import { describe, expect, it } from "vitest";
import { computeExitRisk, computeFollowLateSummary } from "../src/lib/report";
import type { ExitDna, ExitWindow } from "../src/lib/types";

const BASE = 1_700_000_000_000;

function window(coin: string, lateCostPct: { delaySec: number; pct: number }[]): ExitWindow {
  return {
    coin,
    direction: "long",
    firstReduceAt: BASE,
    firstReducePx: 100,
    thresholdPct: 1,
    windowMin: 30,
    horizonMin: 1440,
    maxAdversePct: 2,
    candleInterval: "1m",
    lateCostPct,
  };
}

function exitDna(overrides: Partial<ExitDna> = {}): ExitDna {
  return {
    sample: 10,
    firstReduceToFlatMedianMin: 38,
    fullExitAfterFirstReducePct: 73,
    medianClips: 1,
    firstReduceAtPnlPct: 5,
    style: "nuclear",
    ...overrides,
  };
}

describe("computeFollowLateSummary", () => {
  it("returns null when no window has any lateCostPct entry", () => {
    expect(computeFollowLateSummary([window("BTC", []), window("ETH", [])])).toBeNull();
    expect(computeFollowLateSummary([])).toBeNull();
  });

  it("means pct per delay across windows and names the single worst exit", () => {
    const windows = [
      window("BTC", [
        { delaySec: 60, pct: 1 },
        { delaySec: 300, pct: 2 },
      ]),
      window("ETH", [
        { delaySec: 60, pct: 3 },
        { delaySec: 300, pct: 8 }, // worst overall
      ]),
    ];
    const summary = computeFollowLateSummary(windows);
    expect(summary).not.toBeNull();
    expect(summary?.perDelay).toEqual([
      { delaySec: 60, meanPct: 2 }, // mean(1,3)
      { delaySec: 300, meanPct: 5 }, // mean(2,8)
    ]);
    expect(summary?.worst).toEqual({ coin: "ETH", delaySec: 300, pct: 8 });
  });

  it("a delay with no samples across any window is left out of perDelay entirely", () => {
    const summary = computeFollowLateSummary([window("BTC", [{ delaySec: 60, pct: 1 }])]);
    expect(summary?.perDelay).toEqual([{ delaySec: 60, meanPct: 1 }]);
  });
});

describe("computeExitRisk", () => {
  it("unknown when exitDna has no sample yet", () => {
    const risk = computeExitRisk(null, null);
    expect(risk.level).toBe("unknown");
    expect(risk.sample).toBe(0);
    expect(risk.sentence).toBe("Not enough closed exits yet to size holder risk.");
  });

  it("high when full-exit rate is >= 70% and medianWindowMin is fast", () => {
    const risk = computeExitRisk(exitDna({ fullExitAfterFirstReducePct: 73, firstReduceToFlatMedianMin: 38 }), 45);
    expect(risk.level).toBe("high");
    expect(risk.sentence).toBe(
      "When this wallet starts selling it usually finishes: 73% of first reduces became full exits, median 38m to flat. Holder risk: high.",
    );
  });

  it("high when full-exit rate is >= 70% and minutesToFlat is fast, even if medianWindowMin is slow/unknown", () => {
    const risk = computeExitRisk(exitDna({ fullExitAfterFirstReducePct: 80, firstReduceToFlatMedianMin: 20 }), null);
    expect(risk.level).toBe("high");
  });

  it("low when full-exit rate is < 40% and medianWindowMin is slow", () => {
    const risk = computeExitRisk(exitDna({ fullExitAfterFirstReducePct: 25, firstReduceToFlatMedianMin: 500 }), 300);
    expect(risk.level).toBe("low");
  });

  it("medium otherwise", () => {
    const risk = computeExitRisk(exitDna({ fullExitAfterFirstReducePct: 55, firstReduceToFlatMedianMin: 150 }), 150);
    expect(risk.level).toBe("medium");
  });
});
