// Assembles a WalletReport: fetch fills + pnl + positions, build episodes, measure exit windows,
// backtest the latency tax, and settle on a verdict. This is the one call the UI needs per wallet.
import { attachMarkPrices, fetchCandles, intervalForAge, type Candle } from "./hyperliquid";
import { fetchPerpTrades, fetchPerpPositions, fetchPnlSummary, currentNetworkCallCount, networkCallsSince } from "./nansen";
import { loadFills, saveFills, mergeFills } from "./fills-store";
import { fillsToEpisodes } from "./positions";
import { measureWindow } from "./exitwindow";
import { latencyTax, buildVerdict } from "./backtest";
import type { Episode, ExitDna, ExitWindow, Fill, WalletReport } from "./types";
import { LATENCIES_SEC } from "./types";

const MAX_PAGES = 5;
const PER_PAGE = 100;
const CANDLE_CONCURRENCY = 4;
const HORIZON_MIN = 1440; // 24h, matches measureWindow's default
const MAX_LATENCY_SEC = LATENCIES_SEC[LATENCIES_SEC.length - 1];

export interface BuildReportOptions {
  lookbackDays?: number;
  maxEpisodes?: number;
}

/** Runs up to `limit` async jobs at once, preserving input order in the output. */
async function mapBounded<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchRange(address: string, from: string, to: string): Promise<Fill[]> {
  const fills: Fill[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await fetchPerpTrades(address, from, to, page, PER_PAGE);
    fills.push(...data.fills);
    if (data.isLastPage || data.fills.length === 0) break;
  }
  return fills;
}

/** Buys only what the persisted store hasn't already got: [lastSeen, to] going forward (usually
 * 1 page, since most of a wallet's history hasn't changed since the last report), plus
 * [from, earliestSeen] on the rare call that asks further back than anything stored. */
async function fetchAllFills(address: string, from: string, to: string): Promise<Fill[]> {
  const stored = await loadFills(address);
  const fetched: Fill[] = [];

  if (!stored) {
    fetched.push(...(await fetchRange(address, from, to)));
  } else {
    if (Date.parse(from) < Date.parse(stored.earliestSeen)) {
      fetched.push(...(await fetchRange(address, from, stored.earliestSeen)));
    }
    if (Date.parse(to) > Date.parse(stored.lastSeen)) {
      fetched.push(...(await fetchRange(address, stored.lastSeen, to)));
    }
  }

  const merged = mergeFills(stored?.fills ?? [], fetched);
  const earliestSeen = stored && Date.parse(stored.earliestSeen) < Date.parse(from) ? stored.earliestSeen : from;
  const lastSeen = stored && Date.parse(stored.lastSeen) > Date.parse(to) ? stored.lastSeen : to;
  await saveFills(address, { earliestSeen, lastSeen, fills: merged });

  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  return merged.filter((f) => f.t >= fromMs && f.t <= toMs);
}

/** Candle range covering everything the exit-window measurement and the latency backtest need:
 * from the episode's own start through its horizon and worst-case latency, past the close. */
async function candlesForEpisode(ep: Episode): Promise<Candle[] | null> {
  if (ep.exits.length === 0) return null;
  const firstReduceAt = ep.exits[0].t;
  const start = ep.openedAt - 5 * 60_000;
  const end = Math.max(ep.closedAt ?? Date.now(), firstReduceAt + HORIZON_MIN * 60_000) + MAX_LATENCY_SEC * 1000;
  const interval = intervalForAge(Date.now() - ep.openedAt);
  return fetchCandles(ep.coin, interval, start, end);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** One plain sentence on why the latency backtest is empty or thin (needs 3+ eligible episodes,
 * see buildVerdict), or null when there's enough to trust the numbers. */
function backtestNote(episodes: Episode[], eligibleCount: number, lookbackDays: number): string | null {
  if (eligibleCount >= 3) return null;
  if (episodes.length === 0) return "No closed positions found in this lookback window to backtest.";
  if (eligibleCount === 0 && episodes.every((e) => !e.observedOpen)) {
    const n = episodes.length;
    return `All ${n} position${n === 1 ? "" : "s"} were already open when the ${lookbackDays}-day lookback began, so their entries can't be replayed.`;
  }
  if (eligibleCount === 0) {
    return "No round-trip positions with both an observed entry and an exit in this lookback window.";
  }
  return `Only ${eligibleCount} round-trip position${eligibleCount === 1 ? "" : "s"} fully observed in this lookback window; the backtest needs at least 3 for a verdict.`;
}

function classifyExitStyle(episodes: Episode[]): WalletReport["exitStyle"] {
  const closed = episodes.filter((e) => e.closedAt !== null && e.exits.length > 0);
  if (closed.length === 0) return "unknown";
  const scalerCount = closed.filter((e) => e.exits.length >= 2).length;
  const oneShotCount = closed.filter((e) => e.exits.length === 1).length;
  if (scalerCount > oneShotCount) return "scaler";
  if (oneShotCount > scalerCount) return "one_shot";
  return "mixed";
}

/** Distills how this wallet tends to leave a position from its own closed episodes. Structural
 * metrics (clips, full-exit rate, time to flat) only need the exit side, so an unobserved-open
 * episode (entry predates the lookback) still counts for those; firstReduceAtPnlPct needs a real
 * entry price, so it's median'd over the observedOpen subset only and is null when that's empty.
 * Null overall when there's no closed episode with an exit at all. Order matters in the style
 * classifier: nuclear is checked before scaler so a wallet with exactly one clip that always fully
 * exits reads as nuclear, not scaler. */
export function computeExitDna(episodes: Episode[]): ExitDna | null {
  const eligible = episodes.filter((ep) => ep.closedAt !== null && ep.exits.length > 0);
  if (eligible.length === 0) return null;

  const sample = eligible.length;
  const firstReduceToFlatMedianMin = median(
    eligible.map((ep) => ((ep.closedAt as number) - ep.exits[0].t) / 60_000),
  );
  const fullExitAfterFirstReducePct = (eligible.filter((ep) => ep.exits.length === 1).length / sample) * 100;
  const medianClips = median(eligible.map((ep) => ep.exits.length)) as number;

  const withEntry = eligible.filter((ep) => ep.observedOpen && ep.avgEntryPx > 0);
  const firstReduceAtPnlPct = median(
    withEntry.map((ep) => {
      const move = (ep.exits[0].px - ep.avgEntryPx) / ep.avgEntryPx;
      return (ep.direction === "long" ? move : -move) * 100;
    }),
  );

  let style: ExitDna["style"];
  if (medianClips <= 1 && fullExitAfterFirstReducePct >= 70) style = "nuclear";
  else if (medianClips >= 3) style = "scaler";
  else if (fullExitAfterFirstReducePct < 40) style = "trimmer";
  else style = "mixed";

  return { sample, firstReduceToFlatMedianMin, fullExitAfterFirstReducePct, medianClips, firstReduceAtPnlPct, style };
}

const reportCache = new Map<string, { report: WalletReport; cachedAt: number }>();
const REPORT_CACHE_TTL_MS = 10 * 60_000;

function reportCacheKey(address: string, options: BuildReportOptions): string {
  const lookbackDays = options.lookbackDays ?? 30;
  const maxEpisodes = options.maxEpisodes ?? 25;
  return `${address.toLowerCase()}::${lookbackDays}::${maxEpisodes}`;
}

/** The cached report if one exists and hasn't expired, without ever touching the network -
 * for GET /api/wallet/[address]?cached=1, which the home hero uses so listing exiting wallets
 * never burns Nansen credits on wallets nobody has opened a full report for yet. */
export function getCachedReport(address: string, options: BuildReportOptions = {}): WalletReport | null {
  const cached = reportCache.get(reportCacheKey(address, options));
  if (!cached || Date.now() - cached.cachedAt >= REPORT_CACHE_TTL_MS) return null;
  return cached.report;
}

export async function buildReport(address: string, options: BuildReportOptions = {}): Promise<WalletReport> {
  const lookbackDays = options.lookbackDays ?? 30;
  const maxEpisodes = options.maxEpisodes ?? 25;
  const cacheKey = reportCacheKey(address, options);

  const cached = reportCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < REPORT_CACHE_TTL_MS) return cached.report;

  const callsBefore = currentNetworkCallCount();

  // Snap the range to a 30-minute bucket: the Nansen cache is keyed on the request body,
  // so a millisecond `to` would make every request a fresh, paid network call.
  const BUCKET_MS = 30 * 60_000;
  const nowMs = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
  const from = new Date(nowMs - lookbackDays * 86_400_000).toISOString();
  const to = new Date(nowMs).toISOString();

  const [fills, pnlSummary, positions] = await Promise.all([
    fetchAllFills(address, from, to),
    fetchPnlSummary(address, from, to),
    fetchPerpPositions(address),
  ]);

  const allEpisodes = fillsToEpisodes(fills);
  // Most recent maxEpisodes: candle-fetch cost scales with episode count, and the UI cares about
  // recent exits, not the full 30-day history once it's long.
  const episodes = allEpisodes.slice(-maxEpisodes);

  const candlesByEpisode = await mapBounded(episodes, CANDLE_CONCURRENCY, candlesForEpisode);

  const windows: ExitWindow[] = [];
  episodes.forEach((ep, i) => {
    if (ep.exits.length === 0) return;
    windows.push(measureWindow(ep, candlesByEpisode[i] ?? [], 1, HORIZON_MIN));
  });

  const latency = latencyTax(episodes, candlesByEpisode, LATENCIES_SEC, { feeBps: 4.5, slippageBps: 5 });

  const eligible = episodes.filter(
    (ep) => ep.observedOpen && ep.closedAt !== null && ep.entries.length > 0 && ep.exits.length > 0 && ep.walletReturnPct !== null,
  );
  const meanWalletReturnPct =
    eligible.length > 0 ? eligible.reduce((sum, ep) => sum + (ep.walletReturnPct as number), 0) / eligible.length : 0;
  const { verdict, maxSafeLatencySec } = buildVerdict({
    latency,
    eligibleEpisodeCount: eligible.length,
    meanWalletReturnPct,
  });

  const openPositions = await attachMarkPrices(positions.data);
  const unrealizedPnlUsd = openPositions.reduce((sum, p) => sum + (p.unrealizedPnlUsd ?? 0), 0);
  const medianWindowMin = median(windows.map((w) => w.windowMin).filter((m): m is number => m !== null));

  const report: WalletReport = {
    address,
    label: null,
    generatedAt: Date.now(),
    lookbackDays,
    episodesAnalyzed: episodes.length,
    exitStyle: classifyExitStyle(episodes),
    medianWindowMin,
    windows,
    latency,
    maxSafeLatencySec,
    verdict,
    realizedPnlUsd: pnlSummary.data.realizedPnlUsd,
    unrealizedPnlUsd,
    episodes,
    exitDna: computeExitDna(episodes),
    openPositions,
    nansenCalls: networkCallsSince(callsBefore),
    backtestEligible: eligible.length,
    backtestNote: backtestNote(episodes, eligible.length, lookbackDays),
  };

  reportCache.set(cacheKey, { report, cachedAt: Date.now() });
  return report;
}
