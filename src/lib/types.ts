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
  oid: number; // Hyperliquid order id; the only reliably-unique per-fill key (transaction_hash is a
  // constant placeholder on most rows), used to dedupe when merging incrementally-fetched fills.
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

/** How this wallet tends to leave a position, distilled from its own closed episodes.
 * style: nuclear = one clip, mostly full exits on the first reduce; scaler = usually 3+ clips;
 * trimmer = mostly partial reduces that don't close the position on the first cut; else mixed. */
export interface ExitDna {
  sample: number; // eligible (observed-open, closed, at least one exit) episodes this is built from
  firstReduceToFlatMedianMin: number | null; // median minutes from first reduce to fully flat
  fullExitAfterFirstReducePct: number; // % of eligible episodes closed in a single exit tranche
  medianClips: number; // median number of separate exit tranches per episode
  firstReduceAtPnlPct: number | null; // median direction-adjusted price move at the first reduce
  style: "nuclear" | "scaler" | "trimmer" | "mixed";
}

/** One episode's outcome for three hypothetical copiers, all measured from the wallet's own
 * first-reduce price: act on the alarm and exit 60s later, wait for the wallet's final exit
 * (+60s), or ignore it and hold 24h. All percentages are direction-adjusted price moves. */
export interface AlarmReplayEpisode {
  coin: string;
  direction: Direction;
  firstReduceAt: number;
  alarmPct: number;
  waitPct: number;
  holdPct: number;
}

/** Backtests the alarm itself: across the wallet's own closed episodes with observed candles,
 * how much a copier who exited on the alarm would have saved versus waiting for the wallet's
 * final exit, or versus not acting at all and holding 24h. Doesn't need observedOpen: every
 * number here is anchored to the wallet's own first-reduce price, not its entry price. */
export interface AlarmReplay {
  episodes: number;
  savedVsWaitingPct: number; // mean(alarmPct - waitPct)
  savedVsHoldingPct: number; // mean(alarmPct - holdPct)
  bestSaveCoin: string; // coin of the episode with the largest single alarmPct - waitPct save
  bestSavePct: number;
  perEpisode: AlarmReplayEpisode[];
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
  exitDna: ExitDna | null; // null when there aren't enough closed, observed episodes to say anything
  alarmReplay: AlarmReplay | null; // null when no closed episode has observed candles to replay
  openPositions: OpenPosition[];
  nansenCalls: number; // Nansen API calls this report cost
  backtestEligible: number; // episodes with a full observed entry+exit, used in the latency backtest
  backtestNote: string | null; // one plain sentence on why the backtest is empty or thin, else null
  degraded: boolean; // true when fills, pnl or positions served cached/fallback data instead of a fresh Nansen call
  dataAsOf: number | null; // newest fetchedAt among any degraded component's source; null when not degraded
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

/** A labeled wallet holding the same coin and side as the user (Nansen tgm/perp-positions).
 * cohort records which label_type query found it: smart_money first, whale only used to top up
 * when fewer than 3 same-side smart_money holders exist. */
export interface Companion {
  address: string;
  label: string | null;
  displayLabel: string; // best label for why this wallet matters; never a referral-code label
  positionValueUsd: number;
  size: number;
  entryPx: number;
  upnlUsd: number | null;
  leverage: number | null;
  cohort: "smart_money" | "whale" | "public_figure";
}

/** GET /api/overlap/[address]: one row per open position of the user. */
export interface OverlapRow {
  coin: string;
  direction: Direction;
  size: number;
  entryPx: number;
  markPx: number | null;
  companions: Companion[];
}

/** POST /api/alarm response. */
export interface AlarmCreated {
  code: string;
  deepLink: string;
}
