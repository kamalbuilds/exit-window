import type { NansenEnvelope } from './types';

const BASE = process.env.NANSEN_BASE_URL ?? 'https://api.nansen.ai/api';
const TTL_MS = Number(process.env.POLYGRAPH_CACHE_TTL ?? 120) * 1000;

/**
 * Buildathon entry requirement: log 1,000 API calls.
 * We count every outbound call so the number is verifiable rather than claimed,
 * and expose it at /api/stats. Cache hits are counted separately and are NOT
 * counted as API calls — inflating the number with cached reads would be lying
 * to the judges.
 */
const counters = {
  apiCalls: 0,
  cacheHits: 0,
  errors: 0,
  byEndpoint: new Map<string, number>(),
  startedAt: new Date().toISOString(),
};

interface CacheEntry {
  at: number;
  value: unknown;
}
const cache = new Map<string, CacheEntry>();

export class NansenError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = 'NansenError';
  }
}

function apiKey(): string {
  const k = process.env.NANSEN_API_KEY;
  if (!k) {
    throw new Error(
      'NANSEN_API_KEY is not set. Copy .env.example to .env.local and add your key.',
    );
  }
  return k;
}

function cacheKey(version: string, path: string, body: unknown) {
  return `${version}:${path}:${JSON.stringify(body)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST to a Nansen endpoint.
 *
 * `version` matters: the live API serves stable endpoints under `v1` and the
 * backtesting suite under `v1beta1`. Mixing them up yields a bare 404.
 */
export async function nansen<T>(
  path: string,
  body: Record<string, unknown> = {},
  opts: { version?: 'v1' | 'v1beta1'; retries?: number; ttlMs?: number } = {},
): Promise<T[]> {
  const version = opts.version ?? 'v1';
  const retries = opts.retries ?? 2;
  const ttl = opts.ttlMs ?? TTL_MS;
  const key = cacheKey(version, path, body);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) {
    counters.cacheHits += 1;
    return hit.value as T[];
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      counters.apiCalls += 1;
      counters.byEndpoint.set(path, (counters.byEndpoint.get(path) ?? 0) + 1);

      const res = await fetch(`${BASE}/${version}/${path}`, {
        method: 'POST',
        headers: {
          apikey: apiKey(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        // Nansen data is near-real-time; we do our own caching above.
        cache: 'no-store',
      });

      const text = await res.text();
      let json: NansenEnvelope<T> | null = null;
      try {
        json = JSON.parse(text) as NansenEnvelope<T>;
      } catch {
        /* non-JSON error body */
      }

      if (res.status === 429) {
        // Rate limited — exponential backoff, then retry.
        await sleep(600 * 2 ** attempt);
        continue;
      }

      if (!res.ok) {
        counters.errors += 1;
        throw new NansenError(
          json?.message || text.slice(0, 200) || `HTTP ${res.status}`,
          res.status,
          path,
        );
      }

      const data = json?.data ?? [];
      cache.set(key, { at: Date.now(), value: data });
      return data;
    } catch (err) {
      lastErr = err;
      // A 4xx is a contract problem; retrying will not fix it.
      if (err instanceof NansenError && err.status < 500 && err.status !== 429) {
        throw err;
      }
      if (attempt === retries) break;
      await sleep(400 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Like `nansen`, but resolves to `[]` instead of throwing. */
export async function nansenSafe<T>(
  path: string,
  body: Record<string, unknown> = {},
  opts: Parameters<typeof nansen>[2] & { onError?: (m: string) => void } = {},
): Promise<T[]> {
  try {
    return await nansen<T>(path, body, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    opts.onError?.(`${path}: ${msg}`);
    return [];
  }
}

export function callStats() {
  return {
    ...counters,
    byEndpoint: Object.fromEntries(counters.byEndpoint),
    cacheSize: cache.size,
  };
}

export function resetCache() {
  cache.clear();
}
