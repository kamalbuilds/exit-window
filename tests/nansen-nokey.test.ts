// A fresh clone runs without NANSEN_API_KEY on the committed seed. A missing key must reach
// callers as NansenCreditsError (every route's cache/seed/Hyperliquid fallback keys on it), must
// never touch the network, and must never count toward the circuit breaker.
import { afterEach, describe, expect, it, vi } from "vitest";

delete process.env.NANSEN_API_KEY;

import { NansenCreditsError, __resetBackoffStateForTests, nansenCall } from "../src/lib/nansen";

describe("nansen without a key", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    __resetBackoffStateForTests();
  });

  it("throws NansenCreditsError without fetching, every time", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    // Six uncached calls: past the breaker's 5-failure threshold, so a missing key that counted as
    // a network failure would start surfacing as NansenTimeoutError here.
    for (let i = 0; i < 6; i++) {
      await expect(nansenCall(`test/nokey-${i}`, { i }, (j) => j, { retries: 0 })).rejects.toBeInstanceOf(NansenCreditsError);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
