// Hyperliquid public info API. No key required, no credits, no rate-limit budget to protect -
// so this client is plain fetch with no cache layer of its own.

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

export async function fetchAllMids(): Promise<Record<string, number>> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "allMids" }),
  });
  if (!res.ok) throw new Error(`Hyperliquid allMids ${res.status}`);
  const raw = (await res.json()) as Record<string, string | number>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw ?? {})) out[k] = Number(v);
  return out;
}
