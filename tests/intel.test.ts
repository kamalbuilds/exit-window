import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCohortOneLiner,
  buildPressureRead,
  buildSmartAlertRequest,
  classifyPressure,
  parseLabelsResponse,
  parsePositionIntelligenceResponse,
  parseRelatedWalletsResponse,
  parseSearchTokens,
  pickPerpToken,
  pickSpotToken,
  summarizeSmartMoneyTrades,
  type Reducer,
  type TokenCandidate, pickRecyclableAlert } from "../src/lib/intel";
import type { SmartMoneyPerpTrade } from "../src/lib/nansen";

describe("parseLabelsResponse", () => {
  it("extracts label names and drops empties", () => {
    const json = { data: [{ label: "Smart Trader", category: "smart_money" }, { label: "" }] };
    expect(parseLabelsResponse(json)).toEqual(["Smart Trader"]);
  });

  it("handles a missing data field", () => {
    expect(parseLabelsResponse({})).toEqual([]);
  });
});

describe("parseRelatedWalletsResponse", () => {
  it("maps related-wallets rows to siblings", () => {
    const json = {
      data: [
        {
          address: "0xabc",
          address_label: "Exchange Hot Wallet",
          relation: "funded_by",
          block_timestamp: "2026-01-01T00:00:00Z",
        },
        { address: "0xdef", address_label: null, relation: "funder_of", block_timestamp: "2026-02-01T00:00:00Z" },
      ],
    };
    const siblings = parseRelatedWalletsResponse(json);
    expect(siblings).toHaveLength(2);
    expect(siblings[0]).toMatchObject({ address: "0xabc", label: "Exchange Hot Wallet", relation: "funded_by" });
    expect(siblings[1].label).toBeNull();
    expect(siblings[0].firstSeen).toBeGreaterThan(0);
  });
});

describe("parseSearchTokens", () => {
  it("keeps only exact symbol matches with a real address and chain", () => {
    const json = {
      tokens: [
        { symbol: "HYPE", address: "HYPE", chain: "hyperliquid", market_cap: 20_000_000_000 },
        { symbol: "WHYPE", address: "0x1", chain: "hyperevm" },
        { symbol: "HYPE", address: "0xeeee", chain: "hyperevm", market_cap: 20_000_000_000 },
      ],
    };
    const candidates = parseSearchTokens(json, "HYPE");
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.chain)).toEqual(["hyperliquid", "hyperevm"]);
  });

  it("returns an empty list when nothing resolves", () => {
    expect(parseSearchTokens({ tokens: [] }, "xyz:BRENTOIL")).toEqual([]);
  });
});

describe("pickPerpToken", () => {
  it("picks the hyperliquid (symbolic) entry for tgm/position-intelligence", () => {
    const candidates: TokenCandidate[] = [
      { symbol: "HYPE", chain: "hyperevm", address: "0xeeee", marketCapUsd: 20e9 },
      { symbol: "HYPE", chain: "hyperliquid", address: "HYPE", marketCapUsd: 20e9 },
    ];
    expect(pickPerpToken(candidates)).toEqual({ address: "HYPE", chain: "hyperliquid" });
  });

  it("falls back to the first candidate when there is no hyperliquid entry", () => {
    const candidates: TokenCandidate[] = [{ symbol: "ETHFI", chain: "ethereum", address: "0x1", marketCapUsd: 1 }];
    expect(pickPerpToken(candidates)).toEqual({ address: "0x1", chain: "ethereum" });
  });

  it("returns null for an empty list", () => {
    expect(pickPerpToken([])).toBeNull();
  });
});

describe("pickSpotToken", () => {
  it("prefers hyperevm over an unrelated same-ticker token on another chain", () => {
    const candidates: TokenCandidate[] = [
      { symbol: "HYPE", chain: "hyperliquid", address: "HYPE", marketCapUsd: 20e9 },
      { symbol: "HYPE", chain: "solana", address: "98sM...", marketCapUsd: 74e6 }, // imposter, tiny cap
      { symbol: "HYPE", chain: "hyperevm", address: "0xeeee", marketCapUsd: 20e9 }, // real twin
    ];
    expect(pickSpotToken(candidates)).toEqual({ address: "0xeeee", chain: "hyperevm" });
  });

  it("prefers ethereum when there is no hyperevm candidate", () => {
    const candidates: TokenCandidate[] = [
      { symbol: "ETH", chain: "hyperliquid", address: "ETH", marketCapUsd: 331e9 },
      { symbol: "ETH", chain: "base", address: "0xbase", marketCapUsd: 331e9 },
      { symbol: "ETH", chain: "ethereum", address: "0xeth", marketCapUsd: 331e9 },
    ];
    expect(pickSpotToken(candidates)).toEqual({ address: "0xeth", chain: "ethereum" });
  });

  it("returns null when the only candidate is the symbolic hyperliquid entry", () => {
    const candidates: TokenCandidate[] = [{ symbol: "XYZ", chain: "hyperliquid", address: "XYZ", marketCapUsd: 1 }];
    expect(pickSpotToken(candidates)).toBeNull();
  });
});

describe("parsePositionIntelligenceResponse", () => {
  it("reads the first row and defaults nulls to zero", () => {
    const json = { data: [{ smart_trader_longs_usd: 3_100_000, smart_trader_shorts_usd: 1_000_000 }] };
    const pos = parsePositionIntelligenceResponse(json);
    expect(pos.smartTraderLongUsd).toBe(3_100_000);
    expect(pos.smartTraderShortUsd).toBe(1_000_000);
    expect(pos.whaleLongUsd).toBe(0);
  });

  it("handles an empty data array", () => {
    expect(parsePositionIntelligenceResponse({ data: [] }).smartTraderLongUsd).toBe(0);
  });
});

describe("buildCohortOneLiner", () => {
  it("reports a net-long ratio", () => {
    const line = buildCohortOneLiner("HYPE", { smartTraderLongUsd: 3_100_000, smartTraderShortUsd: 1_000_000 });
    expect(line).toBe("Smart Traders are 3.1x net long HYPE.");
  });

  it("reports a net-short ratio", () => {
    const line = buildCohortOneLiner("ETH", { smartTraderLongUsd: 500_000, smartTraderShortUsd: 2_000_000 });
    expect(line).toBe("Smart Traders are 4.0x net short ETH.");
  });

  it("reports all-long with no shorts", () => {
    expect(buildCohortOneLiner("SOL", { smartTraderLongUsd: 100, smartTraderShortUsd: 0 })).toContain("all-long");
  });

  it("reports no data when both sides are zero", () => {
    expect(buildCohortOneLiner("SOL", { smartTraderLongUsd: 0, smartTraderShortUsd: 0 })).toContain("No Smart Trader");
  });

  it("reports balanced when long equals short", () => {
    expect(buildCohortOneLiner("SOL", { smartTraderLongUsd: 500, smartTraderShortUsd: 500 })).toContain("balanced");
  });
});

describe("buildSmartAlertRequest", () => {
  const prevAppUrl = process.env.APP_URL;
  const prevSecret = process.env.NANSEN_WEBHOOK_SECRET;
  beforeEach(() => {
    process.env.APP_URL = "https://exit-window.fly.dev";
    process.env.NANSEN_WEBHOOK_SECRET = "test-secret";
  });
  afterEach(() => {
    if (prevAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prevAppUrl;
    if (prevSecret === undefined) delete process.env.NANSEN_WEBHOOK_SECRET;
    else process.env.NANSEN_WEBHOOK_SECRET = prevSecret;
  });

  it("watches Smart Money outflow for a long holder, delivered to the signed webhook for this alarm code", () => {
    const body = buildSmartAlertRequest({
      code: "ABC123",
      coin: "HYPE",
      direction: "long",
      tokenAddress: "0xtoken",
      tokenChain: "hyperevm",
    });
    expect(body.type).toBe("sm-token-flows");
    expect(body.channels).toEqual([
      { type: "webhook", data: { webhookUrl: "https://exit-window.fly.dev/api/nansen-webhook?alarm=ABC123", secret: "test-secret" } },
    ]);
    expect(body.data.outflow_1h).toEqual({ min: 250_000 });
    expect(body.data.inflow_1h).toBeUndefined();
    expect(body.data.inclusion.tokens).toEqual([{ chain: "hyperevm", address: "0xtoken" }]);
  });

  it("watches Smart Money inflow for a short holder, with a custom threshold", () => {
    const body = buildSmartAlertRequest({
      code: "XYZ999",
      coin: "ETH",
      direction: "short",
      tokenAddress: "0xeth",
      tokenChain: "ethereum",
      thresholdUsd: 50_000,
    });
    expect(body.data.inflow_1h).toEqual({ min: 50_000 });
    expect(body.data.outflow_1h).toBeUndefined();
  });

  it("throws a clear error instead of building an unsigned webhook when the secret is unset", () => {
    delete process.env.NANSEN_WEBHOOK_SECRET;
    expect(() => buildSmartAlertRequest({ code: "ABC123", coin: "HYPE", direction: "long", tokenAddress: "0xtoken", tokenChain: "hyperevm" })).toThrow(
      /NANSEN_WEBHOOK_SECRET/,
    );
  });
});

function trade(overrides: Partial<SmartMoneyPerpTrade> = {}): SmartMoneyPerpTrade {
  return {
    traderAddress: "0xtrader",
    traderLabel: "Smart Trader",
    coin: "HYPE",
    side: "Long",
    action: "Reduce",
    size: 100,
    priceUsd: 30,
    valueUsd: 3000,
    at: Date.now(),
    ...overrides,
  };
}

describe("summarizeSmartMoneyTrades", () => {
  const now = 1_800_000_000_000;

  it("buckets reduces/adds by coin, side and age, newest reducer first", () => {
    const trades: SmartMoneyPerpTrade[] = [
      trade({ traderAddress: "0x1", action: "Reduce", at: now - 10 * 60_000 }), // 10m ago, in 1h
      trade({ traderAddress: "0x2", action: "Close", at: now - 3 * HOUR_MS() }), // 3h ago, in 6h not 1h
      trade({ traderAddress: "0x3", action: "Add", at: now - 5 * 60_000 }), // add, 1h
      trade({ traderAddress: "0x4", action: "Reduce", coin: "ETH", at: now - 60_000 }), // wrong coin
      trade({ traderAddress: "0x5", action: "Reduce", side: "Short", at: now - 60_000 }), // wrong side
    ];
    const summary = summarizeSmartMoneyTrades(trades, "HYPE", "Long", now);
    expect(summary.reducedLast1h).toBe(1);
    expect(summary.reducedLast6h).toBe(2);
    expect(summary.addedLast1h).toBe(1);
    const addresses: string[] = summary.reducers.map((r: Reducer) => r.address);
    expect(addresses).toEqual(["0x1", "0x2"]); // newest first
  });

  function HOUR_MS() {
    return 60 * 60_000;
  }
});

describe("classifyPressure", () => {
  it("is low when nothing reduced", () => {
    expect(classifyPressure(0, 20)).toBe("low");
  });

  it("is medium when some reduced but below the high threshold", () => {
    expect(classifyPressure(1, 20)).toBe("medium");
  });

  it("is high at the 20% ratio threshold", () => {
    expect(classifyPressure(4, 20)).toBe("high");
  });

  it("is high at 3+ wallets regardless of ratio", () => {
    expect(classifyPressure(3, 1000)).toBe("high");
  });

  it("does not divide by zero when there are no current holders", () => {
    expect(classifyPressure(1, 0)).toBe("medium");
    expect(classifyPressure(3, 0)).toBe("high");
  });
});

describe("buildPressureRead", () => {
  it("names zero reduces plainly", () => {
    expect(buildPressureRead("HYPE", "long", 0, 12)).toBe("No Smart Money HYPE longs have reduced in the last hour.");
  });

  it("names the count and denominator", () => {
    expect(buildPressureRead("HYPE", "long", 3, 12)).toBe("3 of 12 Smart Money HYPE longs reduced in the last hour.");
  });
});

describe("pickRecyclableAlert", () => {
  const mk = (id: string, name: string, createdAt: string, code: string | null) => ({
    id,
    name,
    createdAt,
    webhookUrl: code ? `https://exit-window.fly.dev/api/nansen-webhook?alarm=${code}` : null,
  });
  it("picks the oldest Exit Window alert and never a user's own alert or the one in use", () => {
    const alerts = [
      mk("user", "My BTC alert", "2026-09-01T00:00:00Z", null),
      mk("new", "Exit Window: SM outflow on HYPE", "2026-09-27T12:00:00Z", "NEWCODE"),
      mk("old", "Exit Window: SM outflow on STRK", "2026-09-27T10:00:00Z", "OLDCODE"),
      mk("keep", "Exit Window: SM outflow on ETH", "2026-09-27T09:00:00Z", "KEEPME"),
    ];
    expect(pickRecyclableAlert(alerts, "KEEPME")?.id).toBe("old");
    expect(pickRecyclableAlert([alerts[0]], "X")).toBeNull();
  });
});
