// What copying this wallet would actually have cost at a given reaction delay: the "latency tax."
import type { Candle } from "./hyperliquid";
import { measureWindow } from "./exitwindow";
import type { Episode, LatencyResult, Tranche, Verdict } from "./types";

export interface BacktestCosts {
  feeBps: number;
  slippageBps: number;
}

/** Price a copier would get entering/exiting at time `t + latencySec`. At latency 0 that time is
 * the wallet's own fill, so we use the wallet's own tranche price directly rather than a candle's
 * open (which would introduce OHLC-approximation error a real zero-delay copier never pays). */
function priceAtTime(candles: Candle[] | null, targetT: number, fallbackPx: number): number {
  if (!candles || candles.length === 0) return fallbackPx;
  let chosen: Candle | null = null;
  for (const c of candles) {
    if (c.t <= targetT) chosen = c;
    else break;
  }
  return chosen ? chosen.o : fallbackPx;
}

function weightedPriceAtLatency(tranches: Tranche[], candles: Candle[] | null, latencySec: number): number {
  let sumPxSz = 0;
  let sumSz = 0;
  for (const tr of tranches) {
    const px = latencySec === 0 ? tr.px : priceAtTime(candles, tr.t + latencySec * 1000, tr.px);
    sumPxSz += px * tr.sz;
    sumSz += tr.sz;
  }
  return sumSz > 0 ? sumPxSz / sumSz : 0;
}

function copierReturn(ep: Episode, candles: Candle[] | null, latencySec: number, costs: BacktestCosts): number | null {
  if (ep.entries.length === 0 || ep.exits.length === 0) return null;
  const entryPx = weightedPriceAtLatency(ep.entries, candles, latencySec);
  const exitPx = weightedPriceAtLatency(ep.exits, candles, latencySec);
  if (entryPx <= 0) return null;
  const raw = ep.direction === "long" ? (exitPx - entryPx) / entryPx : (entryPx - exitPx) / entryPx;
  const costFrac = (2 * (costs.feeBps + costs.slippageBps)) / 10_000; // paid on entry and on exit
  return raw - costFrac;
}

export function latencyTax(
  episodes: Episode[],
  candlesByEpisode: (Candle[] | null)[],
  latenciesSec: readonly number[],
  costs: BacktestCosts,
): LatencyResult[] {
  const eligible = episodes
    .map((ep, i) => ({ ep, candles: candlesByEpisode[i] ?? null }))
    .filter(
      ({ ep }) =>
        ep.observedOpen &&
        ep.closedAt !== null &&
        ep.entries.length > 0 &&
        ep.exits.length > 0 &&
        ep.walletReturnPct !== null,
    )
    .map(({ ep, candles }) => ({ ep, candles, window: measureWindow(ep, candles ?? [], 1, 1440) }));

  return latenciesSec.map((latencySec) => {
    let copierSum = 0;
    let taxSum = 0;
    let taxCount = 0;
    let lateCount = 0;
    let exitCount = 0;

    for (const { ep, candles, window } of eligible) {
      const cr = copierReturn(ep, candles, latencySec, costs);
      if (cr !== null) {
        copierSum += cr;
        taxSum += (ep.walletReturnPct as number) - cr;
        taxCount++;
      }
      const deadline = window.windowMin === null ? Number.POSITIVE_INFINITY : ep.exits[0].t + window.windowMin * 60_000;
      for (const tr of ep.exits) {
        exitCount++;
        if (tr.t + latencySec * 1000 > deadline) lateCount++;
      }
    }

    return {
      latencySec,
      copierReturnPct: taxCount > 0 ? copierSum / taxCount : 0,
      taxPct: taxCount > 0 ? taxSum / taxCount : 0,
      lateExitSharePct: exitCount > 0 ? (lateCount / exitCount) * 100 : 0,
    };
  });
}

export interface VerdictInput {
  latency: LatencyResult[];
  eligibleEpisodeCount: number;
  meanWalletReturnPct: number;
}

export function buildVerdict({ latency, eligibleEpisodeCount, meanWalletReturnPct }: VerdictInput): {
  verdict: Verdict;
  maxSafeLatencySec: number | null;
} {
  if (eligibleEpisodeCount < 3) return { verdict: "insufficient_data", maxSafeLatencySec: null };

  // Compare against the wallet's edge magnitude: a losing wallet's "25% of its return" would
  // otherwise be negative and satisfy nothing. ponytail: abs() is a deliberate simplification;
  // revisit if a wallet with a large negative edge needs a different verdict shape.
  const threshold = Math.abs(meanWalletReturnPct) * 0.25;

  let maxSafeLatencySec: number | null = null;
  for (const r of latency) {
    if (r.taxPct < threshold) maxSafeLatencySec = Math.max(maxSafeLatencySec ?? 0, r.latencySec);
  }

  const at60 = latency.find((r) => r.latencySec === 60);
  const at300 = latency.find((r) => r.latencySec === 300);
  if (at300 && at300.taxPct < threshold) return { verdict: "copyable", maxSafeLatencySec };
  if (at60 && at60.taxPct < threshold) return { verdict: "tight", maxSafeLatencySec };
  return { verdict: "not_copyable", maxSafeLatencySec };
}
