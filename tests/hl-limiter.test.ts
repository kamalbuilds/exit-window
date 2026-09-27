// Hyperliquid's 1200 weight/min per IP is shared by web, worker and sentinel. One cold /me load
// used to fan out enough reads to 429, so reads of the same wallet must collapse into one call,
// the protection rule must still get a fresh read, and a 429 must be retried rather than surfaced.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchClearinghouseForDex, fetchMidsForDex, hlPost } from "../src/lib/hyperliquid";

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("hyperliquid limiter", () => {
  it("serves parallel reads of one wallet from a single call, but a fresh read goes out", async () => {
    const f = vi.fn(async () => ok({ assetPositions: [] }));
    global.fetch = f as unknown as typeof fetch;
    const addr = "0xdedupe00000000000000000000000000000000001";
    await Promise.all(Array.from({ length: 6 }, () => fetchClearinghouseForDex(addr, "")));
    expect(f).toHaveBeenCalledTimes(1);
    await fetchClearinghouseForDex(addr, "", 0);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("collapses parallel allMids for one dex into one call", async () => {
    const f = vi.fn(async () => ok({ BTC: "1" }));
    global.fetch = f as unknown as typeof fetch;
    const mids = await Promise.all(Array.from({ length: 5 }, () => fetchMidsForDex("testdex")));
    expect(f).toHaveBeenCalledTimes(1);
    expect(mids[4].BTC).toBe(1);
  });

  it("retries a 429 instead of returning it", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(ok({ ETH: "2" }));
    global.fetch = f as unknown as typeof fetch;
    const res = await hlPost({ type: "allMids" }, 2);
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
