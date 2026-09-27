import { describe, expect, it } from "vitest";
import { measureWindow } from "../src/lib/exitwindow";
import type { Candle } from "../src/lib/hyperliquid";
import type { Episode } from "../src/lib/types";

const BASE = 1_700_000_000_000;
const MIN = 60_000;

function episode(direction: "long" | "short", firstReducePx: number): Episode {
  return {
    coin: "BTC",
    direction,
    openedAt: BASE - 10 * MIN,
    closedAt: null,
    observedOpen: true,
    entries: [{ t: BASE - 10 * MIN, px: 100, sz: 1 }],
    exits: [{ t: BASE, px: firstReducePx, sz: 1 }],
    peakSize: 1,
    avgEntryPx: 100,
    avgExitPx: firstReducePx,
    realizedPnlUsd: 0,
    walletReturnPct: null,
  };
}

function candle(tOffsetMin: number, low: number, high: number): Candle {
  return { t: BASE + tOffsetMin * MIN, T: BASE + (tOffsetMin + 1) * MIN, o: (low + high) / 2, h: high, l: low, c: (low + high) / 2, v: 0 };
}

describe("measureWindow", () => {
  it("long: window closes at the first candle whose low breaches -1%", () => {
    const ep = episode("long", 100);
    const candles = [candle(0, 99.5, 100.5), candle(1, 99.2, 100), candle(2, 98.9, 99.5)];
    const w = measureWindow(ep, candles, 1, 60);
    expect(w.direction).toBe("long");
    expect(w.windowMin).toBe(2); // low 98.9 <= 100 * 0.99 = 99 first at t+2m
  });

  it("short: window closes at the first candle whose high breaches +1%", () => {
    const ep = episode("short", 100);
    const candles = [candle(0, 99.5, 100.5), candle(1, 99.8, 100.9), candle(2, 100, 101.2)];
    const w = measureWindow(ep, candles, 1, 60);
    expect(w.direction).toBe("short");
    expect(w.windowMin).toBe(2); // high 101.2 >= 100 * 1.01 = 101 first at t+2m
  });

  it("never closes within horizon -> windowMin is null, maxAdversePct reflects the worst move seen", () => {
    const ep = episode("long", 100);
    const candles = [candle(0, 99.7, 100.2), candle(1, 99.6, 100.1)];
    const w = measureWindow(ep, candles, 1, 60);
    expect(w.windowMin).toBeNull();
    expect(w.maxAdversePct).toBeCloseTo(0.4, 5); // (100-99.6)/100*100
  });

  it("throws if the episode has no exits (nothing to measure a window from)", () => {
    const ep = episode("long", 100);
    ep.exits = [];
    expect(() => measureWindow(ep, [])).toThrow();
  });
});

describe("measureWindow lateCostPct", () => {
  it("long: positive pct when price is lower (against the holder) at firstReduceAt + delay", () => {
    const ep = episode("long", 100);
    // 1-min candles at offsets 1, 5, 15, 60 cover exactly the 60s/300s/900s/3600s delay points.
    const candles = [candle(1, 98, 100), candle(5, 96, 98), candle(15, 94, 96), candle(60, 90, 92)];
    const w = measureWindow(ep, candles, 1, 4000);
    expect(w.lateCostPct).toEqual([
      { delaySec: 60, pct: 1 }, // open 99, (100-99)/100*100
      { delaySec: 300, pct: 3 }, // open 97
      { delaySec: 900, pct: 5 }, // open 95
      { delaySec: 3600, pct: 9 }, // open 91
    ]);
  });

  it("short: positive pct when price is higher (against the holder) at firstReduceAt + delay", () => {
    const ep = episode("short", 100);
    const candles = [candle(1, 100, 102)]; // open 101
    const w = measureWindow(ep, candles, 1, 4000);
    expect(w.lateCostPct.find((c) => c.delaySec === 60)?.pct).toBe(1);
  });

  it("omits a delay that falls in a gap between fetched candles, instead of faking a 0", () => {
    const ep = episode("long", 100);
    // Covers the 60s and 900s/3600s points (offsets 1 and 15/60 min) but leaves a real gap at the
    // 300s point (offset 5 min) - unlike a delay past the last candle, priceAt can't clamp this.
    const candles = [candle(1, 98, 100), candle(15, 94, 96), candle(60, 90, 92)];
    const w = measureWindow(ep, candles, 1, 4000);
    expect(w.lateCostPct).toEqual([
      { delaySec: 60, pct: 1 },
      { delaySec: 900, pct: 5 },
      { delaySec: 3600, pct: 9 },
    ]);
  });
});
