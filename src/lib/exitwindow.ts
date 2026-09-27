// How long a copier had after the wallet's first reduce, before price moved thresholdPct against
// a holder. This is the signature measurement of the whole product.
import type { Candle } from "./hyperliquid";
import type { Episode, ExitWindow } from "./types";

const KNOWN_GAPS: Record<number, string> = {
  60_000: "1m",
  300_000: "5m",
  900_000: "15m",
  3_600_000: "1h",
};

function inferInterval(candles: Candle[]): string {
  if (candles.length < 2) return "unavailable";
  const gap = candles[1].t - candles[0].t;
  return KNOWN_GAPS[gap] ?? "unavailable";
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
  };
}
