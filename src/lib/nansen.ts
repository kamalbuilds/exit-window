// Server-only typed client for the Nansen API, with a two-layer cache (memory + disk) so
// development and the deployed demo never pay Nansen credits twice for the same request.
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Companion, Direction, Fill, LeaderRow, OpenPosition } from "./types";

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
  "tgm/perp-positions": 30 * 60_000,
  "profiler/address/labels": 24 * 60 * 60_000,
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

// A fixed path (even under /tmp) would let one `vitest run` invocation's leftover disk-cache
// entries silently serve a later, unrelated invocation - proven by running the suite twice in
// a row and watching a "network miss" assertion go stale. One random directory per process
// keeps every test run (and every vitest worker) isolated from every other.
const testCacheDir = process.env.VITEST ? path.join("/tmp", `nansen-cache-test-${randomUUID()}`) : null;

function cacheDir(): string {
  if (process.env.NANSEN_CACHE_DIR) return process.env.NANSEN_CACHE_DIR;
  // Without this, a test run writes real disk-cache entries into the same .cache/nansen a
  // dev server reads from, and a later test run can then silently serve a stale hit instead
  // of exercising the network path it meant to test.
  if (testCacheDir) return testCacheDir;
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

// Same hazard as testCacheDir above, same fix: a fixed VITEST path would let one test's logged
// calls leak into another test's (or another `vitest run` invocation's) any-age log scan.
const testLogPath = process.env.VITEST ? path.join("/tmp", `nansen-calls-test-${randomUUID()}.jsonl`) : null;

function callLogPath(): string {
  if (testLogPath) return testLogPath;
  if (process.env.VERCEL) return "/tmp/nansen-calls.jsonl";
  return path.join(process.cwd(), "data", "nansen-calls.jsonl");
}

export interface CallLogEntry {
  ts: string;
  endpoint: string;
  cache: "hit" | "miss";
  requestSummary: Record<string, unknown>;
  method?: "GET" | "POST";
  source?: "memory" | "disk" | "seed";
  status?: number;
  latencyMs?: number;
  rows?: number | null;
  rateLimitRemaining?: number | null;
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
  if (typeof b.token_symbol === "string") out.tokenSymbol = b.token_symbol;
  if (typeof b.label_type === "string") out.labelType = b.label_type;
  const filters = b.filters;
  if (filters && typeof filters === "object") {
    const side = (filters as Record<string, unknown>).side;
    if (typeof side === "string") out.side = side;
  }
  if (b.date && typeof b.date === "object") out.date = b.date;
  if (typeof b.lookback_hours === "number") out.lookbackHours = b.lookback_hours;
  const pagination = b.pagination;
  if (pagination && typeof pagination === "object") {
    const page = (pagination as Record<string, unknown>).page;
    if (typeof page === "number") out.page = page;
  }
  if (typeof q.page === "string" && q.page.trim() !== "") out.page = Number(q.page);
  return out;
}

function rowsOf(json: Json): number | null {
  if (Array.isArray(json)) return json.length;
  const data = (json as { data?: unknown })?.data;
  return Array.isArray(data) ? data.length : null;
}

export async function logCall(entry: Omit<CallLogEntry, "ts">): Promise<void> {
  try {
    await mkdir(path.dirname(callLogPath()), { recursive: true });
    const line: CallLogEntry = { ts: new Date().toISOString(), ...entry };
    await appendFile(callLogPath(), `${JSON.stringify(line)}\n`);
  } catch {
    // ponytail: best-effort append-only log; a failure here must never break a real request.
  }
}

// ---------------------------------------------------------------------------
// Read-side: merges the committed log with the Vercel /tmp log (writes on Vercel go to /tmp
// since the deployment filesystem is read-only outside it; judges still need to see both).
// ---------------------------------------------------------------------------

async function readLogFile(file: string): Promise<CallLogEntry[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const out: CallLogEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as CallLogEntry);
    } catch {
      // ponytail: skip a truncated last line rather than fail the whole read.
    }
  }
  return out;
}

const COMMITTED_LOG_PATH = path.join(process.cwd(), "data", "nansen-calls.jsonl");

/** All logged calls, newest last. On Vercel this is the committed log (whatever was checked in
 * up to the last deploy) plus /tmp/nansen-calls.jsonl (what this running instance has hit since);
 * elsewhere it is just the one file callLogPath() already points at. */
export async function readCallLog(): Promise<CallLogEntry[]> {
  const files = process.env.VERCEL ? [COMMITTED_LOG_PATH, callLogPath()] : [callLogPath()];
  const unique = [...new Set(files)];
  const all = (await Promise.all(unique.map(readLogFile))).flat();
  all.sort((a, b) => a.ts.localeCompare(b.ts));
  return all;
}

// ---------------------------------------------------------------------------
// Raw HTTP: auth header, 60s per-attempt timeout, retry on status 0 (network/timeout), 429 or
// 5xx up to 2x with backoff, plus a global cap on how many calls are ever in flight together.
// ---------------------------------------------------------------------------

export class NansenAuthError extends Error {}

/** The Nansen account is out of credits (403 insufficient_credits). Never retried - retrying an
 * exhausted key only burns more failed calls. Trips a process-wide latch so a burst of parallel
 * requests stops hitting the network at all for a few minutes, and callers are told to fall back
 * to cache rather than see a raw 403. */
export class NansenCreditsError extends Error {
  constructor(endpoint: string, detail: string) {
    super(`Nansen ${endpoint} credits exhausted: ${detail}`);
    this.name = "NansenCreditsError";
  }
}

const CREDITS_LATCH_MS = 5 * 60_000;
let creditsExhaustedUntil = 0;

/** All retries exhausted against a transient condition (network timeout, persistent 429/5xx).
 * The caller never sees a bare thrown Error or a silently empty/null result for this case -
 * route handlers match on this type and answer 503 rather than 502 or a fabricated empty report. */
export class NansenTimeoutError extends Error {
  retryAfterSec: number;
  constructor(endpoint: string, detail: string, retryAfterSec = 5) {
    super(`Nansen ${endpoint} timed out after retries: ${detail}`);
    this.name = "NansenTimeoutError";
    this.retryAfterSec = retryAfterSec;
  }
}

// ---------------------------------------------------------------------------
// Per-key failure backoff + global circuit breaker. Root cause of the credit-burn bug this
// guards against: once a cached key's TTL expired and a refresh failed, every later request for
// that same key hit the network again - a chart polling every 15s, or an overlap fan-out across
// many (coin, side, labelType) keys, turned one failure into hundreds of retries per minute.
// The existing NansenCreditsError latch only trips on a 403 whose body is exactly
// {code: "insufficient_credits"}; a 403/timeout/5xx that doesn't match that shape (confirmed in
// data/nansen-calls.jsonl: 140 "Nansen auth failed (403)" entries) skipped the latch entirely
// and kept hammering the network. Backoff/breaker below close that gap for every failure kind,
// not just the one Nansen happens to label insufficient_credits.
// ---------------------------------------------------------------------------

const KEY_BACKOFF_STALE_MS = 10 * 60_000; // point 1: stale served -> don't touch this key for 10min
const KEY_BACKOFF_MIN_MS = 60_000; // point 1: no stale -> 60s, doubling
const KEY_BACKOFF_MAX_MS = 10 * 60_000; // point 1: capped at 10min

interface KeyBackoff {
  nextAttemptAt: number;
  backoffMs: number;
}
const keyBackoff = new Map<string, KeyBackoff>();

const BREAKER_FAILURE_THRESHOLD = 5; // point 2
const BREAKER_OPEN_MS = 3 * 60_000; // point 2
let consecutiveNetworkFailures = 0;
let breakerOpenUntil = 0;

/** True while the breaker is open. Lazily logs the single "closed" line the first time this is
 * called after the open window has elapsed - no per-request logging, no timer required. */
function isBreakerOpen(): boolean {
  if (Date.now() < breakerOpenUntil) return true;
  if (breakerOpenUntil !== 0) {
    console.log("[nansen] circuit breaker closed, resuming network calls");
    breakerOpenUntil = 0;
  }
  return false;
}

/** Called once per real network attempt that failed (never for a credits-latch short-circuit,
 * which never touched the network and already has its own 5min global latch above). */
function recordNetworkFailure(key: string, hadStale: boolean): void {
  consecutiveNetworkFailures++;
  if (consecutiveNetworkFailures >= BREAKER_FAILURE_THRESHOLD && breakerOpenUntil <= Date.now()) {
    breakerOpenUntil = Date.now() + BREAKER_OPEN_MS;
    console.log(
      `[nansen] circuit breaker OPEN for ${BREAKER_OPEN_MS / 60_000}min after ${consecutiveNetworkFailures} consecutive network failures`,
    );
  }
  const prev = keyBackoff.get(key);
  const backoffMs = hadStale
    ? KEY_BACKOFF_STALE_MS
    : Math.min(prev ? prev.backoffMs * 2 : KEY_BACKOFF_MIN_MS, KEY_BACKOFF_MAX_MS);
  keyBackoff.set(key, { nextAttemptAt: Date.now() + backoffMs, backoffMs });
}

/** Called once per real network attempt that succeeded: clears this key's backoff and resets
 * the breaker's consecutive-failure count (a healthy call on any endpoint proves the network is
 * up, which is exactly what should let previously-backed-off keys get a fresh attempt sooner -
 * point 2 only opens on CONSECUTIVE failures). */
function recordNetworkSuccess(key: string): void {
  consecutiveNetworkFailures = 0;
  keyBackoff.delete(key);
}

/** Test-only: clears breaker/backoff state so one test file's failures never leak into another
 * test's assertions about a fresh key or a fresh breaker. */
export function __resetBackoffStateForTests(): void {
  keyBackoff.clear();
  consecutiveNetworkFailures = 0;
  breakerOpenUntil = 0;
}

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

const PER_CALL_TIMEOUT_MS = 60_000;

/** Global cap on Nansen calls actually in flight at once, independent of per-endpoint retry
 * counts: a burst of parallel wallet reports on /me must not open dozens of sockets at once,
 * which is what turned late, honest 429s into hung sockets that failed as status 0. */
const MAX_INFLIGHT = 3;
let activeCalls = 0;
const waitQueue: (() => void)[] = [];

async function acquireSlot(): Promise<() => void> {
  if (activeCalls >= MAX_INFLIGHT) {
    await new Promise<void>((resolve) => waitQueue.push(resolve));
  }
  activeCalls++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeCalls--;
    const next = waitQueue.shift();
    if (next) next();
  };
}

async function rawFetch(endpoint: string, body: Json, opts: RequestOptions): Promise<RawFetchResult> {
  const key = process.env.NANSEN_API_KEY;
  if (!key) {
    throw new NansenAuthError(
      "NANSEN_API_KEY is not set. Add it to .env (never commit it, never log its value).",
    );
  }
  if (Date.now() < creditsExhaustedUntil) {
    throw new NansenCreditsError(endpoint, "credits exhausted, latched until retry window elapses");
  }

  const method = opts.method ?? "POST";
  let url = `https://api.nansen.ai/api/v1/${endpoint}`;
  if (opts.query) url += `?${new URLSearchParams(opts.query).toString()}`;

  const maxAttempts = opts.retries ?? 1;
  let lastError: Error = new Error(`Nansen ${endpoint} failed`);
  let lastRetryAfterSec = 5;

  const release = await acquireSlot();
  try {
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: { apikey: key, "Content-Type": "application/json" },
          body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        lastError = aborted
          ? new Error(`timeout after ${PER_CALL_TIMEOUT_MS}ms`)
          : new Error(`network error: ${err instanceof Error ? err.message : String(err)}`);
        if (attempt === maxAttempts) throw new NansenTimeoutError(endpoint, lastError.message, lastRetryAfterSec);
        await new Promise((r) => setTimeout(r, Math.max(1000 * 2 ** attempt, 250)));
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 429 || res.status >= 500) {
        const text = await res.text().catch(() => "");
        lastError = new Error(`${res.status}: ${text}`);
        const resetHeader =
          res.headers.get("Retry-After") ??
          res.headers.get("RateLimit-Reset") ??
          res.headers.get("X-RateLimit-Reset");
        const parsed = resetHeader ? Number(resetHeader) : NaN;
        lastRetryAfterSec = Number.isFinite(parsed) && parsed > 0 ? parsed : lastRetryAfterSec;
        if (attempt === maxAttempts) throw new NansenTimeoutError(endpoint, lastError.message, lastRetryAfterSec);
        const waitMs = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed * 1000, 15_000) : 1000 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, Math.max(waitMs, 250)));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 403) {
          const code = (() => {
            try {
              return (JSON.parse(text) as { code?: string }).code;
            } catch {
              return undefined;
            }
          })();
          if (code === "insufficient_credits") {
            creditsExhaustedUntil = Date.now() + CREDITS_LATCH_MS;
            throw new NansenCreditsError(endpoint, text);
          }
        }
        if (res.status === 401 || res.status === 403) {
          throw new NansenAuthError(`Nansen auth failed (${res.status}): ${text}`);
        }
        throw new Error(`Nansen ${endpoint} ${res.status}: ${text}`);
      }

      return { json: await res.json(), status: res.status, rateLimitRemaining: rateLimitRemainingOf(res.headers) };
    }
    throw lastError;
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Cached call: memory -> disk -> seed -> network, with in-flight dedupe and
// stale-while-error fallback. Trading/live-account endpoints (ttl null) always hit network.
// ---------------------------------------------------------------------------

export async function nansenCall<T>(
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
      void logCall({ endpoint, requestSummary: summarizeRequest(body, opts.query), cache: "hit", source: "memory" });
      return { data: mem.data as T, fetchedAt: mem.fetchedAt, stale: !!mem.stale };
    }
    const disk = await readJson(path.join(cacheDir(), `${hash}.json`));
    if (disk && Date.now() - disk.fetchedAt < ttl) {
      memCache.set(key, disk);
      bump(ledger.cacheHits, endpoint);
      void logCall({ endpoint, requestSummary: summarizeRequest(body, opts.query), cache: "hit", source: "disk" });
      return { data: disk.data as T, fetchedAt: disk.fetchedAt, stale: !!disk.stale };
    }
    const seed = await readJson(path.join(SEED_DIR, `${hash}.json`));
    if (seed && Date.now() - seed.fetchedAt < ttl) {
      memCache.set(key, seed);
      bump(ledger.cacheHits, endpoint);
      void logCall({ endpoint, requestSummary: summarizeRequest(body, opts.query), cache: "hit", source: "seed" });
      return { data: seed.data as T, fetchedAt: seed.fetchedAt, stale: !!seed.stale };
    }
  }

  // Points 1+2+4: before attempting the network, honor this key's own backoff and the global
  // breaker. Neither writes a call-log line (point 4: a blocked attempt is not a real attempt) -
  // serve stale if this key has any, otherwise fail fast with the same typed error a real
  // timeout would raise, so every existing caller (route handlers matching on NansenTimeoutError)
  // keeps working unchanged.
  const now = Date.now();
  const backoff = keyBackoff.get(key);
  const breakerOpen = isBreakerOpen();
  const keyBackedOff = !!backoff && now < backoff.nextAttemptAt;
  if (breakerOpen || keyBackedOff) {
    const stale =
      ttl !== null
        ? (memCache.get(key) ??
          (await readJson(path.join(cacheDir(), `${hash}.json`))) ??
          (await readJson(path.join(SEED_DIR, `${hash}.json`))))
        : undefined;
    if (stale) {
      const rec: CacheRecord<T> = { data: stale.data as T, fetchedAt: stale.fetchedAt, stale: true };
      memCache.set(key, rec);
      return { data: rec.data, fetchedAt: rec.fetchedAt, stale: true };
    }
    const nextAttemptAt = breakerOpen ? breakerOpenUntil : (backoff as KeyBackoff).nextAttemptAt;
    const retryAfterSec = Math.max(1, Math.ceil((nextAttemptAt - now) / 1000));
    throw new NansenTimeoutError(
      endpoint,
      breakerOpen ? "circuit breaker open, no stale cache available" : "per-key backoff active, no stale cache available",
      retryAfterSec,
    );
  }

  let promise = inflight.get(key);
  if (!promise) {
    promise = (async (): Promise<CacheRecord<T>> => {
      const startedAt = Date.now();
      try {
        const raw = await rawFetch(endpoint, body, opts);
        bump(ledger.network, endpoint);
        recordNetworkSuccess(key);
        void logCall({
          endpoint,
          cache: "miss",
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
          cache: "miss",
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
        // Point 1: a credits-latch short-circuit never touched the network (its own 5min global
        // latch already prevents the next call from doing so either) - only a real failed network
        // attempt counts toward this key's backoff or the breaker's consecutive-failure count.
        if (!(err instanceof NansenCreditsError)) {
          recordNetworkFailure(key, !!stale);
        }
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

/** Second-level fallback for when nansenCall's own exact-key stale cache also has nothing (the
 * request's date range never matched a prior call): scans the append-only call log for the
 * newest successful call on `endpoint` whose logged fields satisfy `matches`, reconstructs that
 * call's exact cache key from what the log captured, and reads whatever's still on disk or in
 * the seed for it - ignoring TTL entirely. Real, possibly-old data beats a 503. Returns null when
 * no logged call matches, or the log didn't capture enough fields to rebuild the body (a request
 * shape summarizeRequest started allowlisting after that call was made). Callers opt into this
 * explicitly; nansenCall itself never does this scan, so unrelated endpoints are unaffected. */
export async function findAnyAgeCache<T>(
  endpoint: string,
  matches: (summary: Record<string, unknown>) => boolean,
  rebuildBody: (summary: Record<string, unknown>) => Json | null,
): Promise<CachedResult<T> | null> {
  const log = await readCallLog();
  const candidates = log
    .filter((e) => e.endpoint === endpoint && e.cache === "miss" && !e.error && matches(e.requestSummary))
    .sort((a, b) => b.ts.localeCompare(a.ts)); // newest first
  for (const entry of candidates) {
    const body = rebuildBody(entry.requestSummary);
    if (body === null) continue;
    const hash = hashKey(cacheKey(endpoint, body));
    const rec =
      (await readJson(path.join(cacheDir(), `${hash}.json`))) ?? (await readJson(path.join(SEED_DIR, `${hash}.json`)));
    if (rec) return { data: rec.data as T, fetchedAt: rec.fetchedAt, stale: true };
  }
  return null;
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
  oid: number;
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
    oid: row.oid,
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

/** Labeled wallets currently holding `coin` on `side`, for the overlap feature: "who else is in
 * this trade." labelType picks the cohort (smart_money first; overlap.ts tops up with whale when
 * fewer than 3 same-side smart_money holders survive excluding the user). Point-in-time snapshot,
 * no date range - cached 10 min per (coin, side, labelType) since the cache key is the full
 * canonicalized request body. */
/** Companion row before displayLabel is resolved (overlap.ts's job: a leaderboard label is
 * sometimes a referral-code label, worth a real address/labels lookup before it's shown). */
export type RawCompanion = Omit<Companion, "displayLabel">;

export async function fetchTgmPerpPositions(
  coin: string,
  side: "Long" | "Short",
  labelType: "smart_money" | "whale" | "public_figure" = "smart_money",
  perPage = 10,
): Promise<CachedResult<RawCompanion[]>> {
  return nansenCall(
    "tgm/perp-positions",
    {
      token_symbol: coin,
      label_type: labelType,
      pagination: { page: 1, per_page: perPage },
      filters: { side },
      order_by: [{ field: "position_value_usd", direction: "DESC" }],
    },
    (j) => {
      const data = (j as { data?: Record<string, unknown>[] }).data ?? [];
      return data.map(
        (r): RawCompanion => ({
          address: String(r.address ?? ""),
          label: (r.address_label as string) || null,
          positionValueUsd: Number(r.position_value_usd ?? 0),
          size: Math.abs(Number(r.position_size ?? 0)),
          entryPx: Number(r.entry_price ?? 0),
          upnlUsd: r.upnl_usd !== undefined ? Number(r.upnl_usd) : null,
          leverage: r.leverage !== undefined ? Number(r.leverage) : null,
          cohort: labelType,
        }),
      );
    },
    { retries: 0 }, // biggest spender in the overlap fan-out; a failed call skips, it never retries
  );
}

export interface AddressLabel {
  label: string;
  category: string | null;
  kind: string[];
}

/** All Nansen labels known for one address, for resolving a real displayLabel when the
 * leaderboard label is junk (a referral code, "High Balance"). Cached 24h per address. */
export async function fetchAddressLabels(address: string, chain = "hyperliquid"): Promise<CachedResult<AddressLabel[]>> {
  return nansenCall("profiler/address/labels", { address, chain, pagination: { page: 1, per_page: 100 } }, (j) => {
    const data = (j as { data?: Record<string, unknown>[] }).data ?? [];
    return data.map(
      (r): AddressLabel => ({
        label: String(r.label ?? ""),
        category: (r.category as string) ?? null,
        kind: Array.isArray(r.kind) ? (r.kind as string[]) : [],
      }),
    );
  });
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
