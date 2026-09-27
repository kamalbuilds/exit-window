// How long a copier had after the wallet's first reduce, before price moved thresholdPct against
// a holder. This is the signature measurement of the whole product.
import type { Candle } from "./hyperliquid";
import { LATENCIES_SEC } from "./types";
import type { Episode, ExitWindow } from "./types";

const KNOWN_GAPS: Record<number, string> = {
  60_000: "1m",
  300_000: "5m",
  900_000: "15m",
  3_600_000: "1h",
};

// The non-zero entries of LATENCIES_SEC (60/300/900/3600) - the same delays the latency backtest
// already replays a copier at, reused here so lateCostPct measures the same points in time.
const LATE_DELAYS_SEC = LATENCIES_SEC.filter((s) => s > 0);

function inferInterval(candles: Candle[]): string {
  if (candles.length < 2) return "unavailable";
  const gap = candles[1].t - candles[0].t;
  return KNOWN_GAPS[gap] ?? "unavailable";
}

/** The open of the candle covering `t`, or the nearest available candle's price when `t` falls
 * outside the fetched range (before the first candle: its open; after the last: its close). null
 * only when there are no candles at all, or `t` falls in a gap the fetched range doesn't cover. */
export function priceAt(candles: Candle[], t: number): number | null {
  if (candles.length === 0) return null;
  const sorted = [...candles].sort((a, b) => a.t - b.t);
  if (t < sorted[0].t) return sorted[0].o;
  if (t >= sorted[sorted.length - 1].T) return sorted[sorted.length - 1].c;
  const containing = sorted.find((c) => t >= c.t && t < c.T);
  return containing ? containing.o : null;
}

export function measureWindow(
  ep: Episode,
  candles: Candle[],
  thresholdPct = 1,
  horizonMin = 1440,
  knownInterval?: string,
): ExitWindow {
  if (ep.exits.length === 0) {
    throw new Error(`measureWindow: episode for ${ep.coin} has no exits, there is no window to measure`);
  }
  const firstReduceAt = ep.exits[0].t;
  const firstReducePx = ep.exits[0].px;
  const horizonEnd = firstReduceAt + horizonMin * 60_000;

  const inWindow = candles
    .filter((c) => c.t >= firstReduceAt && c.t <= horizonEnd)
    .sort((a, b) => a.t - b.t);

  let windowMin: number | null = null;
  let maxAdversePct = 0;

  for (const c of inWindow) {
    const adversePct =
      ep.direction === "long"
        ? Math.max(0, ((firstReducePx - c.l) / firstReducePx) * 100)
        : Math.max(0, ((c.h - firstReducePx) / firstReducePx) * 100);
    if (adversePct > maxAdversePct) maxAdversePct = adversePct;
    if (windowMin === null && adversePct >= thresholdPct) {
      windowMin = (c.t - firstReduceAt) / 60_000;
    }
  }

  const lateCostPct: ExitWindow["lateCostPct"] = [];
  for (const delaySec of LATE_DELAYS_SEC) {
    const px = priceAt(candles, firstReduceAt + delaySec * 1000);
    if (px === null) continue; // delay not covered by the fetched candle range - omit, don't fake a 0
    const pct = ep.direction === "long" ? ((firstReducePx - px) / firstReducePx) * 100 : ((px - firstReducePx) / firstReducePx) * 100;
    lateCostPct.push({ delaySec, pct });
  }

  return {
    coin: ep.coin,
    direction: ep.direction,
    firstReduceAt,
    firstReducePx,
    thresholdPct,
    windowMin,
    horizonMin,
    maxAdversePct,
    candleInterval: knownInterval ?? inferInterval(inWindow),
    lateCostPct,
  };
}
