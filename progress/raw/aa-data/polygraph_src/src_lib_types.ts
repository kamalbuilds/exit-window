// ---------------------------------------------------------------------------
// Nansen API response shapes.
// These are transcribed from LIVE responses captured against api.nansen.ai,
// not from the docs — several documented paths (e.g. `smart-money/netflows`)
// do not exist, and several documented bodies are missing required fields.
// See docs/API-NOTES.md for the full reconnaissance log.
// ---------------------------------------------------------------------------

export interface NansenPagination {
  page: number;
  per_page: number;
  is_last_page: boolean;
}

export interface NansenEnvelope<T> {
  pagination?: NansenPagination;
  data: T[];
  message?: string;
}

/** POST /v1/prediction-market/market-screener */
export interface PredictionMarket {
  market_id: string;
  question: string;
  slug: string;
  event_id: string;
  event_title: string;
  active: boolean;
  closed: boolean;
  end_date: string;
  neg_risk: boolean;
  tags: string[];
  volume: number;
  volume_24hr: number;
  volume_1wk: number;
  volume_1mo: number;
  liquidity: number;
  volume_change_pct: number | null;
  open_interest: number;
  best_bid: number | null;
  best_ask: number | null;
  last_trade_price: number | null;
  one_day_price_change: number | null;
  unique_traders_24h: number;
  created_at: string;
  age_hours: number;
}

/** POST /v1/prediction-market/ohlcv */
export interface PredictionMarketCandle {
  market_id: string;
  token_id: string;
  side: string;
  outcome_index: number;
  period_start: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume_usd: number;
  trade_count: number;
  unique_traders: number;
}

/** POST /v1/tgm/flow-intelligence — the six cohorts. */
export interface FlowIntelligence {
  public_figure_net_flow_usd: number;
  public_figure_avg_flow_usd: number;
  public_figure_wallet_count: number;
  top_pnl_net_flow_usd: number;
  top_pnl_avg_flow_usd: number;
  top_pnl_wallet_count: number;
  whale_net_flow_usd: number;
  whale_avg_flow_usd: number;
  whale_wallet_count: number;
  smart_trader_net_flow_usd: number;
  smart_trader_avg_flow_usd: number;
  smart_trader_wallet_count: number;
  exchange_net_flow_usd: number;
  exchange_avg_flow_usd: number;
  exchange_wallet_count: number;
  fresh_wallets_net_flow_usd: number;
  fresh_wallets_avg_flow_usd: number;
  fresh_wallets_wallet_count: number;
}

/** POST /v1/tgm/token-ohlcv */
export interface TokenCandle {
  interval_start: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  volume_usd: number;
  market_cap: number;
}

/** POST /v1/smart-money/netflow (singular — `netflows` 404s) */
export interface SmartMoneyNetflow {
  token_address: string;
  token_symbol: string;
  net_flow_1h_usd: number;
  net_flow_24h_usd: number;
  net_flow_7d_usd: number;
  net_flow_30d_usd: number;
  chain: string;
  token_sectors: string[] | null;
  trader_count: number;
  token_age_days: number;
  market_cap_usd: number;
}

// ---------------------------------------------------------------------------
// Polygraph domain model
// ---------------------------------------------------------------------------

export type CohortKey =
  | 'smart_trader'
  | 'top_pnl'
  | 'whale'
  | 'public_figure'
  | 'fresh_wallets'
  | 'exchange';

export interface CohortReading {
  key: CohortKey;
  label: string;
  /** Short description of who these wallets are. */
  blurb: string;
  netFlowUsd: number;
  walletCount: number;
  /** Bounded conviction in [-1, 1]; positive = accumulating. */
  stance: number;
  /** True when this cohort is treated as "informed capital". */
  informed: boolean;
  /** True when the raw flow sign is inverted to express bullishness
   *  (exchange inflow = sell pressure). */
  inverted: boolean;
}

/**
 * What a market's price actually claims. These are three different random
 * variables and must never be blended:
 *
 *  - `terminal_above`  P(close >= strike at expiry)     — a true CDF point
 *  - `touch_up`        P(running max >= strike)         — an upside barrier
 *  - `touch_down`      P(running min <= strike)         — a downside barrier
 */
export type MarketClaim = 'terminal_above' | 'touch_up' | 'touch_down';

export interface LadderRung {
  marketId: string;
  question: string;
  /** Strike price parsed from the question, in USD. */
  strike: number;
  /** The market's own probability for the claim it makes. */
  probability: number;
  claim: MarketClaim;
  /** Signed distance from spot, e.g. 0.12 = strike is 12% above spot. */
  distanceFromSpot: number | null;
  openInterest: number;
  volume24h: number;
  endDate: string;
  /** Human label for the expiry bucket this rung belongs to. */
  horizon: string;
}

export type SayMethod = 'terminal-median' | 'barrier-asymmetry' | 'none';

export interface SayReading {
  method: SayMethod;
  stance: number;
  impliedMedian: number | null;
  impliedMovePct: number | null;
  /**
   * For the barrier method: the crowd's priced chance of moving X% up versus
   * X% down, sampled at matched distances from spot.
   */
  asymmetry: {
    distancePct: number;
    pUp: number;
    pDown: number;
  }[];
  /** Mean (pUp - pDown) across matched distances. */
  asymmetryScore: number | null;
  horizonLabel: string;
  explanation: string;
}

/** How much to trust this reading, and why. */
export interface Confidence {
  /** 0-1. */
  score: number;
  band: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
}

export interface AssetVerdict {
  symbol: string;
  name: string;
  chain: string;
  tokenAddress: string;

  spot: number | null;
  /** Median price implied by the Polymarket strike ladder. */
  impliedMedian: number | null;
  /** (impliedMedian / spot) - 1 */
  impliedMovePct: number | null;

  /** Crowd's directional conviction, bounded [-1, 1]. */
  sayStance: number;
  /** Informed-capital directional conviction, bounded [-1, 1]. */
  doStance: number;
  /** sayStance - doStance, bounded [-2, 2]. */
  gap: number;
  /** |gap| rescaled to 0-100 for display. */
  gapScore: number;

  marketCount: number;
  totalOpenInterest: number;
  totalVolume24h: number;
  uniqueTraders24h: number;

  cohorts: CohortReading[];
  ladder: LadderRung[];

  say: SayReading;
  confidence: Confidence;

  /** Plain-English accusation. */
  headline: string;
  verdict: 'DECEPTION' | 'TENSION' | 'ALIGNED' | 'INCONCLUSIVE';

  /** Data-quality notes surfaced in the UI rather than hidden. */
  caveats: string[];
}

export interface PolygraphSnapshot {
  generatedAt: string;
  assets: AssetVerdict[];
  meta: {
    apiCallsThisRequest: number;
    apiCallsTotal: number;
    cacheHits: number;
    degraded: boolean;
    errors: string[];
  };
}

export interface CalibrationBucket {
  /** Lower edge of the implied-probability bucket, e.g. 0.7 for 70-80%. */
  lower: number;
  upper: number;
  samples: number;
  /** Share of samples that finished in-the-money. */
  realised: number;
}

export interface BacktestResult {
  symbol: string;
  marketsAnalysed: number;
  observations: number;
  buckets: CalibrationBucket[];
  /** Mean (implied - realised); positive = the crowd was systematically overconfident. */
  bias: number;
  brierScore: number;
  notes: string[];
}
