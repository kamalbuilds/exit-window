import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { BacktestResult, CalibrationBucket } from './types';

/**
 * The calibration corpus produced by `npm run backfill`.
 *
 * Scoring the crowd live means fetching price history for dozens of resolved
 * markets on every page load — slow, and it burns credits to recompute an
 * answer that does not change. The backfill already did that work across ~900
 * resolved markets, so the committed corpus is the primary source and the
 * live path is the fallback when it is missing.
 */

export interface CorpusObservation {
  symbol: string;
  marketId: string;
  question: string;
  endDate: string;
  forecastAt: number;
  forecast: number;
  outcome: 0 | 1;
}

interface Corpus {
  generatedAt: string;
  observations: CorpusObservation[];
}

let cached: Corpus | null | undefined;

export async function loadCorpus(): Promise<Corpus | null> {
  if (cached !== undefined) return cached;
  try {
    const file = path.join(process.cwd(), 'data', 'calibration-corpus.json');
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Corpus;
    cached = Array.isArray(parsed.observations) ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

const EDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

export function scoreCorpus(
  symbol: string,
  observations: CorpusObservation[],
  generatedAt: string,
): BacktestResult | null {
  const obs = observations.filter((o) => o.symbol === symbol);
  if (obs.length < 20) return null;

  const buckets: CalibrationBucket[] = EDGES.slice(0, -1).map((lower, i) => {
    const upper = EDGES[i + 1];
    const inB = obs.filter(
      (o) =>
        o.forecast >= lower &&
        (i === EDGES.length - 2 ? o.forecast <= upper : o.forecast < upper),
    );
    return {
      lower,
      upper,
      samples: inB.length,
      realised: inB.length ? inB.reduce((a, o) => a + o.outcome, 0) / inB.length : 0,
    };
  });

  const bias = obs.reduce((a, o) => a + (o.forecast - o.outcome), 0) / obs.length;
  const brier = obs.reduce((a, o) => a + (o.forecast - o.outcome) ** 2, 0) / obs.length;
  const markets = new Set(obs.map((o) => o.marketId)).size;

  const notes: string[] = [
    `Scored from the committed calibration corpus: ${markets} resolved ${symbol} markets, built ${new Date(generatedAt).toUTCString().slice(5, 16)}.`,
    'Each market is sampled at 15%, 35%, 55% and 75% of its lifetime, and scored against its own settlement price. Points from one market are correlated, so the sample count overstates the number of independent events.',
  ];

  if (bias > 0.03) {
    notes.push(
      `The crowd was overconfident by ${(bias * 100).toFixed(1)} points on average — it priced ${symbol} outcomes higher than they resolved.`,
    );
  } else if (bias < -0.03) {
    notes.push(
      `The crowd was underconfident by ${(Math.abs(bias) * 100).toFixed(1)} points on average — ${symbol} outcomes resolved more often than the crowd priced them.`,
    );
  } else {
    notes.push(`The crowd was close to well calibrated on ${symbol}.`);
  }
  notes.push(`Brier score ${brier.toFixed(3)} (0 = perfect, 0.25 = a coin flip).`);

  return {
    symbol,
    marketsAnalysed: markets,
    observations: obs.length,
    buckets,
    bias,
    brierScore: brier,
    notes,
  };
}
