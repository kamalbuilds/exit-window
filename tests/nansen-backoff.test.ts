// Proves the credit-burn fix added to src/lib/nansen.ts: once a key's refresh fails, that exact
// key (and, after 5 consecutive failures anywhere, every key) stops touching the network until
// its backoff/breaker window elapses - serving stale when there is any, failing fast when there
// isn't - and none of that blocked traffic writes a data/nansen-calls.jsonl line (only a real
// network attempt does).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NANSEN_API_KEY = "test-fake-key";

import { NansenTimeoutError, __resetBackoffStateForTests, nansenCall, readCallLog } from "../src/lib/nansen";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// logCall's appendFile is fire-and-forget (never awaited, by design - a slow disk must never
// hold up a real response), so a call-log assertion needs a short REAL delay after each
// nansenCall to let that write land before counting lines. Same hazard and same fix as
// tests/nansen-anyage.test.ts's `delay`. Real timers only; do not mix with vi.useFakeTimers().
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("nansen per-key backoff", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    __resetBackoffStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = realFetch;
  });

  it("blocks a key with no stale cache for 60s after a failure, then doubles on the next failure", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      throw new Error("simulated network failure");
    }) as unknown as typeof fetch;

    // endpoint deliberately not in TTL_MS -> never cached, so this key can never have a stale
    // fallback; isolates the "no stale" doubling-backoff branch from the stale-serving one.
    const call = () => nansenCall("test/backoff-nottl", { p: 1 }, (j) => j, { retries: 0 });

    await expect(call()).rejects.toBeInstanceOf(NansenTimeoutError);
    expect(calls).toBe(1); // real network attempt

    await expect(call()).rejects.toBeInstanceOf(NansenTimeoutError);
    expect(calls).toBe(1); // blocked by the fresh 60s backoff, no network attempt

    await vi.advanceTimersByTimeAsync(61_000);
    await expect(call()).rejects.toBeInstanceOf(NansenTimeoutError);
    expect(calls).toBe(2); // backoff elapsed, network attempted and failed again -> now doubles to 120s

    await vi.advanceTimersByTimeAsync(61_000); // past the old 60s window, short of the new 120s one
    await expect(call()).rejects.toBeInstanceOf(NansenTimeoutError);
    expect(calls).toBe(2); // still blocked: this failure's backoff doubled instead of resetting

    await vi.advanceTimersByTimeAsync(60_000); // now past 120s total
    await expect(call()).rejects.toBeInstanceOf(NansenTimeoutError);
    expect(calls).toBe(3);
  });

  it("serves stale for 10 minutes after a failure, with zero further network attempts while blocked", async () => {
    global.fetch = vi.fn(async () => jsonResponse({ data: [{ seen: "fresh" }] })) as unknown as typeof fetch;

    const first = await nansenCall("profiler/perp-positions", { address: "0xbackoff-stale-test" }, (j) => j, {
      retries: 0,
    });
    expect(first.data).toEqual({ data: [{ seen: "fresh" }] });

    await vi.advanceTimersByTimeAsync(31_000); // past profiler/perp-positions' 30s TTL

    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      throw new Error("simulated network failure");
    }) as unknown as typeof fetch;

    const second = await nansenCall("profiler/perp-positions", { address: "0xbackoff-stale-test" }, (j) => j, {
      retries: 0,
    });
    expect(second.stale).toBe(true);
    expect(second.data).toEqual({ data: [{ seen: "fresh" }] }); // real stale data, not blank
    expect(calls).toBe(1); // this one call was a real network attempt

    const third = await nansenCall("profiler/perp-positions", { address: "0xbackoff-stale-test" }, (j) => j, {
      retries: 0,
    });
    expect(third.stale).toBe(true);
    expect(third.data).toEqual({ data: [{ seen: "fresh" }] });
    expect(calls).toBe(1); // blocked by the 10min stale-backoff window, no second network attempt

    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    global.fetch = vi.fn(async () => jsonResponse({ data: [{ seen: "recovered" }] })) as unknown as typeof fetch;
    const fourth = await nansenCall("profiler/perp-positions", { address: "0xbackoff-stale-test" }, (j) => j, {
      retries: 0,
    });
    expect(fourth.data).toEqual({ data: [{ seen: "recovered" }] }); // 10min elapsed, network reattempted
    expect(fourth.stale).toBe(false);
  });
});

describe("nansen backoff/breaker call-log suppression (real timers)", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    __resetBackoffStateForTests();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("writes a log line for a real failed attempt but zero lines for the backoff-blocked retry", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      throw new Error("simulated network failure");
    }) as unknown as typeof fetch;

    await expect(
      nansenCall("test/backoff-logline", { p: 1 }, (j) => j, { retries: 0 }),
    ).rejects.toBeInstanceOf(NansenTimeoutError);
    await delay(20); // let the fire-and-forget log write for that real attempt land
    const linesAfterRealAttempt = (await readCallLog()).length;

    await expect(
      nansenCall("test/backoff-logline", { p: 1 }, (j) => j, { retries: 0 }),
    ).rejects.toBeInstanceOf(NansenTimeoutError);
    await delay(20);

    expect(calls).toBe(1); // second call blocked by fresh 60s backoff, no network attempt
    expect((await readCallLog()).length).toBe(linesAfterRealAttempt); // and wrote no new line
  });

  it("writes 5 log lines for 5 real failures that open the breaker, then zero for the breaker-blocked call", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      throw new Error("simulated network failure");
    }) as unknown as typeof fetch;

    for (let i = 0; i < 5; i++) {
      await expect(
        nansenCall(`test/breaker-logline-${i}`, { p: i }, (j) => j, { retries: 0 }),
      ).rejects.toBeInstanceOf(NansenTimeoutError);
    }
    await delay(20); // let all 5 fire-and-forget log writes land
    const linesAfter5Failures = (await readCallLog()).length;

    await expect(
      nansenCall("test/breaker-logline-fresh", { p: "fresh" }, (j) => j, { retries: 0 }),
    ).rejects.toBeInstanceOf(NansenTimeoutError);
    await delay(20);

    expect(calls).toBe(5); // breaker open: the 6th, fresh key never touched the network
    expect((await readCallLog()).length).toBe(linesAfter5Failures); // and wrote no new line
  });
});

describe("nansen global circuit breaker", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    __resetBackoffStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = realFetch;
  });

  it("opens after 5 consecutive failures on different endpoints and blocks a brand-new key with no network attempt", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      throw new Error("simulated network failure");
    }) as unknown as typeof fetch;

    for (let i = 0; i < 5; i++) {
      await expect(
        nansenCall(`test/breaker-fail-${i}`, { p: i }, (j) => j, { retries: 0 }),
      ).rejects.toBeInstanceOf(NansenTimeoutError);
    }
    expect(calls).toBe(5); // all 5 were real attempts on 5 distinct, never-before-seen keys

    await expect(
      nansenCall("test/breaker-fresh-key", { p: "never seen before" }, (j) => j, { retries: 0 }),
    ).rejects.toBeInstanceOf(NansenTimeoutError);
    expect(calls).toBe(5); // breaker open: this fresh, never-failed key never touched the network either

    await vi.advanceTimersByTimeAsync(3 * 60_000 + 1_000);
    global.fetch = vi.fn(async () => jsonResponse({ data: [] })) as unknown as typeof fetch;
    const recovered = await nansenCall("test/breaker-fresh-key", { p: "never seen before" }, (j) => j, {
      retries: 0,
    });
    expect(recovered.data).toEqual({ data: [] }); // breaker closed, network reattempted and succeeded
  });
});
