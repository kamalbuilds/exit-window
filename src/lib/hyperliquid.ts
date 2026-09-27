// Hyperliquid public info API. No key required, no credits, no rate-limit budget to protect -
// so this client is plain fetch with no cache layer of its own.
import type { Direction, Fill, OpenPosition } from "./types";

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

/** Returns null (not an error) when Hyperliquid has no candles for this coin - a newly-listed
 * market with no history yet, or a bad name. HIP-3 coins work as-is: candleSnapshot takes the
 * dex-prefixed name directly ("xyz:CL", "io:NBIS"), no separate dex param needed. */
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
const midsCache = new Map<string, { data: Record<string, number>; fetchedAt: number }>(); // keyed by dex, "" = main

/** A builder-deployed HIP-3 market's coin name carries its dex as a prefix - "xyz:CL", "io:NBIS"
 * - and Hyperliquid only returns its mid from an allMids call scoped to that same dex ({dex:
 * "xyz"}); the default (no-dex) allMids call, the main perp market, never carries these. Plain
 * coins (no ":") stay on the main dex, prefix "". Exported for the name-mapping unit test. */
export function dexPrefix(coin: string): string {
  const i = coin.indexOf(":");
  return i === -1 ? "" : coin.slice(0, i);
}

/** allMids changes every block; a 15s cache per dex keeps mark-price lookups (one per report,
 * one per position list) from hammering Hyperliquid's public endpoint on every request. Exported
 * so a single-coin caller (mirror.ts's mirrorChange, pricing one leader's coin at a time) can
 * pair it with dexPrefix() directly instead of routing through attachMarkPrices' position-list
 * shape for one coin. */
export async function fetchMidsForDex(dex: string): Promise<Record<string, number>> {
  const cached = midsCache.get(dex);
  if (cached && Date.now() - cached.fetchedAt < MIDS_TTL_MS) return cached.data;
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dex ? { type: "allMids", dex } : { type: "allMids" }),
  });
  if (!res.ok) throw new Error(`Hyperliquid allMids ${res.status}`);
  const raw = (await res.json()) as Record<string, string | number>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw ?? {})) out[k] = Number(v);
  midsCache.set(dex, { data: out, fetchedAt: Date.now() });
  return out;
}

/** The main dex's mids, unscoped - unchanged shape/behavior for existing callers (mirror.ts). */
export async function fetchAllMids(): Promise<Record<string, number>> {
  return fetchMidsForDex("");
}

/** Fills OpenPosition.markPx from the live mid, leaving it null only for coins no dex's allMids
 * carries (a delisted coin). Groups positions by dex prefix so a report mixing main-dex coins
 * with HIP-3 ones (e.g. ETH plus xyz:CL, io:NBIS) fetches each dex's mids once and matches each
 * coin against its own dex, not just the main one. */
export async function attachMarkPrices<T extends { coin: string; markPx: number | null }>(
  positions: T[],
): Promise<T[]> {
  if (positions.length === 0) return positions;
  const dexes = [...new Set(positions.map((p) => dexPrefix(p.coin)))];
  const entries = await Promise.all(dexes.map(async (d) => [d, await fetchMidsForDex(d)] as const));
  const midsByDex = new Map(entries);
  return positions.map((p) => ({ ...p, markPx: midsByDex.get(dexPrefix(p.coin))?.[p.coin] ?? null }));
}

interface RawClearinghousePosition {
  coin: string;
  szi: string;
  entryPx: string;
  unrealizedPnl: string;
  leverage?: { type: string; value: number };
  liquidationPx?: string | null;
}

// clearinghouseState, like allMids, is scoped to one dex per call - a position open on a
// builder-deployed HIP-3 market never appears in the unscoped (main-dex) call at all, not just
// missing its mark. ponytail: queried explicitly rather than discovering every deployed dex via
// perpDexs on each report (10+ dexes exist; most a wallet will never touch) - extend this list
// if a position on another HIP-3 dex needs covering.
const CLEARINGHOUSE_DEXES = ["", "xyz", "io"];

async function fetchClearinghouseForDex(address: string, dex: string): Promise<OpenPosition[]> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dex ? { type: "clearinghouseState", user: address, dex } : { type: "clearinghouseState", user: address }),
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
      liquidationPx: p.liquidationPx ? Number(p.liquidationPx) : null,
    };
  });
}

/** One wallet's live position on one coin, read from the coin's own dex only (one call, not the
 * three-dex fan-out). null = the wallet holds nothing on this coin right now. */
export async function fetchPositionOnCoin(address: string, coin: string): Promise<OpenPosition | null> {
  const positions = await fetchClearinghouseForDex(address, dexPrefix(coin));
  return positions.find((p) => p.coin === coin) ?? null;
}

/** The user's own open positions, straight from Hyperliquid's public account state - free, no
 * key, no Nansen credits. This is the "your side" of an overlap: what tgm/perp-positions'
 * labeled wallets are compared against in overlap.ts. markPx is left null; attachMarkPrices
 * fills it from the same allMids cache used everywhere else. Fans out across the main dex plus
 * every known HIP-3 dex so a builder-deployed position (xyz:CL, io:NBIS, ...) isn't silently
 * dropped just because it lives outside the main perp market. */
export async function fetchClearinghouseState(address: string): Promise<OpenPosition[]> {
  const perDex = await Promise.all(CLEARINGHOUSE_DEXES.map((dex) => fetchClearinghouseForDex(address, dex)));
  return perDex.flat();
}

const FILLS_PAGE = 2000; // userFillsByTime's per-response cap

/** A wallet's own fills in [fromMs, toMs] from Hyperliquid's userFillsByTime: the same rows
 * Nansen's profiler/perp-trades serves, read from the system of record. Pages forward by time
 * until a short page. Used when Nansen credits are exhausted so a never-seen wallet still gets a
 * real report instead of an empty one. */
export async function fetchUserFills(address: string, fromMs: number, toMs: number): Promise<Fill[]> {
  const out: Fill[] = [];
  let start = fromMs;
  for (;;) {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "userFillsByTime", user: address, startTime: start, endTime: toMs }),
    });
    if (!res.ok) throw new Error(`Hyperliquid userFillsByTime ${res.status}`);
    const rows = (await res.json()) as {
      coin: string; px: string; sz: string; side: "B" | "A"; time: number; startPosition: string;
      closedPnl: string; hash: string; oid: number; fee: string;
    }[];
    for (const r of rows) {
      out.push({
        t: r.time,
        coin: r.coin,
        isBuy: r.side === "B",
        px: Number(r.px),
        sz: Math.abs(Number(r.sz)),
        startPosition: Number(r.startPosition),
        closedPnl: Number(r.closedPnl),
        feeUsd: Number(r.fee),
        hash: r.hash,
        oid: r.oid,
      });
    }
    if (rows.length < FILLS_PAGE) break;
    start = rows[rows.length - 1].time + 1;
  }
  return out.sort((a, b) => a.t - b.t);
}
