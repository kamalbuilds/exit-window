// Assembles a WalletReport: fetch fills + pnl + positions, build episodes, measure exit windows,
// backtest the latency tax, and settle on a verdict. This is the one call the UI needs per wallet.
import { fetchCandles, intervalForAge, type Candle } from "./hyperliquid";
import { fetchPerpTrades, fetchPerpPositions, fetchPnlSummary, currentNetworkCallCount, networkCallsSince } from "./nansen";
import { fillsToEpisodes } from "./positions";
import { measureWindow } from "./exitwindow";
import { latencyTax, buildVerdict } from "./backtest";
import type { Episode, ExitWindow, Fill, WalletReport } from "./types";
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

async function fetchAllFills(address: string, from: string, to: string): Promise<Fill[]> {
  const fills: Fill[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await fetchPerpTrades(address, from, to, page, PER_PAGE);
    fills.push(...data.fills);
    if (data.isLastPage || data.fills.length === 0) break;
  }
  return fills;
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

const reportCache = new Map<string, { report: WalletReport; cachedAt: number }>();
const REPORT_CACHE_TTL_MS = 10 * 60_000;

export async function buildReport(address: string, options: BuildReportOptions = {}): Promise<WalletReport> {
  const lookbackDays = options.lookbackDays ?? 30;
  const maxEpisodes = options.maxEpisodes ?? 25;
  const cacheKey = `${address.toLowerCase()}::${lookbackDays}::${maxEpisodes}`;

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

  const unrealizedPnlUsd = positions.data.reduce((sum, p) => sum + (p.unrealizedPnlUsd ?? 0), 0);
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
    openPositions: positions.data,
    nansenCalls: networkCallsSince(callsBefore),
    backtestEligible: eligible.length,
    backtestNote: backtestNote(episodes, eligible.length, lookbackDays),
  };

  reportCache.set(cacheKey, { report, cachedAt: Date.now() });
  return report;
}
