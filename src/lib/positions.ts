// Groups raw fills into tranches, then into signed-position episodes (flat to flat, or still
// open). See docs/BUILD-SPEC.md "Real API facts" for why: one human exit is dozens of fills
// within seconds, and Nansen's start_position is the only reliable signal for direction.
import type { Direction, Episode, Fill, Tranche } from "./types";

const TRANCHE_WINDOW_MS = 120_000;

/** A merged tranche keeps `t` as the burst's start (used for firstReduceAt/entry-time semantics)
 * but also tracks `tEnd`, the last raw fill's time - needed so a close/flip that lands on a
 * merged fill dates the episode boundary at when the position actually went flat, not when the
 * burst started. */
interface MergedFill extends Fill {
  tEnd: number;
}

/** Merges consecutive same-coin, same-direction (isBuy) fills into one synthetic fill when the
 * gap to the previous raw fill is <= 120s - a TWAP/iceberg exit arriving as dozens of rows. */
function mergeTranches(fills: Fill[]): MergedFill[] {
  const merged: MergedFill[] = [];
  let lastRawT = Number.NEGATIVE_INFINITY;
  for (const f of fills) {
    const last = merged[merged.length - 1];
    if (last && last.isBuy === f.isBuy && f.t - lastRawT <= TRANCHE_WINDOW_MS) {
      const totalSz = last.sz + f.sz;
      last.px = (last.px * last.sz + f.px * f.sz) / totalSz;
      last.sz = totalSz;
      last.closedPnl += f.closedPnl;
      last.feeUsd += f.feeUsd;
      last.tEnd = f.t;
    } else {
      merged.push({ ...f, tEnd: f.t });
    }
    lastRawT = f.t;
  }
  return merged;
}

interface EpisodeBuilder {
  coin: string;
  direction: Direction;
  openedAt: number;
  observedOpen: boolean;
  entries: Tranche[];
  exits: Tranche[];
  peakSize: number;
  realizedPnlUsd: number;
}

function newBuilder(coin: string, direction: Direction, openedAt: number, observedOpen: boolean): EpisodeBuilder {
  return { coin, direction, openedAt, observedOpen, entries: [], exits: [], peakSize: 0, realizedPnlUsd: 0 };
}

function weightedAvg(tranches: Tranche[]): number {
  let sumPxSz = 0;
  let sumSz = 0;
  for (const t of tranches) {
    sumPxSz += t.px * t.sz;
    sumSz += t.sz;
  }
  return sumSz > 0 ? sumPxSz / sumSz : 0;
}

function finalize(ep: EpisodeBuilder, closedAt: number | null): Episode {
  const avgEntryPx = ep.entries.length > 0 ? weightedAvg(ep.entries) : 0;
  const avgExitPx = ep.exits.length > 0 ? weightedAvg(ep.exits) : null;
  // walletReturnPct is only meaningful when we saw the true entry (observedOpen) and there is
  // at least one exit to compare against; unobserved-open episodes are marked, not guessed.
  let walletReturnPct: number | null = null;
  if (ep.observedOpen && avgEntryPx > 0 && avgExitPx !== null) {
    walletReturnPct =
      ep.direction === "long" ? (avgExitPx - avgEntryPx) / avgEntryPx : (avgEntryPx - avgExitPx) / avgEntryPx;
  }
  return {
    coin: ep.coin,
    direction: ep.direction,
    openedAt: ep.openedAt,
    closedAt,
    observedOpen: ep.observedOpen,
    entries: ep.entries,
    exits: ep.exits,
    peakSize: ep.peakSize,
    avgEntryPx,
    avgExitPx,
    realizedPnlUsd: ep.realizedPnlUsd,
    walletReturnPct,
  };
}

function buildEpisodesForCoin(coin: string, fills: MergedFill[]): Episode[] {
  const episodes: Episode[] = [];
  let ep: EpisodeBuilder | null = null;

  for (const f of fills) {
    const delta = f.isBuy ? f.sz : -f.sz;
    const startPos = f.startPosition;
    const endPos = startPos + delta;
    const startSign = Math.sign(startPos);
    const endSign = Math.sign(endPos);

    if (!ep) {
      const dir: Direction = startSign !== 0 ? (startSign > 0 ? "long" : "short") : endSign >= 0 ? "long" : "short";
      ep = newBuilder(coin, dir, f.t, startSign === 0);
      ep.peakSize = Math.abs(startPos);
    }

    const flips = startSign !== 0 && endSign !== 0 && startSign !== endSign;
    if (flips) {
      const closingSz = Math.abs(startPos);
      const openingSz = Math.max(f.sz - closingSz, 0);
      ep.exits.push({ t: f.t, px: f.px, sz: closingSz });
      ep.realizedPnlUsd += f.closedPnl;
      ep.peakSize = Math.max(ep.peakSize, Math.abs(startPos));
      episodes.push(finalize(ep, f.tEnd));

      const newDir: Direction = endSign > 0 ? "long" : "short";
      ep = newBuilder(coin, newDir, f.t, true);
      if (openingSz > 0) ep.entries.push({ t: f.t, px: f.px, sz: openingSz });
      ep.peakSize = openingSz;
      continue;
    }

    if (endSign === 0 && startSign !== 0) {
      ep.exits.push({ t: f.t, px: f.px, sz: f.sz });
      ep.realizedPnlUsd += f.closedPnl;
      ep.peakSize = Math.max(ep.peakSize, Math.abs(startPos));
      episodes.push(finalize(ep, f.tEnd));
      ep = null;
      continue;
    }

    const increasing = Math.abs(endPos) > Math.abs(startPos);
    if (increasing) {
      ep.entries.push({ t: f.t, px: f.px, sz: f.sz });
    } else {
      ep.exits.push({ t: f.t, px: f.px, sz: f.sz });
      ep.realizedPnlUsd += f.closedPnl;
    }
    ep.peakSize = Math.max(ep.peakSize, Math.abs(endPos));
  }

  if (ep) episodes.push(finalize(ep, null));
  return episodes;
}

export function fillsToEpisodes(fills: Fill[]): Episode[] {
  const byCoin = new Map<string, Fill[]>();
  for (const f of fills) {
    const arr = byCoin.get(f.coin) ?? [];
    arr.push(f);
    byCoin.set(f.coin, arr);
  }

  const episodes: Episode[] = [];
  for (const [coin, coinFills] of byCoin) {
    coinFills.sort((a, b) => a.t - b.t);
    episodes.push(...buildEpisodesForCoin(coin, mergeTranches(coinFills)));
  }
  episodes.sort((a, b) => a.openedAt - b.openedAt);
  return episodes;
}
