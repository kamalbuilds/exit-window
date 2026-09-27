import { AssetDef, findAsset, isLadderCandidate, matchesAsset } from './assets';
import { nansenSafe } from './nansen';
import type {
  BacktestResult,
  CalibrationBucket,
  PredictionMarketCandle,
  PredictionMarket,
} from './types';

/**
 * Is the crowd actually any good?
 *
 * A Polymarket binary settles at $1.00 or $0.00, so the final close of a
 * resolved market IS the ground truth. That lets us score the crowd without
 * any external oracle: take the price at a point in the market's life as the
 * forecast, take the terminal price as the outcome, and measure calibration.
 *
 * This is the part that makes Polygraph falsifiable. A divergence dashboard
 * that never checks whether the crowd was wrong is just decoration.
 */

const BUCKET_EDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

/**
 * Where in a market's life the forecast is sampled, as fractions of its
 * lifetime. Sampling one point per market concentrates almost everything in
 * the 0-10% bucket — by the halfway mark most binaries have already decided —
 * so the curve is drawn from several points per market instead. Observations
 * from the same market are correlated, which is stated in the notes rather
 * than hidden.
 */
const FORECAST_POINTS = [0.15, 0.35, 0.55, 0.75];

export async function backtestAsset(
  symbolOrAsset: string | AssetDef,
  opts: { maxMarkets?: number } = {},
): Promise<BacktestResult> {
  const asset =
    typeof symbolOrAsset === 'string' ? findAsset(symbolOrAsset) : symbolOrAsset;
  if (!asset) {
    return emptyResult(String(symbolOrAsset), ['Unknown asset.']);
  }

  const maxMarkets = opts.maxMarkets ?? 60;
  const notes: string[] = [];
  const errors: string[] = [];

  const closed = await nansenSafe<PredictionMarket>(
    'prediction-market/market-screener',
    {
      tags: asset.tags,
      status: 'closed',
      order_by: [{ field: 'volume', direction: 'DESC' }],
      pagination: { page: 1, per_page: maxMarkets },
    },
    { onError: (m) => errors.push(m) },
  );

  const usable = closed.filter(
    (m) => matchesAsset(m.question, asset) && isLadderCandidate(m.question),
  );

  if (usable.length === 0) {
    return emptyResult(asset.symbol, [
      'No resolved markets returned for this asset.',
      ...errors,
    ]);
  }

  const observations: { forecast: number; outcome: 0 | 1 }[] = [];

  // Sequential rather than parallel: this runs against many markets and we
  // would rather be a good API citizen than shave a few seconds.
  for (const m of usable) {
    const candles = await nansenSafe<PredictionMarketCandle>(
      'prediction-market/ohlcv',
      { market_id: m.market_id, pagination: { page: 1, per_page: 500 } },
      { onError: (e) => errors.push(e) },
    );
    observations.push(...observationsFrom(candles));
  }

  if (observations.length === 0) {
    return emptyResult(asset.symbol, [
      'Resolved markets found, but none had usable price history.',
      ...errors,
    ]);
  }

  const buckets = bucketise(observations);
  const bias =
    observations.reduce((acc, o) => acc + (o.forecast - o.outcome), 0) /
    observations.length;
  const brier =
    observations.reduce((acc, o) => acc + (o.forecast - o.outcome) ** 2, 0) /
    observations.length;

  notes.push(
    `Forecast sampled at ${FORECAST_POINTS.map((p) => `${Math.round(p * 100)}%`).join(', ')} of each market's lifetime; the outcome is that market's own settlement price. Points from one market are correlated, so treat the sample count as larger than the number of independent events.`,
  );
  if (bias > 0.03) {
    notes.push(
      `The crowd was overconfident by ${(bias * 100).toFixed(1)} points on average — it priced ${asset.symbol} outcomes higher than they resolved.`,
    );
  } else if (bias < -0.03) {
    notes.push(
      `The crowd was underconfident by ${(Math.abs(bias) * 100).toFixed(1)} points on average — ${asset.symbol} outcomes resolved more often than priced.`,
    );
  } else {
    notes.push('The crowd was close to well-calibrated on this asset.');
  }
  notes.push(
    `Brier score ${brier.toFixed(3)} (0 = perfect, 0.25 = a coin flip).`,
  );
  if (errors.length) notes.push(`${errors.length} market(s) failed to load.`);

  return {
    symbol: asset.symbol,
    marketsAnalysed: usable.length,
    observations: observations.length,
    buckets,
    bias,
    brierScore: brier,
    notes,
  };
}

function observationsFrom(
  candles: PredictionMarketCandle[],
): { forecast: number; outcome: 0 | 1 }[] {
  if (candles.length < 6) return [];

  // A market has one series per outcome ("Yes"/"No"). Score the Yes leg only,
  // otherwise every market contributes a mirrored pair and the calibration
  // curve is forced to look symmetric by construction.
  const yes = candles.filter(
    (c) => (c.side ?? '').toLowerCase() === 'yes' || c.outcome_index === 1,
  );
  const series = (yes.length >= 4 ? yes : candles)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.period_start).getTime() - new Date(b.period_start).getTime(),
    );

  const terminal = series[series.length - 1].close;
  // Only trust markets that actually settled to a corner.
  if (terminal > 0.08 && terminal < 0.92) return [];
  const outcome: 0 | 1 = terminal >= 0.5 ? 1 : 0;

  const out: { forecast: number; outcome: 0 | 1 }[] = [];
  for (const point of FORECAST_POINTS) {
    const idx = Math.floor((series.length - 1) * point);
    const forecast = series[idx].close;
    if (!Number.isFinite(forecast) || forecast <= 0 || forecast >= 1) continue;
    out.push({ forecast, outcome });
  }
  return out;
}

function bucketise(
  observations: { forecast: number; outcome: 0 | 1 }[],
): CalibrationBucket[] {
  const out: CalibrationBucket[] = [];
  for (let i = 0; i < BUCKET_EDGES.length - 1; i += 1) {
    const lower = BUCKET_EDGES[i];
    const upper = BUCKET_EDGES[i + 1];
    const inBucket = observations.filter(
      (o) => o.forecast >= lower && (i === BUCKET_EDGES.length - 2 ? o.forecast <= upper : o.forecast < upper),
    );
    out.push({
      lower,
      upper,
      samples: inBucket.length,
      realised:
        inBucket.length === 0
          ? 0
          : inBucket.reduce((a, o) => a + o.outcome, 0) / inBucket.length,
    });
  }
  return out;
}

function emptyResult(symbol: string, notes: string[]): BacktestResult {
  return {
    symbol,
    marketsAnalysed: 0,
    observations: 0,
    buckets: [],
    bias: 0,
    brierScore: 0,
    notes,
  };
}
