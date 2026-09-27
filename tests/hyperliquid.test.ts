import { afterEach, describe, expect, it, vi } from "vitest";
import { attachMarkPrices, dexPrefix } from "../src/lib/hyperliquid";

describe("dexPrefix", () => {
  it("extracts the dex namespace from a HIP-3 coin name", () => {
    expect(dexPrefix("xyz:CL")).toBe("xyz");
    expect(dexPrefix("xyz:BRENTOIL")).toBe("xyz");
    expect(dexPrefix("io:NBIS")).toBe("io");
  });

  it("returns the main dex (empty string) for a plain coin", () => {
    expect(dexPrefix("ETH")).toBe("");
    expect(dexPrefix("HYPE")).toBe("");
  });
});

describe("attachMarkPrices", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("routes each position's mark lookup through its own dex's allMids call", async () => {
    const calls: unknown[] = [];
    global.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { type: string; dex?: string };
      calls.push(body);
      const byDex: Record<string, Record<string, string>> = {
        "": { ETH: "4500.1" },
        xyz: { "xyz:CL": "93.318" },
        io: { "io:NBIS": "239.785" },
      };
      return new Response(JSON.stringify(byDex[body.dex ?? ""] ?? {}), { status: 200 });
    }) as typeof fetch;

    const positions = [
      { coin: "ETH", markPx: null },
      { coin: "xyz:CL", markPx: null },
      { coin: "io:NBIS", markPx: null },
    ];
    const out = await attachMarkPrices(positions);

    expect(out.find((p) => p.coin === "ETH")?.markPx).toBe(4500.1);
    expect(out.find((p) => p.coin === "xyz:CL")?.markPx).toBe(93.318);
    expect(out.find((p) => p.coin === "io:NBIS")?.markPx).toBe(239.785);
    // one allMids call per distinct dex present in the position list, not one per position
    expect(calls.length).toBe(3);
  });
});
