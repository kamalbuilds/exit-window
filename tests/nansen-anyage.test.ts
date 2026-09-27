// Proves findAnyAgeCache (src/lib/nansen.ts), the second-level fallback report.ts and
// overlap.ts reach for once nansenCall's own exact-key stale cache has nothing: it scans the
// call log for the newest successful call on an endpoint whose logged request fields match,
// reconstructs that call's exact cache key, and reads whatever's still cached for it - even
// though the CURRENT request's own key (a different date range, in pnl-summary's case) was
// never cached at all.
//
// Real timers throughout: nansenCall writes its disk-cache entry and log line fire-and-forget
// (never awaited, so a real disk write never holds up the response), and vi.useFakeTimers()
// also fakes setImmediate/setTimeout - which would stop those pending real fs writes from ever
// settling. A short real delay between calls both gives each logged call a distinct
// millisecond-resolution ISO timestamp (for the newest-first sort) and lets the writes land.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NANSEN_API_KEY = "test-fake-key";

import { findAnyAgeCache, nansenCall } from "../src/lib/nansen";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("findAnyAgeCache", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("picks the newest of several logged calls for the same address, across different date ranges", async () => {
    const address = "0xanyage-address-1";

    global.fetch = vi.fn(async () => jsonResponse({ data: { realized_pnl_usd: 111 } })) as unknown as typeof fetch;
    const older = await nansenCall(
      "profiler/perp-pnl-summary",
      { address, date: { from: "2026-01-01", to: "2026-01-02" } },
      (j) => j,
    );
    expect(older.data).toEqual({ data: { realized_pnl_usd: 111 } });
    await delay(20);

    global.fetch = vi.fn(async () => jsonResponse({ data: { realized_pnl_usd: 222 } })) as unknown as typeof fetch;
    const newer = await nansenCall(
      "profiler/perp-pnl-summary",
      { address, date: { from: "2026-02-01", to: "2026-02-02" } },
      (j) => j,
    );
    expect(newer.data).toEqual({ data: { realized_pnl_usd: 222 } });
    await delay(20);

    // Neither of those two exact keys is what's being asked for now - a THIRD, never-cached date
    // range - which is exactly the situation this fallback exists for.
    const fallback = await findAnyAgeCache<{ data: { realized_pnl_usd: number } }>(
      "profiler/perp-pnl-summary",
      (s) => typeof s.address === "string" && s.address.toLowerCase() === address.toLowerCase(),
      (s) => (typeof s.address === "string" && s.date ? { address: s.address, date: s.date } : null),
    );

    expect(fallback).not.toBeNull();
    expect(fallback?.stale).toBe(true);
    expect(fallback?.data).toEqual({ data: { realized_pnl_usd: 222 } }); // the NEWER of the two, not the older
  });

  it("returns null when no logged call for the endpoint matches", async () => {
    const result = await findAnyAgeCache(
      "profiler/perp-pnl-summary",
      (s) => s.address === "0xanyage-address-that-was-never-called",
      (s) => (typeof s.address === "string" && s.date ? { address: s.address, date: s.date } : null),
    );
    expect(result).toBeNull();
  });

  it("captures side and label_type for tgm/perp-positions, enabling reconstruction by coin+side+labelType", async () => {
    global.fetch = vi.fn(async () => jsonResponse({ data: [{ address: "0xcompanion" }] })) as unknown as typeof fetch;
    await nansenCall(
      "tgm/perp-positions",
      {
        token_symbol: "ANYAGETEST",
        label_type: "whale",
        pagination: { page: 1, per_page: 8 },
        filters: { side: "Short" },
        order_by: [{ field: "position_value_usd", direction: "DESC" }],
      },
      (j) => j,
    );
    await delay(20);

    const fallback = await findAnyAgeCache<{ data: unknown[] }>(
      "tgm/perp-positions",
      (s) => s.tokenSymbol === "ANYAGETEST" && s.side === "Short" && s.labelType === "whale",
      (s) =>
        typeof s.tokenSymbol === "string" && typeof s.side === "string" && typeof s.labelType === "string"
          ? {
              token_symbol: s.tokenSymbol,
              label_type: s.labelType,
              pagination: { page: 1, per_page: 8 },
              filters: { side: s.side },
              order_by: [{ field: "position_value_usd", direction: "DESC" }],
            }
          : null,
    );

    expect(fallback).not.toBeNull();
    expect(fallback?.data).toEqual({ data: [{ address: "0xcompanion" }] });
  });
});
