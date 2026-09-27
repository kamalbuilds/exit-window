import { describe, expect, it } from "vitest";
import {
  bandsFromReduces,
  bubbleSize,
  classifyFill,
  clusterBubbles,
  passesMinSize,
  valueWeightedEntry,
  type ChartMarker,
} from "../src/lib/chart";
import { walletLabel } from "../src/components/format";
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

describe("passesMinSize", () => {
  it("any lets everything through", () => {
    expect(passesMinSize(1, "any")).toBe(true);
  });

  it("thresholds use absolute usd", () => {
    expect(passesMinSize(-5000, "1k")).toBe(true);
    expect(passesMinSize(500, "1k")).toBe(false);
    expect(passesMinSize(10_000, "10k")).toBe(true);
    expect(passesMinSize(9_999, "10k")).toBe(false);
    expect(passesMinSize(100_000, "100k")).toBe(true);
    expect(passesMinSize(99_999, "100k")).toBe(false);
  });
});

describe("bubbleSize", () => {
  it("is monotonic and bounded to [18, 34] by default", () => {
    expect(bubbleSize(0)).toBeCloseTo(18, 5);
    expect(bubbleSize(1_000_000)).toBeCloseTo(34, 5);
    const small = bubbleSize(300);
    const big = bubbleSize(300_000);
    expect(small).toBeGreaterThan(18);
    expect(small).toBeLessThan(big);
    expect(big).toBeLessThan(34);
  });

  it("clamps sizes above the $1M reference", () => {
    expect(bubbleSize(50_000_000)).toBeCloseTo(34, 5);
  });

  it("uses the magnitude of a negative (sell) usd", () => {
    expect(bubbleSize(-300_000)).toBeCloseTo(bubbleSize(300_000), 5);
  });
});

describe("clusterBubbles", () => {
  it("merges points within the radius and keeps far points separate", () => {
    const clusters = clusterBubbles(
      [
        { x: 0, y: 0, id: "a" },
        { x: 5, y: 5, id: "b" },
        { x: 100, y: 100, id: "c" },
      ],
      14,
    );
    expect(clusters).toHaveLength(2);
    const merged = clusters.find((c) => c.items.length === 2)!;
    expect(merged.items.map((i) => i.id).sort()).toEqual(["a", "b"]);
    expect(merged.x).toBeCloseTo(2.5, 5);
    expect(merged.y).toBeCloseTo(2.5, 5);
    const solo = clusters.find((c) => c.items.length === 1)!;
    expect(solo.items[0].id).toBe("c");
  });

  it("a check that can fail: distant points never merge", () => {
    const clusters = clusterBubbles(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
      14,
    );
    expect(clusters).toHaveLength(2);
  });

  it("keeps every point in its own cluster when the list is empty or singleton", () => {
    expect(clusterBubbles([])).toHaveLength(0);
    expect(clusterBubbles([{ x: 1, y: 1 }])).toHaveLength(1);
  });
});

describe("walletLabel (hover card label cleanup)", () => {
  it("hides a referral-code label behind the cohort fallback", () => {
    expect(walletLabel('Uses "ABC123" HL Referral Code', "0xabc")).toBe("Smart Money wallet");
  });

  it("hides the junk 'High Balance' label", () => {
    expect(walletLabel("High Balance", "0xabc")).toBe("Smart Money wallet");
  });

  it("keeps a real label", () => {
    expect(walletLabel("Whale #4", "0xabc")).toBe("Whale #4");
  });
});
