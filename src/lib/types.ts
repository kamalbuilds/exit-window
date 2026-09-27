// Shared contract between the analysis engine (src/lib), the API routes and the UI.

export type Direction = "long" | "short";

/** One fill from Nansen POST /api/v1/profiler/perp-trades, normalized. */
export interface Fill {
  t: number; // unix ms
  coin: string;
  isBuy: boolean;
  px: number;
  sz: number; // absolute size in coin units
  startPosition: number; // signed position before this fill (+ long, - short)
  closedPnl: number;
  feeUsd: number;
  hash: string;
}

export interface Tranche {
  t: number;
  px: number;
  sz: number;
}

/** A position from flat to flat (or still open) on one coin. */
export interface Episode {
  coin: string;
  direction: Direction;
  openedAt: number;
  closedAt: number | null; // null while still open
  observedOpen: boolean; // false when the position was already open at the start of the lookback (entries incomplete)
  entries: Tranche[];
  exits: Tranche[]; // every reduce, including the final close
  peakSize: number;
  avgEntryPx: number;
  avgExitPx: number | null;
  realizedPnlUsd: number;
  walletReturnPct: number | null; // direction-adjusted price return of the wallet's own fills, before fees
}

/** What happened to price after the wallet's first reduce. */
export interface ExitWindow {
  coin: string;
  direction: Direction;
  firstReduceAt: number;
  firstReducePx: number;
  thresholdPct: number; // adverse move that closes the window, e.g. 1
  windowMin: number | null; // minutes until price moved thresholdPct against a copier still holding; null = not within horizon
  horizonMin: number;
  maxAdversePct: number; // worst move against a holder within the horizon
  candleInterval: string; // "1m" | "5m" | "15m" | "1h"
}

export const LATENCIES_SEC = [0, 60, 300, 900, 3600] as const;

export interface LatencyResult {
  latencySec: number;
  copierReturnPct: number; // mean per-episode return mirroring entries AND exits at this delay, after fees + slippage
  taxPct: number; // mean walletReturnPct minus copierReturnPct
  lateExitSharePct: number; // share of exits where this delay lands after the exit window closed
}

export type Verdict = "copyable" | "tight" | "not_copyable" | "insufficient_data";

export interface OpenPosition {
  coin: string;
  direction: Direction;
  size: number; // absolute
  entryPx: number;
  markPx: number | null;
  unrealizedPnlUsd: number | null;
  leverage: number | null;
}

export interface WalletReport {
  address: string;
  label: string | null; // Nansen label if known
  generatedAt: number;
  lookbackDays: number;
  episodesAnalyzed: number;
  exitStyle: "scaler" | "one_shot" | "mixed" | "unknown"; // scaler = usually >= 2 reduces before flat
  medianWindowMin: number | null;
  windows: ExitWindow[];
  latency: LatencyResult[];
  maxSafeLatencySec: number | null; // largest delay whose tax stays under 25% of the wallet's edge
  verdict: Verdict;
  realizedPnlUsd: number | null; // from profiler/perp-pnl-summary
  unrealizedPnlUsd: number | null;
  episodes: Episode[];
  openPositions: OpenPosition[];
  nansenCalls: number; // Nansen API calls this report cost
}

export interface LeaderRow {
  address: string;
  label: string | null;
  totalPnlUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  roi: number;
  accountValue: number;
}

/** Diff between two position snapshots of a followed wallet. */
export interface PositionChange {
  coin: string;
  kind: "open" | "add" | "reduce" | "close" | "flip";
  direction: Direction;
  fromSize: number;
  toSize: number;
  reducedFraction: number; // 0..1 of the previous size, for reduce/close
  at: number;
}
