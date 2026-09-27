import { describe, expect, it } from "vitest";
import { latencyTax } from "../src/lib/backtest";
import type { Episode } from "../src/lib/types";

const BASE = 1_700_000_000_000;

function closedLongEpisode(): Episode {
  const entryPx = 100;
  const exitPx = 120;
  return {
    coin: "BTC",
    direction: "long",
    openedAt: BASE,
    closedAt: BASE + 3_600_000,
    observedOpen: true,
    entries: [{ t: BASE, px: entryPx, sz: 1 }],
    exits: [{ t: BASE + 3_600_000, px: exitPx, sz: 1 }],
    peakSize: 1,
    avgEntryPx: entryPx,
    avgExitPx: exitPx,
    realizedPnlUsd: 20,
    walletReturnPct: (exitPx - entryPx) / entryPx, // 0.2
  };
}

describe("latencyTax", () => {
  it("at latency 0, copier return equals the wallet's return minus fees and slippage", () => {
    const episodes = [closedLongEpisode(), closedLongEpisode(), closedLongEpisode()];
    const results = latencyTax(episodes, [null, null, null], [0], { feeBps: 4.5, slippageBps: 5 });
    const costFrac = (2 * (4.5 + 5)) / 10_000;
    expect(results).toHaveLength(1);
    expect(results[0].copierReturnPct).toBeCloseTo(0.2 - costFrac, 8);
    expect(results[0].taxPct).toBeCloseTo(costFrac, 8);
  });

  it("excludes unobserved-open episodes from the backtest", () => {
    const unobserved: Episode = { ...closedLongEpisode(), observedOpen: false, walletReturnPct: null };
    const results = latencyTax([unobserved], [null], [0], { feeBps: 0, slippageBps: 0 });
    expect(results[0].copierReturnPct).toBe(0);
    expect(results[0].taxPct).toBe(0);
  });
});
