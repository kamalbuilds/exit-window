// Server-only typed client for the Nansen API, with a two-layer cache (memory + disk) so
// development and the deployed demo never pay Nansen credits twice for the same request.
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Direction, Fill, LeaderRow, OpenPosition } from "./types";

// ---------------------------------------------------------------------------
// Cache: key = endpoint + canonical JSON body. Memory -> disk -> committed seed -> network.
// ---------------------------------------------------------------------------

type Json = unknown;

interface CacheRecord<T = Json> {
  data: T;
  fetchedAt: number;
  stale?: boolean;
}

export interface CachedResult<T> {
  data: T;
  fetchedAt: number;
  stale: boolean;
}

/** Per-endpoint TTL. Endpoints not listed here are never cached (trading actions, live account
 * reads) - every call goes straight to the network and is never written to disk. */
const TTL_MS: Record<string, number> = {
  "profiler/perp-trades": 30 * 60_000,
  "profiler/perp-pnl-summary": 30 * 60_000,
  "perp-leaderboard": 6 * 60 * 60_000,
  "smart-money/perp-trades": 5 * 60_000,
  "profiler/perp-positions": 30_000,
};

function ttlFor(endpoint: string): number | null {
  return TTL_MS[endpoint] ?? null;
}

function canonicalize(v: Json): Json {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const out: Record<string, Json> = {};
    for (const k of Object.keys(v as Record<string, Json>).sort()) {
      out[k] = canonicalize((v as Record<string, Json>)[k]);
    }
    return out;
  }
  return v;
}

function cacheKey(endpoint: string, body: Json): string {
  return `${endpoint}::${JSON.stringify(canonicalize(body ?? {}))}`;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function cacheDir(): string {
  if (process.env.NANSEN_CACHE_DIR) return process.env.NANSEN_CACHE_DIR;
  if (process.env.VERCEL) return "/tmp/nansen-cache";
  return path.join(process.cwd(), ".cache", "nansen");
}

const SEED_DIR = path.join(process.cwd(), "data", "nansen-seed");

const memCache = new Map<string, CacheRecord>();
const inflight = new Map<string, Promise<CacheRecord>>();

async function readJson(file: string): Promise<CacheRecord | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as CacheRecord;
  } catch {
    return null;
  }
}

async function writeDisk(hash: string, rec: CacheRecord): Promise<void> {
  try {
    const dir = cacheDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${hash}.json`), JSON.stringify(rec));
  } catch {
    // ponytail: best-effort disk cache; the in-memory copy still serves this process if disk fails.
  }
}

// ---------------------------------------------------------------------------
// Ledger: network calls vs cache hits, per endpoint.
// ---------------------------------------------------------------------------

const ledger = {
  network: {} as Record<string, number>,
  cacheHits: {} as Record<string, number>,
};

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function getLedger() {
  const totalNetwork = Object.values(ledger.network).reduce((a, b) => a + b, 0);
  const totalCacheHits = Object.values(ledger.cacheHits).reduce((a, b) => a + b, 0);
  return {
    network: { ...ledger.network },
    cacheHits: { ...ledger.cacheHits },
    totalNetwork,
    totalCacheHits,
  };
}

/** Net new network calls made since `since` (from a prior `getLedger()` snapshot). Used to
 * populate WalletReport.nansenCalls without a global counter leaking across requests. */
export function networkCallsSince(since: number): number {
  return getLedger().totalNetwork - since;
}

export function currentNetworkCallCount(): number {
  return getLedger().totalNetwork;
}

// ---------------------------------------------------------------------------
// Append-only call log: one JSON line per real network call, so a judge can see the Nansen
// API was actually hit and how it behaved. Never the apikey, never a signature.
// ---------------------------------------------------------------------------

function callLogPath(): string {
  if (process.env.VERCEL) return "/tmp/nansen-calls.jsonl";
  return path.join(process.cwd(), "data", "nansen-calls.jsonl");
}

interface CallLogEntry {
  ts: string;
  endpoint: string;
  method: "GET" | "POST";
  requestSummary: Record<string, unknown>;
  status: number;
  latencyMs: number;
  rows: number | null;
  rateLimitRemaining: number | null;
  cache: "miss";
  error?: string;
}

/** Allowlist, not blocklist, so a new field on a trading body (a future signature, a nonce)
 * is excluded by default rather than needing to be remembered to redact. */
function summarizeRequest(body: Json, query?: Record<string, string>): Record<string, unknown> {
  const b = (body ?? {}) as Record<string, unknown>;
  const q = query ?? {};
  const out: Record<string, unknown> = {};
  const address = b.address ?? b.wallet_address ?? q.wallet_address ?? q.address;
  if (typeof address === "string") out.address = address;
  if (typeof b.coin === "string") out.coin = b.coin;
  if (b.date && typeof b.date === "object") out.date = b.date;
  if (typeof b.lookback_hours === "number") out.lookbackHours = b.lookback_hours;
  return out;
}

function rowsOf(json: Json): number | null {
  if (Array.isArray(json)) return json.length;
  const data = (json as { data?: unknown })?.data;
  return Array.isArray(data) ? data.length : null;
}

async function logCall(entry: Omit<CallLogEntry, "ts" | "cache">): Promise<void> {
  try {
    await mkdir(path.dirname(callLogPath()), { recursive: true });
    const line: CallLogEntry = { ts: new Date().toISOString(), cache: "miss", ...entry };
    await appendFile(callLogPath(), `${JSON.stringify(line)}\n`);
  } catch {
    // ponytail: best-effort append-only log; a failure here must never break a real request.
  }
}

// ---------------------------------------------------------------------------
// Raw HTTP: auth header, 429/5xx backoff (max 3 retries).
// ---------------------------------------------------------------------------

export class NansenAuthError extends Error {}

interface RequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string>;
  /** Skip retry/backoff (used for the single-shot execute call). */
  retries?: number;
}

interface RawFetchResult {
  json: Json;
  status: number;
  rateLimitRemaining: number | null;
}

function rateLimitRemainingOf(headers: Headers): number | null {
  const h = headers.get("RateLimit-Remaining") ?? headers.get("X-RateLimit-Remaining");
  const n = h ? Number(h) : NaN;
  return Number.isFinite(n) ? n : null;
}

async function rawFetch(endpoint: string, body: Json, opts: RequestOptions): Promise<RawFetchResult> {
  const key = process.env.NANSEN_API_KEY;
  if (!key) {
    throw new NansenAuthError(
      "NANSEN_API_KEY is not set. Add it to .env (never commit it, never log its value).",
    );
  }
  const method = opts.method ?? "POST";
  let url = `https://api.nansen.ai/api/v1/${endpoint}`;
  if (opts.query) url += `?${new URLSearchParams(opts.query).toString()}`;

  const maxAttempts = opts.retries ?? 3;
  let lastError: Error = new Error(`Nansen ${endpoint} failed`);
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { apikey: key, "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });

    if (res.status === 429 || res.status >= 500) {
      const text = await res.text().catch(() => "");
      lastError = new Error(`Nansen ${endpoint} ${res.status}: ${text}`);
      if (attempt === maxAttempts) throw lastError;
      const resetHeader =
        res.headers.get("Retry-After") ??
        res.headers.get("RateLimit-Reset") ??
        res.headers.get("X-RateLimit-Reset");
      const parsed = resetHeader ? Number(resetHeader) : NaN;
      const waitMs = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed * 1000, 15_000) : 1000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.max(waitMs, 250)));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new NansenAuthError(`Nansen auth failed (${res.status}): ${text}`);
      }
      throw new Error(`Nansen ${endpoint} ${res.status}: ${text}`);
    }

    return { json: await res.json(), status: res.status, rateLimitRemaining: rateLimitRemainingOf(res.headers) };
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Cached call: memory -> disk -> seed -> network, with in-flight dedupe and
// stale-while-error fallback. Trading/live-account endpoints (ttl null) always hit network.
// ---------------------------------------------------------------------------

async function nansenCall<T>(
  endpoint: string,
  body: Json,
  parse: (j: Json) => T,
  opts: RequestOptions = {},
): Promise<CachedResult<T>> {
  const ttl = ttlFor(endpoint);
  const keyBody = opts.method === "GET" ? opts.query ?? {} : body;
  const key = cacheKey(endpoint, keyBody);
  const hash = hashKey(key);

  if (ttl !== null) {
    const mem = memCache.get(key);
    if (mem && Date.now() - mem.fetchedAt < ttl) {
      bump(ledger.cacheHits, endpoint);
      return { data: mem.data as T, fetchedAt: mem.fetchedAt, stale: !!mem.stale };
    }
    const disk = await readJson(path.join(cacheDir(), `${hash}.json`));
    if (disk && Date.now() - disk.fetchedAt < ttl) {
      memCache.set(key, disk);
      bump(ledger.cacheHits, endpoint);
      return { data: disk.data as T, fetchedAt: disk.fetchedAt, stale: !!disk.stale };
    }
    const seed = await readJson(path.join(SEED_DIR, `${hash}.json`));
    if (seed && Date.now() - seed.fetchedAt < ttl) {
      memCache.set(key, seed);
      bump(ledger.cacheHits, endpoint);
      return { data: seed.data as T, fetchedAt: seed.fetchedAt, stale: !!seed.stale };
    }
  }

  let promise = inflight.get(key);
  if (!promise) {
    promise = (async (): Promise<CacheRecord<T>> => {
      const startedAt = Date.now();
      try {
        const raw = await rawFetch(endpoint, body, opts);
        bump(ledger.network, endpoint);
        void logCall({
          endpoint,
          method: opts.method ?? "POST",
          requestSummary: summarizeRequest(body, opts.query),
          status: raw.status,
          latencyMs: Date.now() - startedAt,
          rows: rowsOf(raw.json),
          rateLimitRemaining: raw.rateLimitRemaining,
        });
        const rec: CacheRecord<T> = { data: parse(raw.json), fetchedAt: Date.now(), stale: false };
        if (ttl !== null) {
          memCache.set(key, rec);
          void writeDisk(hash, rec);
        }
        return rec;
      } catch (err) {
        void logCall({
          endpoint,
          method: opts.method ?? "POST",
          requestSummary: summarizeRequest(body, opts.query),
          status: 0,
          latencyMs: Date.now() - startedAt,
          rows: null,
          rateLimitRemaining: null,
          error: err instanceof Error ? err.message : String(err),
        });
        const stale =
          memCache.get(key) ??
          (await readJson(path.join(cacheDir(), `${hash}.json`))) ??
          (await readJson(path.join(SEED_DIR, `${hash}.json`)));
        if (stale) {
          const rec: CacheRecord<T> = { data: stale.data as T, fetchedAt: stale.fetchedAt, stale: true };
          memCache.set(key, rec);
          return rec;
        }
        throw err;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise as Promise<CacheRecord>);
  }
  const rec = (await promise) as CacheRecord<T>;
  return { data: rec.data, fetchedAt: rec.fetchedAt, stale: !!rec.stale };
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function toFill(row: {
  timestamp: string;
  token_symbol: string;
  side: "Long" | "Short";
  action: string;
  price: number;
  size: number;
  start_position: number;
  closed_pnl: number;
  fee_usd: number;
  transaction_hash: string;
}): Fill {
  const isBuy =
    (row.side === "Long" && (row.action === "Open" || row.action === "Add")) ||
    (row.side === "Short" && (row.action === "Reduce" || row.action === "Close"));
  return {
    t: Date.parse(row.timestamp),
    coin: row.token_symbol,
    isBuy,
    px: row.price,
    sz: row.size,
    startPosition: row.start_position,
    closedPnl: row.closed_pnl,
    feeUsd: row.fee_usd,
    hash: row.transaction_hash,
  };
}

interface RawPosition {
  token_symbol?: string;
  size?: string;
  entry_price_usd?: string;
  position_value_usd?: string;
  unrealized_pnl_usd?: string;
  leverage_value?: number;
  liquidation_price_usd?: string;
}

function toOpenPosition(p: RawPosition): OpenPosition {
  const size = Number(p.size ?? 0);
  const direction: Direction = size < 0 ? "short" : "long";
  return {
    coin: p.token_symbol ?? "",
    direction,
    size: Math.abs(size),
    entryPx: Number(p.entry_price_usd ?? 0),
    markPx: null,
    unrealizedPnlUsd: p.unrealized_pnl_usd !== undefined ? Number(p.unrealized_pnl_usd) : null,
    leverage: p.leverage_value ?? null,
  };
}

// ---------------------------------------------------------------------------
// Typed endpoints
// ---------------------------------------------------------------------------

export async function fetchPerpTrades(
  address: string,
  from: string,
  to: string,
  page: number,
  perPage = 100,
): Promise<CachedResult<{ fills: Fill[]; isLastPage: boolean }>> {
  return nansenCall(
    "profiler/perp-trades",
    {
      address,
      date: { from, to },
      pagination: { page, per_page: perPage },
      order_by: [{ field: "timestamp", direction: "ASC" }],
    },
    (j) => {
      const data = (j as { data?: unknown[] }).data ?? [];
      const pagination = (j as { pagination?: { is_last_page?: boolean } }).pagination;
      return {
        fills: (data as Parameters<typeof toFill>[0][]).map(toFill),
        isLastPage: !!pagination?.is_last_page,
      };
    },
  );
}

export async function fetchPerpPositions(address: string): Promise<CachedResult<OpenPosition[]>> {
  return nansenCall("profiler/perp-positions", { address }, (j) => {
    const data = (j as { data?: { asset_positions?: { position?: RawPosition }[] } }).data;
    const raw = data?.asset_positions ?? [];
    return raw.map((ap) => toOpenPosition(ap.position ?? {}));
  });
}

export interface PnlSummary {
  realizedPnlUsd: number;
  winRate: number;
  tradedTimes: number;
  closedTradeCount: number;
  feesUsd: number;
}

export async function fetchPnlSummary(
  address: string,
  from: string,
  to: string,
): Promise<CachedResult<PnlSummary>> {
  return nansenCall("profiler/perp-pnl-summary", { address, date: { from, to } }, (j) => {
    const d = (j as { data?: Record<string, number> }).data ?? {};
    return {
      realizedPnlUsd: d.realized_pnl_usd ?? 0,
      winRate: d.win_rate ?? 0,
      tradedTimes: d.traded_times ?? 0,
      closedTradeCount: d.closed_trade_count ?? 0,
      feesUsd: d.fees_usd ?? 0,
    };
  });
}

export async function fetchLeaderboard(
  fromDate: string,
  toDate: string,
  perPage = 50,
): Promise<CachedResult<LeaderRow[]>> {
  return nansenCall(
    "perp-leaderboard",
    {
      date: { from: fromDate, to: toDate },
      pagination: { page: 1, per_page: perPage },
      order_by: [{ field: "total_pnl", direction: "DESC" }],
    },
    (j) => {
      const data = (j as { data?: Record<string, unknown>[] }).data ?? [];
      return data.map(
        (r): LeaderRow => ({
          address: String(r.trader_address ?? ""),
          label: (r.trader_address_label as string) ?? null,
          totalPnlUsd: Number(r.total_pnl ?? 0),
          realizedPnlUsd: Number(r.realized_pnl_usd ?? 0),
          unrealizedPnlUsd: Number(r.unrealized_pnl_usd ?? 0),
          roi: Number(r.roi ?? 0),
          accountValue: Number(r.account_value ?? 0),
        }),
      );
    },
  );
}

export interface SmartMoneyPerpTrade {
  traderAddress: string;
  traderLabel: string;
  coin: string;
  side: "Long" | "Short";
  action: string;
  size: number;
  priceUsd: number;
  valueUsd: number;
  at: number;
}

export async function fetchSmartMoneyPerpTrades(
  lookbackHours = 24,
  perPage = 50,
): Promise<CachedResult<SmartMoneyPerpTrade[]>> {
  return nansenCall(
    "smart-money/perp-trades",
    {
      lookback_hours: lookbackHours,
      pagination: { page: 1, per_page: perPage },
      order_by: [{ field: "block_timestamp", direction: "DESC" }],
    },
    (j) => {
      const data = (j as { data?: Record<string, unknown>[] }).data ?? [];
      return data.map(
        (r): SmartMoneyPerpTrade => ({
          traderAddress: String(r.trader_address ?? ""),
          traderLabel: String(r.trader_address_label ?? ""),
          coin: String(r.token_symbol ?? ""),
          side: (r.side as "Long" | "Short") ?? "Long",
          action: String(r.action ?? ""),
          size: Number(r.token_amount ?? 0),
          priceUsd: Number(r.price_usd ?? 0),
          valueUsd: Number(r.value_usd ?? 0),
          at: Date.parse(String(r.block_timestamp ?? "")),
        }),
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Trading (prepare -> sign -> execute) and live-account reads: never cached.
// ---------------------------------------------------------------------------

export interface Eip712Payload {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface PreparedAction {
  action: Record<string, unknown>;
  nonce: number;
  vaultAddress: string | null;
  eip712: Eip712Payload;
  size: number | null;
  price: number | null;
}

function toPrepared(j: Json): PreparedAction {
  const r = j as {
    action: Record<string, unknown>;
    nonce: number;
    vault_address?: string | null;
    eip712: Eip712Payload;
    size?: number | null;
    price?: number | null;
  };
  return {
    action: r.action,
    nonce: r.nonce,
    vaultAddress: r.vault_address ?? null,
    eip712: r.eip712,
    size: r.size ?? null,
    price: r.price ?? null,
  };
}

export async function preparePerpClose(
  walletAddress: string,
  coin: string,
  size: number,
  price: number,
  isBuy: boolean,
): Promise<CachedResult<PreparedAction>> {
  return nansenCall(
    "perp/close",
    { wallet_address: walletAddress, coin, size, price, is_buy: isBuy },
    toPrepared,
  );
}

export interface Signature {
  r: string;
  s: string;
  v: number;
}

export async function executePerpAction(
  action: Record<string, unknown>,
  nonce: number,
  signature: Signature,
  vaultAddress: string | null,
): Promise<CachedResult<unknown>> {
  return nansenCall(
    "perp/execute",
    { action, nonce, signature, vault_address: vaultAddress },
    (j) => j,
    { retries: 0 },
  );
}

export interface BuilderFeeStatus {
  approved: boolean;
  maxFeeRate: number;
  requiredFee: number;
  builderAddress: string | null;
}

export async function fetchBuilderFee(walletAddress: string): Promise<CachedResult<BuilderFeeStatus>> {
  return nansenCall(
    "perp/builder-fee",
    null,
    (j) => {
      const r = j as { approved?: boolean; max_fee_rate?: number; required_fee?: number; builder_address?: string };
      return {
        approved: !!r.approved,
        maxFeeRate: r.max_fee_rate ?? 0,
        requiredFee: r.required_fee ?? 0,
        builderAddress: r.builder_address ?? null,
      };
    },
    { method: "GET", query: { wallet_address: walletAddress } },
  );
}

/** The follower's own live positions (trading endpoint, never cached - it is polled). */
export async function fetchFollowerPositions(walletAddress: string): Promise<CachedResult<OpenPosition[]>> {
  return nansenCall(
    "perp/positions",
    null,
    (j) => {
      const data = (j as { data?: { asset_positions?: { position?: RawPosition }[] } }).data;
      const raw = data?.asset_positions ?? [];
      return raw.map((ap) => toOpenPosition(ap.position ?? {}));
    },
    { method: "GET", query: { wallet_address: walletAddress } },
  );
}
