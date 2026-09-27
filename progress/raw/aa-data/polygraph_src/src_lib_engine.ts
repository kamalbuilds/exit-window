import type {
  AssetVerdict,
  CohortKey,
  CohortReading,
  Confidence,
  FlowIntelligence,
  SayReading,
} from './types';
import { AssetDef } from './assets';
import type { LadderBuild } from './say';

// ---------------------------------------------------------------------------
// The DO side — what the capital actually did
//
// The SAY side lives in say.ts; it needed enough room of its own.
// ---------------------------------------------------------------------------

interface CohortSpec {
  key: CohortKey;
  label: string;
  blurb: string;
  informed: boolean;
  inverted: boolean;
  weight: number;
  net: (f: FlowIntelligence) => number;
  count: (f: FlowIntelligence) => number;
}

const COHORTS: CohortSpec[] = [
  {
    key: 'top_pnl',
    label: 'Top PnL',
    blurb: 'Wallets with the best realised profit history.',
    informed: true,
    inverted: false,
    weight: 0.4,
    net: (f) => f.top_pnl_net_flow_usd,
    count: (f) => f.top_pnl_wallet_count,
  },
  {
    key: 'smart_trader',
    label: 'Smart Traders',
    blurb: "Nansen's Smart Money label — consistent outperformers.",
    informed: true,
    inverted: false,
    weight: 0.35,
    net: (f) => f.smart_trader_net_flow_usd,
    count: (f) => f.smart_trader_wallet_count,
  },
  {
    key: 'whale',
    label: 'Whales',
    blurb: 'Balance-sheet size large enough to move the book.',
    informed: true,
    inverted: false,
    weight: 0.25,
    net: (f) => f.whale_net_flow_usd,
    count: (f) => f.whale_wallet_count,
  },
  {
    key: 'public_figure',
    label: 'Public Figures',
    blurb: 'Named, publicly attributable wallets.',
    informed: false,
    inverted: false,
    weight: 0,
    net: (f) => f.public_figure_net_flow_usd,
    count: (f) => f.public_figure_wallet_count,
  },
  {
    key: 'fresh_wallets',
    label: 'Fresh Wallets',
    blurb: 'Newly created addresses — the closest available proxy for retail.',
    informed: false,
    inverted: false,
    weight: 0,
    net: (f) => f.fresh_wallets_net_flow_usd,
    count: (f) => f.fresh_wallets_wallet_count,
  },
  {
    key: 'exchange',
    label: 'Exchanges',
    blurb:
      'Net flow into CEX wallets. Inflow is supply arriving to be sold, so the sign is inverted to express bullishness.',
    informed: false,
    inverted: true,
    weight: 0,
    net: (f) => f.exchange_net_flow_usd,
    count: (f) => f.exchange_wallet_count,
  },
];

/** Floor on the normalising denominator, in USD, so a quiet week cannot turn a
 *  $200k flow into maximum conviction. */
const SCALE_FLOOR_USD = 250_000;

/**
 * Each cohort is scored against ITS OWN recent pace, never against the other
 * cohorts. Fresh wallets move billions and smart traders move thousands; a
 * shared denominator would drown every informed signal.
 */
export function readCohorts(
  day: FlowIntelligence | null,
  week: FlowIntelligence | null,
): CohortReading[] {
  return COHORTS.map((c) => {
    const net = day ? c.net(day) : 0;
    const weekly = week ? c.net(week) : 0;
    const dailyPace = Math.abs(weekly) / 7;
    const scale = Math.max(dailyPace, SCALE_FLOOR_USD);
    const raw = clamp(Math.tanh(net / scale), -1, 1);
    return {
      key: c.key,
      label: c.label,
      blurb: c.blurb,
      netFlowUsd: net,
      walletCount: day ? c.count(day) : 0,
      stance: c.inverted ? -raw : raw,
      informed: c.informed,
      inverted: c.inverted,
    };
  });
}

export function reportingInformed(cohorts: CohortReading[]): CohortReading[] {
  const specs = new Map(COHORTS.map((c) => [c.key, c]));
  return cohorts.filter((c) => {
    const spec = specs.get(c.key);
    return !!spec && spec.informed && spec.weight > 0 && c.netFlowUsd !== 0;
  });
}

/** Informed capital's aggregate stance, weighted and renormalised over the
 *  cohorts that actually reported data. */
export function doStanceFrom(cohorts: CohortReading[]): number {
  const specs = new Map(COHORTS.map((c) => [c.key, c]));
  let num = 0;
  let den = 0;
  for (const c of reportingInformed(cohorts)) {
    const spec = specs.get(c.key)!;
    num += spec.weight * c.stance;
    den += spec.weight;
  }
  if (den === 0) return 0;
  return clamp(num / den, -1, 1);
}

// ---------------------------------------------------------------------------
// Confidence — how much of this reading is real
// ---------------------------------------------------------------------------

export function confidenceFor(
  say: SayReading,
  build: LadderBuild,
  cohorts: CohortReading[],
  hasSpot: boolean,
): Confidence {
  const reasons: string[] = [];
  let score = 1;

  if (say.method === 'none') {
    score = 0;
    reasons.push('No readable crowd structure for this asset.');
  }

  if (say.method === 'barrier-asymmetry') {
    // Correct, but a coarser instrument than a real distribution.
    score *= 0.8;
    reasons.push(
      'Direction is read from barrier markets rather than a close-settled distribution, so there is no implied price level — only an up-versus-down skew.',
    );
  }

  const rungs = build.rungs.length;
  if (say.method !== 'none') {
    if (rungs < 5) {
      score *= 0.6;
      reasons.push(`Only ${rungs} usable strikes in the dominant expiry bucket.`);
    } else if (rungs < 9) {
      score *= 0.9;
    }
  }

  if (build.inversionRate > 0.3) {
    score *= 0.6;
    reasons.push(
      `${Math.round(build.inversionRate * 100)}% of adjacent strikes were priced inconsistently with each other and had to be smoothed.`,
    );
  } else if (build.inversionRate > 0.15) {
    score *= 0.85;
  }

  const informed = reportingInformed(cohorts).length;
  if (informed === 0) {
    score = 0;
    reasons.push('No informed cohort reported flow for this token.');
  } else if (informed === 1) {
    score *= 0.5;
    reasons.push(
      'Only one informed cohort reported flow — the onchain read rests on a single group.',
    );
  } else if (informed === 2) {
    score *= 0.85;
  }

  if (!hasSpot) {
    score = 0;
    reasons.push('No spot price available.');
  }

  const band: Confidence['band'] = score >= 0.7 ? 'HIGH' : score >= 0.4 ? 'MEDIUM' : 'LOW';
  return { score: Math.max(0, Math.min(1, score)), band, reasons };
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

export function verdictFor(
  gap: number,
  say: number,
  doStance: number,
  confidence: Confidence,
): AssetVerdict['verdict'] {
  if (confidence.score === 0) return 'INCONCLUSIVE';

  const opposed =
    Math.sign(say) !== 0 && Math.sign(doStance) !== 0 && Math.sign(say) !== Math.sign(doStance);
  const mag = Math.abs(gap);

  // A low-confidence reading is never allowed to shout. Calling DECEPTION off
  // one cohort and four strikes is exactly how a dashboard loses credibility.
  if (opposed && mag >= 0.8 && confidence.band === 'HIGH') return 'DECEPTION';
  if (opposed && mag >= 0.8) return 'TENSION';
  if (mag >= 0.5) return 'TENSION';
  if (mag < 0.25) return 'ALIGNED';
  return 'TENSION';
}

/** Verb phrase, e.g. "aggressively selling". */
function verbPhrase(stance: number): string {
  const a = Math.abs(stance);
  const dir = stance > 0 ? 'buying' : 'selling';
  if (a < 0.15) return 'sitting flat';
  if (a < 0.45) return `leaning ${stance > 0 ? 'long' : 'short'}`;
  if (a < 0.8) return dir;
  return `aggressively ${dir}`;
}

export function headlineFor(
  asset: AssetDef,
  say: number,
  doStance: number,
  cohorts: CohortReading[],
  verdict: AssetVerdict['verdict'],
): string {
  const crowd = verbPhrase(say);
  const smart = verbPhrase(doStance);
  const sym = asset.symbol;

  if (verdict === 'INCONCLUSIVE') {
    return `Not enough coherent ${sym} data to take a reading right now.`;
  }

  if (verdict === 'ALIGNED') {
    return `Polymarket and the smart money agree on ${sym} — both ${crowd}. No divergence to trade.`;
  }

  const opposed = Math.sign(say) !== Math.sign(doStance) && say !== 0 && doStance !== 0;

  let base: string;
  if (opposed) {
    base = `The crowd is ${crowd} ${sym}. The best-performing wallets are ${smart} it.`;
  } else if (Math.abs(say) > Math.abs(doStance)) {
    base = `Polymarket is ${crowd} ${sym} harder than the money is — informed capital is only ${smart}.`;
  } else {
    base = `Informed capital is ${smart} ${sym} well ahead of the crowd, which is merely ${crowd}.`;
  }

  const retail = cohorts.find((c) => c.key === 'fresh_wallets');
  if (
    retail &&
    Math.abs(retail.stance) > 0.4 &&
    doStance !== 0 &&
    Math.sign(retail.stance) !== Math.sign(doStance)
  ) {
    return `${base} Fresh wallets are on the crowd's side of the trade.`;
  }
  return base;
}

// ---------------------------------------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function gapScore(gap: number): number {
  return Math.round((Math.abs(gap) / 2) * 100);
}
