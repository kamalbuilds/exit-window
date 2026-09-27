import { ASSETS, AssetDef } from './assets';
import {
  confidenceFor,
  doStanceFrom,
  gapScore,
  headlineFor,
  readCohorts,
  verdictFor,
} from './engine';
import { readCrowd } from './say';
import { callStats, nansenSafe } from './nansen';
import type {
  AssetVerdict,
  FlowIntelligence,
  PolygraphSnapshot,
  PredictionMarket,
  TokenCandle,
} from './types';

/** Polymarket markets per asset. 200 is comfortably above BTC's live count. */
const MARKETS_PER_ASSET = 200;

/** Passed down when the caller wants a genuinely fresh read rather than a
 *  cached one — the manual refresh, and the backfill. */
type Freshness = { ttlMs?: number };

async function marketsFor(asset: AssetDef, err: (m: string) => void, f: Freshness) {
  return nansenSafe<PredictionMarket>(
    'prediction-market/market-screener',
    {
      tags: asset.tags,
      status: 'active',
      order_by: [{ field: 'volume_1wk', direction: 'DESC' }],
      pagination: { page: 1, per_page: MARKETS_PER_ASSET },
    },
    { ...f, onError: err },
  );
}

async function spotFor(asset: AssetDef, err: (m: string) => void, f: Freshness) {
  const to = new Date();
  const from = new Date(to.getTime() - 3 * 24 * 3600 * 1000);
  const candles = await nansenSafe<TokenCandle>(
    'tgm/token-ohlcv',
    {
      chain: asset.chain,
      token_address: asset.tokenAddress,
      timeframe: '1h',
      date: { from: iso(from), to: iso(to) },
    },
    { ...f, onError: err },
  );
  if (candles.length === 0) return null;
  return candles[candles.length - 1].close ?? null;
}

async function flowsFor(asset: AssetDef, err: (m: string) => void, f: Freshness) {
  const [day, week] = await Promise.all([
    nansenSafe<FlowIntelligence>(
      'tgm/flow-intelligence',
      { chain: asset.chain, token_address: asset.tokenAddress, timeframe: '1d' },
      { ...f, onError: err },
    ),
    nansenSafe<FlowIntelligence>(
      'tgm/flow-intelligence',
      { chain: asset.chain, token_address: asset.tokenAddress, timeframe: '7d' },
      { ...f, onError: err },
    ),
  ]);
  return { day: day[0] ?? null, week: week[0] ?? null };
}

export async function analyseAsset(
  asset: AssetDef,
  errors: string[],
  fresh = false,
): Promise<AssetVerdict> {
  const err = (m: string) => errors.push(m);
  const caveats: string[] = [];
  const f: Freshness = fresh ? { ttlMs: 0 } : {};

  // Spot is needed before the crowd can be read (barrier markets are scored by
  // distance from spot), so it is fetched first and the rest in parallel.
  const spot = await spotFor(asset, err, f);
  const [markets, flows] = await Promise.all([
    marketsFor(asset, err, f),
    flowsFor(asset, err, f),
  ]);

  const { say, build } = readCrowd(markets, asset, spot);

  if (spot === null) {
    caveats.push('Spot price unavailable — the crowd cannot be scored against it.');
  }
  if (!flows.day) {
    caveats.push('No 1-day flow intelligence returned for this token.');
  }
  const excluded = build.all.length - build.rungs.length;
  if (excluded > 0) {
    caveats.push(
      `${excluded} other ${asset.symbol} market${excluded === 1 ? '' : 's'} parsed cleanly but belong to a different expiry or settlement type, so they are excluded from the reading rather than blended into it.`,
    );
  }

  const cohorts = readCohorts(flows.day, flows.week);
  const confidence = confidenceFor(say, build, cohorts, spot !== null);
  caveats.push(...confidence.reasons);

  const doStance = doStanceFrom(cohorts);
  const gap = say.stance - doStance;
  const verdict = verdictFor(gap, say.stance, doStance, confidence);

  return {
    symbol: asset.symbol,
    name: asset.name,
    chain: asset.chain,
    tokenAddress: asset.tokenAddress,
    spot,
    impliedMedian: say.impliedMedian,
    impliedMovePct: say.impliedMovePct,
    sayStance: say.stance,
    doStance,
    gap,
    gapScore: gapScore(gap),
    marketCount: build.rungs.length,
    totalOpenInterest: sum(build.rungs.map((r) => r.openInterest)),
    totalVolume24h: sum(build.rungs.map((r) => r.volume24h)),
    uniqueTraders24h: sum(markets.map((m) => m.unique_traders_24h ?? 0)),
    cohorts,
    ladder: build.rungs,
    say,
    confidence,
    headline: headlineFor(asset, say.stance, doStance, cohorts, verdict),
    verdict,
    caveats,
  };
}

export async function snapshot(
  symbols?: string[],
  opts: { fresh?: boolean } = {},
): Promise<PolygraphSnapshot> {
  const before = callStats();
  const errors: string[] = [];
  const targets = symbols?.length
    ? ASSETS.filter((a) => symbols.includes(a.symbol))
    : ASSETS;

  const assets = await Promise.all(
    targets.map((a) => analyseAsset(a, errors, opts.fresh === true)),
  );
  // Loudest genuine divergence first, but never let a low-confidence reading
  // outrank a high-confidence one.
  assets.sort(
    (a, b) =>
      b.confidence.score * Math.abs(b.gap) - a.confidence.score * Math.abs(a.gap),
  );

  const after = callStats();
  return {
    generatedAt: new Date().toISOString(),
    assets,
    meta: {
      apiCallsThisRequest: after.apiCalls - before.apiCalls,
      apiCallsTotal: after.apiCalls,
      cacheHits: after.cacheHits - before.cacheHits,
      degraded: errors.length > 0,
      errors: errors.slice(0, 12),
    },
  };
}

function sum(xs: number[]) {
  return xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
