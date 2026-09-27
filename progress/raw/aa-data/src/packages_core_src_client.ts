import { createHash } from "node:crypto";

/** Every Nansen call the engine makes, recorded for the provenance drawer and `--explain`. */
export type Call = {
  endpoint: string;
  body: Record<string, unknown>;
  credits: number;
  ms: number;
  cached: boolean;
  status: number;
  fieldsUsed: string[];
  /** sha256 of the raw response body — verify.ts compares live vs fixture. */
  responseHash: string;
  /** network attempts made (1 = clean; 2 = one timeout/429/5xx was retried) */
  attempts: number;
  /** wall time including any failed attempt, so a hidden timeout is visible in provenance */
  totalMs: number;
  /** false when every attempt failed; `error` says why. Failed calls are recorded at 0 credits. */
  ok: boolean;
  error?: string;
  /** credits Nansen reported in `x-nansen-credits-cost` (undefined on cache hits / failures); `credits` prefers it over the table */
  reportedCredits?: number;
  /** per-client sequence number, assigned when the call STARTS — pairs a `CallStart` with the `Call` that lands for it */
  seq?: number;
};

/** Emitted the moment a call begins, before any bytes move — the web rail shows it as a pending row until the `Call` lands. */
export type CallStart = { seq: number; endpoint: string; body: Record<string, unknown>; startedAt: number };

/** Per-call overrides: a secondary lookup can be given a shorter timeout and no retry so it cannot stall a verdict. */
export type CallOptions = { timeoutMs?: number; retries?: number };

export type ClientOptions = {
  baseUrl?: string;
  /** requests per second, client-side burst cap (Nansen: 300/min) */
  rps?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/** Credit cost per endpoint (docs.nansen.ai credits table, 2026-09-18). Fallback only — the live cost comes from `x-nansen-credits-cost`. Unknown endpoints count as 1. */
export const CREDITS: Record<string, number> = {
  account: 0,
  "search/general": 0,
  "search/entity-name": 0,
  "profiler/address/pnl-summary": 1,
  "profiler/address/pnl": 1,
  "profiler/address/current-balance": 1,
  "profiler/address/transactions": 1,
  "profiler/address/related-wallets": 1,
  "transaction-with-token-transfer-lookup": 1,
  "tgm/who-bought-sold": 1,
  "tgm/flow-intelligence": 1,
  "tgm/token-information": 1,
  "profiler/address/counterparties": 5,
  "smart-money/dex-trades": 5,
  "tgm/holders": 5,
  "tgm/indicators": 5,
  "profiler/address/labels": 100,
  "profiler/address/premium-labels": 500,
};

export class NansenError extends Error {
  constructor(
    public endpoint: string,
    public status: number,
    public bodyText: string,
  ) {
    super(`Nansen ${endpoint} → HTTP ${status}: ${bodyText.slice(0, 200)}`);
  }
}

function withAttempts(e: unknown, attempts: number): unknown {
  if (e && typeof e === "object") (e as { attempts?: number }).attempts = attempts;
  return e;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Minimal token bucket: at most `rps` requests per rolling second. */
class RateLimiter {
  private timestamps: number[] = [];
  constructor(private rps: number) {}
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < 1000);
      if (this.timestamps.length < this.rps) {
        this.timestamps.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 - (now - this.timestamps[0]) + 5));
    }
  }
}

export class NansenClient {
  private baseUrl: string;
  private limiter: RateLimiter;
  protected timeoutMs: number;
  private fetchImpl: typeof fetch;
  /** Every call made through this client, in order. */
  readonly calls: Call[] = [];
  /** Fires the moment a call is recorded (live, cached or failed) — the draw stream emits provenance rows as they land. */
  onCall?: (call: Call) => void;
  /** Fires when a call starts (before the network) — the rail draws a pending row that the matching `Call` (same `seq`) resolves. */
  onStart?: (start: CallStart) => void;
  private seqCounter = 0;
  protected begin(endpoint: string, body: Record<string, unknown>): number {
    const seq = ++this.seqCounter;
    this.onStart?.({ seq, endpoint, body, startedAt: Date.now() });
    return seq;
  }
  protected record(call: Call): void {
    this.calls.push(call);
    this.onCall?.(call);
  }

  constructor(
    private apiKey: string,
    opts: ClientOptions = {},
  ) {
    if (!apiKey || !apiKey.startsWith("nsn_")) {
      throw new Error("NANSEN_API_KEY missing or malformed (expected nsn_…)");
    }
    this.baseUrl = opts.baseUrl ?? "https://api.nansen.ai/api/v1";
    this.limiter = new RateLimiter(opts.rps ?? 5); // Nansen cap is 300/min; a deck build runs hundreds of calls — 5 rps keeps a wide margin
    this.timeoutMs = opts.timeoutMs ?? 8000; // counterparties on a hot wallet can be slow; 8 s + one retry caps a call at ~17 s
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** POST `endpoint` with a JSON body; one retry on 429/5xx/timeout unless `retries: 0`; records the call. */
  async post<T = unknown>(endpoint: string, body: Record<string, unknown>, fieldsUsed: string[] = [], opts: CallOptions = {}): Promise<T> {
    const t0 = Date.now();
    const seq = this.begin(endpoint, body);
    try {
      const { text, ms, status, attempts, totalMs, reportedCredits } = await this.postRaw(endpoint, body, opts);
      this.record({
        endpoint,
        body,
        credits: reportedCredits ?? CREDITS[endpoint] ?? 1,
        ms,
        cached: false,
        status,
        fieldsUsed,
        responseHash: sha256(text),
        attempts,
        totalMs,
        ok: true,
        reportedCredits,
        seq,
      });
      return JSON.parse(text) as T;
    } catch (e) {
      this.recordFailure(endpoint, body, fieldsUsed, e, Date.now() - t0, seq);
      throw e;
    }
  }

  /** A call that failed every attempt still appears in provenance — a hidden 12 s timeout is a recording risk, not a detail. */
  protected recordFailure(endpoint: string, body: Record<string, unknown>, fieldsUsed: string[], e: unknown, totalMs: number, seq?: number) {
    const status = e instanceof NansenError ? e.status : 0;
    const error = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message.slice(0, 120)) : String(e);
    const attempts = (e as { attempts?: number })?.attempts ?? 1;
    this.record({ endpoint, body, credits: 0, ms: 0, cached: false, status, fieldsUsed, responseHash: "", attempts, totalMs, ok: false, error, seq });
  }

  /** The network call itself, returning the raw body so callers (and the cache) hash exactly what Nansen sent. */
  protected async postRaw(
    endpoint: string,
    body: Record<string, unknown>,
    opts: CallOptions = {},
  ): Promise<{ text: string; ms: number; status: number; attempts: number; totalMs: number; reportedCredits?: number }> {
    const url = `${this.baseUrl}/${endpoint}`;
    const t0 = Date.now();
    const maxAttempts = 1 + (opts.retries ?? 1);
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    let lastErr: unknown;
    let attemptsMade = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      attemptsMade = attempt + 1;
      await this.limiter.take();
      const started = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: { apikey: this.apiKey, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        // the key must never be recorded: an upstream error body that echoed it would otherwise land in provenance
        const text = (await res.text()).split(this.apiKey).join("nsn_[redacted]");
        const ms = Date.now() - started;
        const costHeader = res.headers.get("x-nansen-credits-cost");
        const reportedCredits = costHeader !== null && costHeader !== "" && Number.isFinite(Number(costHeader)) ? Number(costHeader) : undefined;
        if (res.status === 429 || res.status >= 500) {
          lastErr = new NansenError(endpoint, res.status, text);
          if (attempt < maxAttempts - 1) {
            await new Promise((r) => setTimeout(r, 750));
            continue;
          }
          throw lastErr;
        }
        if (!res.ok) throw new NansenError(endpoint, res.status, text);
        return { text, ms, status: res.status, attempts: attempt + 1, totalMs: Date.now() - t0, reportedCredits };
      } catch (e) {
        lastErr = e;
        if (attempt === maxAttempts - 1 || !(e instanceof Error && e.name === "AbortError")) throw withAttempts(e, attemptsMade);
      } finally {
        clearTimeout(timer);
      }
    }
    throw withAttempts(lastErr, attemptsMade);
  }

  /** Credits spent through this client so far (from the static cost table; failed calls count 0). */
  get creditsSpent(): number {
    return this.calls.reduce((n, c) => n + c.credits, 0);
  }
}

/** Load the key from the environment; `source ~/.config/nansen/meridian.env` first. */
export function clientFromEnv(opts?: ClientOptions): NansenClient {
  const key = process.env.NANSEN_API_KEY ?? "";
  return new NansenClient(key, opts);
}
