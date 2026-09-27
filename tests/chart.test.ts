import { describe, expect, it } from "vitest";
import { bandsFromReduces, classifyFill, valueWeightedEntry, type ChartMarker } from "../src/lib/chart";
import type { Candle } from "../src/lib/hyperliquid";
import type { Fill } from "../src/lib/types";

const BASE = 1_700_000_000_000;
const MIN = 60_000;

function candle(tOffsetMin: number, low: number, high: number): Candle {
  return { t: BASE + tOffsetMin * MIN, T: BASE + (tOffsetMin + 1) * MIN, o: (low + high) / 2, h: high, l: low, c: (low + high) / 2, v: 0 };
}

function fill(over: Partial<Fill>): Fill {
  return { t: BASE, coin: "BTC", isBuy: true, px: 100, sz: 1, startPosition: 0, closedPnl: 0, feeUsd: 0, hash: "0x", oid: 1, ...over };
}

function marker(over: Partial<ChartMarker>): ChartMarker {
  return { t: BASE, px: 100, side: "Long", action: "Reduce", usd: 1000, label: "w", address: "0xabc", ...over };
}

describe("valueWeightedEntry", () => {
  it("weights entry price by position value", () => {
    const v = valueWeightedEntry([
      { entryPx: 100, positionValueUsd: 1000 },
      { entryPx: 200, positionValueUsd: 3000 },
    ]);
    // (100*1000 + 200*3000) / 4000 = 175
    expect(v).toBeCloseTo(175, 5);
  });

  it("ignores non-positive entry/value rows", () => {
    const v = valueWeightedEntry([
      { entryPx: 100, positionValueUsd: 1000 },
      { entryPx: 0, positionValueUsd: 500 },
      { entryPx: 50, positionValueUsd: 0 },
    ]);
    expect(v).toBe(100);
  });

  it("returns null with no usable weight", () => {
    expect(valueWeightedEntry([])).toBeNull();
    expect(valueWeightedEntry([{ entryPx: 0, positionValueUsd: 0 }])).toBeNull();
  });
});

describe("classifyFill", () => {
  it("Open: starts flat, buys into a long", () => {
    const { action, direction } = classifyFill(fill({ startPosition: 0, isBuy: true, sz: 2 }));
    expect(action).toBe("Open");
    expect(direction).toBe("long");
  });

  it("Add: already long, buys more", () => {
    const { action, direction } = classifyFill(fill({ startPosition: 2, isBuy: true, sz: 1 }));
    expect(action).toBe("Add");
    expect(direction).toBe("long");
  });

  it("Reduce: long position, sells part of it", () => {
    const { action, direction } = classifyFill(fill({ startPosition: 3, isBuy: false, sz: 1 }));
    expect(action).toBe("Reduce");
    expect(direction).toBe("long");
  });

  it("Close: long position, sells all of it", () => {
    const { action, direction } = classifyFill(fill({ startPosition: 2, isBuy: false, sz: 2 }));
    expect(action).toBe("Close");
    expect(direction).toBe("long");
  });

  it("Reduce: a flip through zero still reduces the prior side", () => {
    const { action, direction } = classifyFill(fill({ startPosition: 1, isBuy: false, sz: 3 }));
    expect(action).toBe("Reduce");
    expect(direction).toBe("long"); // prior side was long
  });

  it("short side: Open on a sell from flat", () => {
    const { action, direction } = classifyFill(fill({ startPosition: 0, isBuy: false, sz: 1 }));
    expect(action).toBe("Open");
    expect(direction).toBe("short");
  });
});

describe("bandsFromReduces", () => {
  it("bands a long reduce until price moves 1% against the holder", () => {
    const candles = [candle(0, 99.5, 100.5), candle(1, 99.2, 100), candle(2, 98.9, 99.5)];
    const markers = [marker({ t: candles[0].t, px: 100, side: "Long", action: "Reduce" })];
    const bands = bandsFromReduces(markers, "BTC", candles, 1, 60);
    expect(bands).toHaveLength(1);
    expect(bands[0].from).toBe(candles[0].t);
    expect(bands[0].to).toBe(candles[0].t + 2 * MIN); // low 98.9 breaches 99 first at t+2m
  });

  it("ignores Open/Add markers and markers outside the candle span", () => {
    const candles = [candle(0, 99.5, 100.5), candle(1, 99.2, 100)];
    const markers = [
      marker({ t: candles[0].t, action: "Open" }),
      marker({ t: candles[0].t, action: "Add" }),
      marker({ t: candles[0].t - 100 * MIN, action: "Reduce" }), // before the candle span
    ];
    expect(bandsFromReduces(markers, "BTC", candles)).toHaveLength(0);
  });

  it("dedupes the same wallet reducing at the same instant", () => {
    const candles = [candle(0, 99.5, 100.5), candle(1, 99.2, 100)];
    const markers = [
      marker({ t: candles[0].t, address: "0xabc", action: "Reduce" }),
      marker({ t: candles[0].t, address: "0xabc", action: "Reduce" }),
      marker({ t: candles[0].t, address: "0xDEF", action: "Reduce" }),
    ];
    expect(bandsFromReduces(markers, "BTC", candles)).toHaveLength(2);
  });

  it("returns no bands when there are no candles", () => {
    expect(bandsFromReduces([marker({})], "BTC", [])).toHaveLength(0);
  });
});
