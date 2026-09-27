// Assembles a WalletReport: fetch fills + pnl + positions, build episodes, measure exit windows,
// backtest the latency tax, and settle on a verdict. This is the one call the UI needs per wallet.
import { attachMarkPrices, fetchCandles, fetchClearinghouseState, intervalForAge, type Candle } from "./hyperliquid";
import {
  fetchPerpTrades,
  fetchPerpPositions,
  fetchPnlSummary,
  findAnyAgeCache,
  NansenCreditsError,
  currentNetworkCallCount,
  networkCallsSince,
  type PnlSummary,
} from "./nansen";
import { loadFills, saveFills, mergeFills } from "./fills-store";
import { fillsToEpisodes } from "./positions";
import { measureWindow, priceAt } from "./exitwindow";
import { latencyTax, buildVerdict } from "./backtest";
import type {
  AlarmReplay,
  AlarmReplayEpisode,
  Episode,
  ExitDna,
  ExitRisk,
  ExitWindow,
  Fill,
  FollowLateSummary,
  OpenPosition,
  WalletReport,
} from "./types";
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

export interface FillsResult {
  fills: Fill[];
  degraded: boolean; // true when a top-up call was skipped because credits are exhausted
  dataAsOf: number | null; // stored.lastSeen (ms) when degraded and something was stored, else null
}

/** Buys only what the persisted store hasn't already got: [lastSeen, to] going forward (usually
 * 1 page, since most of a wallet's history hasn't changed since the last report), plus
 * [from, earliestSeen] on the rare call that asks further back than anything stored. When credits
 * are exhausted, a top-up call throws NansenCreditsError; this degrades to the stored fills as-is
 * rather than failing the whole report, and - critically - only claims the coverage it actually
 * fetched, so a later healthy call still knows to top up the range this one couldn't reach. */
async function fetchAllFills(address: string, from: string, to: string): Promise<FillsResult> {
  const stored = await loadFills(address);
  const fetched: Fill[] = [];
  let degraded = false;
  let newEarliestSeen = stored?.earliestSeen ?? from;
  let newLastSeen = stored?.lastSeen ?? to;

  async function extend(rangeFrom: string, rangeTo: string): Promise<boolean> {
    try {
      fetched.push(...(await fetchRange(address, rangeFrom, rangeTo)));
      return true;
    } catch (err) {
      if (!(err instanceof NansenCreditsError)) throw err;
      degraded = true;
      return false;
    }
  }

  if (!stored) {
    await extend(from, to);
  } else {
    if (Date.parse(from) < Date.parse(stored.earliestSeen) && (await extend(from, stored.earliestSeen))) {
      newEarliestSeen = from;
    }
    if (Date.parse(to) > Date.parse(stored.lastSeen) && (await extend(stored.lastSeen, to))) {
      newLastSeen = to;
    }
  }

  const merged = mergeFills(stored?.fills ?? [], fetched);
  // A degraded read must never persist a coverage claim it didn't back with a real fetch - that
  // would make a later, healthy call believe a gap was already checked and skip it forever.
  if (stored || !degraded) {
    await saveFills(address, { earliestSeen: newEarliestSeen, lastSeen: newLastSeen, fills: merged });
  }

  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  return {
    fills: merged.filter((f) => f.t >= fromMs && f.t <= toMs),
    degraded,
    dataAsOf: degraded && stored ? Date.parse(stored.lastSeen) : null,
  };
}

/** profiler/perp-pnl-summary is date-scoped, so a credits-exhausted call for the exact [from,to]
 * bucket almost never has an exact-key cache hit. Falls back to the newest cached pnl summary for
 * this SAME address under any prior date range (reconstructed from the call log), and to null
 * (no pnl shown) when nothing has ever been cached for it. */
async function fetchPnlDegradeAware(
  address: string,
  from: string,
  to: string,
): Promise<{ realizedPnlUsd: number | null; degraded: boolean; dataAsOf: number | null }> {
  try {
    const r = await fetchPnlSummary(address, from, to);
    return { realizedPnlUsd: r.data.realizedPnlUsd, degraded: r.stale, dataAsOf: r.stale ? r.fetchedAt : null };
  } catch (err) {
    if (!(err instanceof NansenCreditsError)) throw err;
    const fallback = await findAnyAgeCache<PnlSummary>(
      "profiler/perp-pnl-summary",
      (s) => typeof s.address === "string" && s.address.toLowerCase() === address.toLowerCase(),
      (s) => (typeof s.address === "string" && s.date ? { address: s.address, date: s.date } : null),
    );
    if (fallback) return { realizedPnlUsd: fallback.data.realizedPnlUsd, degraded: true, dataAsOf: fallback.fetchedAt };
    return { realizedPnlUsd: null, degraded: true, dataAsOf: null };
  }
}

/** profiler/perp-positions has no date component in its cache key, so nansenCall's own exact-key
 * stale-while-error fallback already serves any prior cached response for this address regardless
 * of age; NansenCreditsError only reaches here when truly nothing has ever been cached for it.
 * In that case, fall back to Hyperliquid's own public clearinghouseState: free, live, no credits
 * involved, just missing markPx (attachMarkPrices fills that from the same allMids cache either way). */
async function fetchPositionsDegradeAware(
  address: string,
): Promise<{ positions: OpenPosition[]; degraded: boolean; dataAsOf: number | null }> {
  try {
    const r = await fetchPerpPositions(address);
    return { positions: r.data, degraded: r.stale, dataAsOf: r.stale ? r.fetchedAt : null };
  } catch (err) {
    if (!(err instanceof NansenCreditsError)) throw err;
    const positions = await fetchClearinghouseState(address);
    return { positions, degraded: true, dataAsOf: Date.now() };
  }
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

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
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

/** Backtests the alarm against the wallet's own closed episodes: three hypothetical copiers, all
 * anchored to the price at the wallet's first reduce (not its entry price, so observedOpen isn't
 * required) - exit 60s after the alarm, exit 60s after the wallet's final exit, or hold 24h and
 * do nothing. Only episodes with a real candle at all three replay points count. */
export function computeAlarmReplay(episodes: Episode[], candlesByEpisode: (Candle[] | null)[]): AlarmReplay | null {
  const perEpisode: AlarmReplayEpisode[] = [];

  episodes.forEach((ep, i) => {
    if (ep.closedAt === null || ep.exits.length === 0) return;
    const candles = candlesByEpisode[i];
    if (!candles || candles.length === 0) return;

    const firstReduceAt = ep.exits[0].t;
    const referencePx = ep.exits[0].px;
    const alarmPx = priceAt(candles, firstReduceAt + 60_000);
    const waitPx = priceAt(candles, ep.closedAt + 60_000);
    const holdPx = priceAt(candles, firstReduceAt + 24 * 3_600_000);
    if (alarmPx === null || waitPx === null || holdPx === null) return;

    const sign = ep.direction === "long" ? 1 : -1;
    const pct = (px: number) => ((px - referencePx) / referencePx) * sign * 100;

    perEpisode.push({
      coin: ep.coin,
      direction: ep.direction,
      firstReduceAt,
      alarmPct: pct(alarmPx),
      waitPct: pct(waitPx),
      holdPct: pct(holdPx),
    });
  });

  if (perEpisode.length === 0) return null;

  const saves = perEpisode.map((e) => ({ coin: e.coin, save: e.alarmPct - e.waitPct }));
  const best = saves.reduce((a, b) => (b.save > a.save ? b : a));

  return {
    episodes: perEpisode.length,
    savedVsWaitingPct: mean(perEpisode.map((e) => e.alarmPct - e.waitPct)),
    savedVsHoldingPct: mean(perEpisode.map((e) => e.alarmPct - e.holdPct)),
    bestSaveCoin: best.coin,
    bestSavePct: best.save,
    perEpisode,
  };
}

/** Mean lateCostPct per delay across every window's timed exits, plus the single worst
 * (coin, delaySec, pct). null when no window measured any delay at all (e.g. every episode too
 * recent for its candles to reach even the 60s point). */
export function computeFollowLateSummary(windows: ExitWindow[]): FollowLateSummary | null {
  const flat = windows.flatMap((w) => w.lateCostPct.map((c) => ({ coin: w.coin, delaySec: c.delaySec, pct: c.pct })));
  if (flat.length === 0) return null;

  const perDelay = LATENCIES_SEC.filter((s) => s > 0)
    .map((delaySec) => ({ delaySec, samples: flat.filter((c) => c.delaySec === delaySec) }))
    .filter((g) => g.samples.length > 0)
    .map((g) => ({ delaySec: g.delaySec, meanPct: mean(g.samples.map((s) => s.pct)) }));

  const worst = flat.reduce((a, b) => (b.pct > a.pct ? b : a));

  return { perDelay, worst: { coin: worst.coin, delaySec: worst.delaySec, pct: worst.pct } };
}

/** A plain-English read of exitDna + medianWindowMin, not a new measurement: how likely a holder
 * is to get caught by this wallet's own exit. unknown when exitDna has no sample yet. */
export function computeExitRisk(exitDna: ExitDna | null, medianWindowMin: number | null): ExitRisk {
  const sample = exitDna?.sample ?? 0;
  const fullExitPct = exitDna?.fullExitAfterFirstReducePct ?? 0;
  const minutesToFlat = exitDna?.firstReduceToFlatMedianMin ?? null;

  let level: ExitRisk["level"];
  if (sample < 1) {
    level = "unknown";
  } else if (fullExitPct >= 70 && ((medianWindowMin !== null && medianWindowMin <= 60) || (minutesToFlat !== null && minutesToFlat <= 60))) {
    level = "high";
  } else if (fullExitPct < 40 && medianWindowMin !== null && medianWindowMin > 240) {
    level = "low";
  } else {
    level = "medium";
  }

  const sentence =
    level === "unknown"
      ? "Not enough closed exits yet to size holder risk."
      : `When this wallet starts selling it usually ${fullExitPct >= 50 ? "finishes" : "trims"}: ` +
        `${fullExitPct.toFixed(0)}% of first reduces became full exits` +
        (minutesToFlat !== null ? `, median ${minutesToFlat.toFixed(0)}m to flat` : "") +
        `. Holder risk: ${level}.`;

  return { level, fullExitPct, minutesToFlat, medianWindowMin, sample, sentence };
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

  const [fillsResult, pnlResult, positionsResult] = await Promise.all([
    fetchAllFills(address, from, to),
    fetchPnlDegradeAware(address, from, to),
    fetchPositionsDegradeAware(address),
  ]);
  const { fills } = fillsResult;

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

  const openPositions = await attachMarkPrices(positionsResult.positions);
  const unrealizedPnlUsd = openPositions.reduce((sum, p) => sum + (p.unrealizedPnlUsd ?? 0), 0);
  const medianWindowMin = median(windows.map((w) => w.windowMin).filter((m): m is number => m !== null));
  const exitDna = computeExitDna(episodes);

  const degraded = fillsResult.degraded || pnlResult.degraded || positionsResult.degraded;
  const dataAsOf = degraded
    ? Math.max(...[fillsResult.dataAsOf, pnlResult.dataAsOf, positionsResult.dataAsOf].filter((v): v is number => v !== null), 0) ||
      null
    : null;

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
    realizedPnlUsd: pnlResult.realizedPnlUsd,
    unrealizedPnlUsd,
    episodes,
    exitDna,
    alarmReplay: computeAlarmReplay(episodes, candlesByEpisode),
    followLateSummary: computeFollowLateSummary(windows),
    exitRisk: computeExitRisk(exitDna, medianWindowMin),
    openPositions,
    nansenCalls: networkCallsSince(callsBefore),
    backtestEligible: eligible.length,
    backtestNote: backtestNote(episodes, eligible.length, lookbackDays),
    degraded,
    dataAsOf,
  };

  reportCache.set(cacheKey, { report, cachedAt: Date.now() });
  return report;
}
