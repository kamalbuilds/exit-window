import { describe, expect, it } from "vitest";
import { computeAlarmReplay } from "../src/lib/report";
import type { Candle } from "../src/lib/hyperliquid";
import type { Episode } from "../src/lib/types";

const BASE = 1_700_000_000_000;

function candle(t: number, T: number, o: number, c: number): Candle {
  return { t, T, o, c, h: Math.max(o, c), l: Math.min(o, c), v: 1 };
}

/** A closed 2-clip long episode: reduce to 90 at open+90 (px 100), fully out 10 minutes later
 * (px 90). closedAt !== exits[0].t, so alarm/wait replay points genuinely differ. */
function episode(coin: string, base: number, direction: Episode["direction"] = "long"): Episode {
  return {
    coin,
    direction,
    openedAt: base,
    closedAt: base + 600_000,
    observedOpen: false, // deliberately unobserved: alarmReplay must not need it
    entries: [],
    exits: [
      { t: base, px: 100, sz: 1 },
      { t: base + 600_000, px: 90, sz: 1 },
    ],
    peakSize: 2,
    avgEntryPx: 0,
    avgExitPx: 95,
    realizedPnlUsd: -10,
    walletReturnPct: null,
  };
}

describe("computeAlarmReplay", () => {
  it("returns null with no episodes or no usable candles", () => {
    expect(computeAlarmReplay([], [])).toBeNull();
    const ep = episode("BTC", BASE);
    expect(computeAlarmReplay([ep], [null])).toBeNull();
    expect(computeAlarmReplay([ep], [[]])).toBeNull();
  });

  it("excludes a still-open episode (closedAt null) even with candles present", () => {
    const open: Episode = { ...episode("BTC", BASE), closedAt: null };
    const candles = [candle(BASE + 50_000, BASE + 70_000, 98, 97.5)];
    expect(computeAlarmReplay([open], [candles])).toBeNull();
  });

  it("computes alarm/wait/hold percentages anchored to the first-reduce price, direction-adjusted", () => {
    const ep = episode("BTC", BASE, "long");
    // alarm point: BASE+60s -> open 98 => alarmPct = (98-100)/100*100 = -2
    // wait point: closedAt(+600s)+60s -> open 85 => waitPct = (85-100)/100*100 = -15
    // hold point: BASE+24h, exact match -> open 70 => holdPct = (70-100)/100*100 = -30
    const candles: Candle[] = [
      candle(BASE + 50_000, BASE + 70_000, 98, 97.5),
      candle(BASE + 650_000, BASE + 670_000, 85, 84.5),
      candle(BASE + 86_390_000, BASE + 86_410_000, 70, 69.5),
    ];
    const replay = computeAlarmReplay([ep], [candles]);
    expect(replay).not.toBeNull();
    expect(replay?.episodes).toBe(1);
    const row = replay?.perEpisode[0];
    expect(row?.alarmPct).toBeCloseTo(-2, 5);
    expect(row?.waitPct).toBeCloseTo(-15, 5);
    expect(row?.holdPct).toBeCloseTo(-30, 5);
    expect(replay?.savedVsWaitingPct).toBeCloseTo(13, 5); // -2 - (-15)
    expect(replay?.savedVsHoldingPct).toBeCloseTo(28, 5); // -2 - (-30)
    expect(replay?.bestSaveCoin).toBe("BTC");
    expect(replay?.bestSavePct).toBeCloseTo(13, 5);
  });

  it("flips the sign for a short: price falling after the alarm is a save, not a loss", () => {
    const ep = episode("ETH", BASE, "short");
    const candles: Candle[] = [candle(BASE + 50_000, BASE + 70_000, 95, 94)]; // price fell to 95
    const replay = computeAlarmReplay([ep], [candles]);
    // short: pct = (95-100)/100 * -1 * 100 = +5 (a fall is a gain for a short)
    expect(replay?.perEpisode[0].alarmPct).toBeCloseTo(5, 5);
  });

  it("falls back to the last available candle's close when the 24h hold point is beyond the fetched range", () => {
    const ep = episode("SOL", BASE, "long");
    const candles: Candle[] = [
      candle(BASE + 50_000, BASE + 70_000, 95, 94), // alarm: open 95 -> alarmPct -5
      candle(BASE + 650_000, BASE + 670_000, 80, 78), // wait: open 80 -> waitPct -20
      candle(BASE + 700_000, BASE + 720_000, 75, 72), // last fetched candle, closes at 72
    ];
    // BASE+24h is far beyond the last candle's close time (BASE+720_000) -> fallback to its close.
    const replay = computeAlarmReplay([ep], [candles]);
    expect(replay?.perEpisode[0].holdPct).toBeCloseTo(-28, 5); // (72-100)/100*100
  });

  it("excludes an episode with no candles but keeps the rest, and means/bestSave span only the included ones", () => {
    const btc = episode("BTC", BASE, "long");
    const eth = episode("ETH", BASE + 200_000_000, "long");
    const noCandles = episode("DOGE", BASE + 400_000_000, "long");

    const btcCandles: Candle[] = [
      candle(btc.exits[0].t + 50_000, btc.exits[0].t + 70_000, 98, 97.5), // alarmPct -2
      candle((btc.closedAt as number) + 50_000, (btc.closedAt as number) + 70_000, 85, 84.5), // waitPct -15
      candle(btc.exits[0].t + 86_390_000, btc.exits[0].t + 86_410_000, 70, 69.5), // holdPct -30
    ];
    // episode()'s reference price is always 100 (exits[0].px), regardless of coin.
    const ethCandles: Candle[] = [
      candle(eth.exits[0].t + 50_000, eth.exits[0].t + 70_000, 97, 96.5), // alarmPct -3
      candle((eth.closedAt as number) + 50_000, (eth.closedAt as number) + 70_000, 93, 92.5), // waitPct -7
      candle(eth.exits[0].t + 86_390_000, eth.exits[0].t + 86_410_000, 75, 74.5), // holdPct -25
    ];

    const replay = computeAlarmReplay([btc, eth, noCandles], [btcCandles, ethCandles, null]);
    expect(replay?.episodes).toBe(2);
    // BTC save vs waiting = -2-(-15) = 13; ETH save vs waiting = -3-(-7) = 4; mean = 8.5
    expect(replay?.savedVsWaitingPct).toBeCloseTo(8.5, 5);
    // BTC save vs holding = -2-(-30) = 28; ETH save vs holding = -3-(-25) = 22; mean = 25
    expect(replay?.savedVsHoldingPct).toBeCloseTo(25, 5);
    expect(replay?.bestSaveCoin).toBe("BTC"); // 13 > 4
    expect(replay?.bestSavePct).toBeCloseTo(13, 5);
  });
});
