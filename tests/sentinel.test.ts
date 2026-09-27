import { describe, expect, it } from "vitest";
import { buildEvent, buildWatchlist, mergeFeed, trimEvents, type CacheFileLike, type LiveExitEvent } from "../src/lib/sentinel";
import type { PositionChange } from "../src/lib/types";

const AT = 1_790_000_000_000;

describe("buildWatchlist", () => {
  it("extracts addresses from all three cached-response shapes and dedupes across them", () => {
    const smartMoneyTrades: CacheFileLike = {
      fetchedAt: AT - 10_000,
      data: [
        { traderAddress: "0xAAA", traderLabel: "HL Perps Whale", coin: "BTC", side: "Long", action: "Reduce", size: 1, priceUsd: 1, valueUsd: 1, at: AT - 5_000 },
        { traderAddress: "0xBBB", traderLabel: "High Activity", coin: "ETH", side: "Short", action: "Add", size: 1, priceUsd: 1, valueUsd: 1, at: AT - 1_000 },
      ],
    };
    const leaderboard: CacheFileLike = {
      fetchedAt: AT - 20_000,
      data: [{ address: "0xCCC", label: "Token Millionaire", totalPnlUsd: 100, realizedPnlUsd: 0, unrealizedPnlUsd: 100, roi: 0.1, accountValue: 1000 }],
    };
    const tgmPositions: CacheFileLike = {
      fetchedAt: AT - 2_000,
      data: [
        { address: "0xAAA", label: "HL Perps Whale", positionValueUsd: 500, size: 10, entryPx: 50, upnlUsd: 0, leverage: null, cohort: "smart_money" },
        { address: "0xDDD", label: "Whale Only", positionValueUsd: 500, size: 10, entryPx: 50, upnlUsd: 0, leverage: null, cohort: "whale" },
      ],
    };

    const watchlist = buildWatchlist([smartMoneyTrades, leaderboard, tgmPositions]);
    const addresses = watchlist.map((w) => w.address);

    expect(addresses).toContain("0xaaa"); // seen in both smart-money trades and tgm smart_money
    expect(addresses).toContain("0xbbb");
    expect(addresses).toContain("0xccc");
    expect(addresses).not.toContain("0xddd"); // whale cohort, not smart_money - excluded

    // Ordered by most recent appearance across all sources: 0xBBB's smart-money row (at AT-1000)
    // is newer than 0xAAA's tgm row (fetchedAt AT-2000), which is newer than its own smart-money
    // row (at AT-5000).
    expect(watchlist[0].address).toBe("0xbbb");
    expect(watchlist[1].address).toBe("0xaaa");
  });

  it("caps the watchlist at the given size, keeping the most recent appearances", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      traderAddress: `0xwallet${i}`,
      traderLabel: "Smart Money",
      coin: "BTC",
      side: "Long",
      action: "Reduce",
      size: 1,
      priceUsd: 1,
      valueUsd: 1,
      at: AT + i, // strictly increasing recency
    }));
    const watchlist = buildWatchlist([{ fetchedAt: AT, data: rows }], 3);
    expect(watchlist).toHaveLength(3);
    expect(watchlist.map((w) => w.address)).toEqual(["0xwallet9", "0xwallet8", "0xwallet7"]);
  });

  it("skips unrecognized record shapes (e.g. address/labels, pnl-summary) without throwing", () => {
    const addressLabels: CacheFileLike = {
      fetchedAt: AT,
      data: [{ label: "HL Perps Whale", category: "behavioral", kind: ["hl-perps-size-tier"] }],
    };
    expect(buildWatchlist([addressLabels])).toEqual([]);
  });
});

describe("buildEvent", () => {
  const reduce: PositionChange = { coin: "BTC", kind: "reduce", direction: "long", fromSize: 10, toSize: 4, reducedFraction: 0.6, at: AT };
  const close: PositionChange = { coin: "ETH", kind: "close", direction: "short", fromSize: 5, toSize: 0, reducedFraction: 1, at: AT };
  const open: PositionChange = { coin: "SOL", kind: "open", direction: "long", fromSize: 0, toSize: 2, reducedFraction: 0, at: AT };
  const add: PositionChange = { coin: "SOL", kind: "add", direction: "long", fromSize: 2, toSize: 4, reducedFraction: 0, at: AT };
  const flip: PositionChange = { coin: "SOL", kind: "flip", direction: "short", fromSize: 2, toSize: 3, reducedFraction: 1, at: AT };

  it("builds a Reduce event with valueUsd = size delta x mark price", () => {
    const event = buildEvent(reduce, "0xaaa", "HL Perps Whale", 100, AT);
    expect(event).toEqual({
      ts: AT,
      address: "0xaaa",
      label: "HL Perps Whale",
      coin: "BTC",
      side: "Long",
      action: "Reduce",
      reducedFraction: 0.6,
      valueUsd: 600, // |10-4| * 100
      price: 100,
    });
  });

  it("builds a Close event", () => {
    const event = buildEvent(close, "0xbbb", null, 2000, AT);
    expect(event?.action).toBe("Close");
    expect(event?.side).toBe("Short");
    expect(event?.valueUsd).toBe(10_000); // |5-0| * 2000
  });

  it("falls back to price 0 (not a dropped event) when no mark is available", () => {
    const event = buildEvent(reduce, "0xaaa", null, null, AT);
    expect(event?.price).toBe(0);
    expect(event?.valueUsd).toBe(0);
  });

  it("ignores open, add and flip - this sentinel only fires on reduce/close", () => {
    expect(buildEvent(open, "0xaaa", null, 100, AT)).toBeNull();
    expect(buildEvent(add, "0xaaa", null, 100, AT)).toBeNull();
    expect(buildEvent(flip, "0xaaa", null, 100, AT)).toBeNull();
  });
});

describe("trimEvents", () => {
  it("keeps only the newest `max` events", () => {
    const events = Array.from({ length: 5 }, (_, i) => ({ ts: AT + i } as LiveExitEvent));
    expect(trimEvents(events, 2)).toEqual([{ ts: AT + 3 }, { ts: AT + 4 }]);
  });

  it("is a no-op under the cap", () => {
    const events = [{ ts: AT } as LiveExitEvent];
    expect(trimEvents(events, 2000)).toEqual(events);
  });
});

describe("mergeFeed", () => {
  it("merges Nansen feed rows and sentinel events, newest first", () => {
    const nansenFeed = [
      { timestamp: AT - 1000, trader_address: "0xaaa", trader_address_label: "HL Perps Whale", token_symbol: "BTC", side: "Long" as const, action: "Reduce", value_usd: 500 },
    ];
    const liveEvents: LiveExitEvent[] = [
      { ts: AT, address: "0xbbb", label: "Token Millionaire", coin: "ETH", side: "Short", action: "Close", reducedFraction: 1, valueUsd: 900, price: 3000 },
    ];
    const merged = mergeFeed(nansenFeed, liveEvents);
    expect(merged).toHaveLength(2);
    expect(merged[0].trader_address).toBe("0xbbb"); // newest first
    expect(merged[1].trader_address).toBe("0xaaa");
  });

  it("dedupes a sentinel event that duplicates an already-known Nansen row", () => {
    const nansenFeed = [
      { timestamp: AT, trader_address: "0xAAA", trader_address_label: "HL Perps Whale", token_symbol: "BTC", side: "Long" as const, action: "Reduce", value_usd: 500 },
    ];
    const liveEvents: LiveExitEvent[] = [
      // Same wallet/coin/action/value within the same minute bucket - a duplicate.
      { ts: AT + 5_000, address: "0xaaa", label: "HL Perps Whale", coin: "BTC", side: "Long", action: "Reduce", reducedFraction: 0.5, valueUsd: 500, price: 100 },
    ];
    expect(mergeFeed(nansenFeed, liveEvents)).toHaveLength(1);
  });
});
