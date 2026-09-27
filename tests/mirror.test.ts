import { afterEach, describe, expect, it, vi } from "vitest";
import { mirrorChange } from "../src/lib/mirror";
import type { PositionChange } from "../src/lib/types";

// HL_API_WALLET_KEY / HL_ACCOUNT_ADDRESS deliberately unset (paper mode): mirrorChange must
// return before ever calling preparePerpClose/fetchBuilderFee/executePerpAction (Nansen), so
// this test can mock only Hyperliquid's public endpoints and still cover the real code path.
describe("mirrorChange pricing a HIP-3 coin (paper mode)", () => {
  const realFetch = global.fetch;
  const realKey = process.env.HL_API_WALLET_KEY;
  const realAddr = process.env.HL_ACCOUNT_ADDRESS;

  afterEach(() => {
    global.fetch = realFetch;
    if (realKey === undefined) delete process.env.HL_API_WALLET_KEY;
    else process.env.HL_API_WALLET_KEY = realKey;
    if (realAddr === undefined) delete process.env.HL_ACCOUNT_ADDRESS;
    else process.env.HL_ACCOUNT_ADDRESS = realAddr;
  });

  const change: PositionChange = {
    coin: "xyz:CL",
    kind: "reduce",
    direction: "long",
    fromSize: 100,
    toSize: 40,
    reducedFraction: 0.6,
    at: Date.now(),
  };

  function mockFetch(mids: Record<string, string>, followerSize: string) {
    const calls: { type: string; dex?: string }[] = [];
    global.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { type: string; dex?: string };
      calls.push(body);
      if (body.type === "allMids") {
        return new Response(JSON.stringify(body.dex === "xyz" ? mids : {}), { status: 200 });
      }
      if (body.type === "clearinghouseState") {
        const assetPositions =
          body.dex === "xyz"
            ? [
                {
                  position: {
                    coin: "xyz:CL",
                    szi: followerSize,
                    entryPx: "90",
                    unrealizedPnl: "0",
                  },
                },
              ]
            : [];
        return new Response(JSON.stringify({ assetPositions }), { status: 200 });
      }
      throw new Error(`unexpected call: ${body.type}`);
    }) as typeof fetch;
    return calls;
  }

  it("prices xyz:CL through the xyz-scoped allMids call and reads the follower's xyz:CL size via dex-fanned-out clearinghouseState", async () => {
    delete process.env.HL_API_WALLET_KEY;
    delete process.env.HL_ACCOUNT_ADDRESS;
    const calls = mockFetch({ "xyz:CL": "93.318" }, "100");

    const result = await mirrorChange(change, "0xfollower");

    expect(result.mode).toBe("paper");
    expect(result.price).toBe(93.318);
    expect(result.followerSizeBefore).toBe(100);
    // reducedFraction 0.6 * 100 = 60 units, well under MIRROR_MAX_USD's default $100 cap only if
    // priced right; assert the actual size/usd math used the xyz mid, not a stray 0/undefined.
    expect(result.sizeToClose).toBeGreaterThan(0);
    expect(result.usdValue).toBeCloseTo(result.sizeToClose * 93.318, 5);
    expect(result.executed).toBe(false); // paper mode never reaches Nansen
    expect(calls.some((c) => c.type === "allMids" && c.dex === "xyz")).toBe(true);
    expect(calls.some((c) => c.type === "clearinghouseState" && c.dex === "xyz")).toBe(true);
  });

  it("refuses when a HIP-3 coin has no mid on its own dex (price <= 0 guard still holds)", async () => {
    delete process.env.HL_API_WALLET_KEY;
    delete process.env.HL_ACCOUNT_ADDRESS;
    // Different dex ("io") than the prior test's "xyz" so hyperliquid.ts's 15s per-dex mids
    // cache (keyed by dex) can't serve this test the previous test's cached price.
    const ioChange: PositionChange = { ...change, coin: "io:NBIS" };
    global.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { type: string; dex?: string };
      if (body.type === "allMids") return new Response(JSON.stringify({}), { status: 200 }); // io allMids has no NBIS entry
      throw new Error(`unexpected call: ${body.type}`);
    }) as typeof fetch;

    const result = await mirrorChange(ioChange, "0xfollower");

    expect(result.executed).toBe(false);
    expect(result.price).toBe(0);
    expect(result.refusalReason).toContain("No live mid price for io:NBIS");
  });
});
