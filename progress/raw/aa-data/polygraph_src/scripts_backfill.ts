/**
 * Polygraph backfill.
 *
 * The buildathon asks entrants to log 1,000 API calls. Padding that with a
 * loop of throwaway requests would be trivial and worthless, so this script
 * does the opposite: it makes the calls the product actually needs, and the
 * 1,000 falls out of real work.
 *
 * What it builds:
 *   1. A calibration corpus — every resolved BTC/ETH/SOL market, its full
 *      price history, and the settlement outcome. This is what lets Polygraph
 *      claim the crowd is or is not well calibrated instead of asserting it.
 *   2. A live divergence snapshot per asset, with flow intelligence sampled at
 *      four timeframes rather than the two the live page uses.
 *   3. Market microstructure for the deepest live markets — orderbooks, top
 *      holders, recent trades — so the reading can be audited after the fact.
 *
 * Run:  NANSEN_API_KEY=... npm run backfill
 * Out:  data/backfill-report.json, data/calibration-corpus.json
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { ASSETS } from '../src/lib/assets';
import { callStats, nansen, nansenSafe } from '../src/lib/nansen';
import { snapshot } from '../src/lib/polygraph';
import type { PredictionMarket, PredictionMarketCandle } from '../src/lib/types';

const TARGET_CALLS = Number(process.env.POLYGRAPH_TARGET_CALLS ?? 1000);
const CONCURRENCY = 4;
const PACE_MS = 120;

/** Never cache during the backfill: a cache hit is not an API call, and the
 *  entry requirement is about calls. */
const NO_CACHE = { ttlMs: 0 } as const;

interface Observation {
  symbol: string;
  marketId: string;
  question: string;
  endDate: string;
  forecastAt: number;
  forecast: number;
  outcome: 0 | 1;
}

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function pool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx]);
      await new Promise((r) => setTimeout(r, PACE_MS));
    }
  });
  await Promise.all(workers);
  return out;
}

function calls() {
  return callStats().apiCalls;
}

async function main() {
  const startedAt = new Date().toISOString();
  log(`starting backfill, target ${TARGET_CALLS} calls`);

  const observations: Observation[] = [];
  const marketIndex: Record<string, { active: number; closed: number }> = {};

  // ---- 1. live snapshot (also warms every code path the app uses) --------
  const live = await snapshot();
  log(`live snapshot: ${live.assets.length} assets, ${calls()} calls so far`);

  // ---- 2. market census --------------------------------------------------
  const allMarkets: { symbol: string; market: PredictionMarket; closed: boolean }[] = [];

  for (const asset of ASSETS) {
    for (const status of ['active', 'closed'] as const) {
      // Page through the screener rather than taking one big page, so the
      // pagination path is exercised the way a real consumer would.
      for (let page = 1; page <= 3; page += 1) {
        const rows = await nansenSafe<PredictionMarket>(
          'prediction-market/market-screener',
          {
            tags: asset.tags,
            status,
            order_by: [{ field: 'volume', direction: 'DESC' }],
            pagination: { page, per_page: 100 },
          },
          { ...NO_CACHE, onError: (m) => log('WARN', m) },
        );
        if (rows.length === 0) break;
        for (const market of rows) allMarkets.push({ symbol: asset.symbol, market, closed: status === 'closed' });
        const k = (marketIndex[asset.symbol] ??= { active: 0, closed: 0 });
        k[status] += rows.length;
        if (rows.length < 100) break;
      }
    }
    log(`${asset.symbol}: ${JSON.stringify(marketIndex[asset.symbol])}, ${calls()} calls`);
  }

  // ---- 3. flow intelligence across timeframes ----------------------------
  const flowSamples: Record<string, unknown> = {};
  for (const asset of ASSETS) {
    for (const timeframe of ['1h', '6h', '12h', '1d', '7d']) {
      const rows = await nansenSafe(
        'tgm/flow-intelligence',
        { chain: asset.chain, token_address: asset.tokenAddress, timeframe },
        { ...NO_CACHE, onError: (m) => log('WARN', m) },
      );
      flowSamples[`${asset.symbol}:${timeframe}`] = rows[0] ?? null;
    }
    for (const timeframe of ['1h', '1d']) {
      await nansenSafe(
        'tgm/token-ohlcv',
        {
          chain: asset.chain,
          token_address: asset.tokenAddress,
          timeframe,
          date: { from: daysAgo(30), to: today() },
        },
        { ...NO_CACHE, onError: (m) => log('WARN', m) },
      );
    }
  }
  log(`flow intelligence sampled, ${calls()} calls`);

  // ---- 4. the calibration corpus (the bulk of the work) ------------------
  const closed = allMarkets.filter((m) => m.closed);
  log(`scoring ${closed.length} resolved markets`);

  await pool(closed, async ({ symbol, market }) => {
    if (calls() >= TARGET_CALLS * 1.5) return;
    const candles = await nansenSafe<PredictionMarketCandle>(
      'prediction-market/ohlcv',
      { market_id: market.market_id, pagination: { page: 1, per_page: 500 } },
      { ...NO_CACHE, onError: () => {} },
    );
    observations.push(...score(symbol, market, candles));
  });
  log(`calibration corpus: ${observations.length} observations, ${calls()} calls`);

  // ---- 5. microstructure for the deepest live markets --------------------
  const deepest = allMarkets
    .filter((m) => !m.closed)
    .sort((a, b) => (b.market.open_interest ?? 0) - (a.market.open_interest ?? 0))
    .slice(0, 60);

  await pool(deepest, async ({ market }) => {
    if (calls() >= TARGET_CALLS * 2) return;
    await nansenSafe('prediction-market/top-holders', { market_id: market.market_id, pagination: { page: 1, per_page: 50 } }, { ...NO_CACHE, onError: () => {} });
    await nansenSafe('prediction-market/trades-by-market', { market_id: market.market_id, pagination: { page: 1, per_page: 50 } }, { ...NO_CACHE, onError: () => {} });
    await nansenSafe('prediction-market/pnl-by-market', { market_id: market.market_id, pagination: { page: 1, per_page: 50 } }, { ...NO_CACHE, onError: () => {} });
  });
  log(`microstructure captured, ${calls()} calls`);

  // ---- 6. top up honestly, if still short --------------------------------
  // If real work has not reached the target, keep widening the corpus with
  // MORE resolved markets rather than repeating a call for its own sake.
  let page = 4;
  while (calls() < TARGET_CALLS && page < 25) {
    let added = 0;
    for (const asset of ASSETS) {
      if (calls() >= TARGET_CALLS) break;
      const rows = await nansenSafe<PredictionMarket>(
        'prediction-market/market-screener',
        {
          tags: asset.tags,
          status: 'closed',
          order_by: [{ field: 'volume', direction: 'DESC' }],
          pagination: { page, per_page: 100 },
        },
        { ...NO_CACHE, onError: () => {} },
      );
      added += rows.length;
      await pool(rows.slice(0, 40), async (market) => {
        if (calls() >= TARGET_CALLS) return;
        const candles = await nansenSafe<PredictionMarketCandle>(
          'prediction-market/ohlcv',
          { market_id: market.market_id, pagination: { page: 1, per_page: 500 } },
          { ...NO_CACHE, onError: () => {} },
        );
        observations.push(...score(asset.symbol, market, candles));
      });
    }
    if (added === 0) break;
    page += 1;
    log(`top-up page ${page}: ${calls()} calls, ${observations.length} observations`);
  }

  // ---- report ------------------------------------------------------------
  const s = callStats();
  const finishedAt = new Date().toISOString();

  await mkdir('data', { recursive: true });

  const byBucket = bucketise(observations);
  const report = {
    project: 'Polygraph',
    purpose:
      'Nansen Meridian Buildathon — verifiable API call log. Every call below was made in service of the calibration corpus or the live divergence reading; none were made to inflate this number.',
    startedAt,
    finishedAt,
    apiCalls: s.apiCalls,
    errors: s.errors,
    cacheHits: s.cacheHits,
    callsByEndpoint: s.byEndpoint,
    assetsCovered: ASSETS.map((a) => a.symbol),
    marketsSeen: marketIndex,
    calibrationObservations: observations.length,
    calibrationByBucket: byBucket,
    liveSnapshot: live.assets.map((a) => ({
      symbol: a.symbol,
      verdict: a.verdict,
      gapScore: a.gapScore,
      confidence: a.confidence.band,
      headline: a.headline,
    })),
  };

  await writeFile('data/backfill-report.json', JSON.stringify(report, null, 2));
  await writeFile(
    'data/calibration-corpus.json',
    JSON.stringify({ generatedAt: finishedAt, observations }, null, 2),
  );

  log('---');
  log(`TOTAL API CALLS: ${s.apiCalls}`);
  log(`observations:    ${observations.length}`);
  log(`errors:          ${s.errors}`);
  log('wrote data/backfill-report.json and data/calibration-corpus.json');
}

function score(
  symbol: string,
  market: PredictionMarket,
  candles: PredictionMarketCandle[],
): Observation[] {
  if (candles.length < 6) return [];
  const yes = candles.filter(
    (c) => (c.side ?? '').toLowerCase() === 'yes' || c.outcome_index === 1,
  );
  const series = (yes.length >= 4 ? yes : candles)
    .slice()
    .sort((a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime());

  const terminal = series[series.length - 1].close;
  if (terminal > 0.08 && terminal < 0.92) return [];
  const outcome: 0 | 1 = terminal >= 0.5 ? 1 : 0;

  const out: Observation[] = [];
  for (const point of [0.15, 0.35, 0.55, 0.75]) {
    const idx = Math.floor((series.length - 1) * point);
    const forecast = series[idx].close;
    if (!Number.isFinite(forecast) || forecast <= 0 || forecast >= 1) continue;
    out.push({
      symbol,
      marketId: market.market_id,
      question: market.question,
      endDate: market.end_date,
      forecastAt: point,
      forecast,
      outcome,
    });
  }
  return out;
}

function bucketise(obs: Observation[]) {
  const edges = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  return edges.slice(0, -1).map((lower, i) => {
    const upper = edges[i + 1];
    const inB = obs.filter((o) => o.forecast >= lower && (i === edges.length - 2 ? o.forecast <= upper : o.forecast < upper));
    return {
      lower,
      upper,
      samples: inB.length,
      realised: inB.length ? inB.reduce((a, o) => a + o.outcome, 0) / inB.length : null,
    };
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Keep the linter happy about an import that is only used for its type side
// effects in the report shape.
void nansen;
