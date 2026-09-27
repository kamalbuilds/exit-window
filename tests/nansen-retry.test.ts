// Proves the three reliability guarantees added to src/lib/nansen.ts's rawFetch:
// a transient network failure is retried with backoff and can still succeed, retries
// exhausted throw a typed NansenTimeoutError (never a bare Error, never a silent empty
// result), and no more than MAX_INFLIGHT Nansen calls are ever in flight at once.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// nansenCall reads NANSEN_API_KEY at call time; a fake value keeps this test independent
// of whatever real key is (or isn't) present in the environment it runs under.
process.env.NANSEN_API_KEY = "test-fake-key";

import { NansenCreditsError, NansenTimeoutError, nansenCall } from "../src/lib/nansen";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("nansen rawFetch reliability", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = realFetch;
  });

  it("retries a network failure and succeeds once the underlying call recovers", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("simulated network failure");
      return jsonResponse({ data: [{ ok: true }] });
    }) as unknown as typeof fetch;

    const promise = nansenCall(
      "test/retry-success",
      { probe: "a" },
      (j) => j,
      { retries: 2 },
    );
    await vi.advanceTimersByTimeAsync(10_000); // covers the 1s + 2s backoff, well under the 60s per-call timeout
    const result = await promise;

    expect(calls).toBe(3);
    expect(result.data).toEqual({ data: [{ ok: true }] });
  });

  it("throws a typed NansenTimeoutError carrying retryAfterSec once retries are exhausted", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("simulated network failure");
    }) as unknown as typeof fetch;

    const promise = nansenCall(
      "test/retry-exhausted",
      { probe: "b" },
      (j) => j,
      { retries: 2 },
    );
    const assertion = expect(promise).rejects.toBeInstanceOf(NansenTimeoutError);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it("carries the Retry-After header value into retryAfterSec on exhausted 429s", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
          headers: { "Retry-After": "17" },
        }),
    ) as unknown as typeof fetch;

    let caught: unknown;
    const promise = nansenCall("test/retry-429", { probe: "c" }, (j) => j, { retries: 1 }).catch((e) => {
      caught = e;
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await promise;

    expect(caught).toBeInstanceOf(NansenTimeoutError);
    expect((caught as InstanceType<typeof NansenTimeoutError>).retryAfterSec).toBe(17);
  });

  it("never runs more than 3 Nansen calls at once, queuing the rest", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: (() => void)[] = [];
    global.fetch = vi.fn(() => {
      active++;
      maxActive = Math.max(maxActive, active);
      return new Promise<Response>((resolve) => {
        releases.push(() => {
          active--;
          resolve(jsonResponse({ data: [] }));
        });
      });
    }) as unknown as typeof fetch;

    const calls = Array.from({ length: 6 }, (_, i) =>
      nansenCall(`test/concurrency-${i}`, { probe: `slot-${i}` }, (j) => j, { retries: 0 }),
    );
    await vi.advanceTimersByTimeAsync(0); // let all 6 attempt to acquire a slot

    expect(active).toBe(3); // hard cap: only 3 in flight, 3 queued behind it

    releases.splice(0, 3).forEach((r) => r());
    await vi.advanceTimersByTimeAsync(0); // released slots backfill from the queue

    expect(active).toBe(3);

    releases.splice(0, releases.length).forEach((r) => r());
    await Promise.all(calls);

    expect(maxActive).toBe(3);
  });
});

describe("nansen rawFetch credits handling", () => {
  const realFetch = global.fetch;
  // The credits latch is keyed on Date.now(), which useFakeTimers() resets to the actual
  // wall clock at the start of each test. A fixed "jump 24h past real now" offset isn't
  // enough either: real wall-clock time barely moves between tests (sub-second), so every
  // test would land at nearly the same fake "now" and a latch the previous test set (up to
  // 5 min past ITS start) would still be active. Use a monotonically growing offset instead
  // so each test's clock starts strictly later than any latch a prior test could have set.
  let testClockOffsetMs = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    testClockOffsetMs += 24 * 60 * 60_000;
    vi.setSystemTime(Date.now() + testClockOffsetMs);
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = realFetch;
  });

  it("throws NansenCreditsError on 403 insufficient_credits without retrying", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      return new Response(JSON.stringify({ code: "insufficient_credits" }), { status: 403 });
    }) as unknown as typeof fetch;

    await expect(
      nansenCall("test/credits-no-retry", { probe: "d" }, (j) => j, { retries: 2 }),
    ).rejects.toBeInstanceOf(NansenCreditsError);

    expect(calls).toBe(1); // never retried, even though retries: 2 would otherwise allow 3 attempts
  });

  it("latches after a credits error: a later call skips the network until the window elapses", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      return new Response(JSON.stringify({ code: "insufficient_credits" }), { status: 403 });
    }) as unknown as typeof fetch;

    await expect(
      nansenCall("test/credits-latch-trip", { probe: "e" }, (j) => j, { retries: 0 }),
    ).rejects.toBeInstanceOf(NansenCreditsError);
    expect(calls).toBe(1);

    // A completely different endpoint, called right after: the latch should block it before it
    // ever reaches fetch, so a burst of parallel requests can't keep hammering an exhausted key.
    await expect(
      nansenCall("test/credits-latch-blocked", { probe: "f" }, (j) => j, { retries: 0 }),
    ).rejects.toBeInstanceOf(NansenCreditsError);
    expect(calls).toBe(1); // still 1: the second call never touched the network

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000); // past the 5-minute latch window
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await nansenCall("test/credits-latch-cleared", { probe: "g" }, (j) => j, { retries: 0 });
    expect(result.data).toEqual({ data: [] }); // network reachable again once the latch elapses
  });

  it("serves stale cached data instead of failing outright when credits run out mid-window", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      return new Response(JSON.stringify({ data: [{ seen: "first" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    // profiler/perp-trades is a real cached endpoint (30 min TTL); this primes memCache for a
    // request body unique to this test.
    const first = await nansenCall("profiler/perp-trades", { address: "0xcredits-stale-test" }, (j) => j);
    expect(first.data).toEqual({ data: [{ seen: "first" }] });
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(31 * 60_000); // past the endpoint's own TTL

    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ code: "insufficient_credits" }), { status: 403 }),
    ) as unknown as typeof fetch;
    const second = await nansenCall("profiler/perp-trades", { address: "0xcredits-stale-test" }, (j) => j);

    expect(second.stale).toBe(true);
    expect(second.data).toEqual({ data: [{ seen: "first" }] }); // stale but real, never a blank result
  });
});
