// Pure helpers for the "You vs Smart Money" chart: timeframe -> candle interval/range, marker
// classification for both Nansen smart-money/perp-trades rows and locally-stored Fill rows, the
// value-weighted Smart Money entry, and exit-window shading bands (built on exitwindow.ts's
// measureWindow so the band matches the same math the rest of the product uses for a window).
import { shortAddr } from "@/components/format";
import type { CandleInterval, Candle } from "./hyperliquid";
import { measureWindow } from "./exitwindow";
import type { SmartMoneyPerpTrade } from "./nansen";
import type { Direction, Episode, Fill } from "./types";

export type Timeframe = "1h" | "4h" | "1d" | "7d";

interface TfConfig {
  interval: CandleInterval;
  rangeMs: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Timeframe pill -> Hyperliquid candle interval and how far back to ask for. Wider than the
 * pill's own name so there is always enough tape around the recent action to read. */
const TF_CONFIG: Record<Timeframe, TfConfig> = {
  "1h": { interval: "1m", rangeMs: 6 * HOUR_MS },
  "4h": { interval: "5m", rangeMs: DAY_MS },
  "1d": { interval: "15m", rangeMs: 4 * DAY_MS },
  "7d": { interval: "1h", rangeMs: 30 * DAY_MS },
};

export function tfConfig(tf: string | null | undefined): TfConfig {
  return TF_CONFIG[tf as Timeframe] ?? TF_CONFIG["1d"];
}

export type FillAction = "Open" | "Add" | "Reduce" | "Close";

export interface ChartMarker {
  t: number;
  px: number;
  side: "Long" | "Short";
  action: FillAction;
  usd: number;
  label: string;
  address: string;
}

export interface WindowBand {
  from: number;
  to: number;
}

/** GET /api/chart/[coin] response. Always 200: candles are Hyperliquid public data (always
 * live); everything Nansen-sourced is best-effort from cache and simply omitted/empty when
 * there's nothing stored for it, never surfaced as an error. */
export interface ChartResponse {
  candles: Candle[];
  smFills: ChartMarker[];
  yourEntry?: number;
  yourSize?: number;
  yourDirection?: Direction; // which side "worse than Smart Money" (higher/lower entry) means
  smAvgEntry?: number;
  windows: WindowBand[];
}

const REDUCE_ACTIONS = new Set(["Reduce", "Close"]);

function normalizeAction(raw: string): FillAction {
  if (raw === "Add") return "Add";
  if (raw === "Close") return "Close";
  if (REDUCE_ACTIONS.has(raw)) return "Reduce";
  return "Open";
}

const REFERRAL_LABEL = /^Uses ".*" HL Referral Code$/;

/** A leaderboard label that says nothing; fall back to the address rather than show junk. */
function displayLabel(label: string, address: string): string {
  const trimmed = label.trim();
  if (!trimmed || trimmed === "High Balance" || REFERRAL_LABEL.test(trimmed)) return shortAddr(address);
  return trimmed;
}

/** One coin-filtered Nansen smart-money/perp-trades row as a chart marker. */
export function smTradeToMarker(t: SmartMoneyPerpTrade): ChartMarker {
  return {
    t: t.at,
    px: t.priceUsd,
    side: t.side,
    action: normalizeAction(t.action),
    usd: t.valueUsd,
    label: displayLabel(t.traderLabel, t.traderAddress),
    address: t.traderAddress,
  };
}

/** A raw fill only carries isBuy + the signed position before it, never an Open/Add/Reduce/Close
 * label or a direction - both have to be derived from the sign of the position before and after. */
export function classifyFill(f: Fill): { action: FillAction; direction: Direction } {
  const before = f.startPosition;
  const after = before + (f.isBuy ? f.sz : -f.sz);
  const signBefore = Math.sign(before);
  const signAfter = Math.sign(after);
  const direction: Direction = signBefore !== 0 ? (signBefore > 0 ? "long" : "short") : f.isBuy ? "long" : "short";
  let action: FillAction;
  if (signBefore === 0) action = "Open";
  else if (signAfter === 0) action = "Close";
  else if (signBefore === signAfter && Math.abs(after) > Math.abs(before)) action = "Add";
  else action = "Reduce"; // includes a flip through zero - reduces the prior side either way
  return { action, direction };
}

/** A stored Fill (companion or the viewed wallet's own history) as a chart marker. */
export function fillToMarker(f: Fill, address: string, label: string): ChartMarker {
  const { action, direction } = classifyFill(f);
  return {
    t: f.t,
    px: f.px,
    side: direction === "long" ? "Long" : "Short",
    action,
    usd: f.px * f.sz,
    label: displayLabel(label, address),
    address,
  };
}

/** Value-weighted Smart Money entry, same formula the overlap table uses for the entry-gap read. */
export function valueWeightedEntry(companions: { entryPx: number; positionValueUsd: number }[]): number | null {
  const cs = companions.filter((c) => c.entryPx > 0 && c.positionValueUsd > 0);
  const w = cs.reduce((a, c) => a + c.positionValueUsd, 0);
  if (!w) return null;
  return cs.reduce((a, c) => a + c.entryPx * c.positionValueUsd, 0) / w;
}

/** A minimal, otherwise-unused Episode just so measureWindow's own math runs unchanged - the
 * window band is a first-class measurement, not a re-derivation of it. */
function stubEpisode(direction: Direction, coin: string, reduceAt: number, reducePx: number): Episode {
  return {
    coin,
    direction,
    openedAt: reduceAt,
    closedAt: null,
    observedOpen: true,
    entries: [],
    exits: [{ t: reduceAt, px: reducePx, sz: 0 }],
    peakSize: 0,
    avgEntryPx: 0,
    avgExitPx: null,
    realizedPnlUsd: 0,
    walletReturnPct: null,
  };
}

/** Every Reduce/Close marker within the candle span becomes a shaded band from that reduce to
 * whenever price moved 1% against a holder (or the end of the visible candles, if it never did).
 * Dedupes same wallet + same instant so one trade reported by two sources doesn't double-band. */
export function bandsFromReduces(
  markers: ChartMarker[],
  coin: string,
  candles: Candle[],
  thresholdPct = 1,
  horizonMin = 1440,
): WindowBand[] {
  if (candles.length === 0) return [];
  const first = candles[0].t;
  const last = candles[candles.length - 1].T;
  const seen = new Set<string>();
  const bands: WindowBand[] = [];
  for (const m of markers) {
    if (m.action !== "Reduce" && m.action !== "Close") continue;
    if (m.t < first || m.t > last) continue;
    const key = `${m.address.toLowerCase()}:${m.t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const direction: Direction = m.side === "Long" ? "long" : "short";
    const w = measureWindow(stubEpisode(direction, coin, m.t, m.px), candles, thresholdPct, horizonMin);
    const to = w.windowMin !== null ? m.t + w.windowMin * 60_000 : m.t + horizonMin * 60_000;
    bands.push({ from: m.t, to: Math.min(to, last) });
  }
  return bands;
}
