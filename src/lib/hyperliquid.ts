// Hyperliquid public info API. No key required, no credits, no rate-limit budget to protect -
// so this client is plain fetch with no cache layer of its own.
import type { Direction, OpenPosition } from "./types";

export type CandleInterval = "1m" | "5m" | "15m" | "1h";

export interface Candle {
  t: number; // open time, ms
  T: number; // close time, ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Hyperliquid keeps ~5000 candles per interval, so pick the coarsest interval that still covers
 * how long ago the event was. */
export function intervalForAge(ageMs: number): CandleInterval {
  const days = ageMs / 86_400_000;
  if (days < 3) return "1m";
  if (days < 17) return "5m";
  if (days < 52) return "15m";
  return "1h";
}

/** Returns null (not an error) when Hyperliquid has no candles for this coin - true for
 * newly-listed HIP-3 markets ("xyz:", "io:") that the caller should skip gracefully. */
export async function fetchCandles(
  coin: string,
  interval: CandleInterval,
  startTime: number,
  endTime: number,
): Promise<Candle[] | null> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval, startTime, endTime } }),
  });
  if (!res.ok) return null;
  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((c: Record<string, unknown>) => ({
    t: Number(c.t),
    T: Number(c.T),
    o: Number(c.o),
    h: Number(c.h),
    l: Number(c.l),
    c: Number(c.c),
    v: Number(c.v),
  }));
}

const MIDS_TTL_MS = 15_000;
let midsCache: { data: Record<string, number>; fetchedAt: number } | null = null;

/** allMids changes every block; a 15s cache keeps mark-price lookups (one per report, one per
 * position list) from hammering Hyperliquid's public endpoint on every request. */
export async function fetchAllMids(): Promise<Record<string, number>> {
  if (midsCache && Date.now() - midsCache.fetchedAt < MIDS_TTL_MS) return midsCache.data;
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "allMids" }),
  });
  if (!res.ok) throw new Error(`Hyperliquid allMids ${res.status}`);
  const raw = (await res.json()) as Record<string, string | number>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw ?? {})) out[k] = Number(v);
  midsCache = { data: out, fetchedAt: Date.now() };
  return out;
}

/** Fills OpenPosition.markPx from the live mid, leaving it null only for coins allMids doesn't
 * carry (HIP-3 markets like "xyz:"/"io:" prefixes, or a delisted coin). */
export async function attachMarkPrices<T extends { coin: string; markPx: number | null }>(
  positions: T[],
): Promise<T[]> {
  if (positions.length === 0) return positions;
  const mids = await fetchAllMids();
  return positions.map((p) => ({ ...p, markPx: mids[p.coin] ?? null }));
}

interface RawClearinghousePosition {
  coin: string;
  szi: string;
  entryPx: string;
  unrealizedPnl: string;
  leverage?: { type: string; value: number };
}

/** The user's own open positions, straight from Hyperliquid's public account state - free, no
 * key, no Nansen credits. This is the "your side" of an overlap: what tgm/perp-positions'
 * labeled wallets are compared against in overlap.ts. markPx is left null; attachMarkPrices
 * fills it from the same allMids cache used everywhere else. */
export async function fetchClearinghouseState(address: string): Promise<OpenPosition[]> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "clearinghouseState", user: address }),
  });
  if (!res.ok) throw new Error(`Hyperliquid clearinghouseState ${res.status}`);
  const raw = (await res.json()) as { assetPositions?: { position: RawClearinghousePosition }[] };
  return (raw.assetPositions ?? []).map(({ position: p }) => {
    const szi = Number(p.szi);
    const direction: Direction = szi < 0 ? "short" : "long";
    return {
      coin: p.coin,
      direction,
      size: Math.abs(szi),
      entryPx: Number(p.entryPx),
      markPx: null,
      unrealizedPnlUsd: Number(p.unrealizedPnl),
      leverage: p.leverage?.value ?? null,
    };
  });
}
