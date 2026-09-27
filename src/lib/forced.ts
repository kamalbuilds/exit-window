// Forced exits: the prices at which the Smart Money on the user's side gets liquidated, in the
// order price reaches them. Exit DNA times the exits a wallet chooses; this is the exit it doesn't.
// Pure: the page, the chart and the alarm worker all read the same ladder.
import type { Companion, Direction } from "./types";

export interface LadderStep {
  address: string;
  label: string;
  liquidationPx: number;
  distancePct: number; // adverse move from mark to this liquidation, always >= 0
  positionValueUsd: number;
  cumulativeUsd: number; // Smart Money force-sold by the time price reaches this step
}

export interface ForcedExitLadder {
  steps: LadderStep[]; // nearest liquidation first
  you: { liquidationPx: number; distancePct: number } | null;
  /** Smart Money USD force-sold before price reaches the user's own liquidation. */
  soldBeforeYouUsd: number;
  /** true = the user is liquidated before any Smart Money on their side; null = unknown. */
  youFirst: boolean | null;
  /** Companions whose liquidation price Hyperliquid did not return (cross margin with ample equity,
   * or a failed read). Counted so the UI never implies they are safe. */
  unknown: number;
}

/** Adverse move in percent from mark to px: a long is hurt by price falling, a short by it rising.
 * Negative means the price is already past the liquidation, which Hyperliquid would have closed. */
export function adverseDistancePct(direction: Direction, markPx: number, px: number): number {
  return direction === "long" ? ((markPx - px) / markPx) * 100 : ((px - markPx) / markPx) * 100;
}

export function forcedExitLadder(
  direction: Direction,
  markPx: number | null,
  youLiquidationPx: number | null,
  companions: Companion[],
): ForcedExitLadder | null {
  if (!markPx || markPx <= 0) return null;
  const open = companions.filter((c) => c.stillOpen !== false);
  const known = open.filter((c) => c.liquidationPx !== null && c.liquidationPx > 0);
  const steps = known
    .map((c) => ({ c, d: adverseDistancePct(direction, markPx, c.liquidationPx as number) }))
    .filter(({ d }) => d >= 0)
    .sort((a, b) => a.d - b.d);

  let cumulative = 0;
  const ladder: LadderStep[] = steps.map(({ c, d }) => {
    cumulative += c.positionValueUsd;
    return {
      address: c.address,
      label: c.displayLabel,
      liquidationPx: c.liquidationPx as number,
      distancePct: d,
      positionValueUsd: c.positionValueUsd,
      cumulativeUsd: cumulative,
    };
  });

  const youD = youLiquidationPx && youLiquidationPx > 0 ? adverseDistancePct(direction, markPx, youLiquidationPx) : null;
  const you = youD !== null && youD >= 0 ? { liquidationPx: youLiquidationPx as number, distancePct: youD } : null;
  const soldBeforeYouUsd = you ? ladder.filter((s) => s.distancePct < you.distancePct).reduce((a, s) => a + s.positionValueUsd, 0) : 0;
  const youFirst = you && ladder.length > 0 ? you.distancePct < ladder[0].distancePct : null;

  return { steps: ladder, you, soldBeforeYouUsd, youFirst, unknown: open.length - known.length };
}
