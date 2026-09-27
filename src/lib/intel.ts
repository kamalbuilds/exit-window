// Intelligence layer for Exit Window: sibling wallets, cohort balance, smart-alert dispatch,
// and Smart Money exit pressure. Wraps nansen.ts's nansenCall (never fetch()es Nansen directly)
// and adds its own memory+disk TTL cache for the endpoints nansen.ts's TTL_MS table doesn't list
// (related-wallets, labels, search/general, tgm/position-intelligence, smart-alert) - nansen.ts
// is lane E's file and out of scope to edit, so caching for these lives here instead.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Direction } from "./types";
import {
  fetchSmartMoneyPerpTrades,
  fetchTgmPerpPositions,
  nansenCall,
  type SmartMoneyPerpTrade,
} from "./nansen";

type Json = unknown;

// ---------------------------------------------------------------------------
// Own TTL cache (memory -> disk). Two tiers only, no committed-seed layer: these are new
// endpoints with nothing to seed. ponytail: good enough for a single-instance/serverless
// deploy; if this ever needs cross-instance coherency, move it into nansen.ts's own cache.
// ---------------------------------------------------------------------------
interface Cached<T> {
  data: T;
  at: number;
}
const mem = new Map<string, Cached<unknown>>();

function cacheDir(): string {
  if (process.env.INTEL_CACHE_DIR) return process.env.INTEL_CACHE_DIR;
  if (process.env.VERCEL) return "/tmp/intel-cache";
  return path.join(process.cwd(), ".cache", "intel");
}

async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const m = mem.get(key) as Cached<T> | undefined;
  if (m && now - m.at < ttlMs) return m.data;

  const file = path.join(cacheDir(), `${createHash("sha256").update(key).digest("hex")}.json`);
  try {
    const disk = JSON.parse(await readFile(file, "utf8")) as Cached<T>;
    if (now - disk.at < ttlMs) {
      mem.set(key, disk);
      return disk.data;
    }
  } catch {
    // no usable disk entry
  }

  const data = await fetcher();
  const rec: Cached<T> = { data, at: now };
  mem.set(key, rec);
  void mkdir(cacheDir(), { recursive: true })
    .then(() => writeFile(file, JSON.stringify(rec)))
    .catch(() => {});
  return data;
}

const CLUSTER_TTL_MS = 6 * 60 * 60_000;
const SEARCH_TTL_MS = 24 * 60 * 60_000;
const POSITION_INTEL_TTL_MS = 10 * 60_000;
const PRESSURE_TTL_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// 1. Cluster: /api/intel/cluster/[address]
// ---------------------------------------------------------------------------
export interface Sibling {
  address: string;
  label: string | null;
  relation: string;
  firstSeen: number;
}

export interface WalletCluster {
  address: string;
  labels: string[];
  siblings: Sibling[];
  siblingsChain: string;
  siblingsNote: string;
}

/** profiler/address/labels response -> label names. Non-premium endpoint (as named in the
 * task's spec file); smart_money/alpha_trader tags live behind /profiler/address/premium-labels,
 * not used here. */
export function parseLabelsResponse(j: Json): string[] {
  const data = (j as { data?: { label?: string }[] }).data ?? [];
  return data.map((r) => String(r.label ?? "")).filter(Boolean);
}

/** profiler/address/related-wallets response -> siblings. */
export function parseRelatedWalletsResponse(j: Json): Sibling[] {
  const data = (j as { data?: Record<string, unknown>[] }).data ?? [];
  return data.map((r): Sibling => ({
    address: String(r.address ?? ""),
    label: (r.address_label as string) || null,
    relation: String(r.relation ?? ""),
    firstSeen: Date.parse(String(r.block_timestamp ?? "")) || 0,
  }));
}

/** profiler/address/related-wallets does not accept chain=hyperliquid (not in its chain enum;
 * profiler/address/labels does support hyperliquid and is used as-is below). Hyperliquid wallets
 * are plain EVM addresses and Hyperliquid's bridge contract lives on Arbitrum, so we query
 * related-wallets on arbitrum instead: it surfaces wallets that funded or were funded by this
 * address through the HL bridge, which is the closest available proxy for "sibling wallet." */
const RELATED_WALLETS_CHAIN = "arbitrum";
const SIBLINGS_NOTE =
  "profiler/address/related-wallets has no chain=hyperliquid in its enum; queried chain=arbitrum " +
  "instead (Hyperliquid's bridge contract lives on Arbitrum), so siblings are wallets that " +
  "funded or were funded by this address via the bridge, not Hyperliquid-native activity.";

export async function fetchWalletCluster(address: string): Promise<WalletCluster> {
  return cached(`cluster:${address.toLowerCase()}`, CLUSTER_TTL_MS, async () => {
    const [labelsRes, relatedRes] = await Promise.all([
      nansenCall(
        "profiler/address/labels",
        { address, chain: "hyperliquid", pagination: { page: 1, per_page: 100 } },
        parseLabelsResponse,
      ),
      nansenCall(
        "profiler/address/related-wallets",
        { wallet_address: address, chain: RELATED_WALLETS_CHAIN, pagination: { page: 1, per_page: 25 } },
        parseRelatedWalletsResponse,
      ),
    ]);
    return {
      address,
      labels: labelsRes.data,
      siblings: relatedRes.data,
      siblingsChain: RELATED_WALLETS_CHAIN,
      siblingsNote: SIBLINGS_NOTE,
    };
  });
}

// ---------------------------------------------------------------------------
// 2. Cohort: /api/intel/cohort/[coin]
// ---------------------------------------------------------------------------
export interface TokenResolution {
  address: string;
  chain: string;
}

export interface PositionIntel {
  smartTraderLongUsd: number;
  smartTraderShortUsd: number;
  whaleLongUsd: number;
  whaleShortUsd: number;
  publicFigureLongUsd: number;
  publicFigureShortUsd: number;
}

export interface CohortIntel {
  coin: string;
  available: boolean;
  reason: string | null;
  tokenAddress: string | null;
  tokenChain: string | null;
  smartTraderLongUsd: number;
  smartTraderShortUsd: number;
  whaleLongUsd: number;
  whaleShortUsd: number;
  publicFigureLongUsd: number;
  publicFigureShortUsd: number;
  oneLiner: string | null;
}

export interface TokenCandidate {
  symbol: string;
  chain: string;
  address: string;
  marketCapUsd: number | null;
}

/** search/general response -> every candidate for `coin` (exact symbol match only). Nansen
 * indexes a Hyperliquid perp under chain="hyperliquid" with a symbolic non-hex address (e.g.
 * address="HYPE"), plus separate real on-chain entries per chain it also trades on. Both pickers
 * below read from this same list so one search call serves cohort (perp) and smart-alert (spot). */
export function parseSearchTokens(j: Json, coin: string): TokenCandidate[] {
  const tokens = (j as { tokens?: { symbol?: string; address?: string; chain?: string; market_cap?: number }[] }).tokens ?? [];
  return tokens
    .filter((t) => (t.symbol ?? "").toUpperCase() === coin.toUpperCase() && t.address && t.chain)
    .map((t) => ({
      symbol: t.symbol as string,
      chain: t.chain as string,
      address: t.address as string,
      marketCapUsd: t.market_cap ?? null,
    }));
}

/** Perp lookup for tgm/position-intelligence: the chain="hyperliquid" entry (symbolic address is
 * correct here - the spec says token_address validation is skipped for perps/hyperliquid). Falls
 * back to the top-ranked candidate if Nansen ever stops tagging a coin that way. */
export function pickPerpToken(candidates: TokenCandidate[]): TokenResolution | null {
  const perp = candidates.find((c) => c.chain === "hyperliquid") ?? candidates[0];
  return perp ? { address: perp.address, chain: perp.chain } : null;
}

/** On-chain spot lookup for the smart-alert (sm-token-flows watches real token transfers, so the
 * symbolic hyperliquid address is useless here). Excludes the hyperliquid entry, then prefers
 * hyperevm (Hyperliquid's own EVM, where its native assets actually live) over other chains, and
 * within a chain prefers the candidate whose market cap matches the hyperliquid listing (same
 * asset) over unrelated same-ticker tokens elsewhere with a much smaller market cap. */
const SPOT_CHAIN_PREFERENCE = ["hyperevm", "ethereum", "arbitrum", "base", "optimism"];

export function pickSpotToken(candidates: TokenCandidate[]): TokenResolution | null {
  const perpCap = candidates.find((c) => c.chain === "hyperliquid")?.marketCapUsd ?? null;
  const onChain = candidates.filter((c) => c.chain !== "hyperliquid");
  const sameAsset = perpCap
    ? onChain.filter((c) => c.marketCapUsd !== null && Math.abs(c.marketCapUsd - perpCap) / perpCap < 0.05)
    : onChain;
  const pool = sameAsset.length > 0 ? sameAsset : onChain;
  for (const chain of SPOT_CHAIN_PREFERENCE) {
    const hit = pool.find((c) => c.chain === chain);
    if (hit) return { address: hit.address, chain: hit.chain };
  }
  return pool[0] ? { address: pool[0].address, chain: pool[0].chain } : null;
}

/** tgm/position-intelligence response (an array, one row expected) -> USD long/short by cohort. */
export function parsePositionIntelligenceResponse(j: Json): PositionIntel {
  const rows = (j as { data?: Record<string, number>[] }).data ?? [];
  const r = rows[0] ?? {};
  return {
    smartTraderLongUsd: Number(r.smart_trader_longs_usd ?? 0),
    smartTraderShortUsd: Number(r.smart_trader_shorts_usd ?? 0),
    whaleLongUsd: Number(r.whale_longs_usd ?? 0),
    whaleShortUsd: Number(r.whale_shorts_usd ?? 0),
    publicFigureLongUsd: Number(r.public_figure_longs_usd ?? 0),
    publicFigureShortUsd: Number(r.public_figure_shorts_usd ?? 0),
  };
}

function fmtRatio(n: number): string {
  return n.toFixed(1);
}

/** Pure: "Smart Traders are 3.1x net long HYPE." Ties and all-one-side cases get an honest
 * plain-English line instead of a divide-by-zero ratio. */
export function buildCohortOneLiner(
  coin: string,
  pos: Pick<PositionIntel, "smartTraderLongUsd" | "smartTraderShortUsd">,
): string {
  const long = pos.smartTraderLongUsd;
  const short = pos.smartTraderShortUsd;
  if (long === 0 && short === 0) return `No Smart Trader positioning data for ${coin}.`;
  if (short === 0) return `Smart Traders are all-long ${coin}, no shorts on record.`;
  if (long === 0) return `Smart Traders are all-short ${coin}, no longs on record.`;
  if (long === short) return `Smart Traders are balanced long/short on ${coin}.`;
  if (long > short) return `Smart Traders are ${fmtRatio(long / short)}x net long ${coin}.`;
  return `Smart Traders are ${fmtRatio(short / long)}x net short ${coin}.`;
}

async function searchCandidates(coin: string): Promise<TokenCandidate[]> {
  return cached(`search:${coin.toLowerCase()}`, SEARCH_TTL_MS, async () => {
    const res = await nansenCall(
      "search/general",
      { search_query: coin, result_type: "token", limit: 10 },
      (j) => parseSearchTokens(j, coin),
    );
    return res.data;
  });
}

/** Perp-market token for tgm/position-intelligence. */
async function resolveTokenAddress(coin: string): Promise<TokenResolution | null> {
  return pickPerpToken(await searchCandidates(coin));
}

/** Real on-chain spot token for the smart-alert. Shares the same 24h-cached search call as
 * resolveTokenAddress above, so resolving both costs one network call per coin per day. Exported
 * read-only (no write) so a caller can build+print an alert body without calling createSmartAlert. */
export async function resolveSpotToken(coin: string): Promise<TokenResolution | null> {
  return pickSpotToken(await searchCandidates(coin));
}

export async function fetchCohortIntel(coin: string): Promise<CohortIntel> {
  const isHip3 = coin.includes(":");
  const searchTerm = isHip3 ? coin.split(":")[1] || coin : coin;
  const resolved = await resolveTokenAddress(searchTerm);

  if (!resolved) {
    return {
      coin,
      available: false,
      reason: isHip3
        ? `"${coin}" is a HIP-3 synthetic market; search/general found no backing token for "${searchTerm}", so tgm/position-intelligence has no address to key on.`
        : `search/general found no token address for "${coin}".`,
      tokenAddress: null,
      tokenChain: null,
      smartTraderLongUsd: 0,
      smartTraderShortUsd: 0,
      whaleLongUsd: 0,
      whaleShortUsd: 0,
      publicFigureLongUsd: 0,
      publicFigureShortUsd: 0,
      oneLiner: null,
    };
  }

  const pos = await cached(`posintel:${resolved.address.toLowerCase()}`, POSITION_INTEL_TTL_MS, async () => {
    const res = await nansenCall(
      "tgm/position-intelligence",
      { token_address: resolved.address },
      parsePositionIntelligenceResponse,
    );
    return res.data;
  });

  return {
    coin,
    available: true,
    reason: null,
    tokenAddress: resolved.address,
    tokenChain: resolved.chain,
    ...pos,
    oneLiner: buildCohortOneLiner(coin, pos),
  };
}

// ---------------------------------------------------------------------------
// 3. Smart alert: /api/intel/smart-alert
// ---------------------------------------------------------------------------
export interface SmartAlertRequestBody {
  name: string;
  type: "sm-token-flows";
  timeWindow: string;
  channels: { type: "telegram"; data: { chatId: string } }[];
  data: {
    chains: string[];
    events: ["sm-token-flows"];
    outflow_1h?: { min: number };
    inflow_1h?: { min: number };
    inclusion: { tokens: { chain: string; address: string }[] };
    exclusion: Record<string, never>;
  };
}

/** Pure: builds the sm-token-flows body. Long holder watches Smart Money OUTFLOW (SM selling
 * the spot token is exit pressure on a long); short holder watches INFLOW (SM buying/accumulating
 * is squeeze risk on a short). */
export function buildSmartAlertRequest(params: {
  chatId: string;
  coin: string;
  direction: Direction;
  tokenAddress: string;
  tokenChain: string;
  thresholdUsd?: number;
}): SmartAlertRequestBody {
  const { chatId, coin, direction, tokenAddress, tokenChain, thresholdUsd = 250_000 } = params;
  const watchOutflow = direction === "long";
  return {
    name: `Exit Window: SM ${watchOutflow ? "outflow" : "inflow"} on ${coin}`,
    type: "sm-token-flows",
    timeWindow: "15m",
    channels: [{ type: "telegram", data: { chatId } }],
    data: {
      chains: [tokenChain],
      events: ["sm-token-flows"],
      ...(watchOutflow
        ? { outflow_1h: { min: thresholdUsd } }
        : { inflow_1h: { min: thresholdUsd } }),
      inclusion: { tokens: [{ chain: tokenChain, address: tokenAddress }] },
      exclusion: {},
    },
  };
}

export interface SmartAlertCreated {
  id: string;
  request: SmartAlertRequestBody;
}

/** Resolves the coin's spot token (reusing the same 24h-cached search as cohort) then creates
 * the Nansen smart alert. Never called without an explicit chatId (enforced by the route). */
export async function createSmartAlert(params: {
  chatId: string;
  coin: string;
  direction: Direction;
  thresholdUsd?: number;
}): Promise<SmartAlertCreated> {
  const resolved = await resolveSpotToken(params.coin);
  if (!resolved) {
    throw new Error(`could not resolve a real on-chain spot token address for "${params.coin}"`);
  }
  const request = buildSmartAlertRequest({ ...params, tokenAddress: resolved.address, tokenChain: resolved.chain });
  const res = await nansenCall("smart-alert", request, (j) => {
    const r = j as { id?: string; alert_id?: string; data?: { id?: string } };
    return String(r.id ?? r.alert_id ?? r.data?.id ?? "");
  });
  return { id: res.data, request };
}

/** DELETE /api/v1/smart-alert/{alert_id}: no body, path-scoped. nansen.ts's RequestOptions only
 * types method as "GET" | "POST" (every other endpoint it wires up is one of those); the cast
 * below is local to this call and doesn't touch nansen.ts. Runtime is unaffected: rawFetch passes
 * opts.method straight to fetch() and only attaches a body when method === "POST". */
export async function deleteSmartAlert(alertId: string): Promise<void> {
  type Opts = Parameters<typeof nansenCall>[3];
  await nansenCall(`smart-alert/${alertId}`, null, () => undefined, {
    method: "DELETE",
  } as unknown as Opts);
}

// ---------------------------------------------------------------------------
// 4. Pressure: /api/intel/pressure/[coin]
// ---------------------------------------------------------------------------
export type PressureLevel = "low" | "medium" | "high";

export interface Reducer {
  address: string;
  label: string;
  valueUsd: number;
  at: number;
}

export interface PressureIntel {
  coin: string;
  side: Direction;
  holders: number;
  reducedLast1h: number;
  reducedLast6h: number;
  addedLast1h: number;
  pressure: PressureLevel;
  reducers: Reducer[];
  read: string;
}

const REDUCE_ACTIONS = new Set(["Reduce", "Close"]);
const ADD_ACTIONS = new Set(["Open", "Add"]);
const HOUR_MS = 60 * 60_000;

/** Pure: fetchSmartMoneyPerpTrades has no server-side coin filter, so filter client-side on coin
 * (case-insensitive) and position side, then bucket by action and a 1h/6h age window. */
export function summarizeSmartMoneyTrades(
  trades: SmartMoneyPerpTrade[],
  coin: string,
  sideCap: "Long" | "Short",
  nowMs: number,
): { reducedLast1h: number; reducedLast6h: number; addedLast1h: number; reducers: Reducer[] } {
  const matching = trades.filter(
    (t) => t.coin.toUpperCase() === coin.toUpperCase() && t.side === sideCap,
  );
  const reduces = matching.filter((t) => REDUCE_ACTIONS.has(t.action));
  const reducedLast1h = reduces.filter((t) => nowMs - t.at <= HOUR_MS).length;
  const reducedLast6h = reduces.length;
  const addedLast1h = matching.filter(
    (t) => ADD_ACTIONS.has(t.action) && nowMs - t.at <= HOUR_MS,
  ).length;
  const reducers = reduces
    .slice()
    .sort((a, b) => b.at - a.at)
    .map((t): Reducer => ({ address: t.traderAddress, label: t.traderLabel, valueUsd: t.valueUsd, at: t.at }));
  return { reducedLast1h, reducedLast6h, addedLast1h, reducers };
}

/** Pure: high if 1h reduces are >=20% of current holders or >=3 wallets outright; medium if any
 * reduces at all; low otherwise. Guards holders=0 so it never divides by zero. */
export function classifyPressure(reducedLast1h: number, holders: number): PressureLevel {
  if (reducedLast1h >= 3) return "high";
  if (holders > 0 && reducedLast1h / holders >= 0.2) return "high";
  if (reducedLast1h > 0) return "medium";
  return "low";
}

/** Pure: one plain sentence for the read field. */
export function buildPressureRead(
  coin: string,
  side: Direction,
  reducedLast1h: number,
  holders: number,
): string {
  if (reducedLast1h === 0) {
    return `No Smart Money ${coin} ${side}s have reduced in the last hour.`;
  }
  return `${reducedLast1h} of ${holders} Smart Money ${coin} ${side}s reduced in the last hour.`;
}

export async function fetchPressureIntel(coin: string, side: Direction): Promise<PressureIntel> {
  return cached(`pressure:${coin.toLowerCase()}:${side}`, PRESSURE_TTL_MS, async () => {
    const sideCap: "Long" | "Short" = side === "long" ? "Long" : "Short";
    const [holdersRes, tradesRes] = await Promise.all([
      fetchTgmPerpPositions(coin, sideCap, "smart_money", 100),
      fetchSmartMoneyPerpTrades(6, 100),
    ]);
    const holders = holdersRes.data.length;
    const { reducedLast1h, reducedLast6h, addedLast1h, reducers } = summarizeSmartMoneyTrades(
      tradesRes.data,
      coin,
      sideCap,
      Date.now(),
    );
    return {
      coin,
      side,
      holders,
      reducedLast1h,
      reducedLast6h,
      addedLast1h,
      pressure: classifyPressure(reducedLast1h, holders),
      reducers,
      read: buildPressureRead(coin, side, reducedLast1h, holders),
    };
  });
}
