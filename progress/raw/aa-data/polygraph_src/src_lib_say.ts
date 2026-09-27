import {
  AssetDef,
  HORIZONS,
  horizonFor,
  isLadderCandidate,
  matchesAsset,
  parseDirection,
  parseSettlement,
  parseStrike,
} from './assets';
import { clamp } from './engine';
import type { LadderRung, MarketClaim, PredictionMarket, SayReading } from './types';

/**
 * Reading the crowd's mind out of a pile of Polymarket binaries.
 *
 * The naive approach — normalise everything to "probability the price ends up
 * at or above this strike" and draw a curve — is wrong, and live data made it
 * obvious. Three different questions get asked about the same asset:
 *
 *   "Will ETH be above $2,800 on the 16th?"   P(close >= K)      a CDF point
 *   "Will ETH reach $2,800 in September?"     P(max >= K)        upside barrier
 *   "Will ETH dip to $2,250 in September?"    P(min <= K)        downside barrier
 *
 * Only the first is a point on a distribution. The other two describe the
 * running maximum and running minimum, which are different random variables —
 * P(max >= 2750) = 0.63 and P(min <= 2250) = 0.69 are perfectly consistent
 * with each other and with spot at $2,400, but flattening them onto one axis
 * produces a curve that goes the wrong way and a median that is meaningless.
 *
 * So: if there is a real CDF (terminal markets), use it and take the median.
 * Otherwise use the barriers for what they ARE good at — comparing the priced
 * chance of rising 10% against the priced chance of falling 10%. That
 * asymmetry is a clean directional read, and it is the honest thing to
 * compute from barrier markets.
 */

const MIN_TERMINAL_RUNGS = 4;
const MIN_BARRIER_PER_SIDE = 2;
/** Distances from spot at which the two barrier curves are compared. */
const SAMPLE_DISTANCES = [0.05, 0.1, 0.15, 0.25];

export interface LadderBuild {
  rungs: LadderRung[];
  all: LadderRung[];
  inversionRate: number;
  horizonLabel: string;
}

export function parseRungs(
  markets: PredictionMarket[],
  asset: AssetDef,
  spot: number | null,
  now = Date.now(),
): LadderRung[] {
  const out: LadderRung[] = [];

  for (const m of markets) {
    if (!m.active || m.closed) continue;
    if (!matchesAsset(m.question, asset)) continue;
    if (!isLadderCandidate(m.question)) continue;
    if (new Date(m.end_date).getTime() <= now) continue;

    const strike = parseStrike(m.question, asset.strikeRange);
    if (strike === null) continue;

    const direction = parseDirection(m.question);
    if (direction === null) continue;

    const probability = midPrice(m);
    if (probability === null) continue;

    const settlement = parseSettlement(m.question);
    let claim: MarketClaim;
    if (settlement === 'terminal') {
      // "below $K" terminal markets are complementary to "above $K", so they
      // can be flipped safely — unlike barriers.
      claim = 'terminal_above';
    } else {
      claim = direction === 'above' ? 'touch_up' : 'touch_down';
    }

    const p =
      settlement === 'terminal' && direction === 'below' ? 1 - probability : probability;
    if (p <= 0 || p >= 1) continue;

    out.push({
      marketId: m.market_id,
      question: m.question,
      strike,
      probability: p,
      claim,
      distanceFromSpot: spot && spot > 0 ? strike / spot - 1 : null,
      openInterest: m.open_interest ?? 0,
      volume24h: m.volume_24hr ?? 0,
      endDate: m.end_date,
      horizon: horizonFor(m.end_date, now).label,
    });
  }

  return out;
}

/** Same strike + same claim + same horizon: keep the deepest market. */
function dedupe(rungs: LadderRung[]): LadderRung[] {
  const by = new Map<string, LadderRung>();
  for (const r of rungs) {
    const k = `${r.claim}|${r.horizon}|${r.strike}`;
    const prev = by.get(k);
    if (!prev || r.openInterest > prev.openInterest) by.set(k, r);
  }
  return [...by.values()];
}

/**
 * Which expiry bucket to read the crowd from.
 *
 * NOT the most populated one. Polymarket lists a daily close ladder for every
 * major asset, so "today" almost always wins on count — and a ladder expiring
 * in six hours necessarily implies a median within a fraction of a percent of
 * spot. Reading the crowd there produces a permanent, meaningless "flat".
 *
 * Onchain flow is a slow signal measured over days, so the belief worth
 * comparing against it is the longest-dated view the book can actually
 * support. We therefore walk from the longest horizon down and take the first
 * that has real structure.
 */
function chooseHorizon(rungs: LadderRung[], now: number): { label: string; days: number } | null {
  const order = [...HORIZONS].reverse(); // longest first
  for (const h of order) {
    const inBucket = rungs.filter((r) => r.horizon === h.label);
    if (inBucket.length === 0) continue;

    const terminal = inBucket.filter((r) => r.claim === 'terminal_above').length;
    const up = inBucket.filter((r) => r.claim === 'touch_up' && (r.distanceFromSpot ?? 0) > 0).length;
    const down = inBucket.filter((r) => r.claim === 'touch_down' && (r.distanceFromSpot ?? 0) < 0).length;

    if (terminal >= MIN_TERMINAL_RUNGS || (up >= MIN_BARRIER_PER_SIDE && down >= MIN_BARRIER_PER_SIDE)) {
      const daysList = inBucket
        .map((r) => (new Date(r.endDate).getTime() - now) / 86_400_000)
        .filter((d) => d > 0)
        .sort((a, b) => a - b);
      const days = daysList.length
        ? daysList[Math.floor(daysList.length / 2)]
        : 1;
      return { label: h.label, days: Math.max(days, 0.25) };
    }
  }
  return null;
}

/**
 * Convert an implied move into conviction, scaled for the horizon.
 *
 * A 2% expected move over one day is a far louder statement than 2% over a
 * quarter. Price dispersion grows with the square root of time, so the
 * threshold is scaled the same way: 5% over 30 days is the reference point for
 * "strong conviction", and shorter horizons are held to a proportionally
 * tighter standard.
 */
function stanceFromMove(movePct: number, days: number): number {
  const reference = 0.05 * Math.sqrt(Math.max(days, 0.25) / 30);
  return clamp(Math.tanh(movePct / reference), -1, 1);
}

export function readCrowd(
  markets: PredictionMarket[],
  asset: AssetDef,
  spot: number | null,
  now = Date.now(),
): { say: SayReading; build: LadderBuild } {
  const all = dedupe(parseRungs(markets, asset, spot, now));

  const empty: SayReading = {
    method: 'none',
    stance: 0,
    impliedMedian: null,
    impliedMovePct: null,
    asymmetry: [],
    asymmetryScore: null,
    horizonLabel: '—',
    explanation: 'No usable Polymarket structure for this asset right now.',
  };

  if (all.length === 0 || spot === null) {
    return { say: empty, build: { rungs: [], all, inversionRate: 0, horizonLabel: '—' } };
  }

  const chosen = chooseHorizon(all, now);
  if (!chosen) {
    return {
      say: {
        ...empty,
        explanation: `${all.length} ${asset.symbol} market${all.length === 1 ? '' : 's'} parsed, but no single expiry bucket has enough structure to read a direction without guessing.`,
      },
      build: { rungs: [], all, inversionRate: 0, horizonLabel: '—' },
    };
  }
  const horizon = chosen.label;
  const inHorizon = all.filter((r) => r.horizon === horizon);

  // --- Preferred path: a genuine CDF -------------------------------------
  const terminal = inHorizon
    .filter((r) => r.claim === 'terminal_above')
    .sort((a, b) => a.strike - b.strike);

  if (terminal.length >= MIN_TERMINAL_RUNGS) {
    const { median, inversionRate } = medianFromCdf(terminal);
    if (median !== null) {
      const movePct = median / spot - 1;
      return {
        say: {
          method: 'terminal-median',
          stance: stanceFromMove(movePct, chosen.days),
          impliedMedian: median,
          impliedMovePct: movePct,
          asymmetry: [],
          asymmetryScore: null,
          horizonLabel: horizon,
          explanation: `Built from ${terminal.length} close-settled ${asset.symbol} strikes expiring ${horizon} (median ${chosen.days.toFixed(1)} days out) — a true probability distribution, so the 50% crossing is a real implied median. Conviction is scaled by √time, so a small move over a short horizon still counts.`,
        },
        build: { rungs: terminal, all, inversionRate, horizonLabel: horizon },
      };
    }
  }

  // --- Fallback: compare the two barriers --------------------------------
  const up = inHorizon
    .filter((r) => r.claim === 'touch_up' && (r.distanceFromSpot ?? 0) > 0)
    .sort((a, b) => a.strike - b.strike);
  const down = inHorizon
    .filter((r) => r.claim === 'touch_down' && (r.distanceFromSpot ?? 0) < 0)
    .sort((a, b) => b.strike - a.strike);

  if (up.length >= MIN_BARRIER_PER_SIDE && down.length >= MIN_BARRIER_PER_SIDE) {
    const upCurve = up.map((r) => ({ d: r.distanceFromSpot!, p: r.probability }));
    const downCurve = down.map((r) => ({ d: -r.distanceFromSpot!, p: r.probability }));

    const samples: SayReading['asymmetry'] = [];
    for (const d of SAMPLE_DISTANCES) {
      const pUp = interpolate(upCurve, d);
      const pDown = interpolate(downCurve, d);
      if (pUp === null || pDown === null) continue;
      samples.push({ distancePct: d, pUp, pDown });
    }

    if (samples.length > 0) {
      const score =
        samples.reduce((a, s) => a + (s.pUp - s.pDown), 0) / samples.length;
      const ladder = [...up, ...down].sort((a, b) => a.strike - b.strike);
      return {
        say: {
          method: 'barrier-asymmetry',
          stance: clamp(Math.tanh(score / 0.25), -1, 1),
          impliedMedian: null,
          impliedMovePct: null,
          asymmetry: samples,
          asymmetryScore: score,
          horizonLabel: horizon,
          explanation: `No close-settled ${asset.symbol} ladder deep enough for a median, so the crowd is read from barrier markets instead: the priced chance of rising X% against the priced chance of falling X%, at ${samples.length} matched distance${samples.length === 1 ? '' : 's'} from spot, expiring ${horizon}.`,
        },
        build: { rungs: ladder, all, inversionRate: 0, horizonLabel: horizon },
      };
    }
  }

  return {
    say: {
      ...empty,
      horizonLabel: horizon,
      explanation: `${all.length} ${asset.symbol} market${all.length === 1 ? '' : 's'} parsed, but not enough on either side of spot to read a direction without guessing.`,
    },
    build: { rungs: [], all, inversionRate: 0, horizonLabel: horizon },
  };
}

function medianFromCdf(rungs: LadderRung[]): {
  median: number | null;
  inversionRate: number;
} {
  const clean = rungs.map((r) => ({ ...r }));
  let inversions = 0;
  for (let i = 1; i < clean.length; i += 1) {
    if (clean[i].probability > clean[i - 1].probability + 1e-9) inversions += 1;
    clean[i].probability = Math.min(clean[i].probability, clean[i - 1].probability);
  }
  const inversionRate = clean.length > 1 ? inversions / (clean.length - 1) : 0;

  for (let i = 0; i < clean.length - 1; i += 1) {
    const hi = clean[i];
    const lo = clean[i + 1];
    if (hi.probability >= 0.5 && lo.probability <= 0.5) {
      const span = hi.probability - lo.probability;
      if (span <= 1e-9) return { median: hi.strike, inversionRate };
      const t = (hi.probability - 0.5) / span;
      // Interpolate in log price: assets move multiplicatively.
      const m = Math.exp(
        Math.log(hi.strike) + t * (Math.log(lo.strike) - Math.log(hi.strike)),
      );
      return { median: m, inversionRate };
    }
  }
  return { median: null, inversionRate };
}

/** Linear interpolation over a monotone-ish (distance, probability) curve. */
function interpolate(curve: { d: number; p: number }[], target: number): number | null {
  if (curve.length === 0) return null;
  const pts = [...curve].sort((a, b) => a.d - b.d);
  if (target < pts[0].d || target > pts[pts.length - 1].d) return null;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (target >= a.d && target <= b.d) {
      if (b.d - a.d < 1e-9) return a.p;
      const t = (target - a.d) / (b.d - a.d);
      return a.p + t * (b.p - a.p);
    }
  }
  return null;
}

function midPrice(m: PredictionMarket): number | null {
  if (m.best_bid != null && m.best_ask != null && m.best_ask > 0) {
    const mid = (m.best_bid + m.best_ask) / 2;
    if (mid > 0 && mid < 1) return mid;
  }
  if (m.last_trade_price != null && m.last_trade_price > 0 && m.last_trade_price < 1) {
    return m.last_trade_price;
  }
  return null;
}
