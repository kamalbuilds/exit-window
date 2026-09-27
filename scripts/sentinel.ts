// Smart Money sentinel: polls Hyperliquid's free public clearinghouseState for the Nansen-labeled
// watchlist every 60s, diffs against the previous snapshot, and appends every reduce/close to
// data/live-exits.jsonl. Zero Nansen calls in this loop - the watchlist itself comes from Nansen
// responses already cached on disk (src/lib/sentinel.ts's loadWatchlistFromDisk), refreshed every
// 30 minutes. Run forever with `npx tsx scripts/sentinel.ts`, or exit after N sweeps with
// `--sweeps N` (used for a bounded local test run).
import { diffPositions } from "@/lib/follow";
import { dexPrefix, fetchClearinghouseState, fetchMidsForDex } from "@/lib/hyperliquid";
import { appendEvents, buildEvent, loadWatchlistFromDisk, writeSnapshot, type LiveExitEvent, type WatchlistEntry } from "@/lib/sentinel";
import type { OpenPosition } from "@/lib/types";

const SWEEP_MS = 60_000;
const CONCURRENCY = 8;
const WATCHLIST_REFRESH_MS = 30 * 60_000;
const MAX_429_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Small jitter before every request (spreads a concurrency-8 batch across the second instead of
 * firing all 8 at once), plus exponential backoff and retry specifically on a 429 - other errors
 * (a timed-out or delisted-account read) just skip this address for the sweep and log. */
async function fetchPositionsWithBackoff(address: string, attempt = 0): Promise<OpenPosition[] | null> {
  await sleep(Math.random() * 250);
  try {
    return await fetchClearinghouseState(address);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("429") && attempt < MAX_429_RETRIES) {
      await sleep(1000 * 2 ** attempt + Math.random() * 300);
      return fetchPositionsWithBackoff(address, attempt + 1);
    }
    console.error(`sentinel: clearinghouseState failed for ${address}: ${msg}`);
    return null;
  }
}

const snapshots = new Map<string, OpenPosition[]>();
let sweepCount = 0;

async function sweep(watchlist: WatchlistEntry[]): Promise<void> {
  const startedAt = Date.now();
  const midsByDex = new Map<string, Record<string, number>>();
  async function markPriceFor(coin: string): Promise<number | null> {
    const dex = dexPrefix(coin);
    let mids = midsByDex.get(dex);
    if (!mids) {
      mids = await fetchMidsForDex(dex).catch(() => ({}) as Record<string, number>);
      midsByDex.set(dex, mids);
    }
    return mids[coin] ?? null;
  }

  let polled = 0;
  let errors = 0;
  const newEvents: LiveExitEvent[] = [];

  for (let i = 0; i < watchlist.length; i += CONCURRENCY) {
    const batch = watchlist.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (entry) => {
        const next = await fetchPositionsWithBackoff(entry.address);
        polled++;
        if (next === null) {
          errors++;
          return;
        }
        const prev = snapshots.get(entry.address) ?? [];
        snapshots.set(entry.address, next);
        const changes = diffPositions(prev, next, Date.now());
        for (const change of changes) {
          if (change.kind !== "reduce" && change.kind !== "close") continue;
          const price = await markPriceFor(change.coin);
          const event = buildEvent(change, entry.address, entry.label, price);
          if (event) newEvents.push(event);
        }
      }),
    );
  }

  if (newEvents.length > 0) await appendEvents(newEvents);
  await writeSnapshot({
    at: Date.now(),
    wallets: watchlist.flatMap((w) => {
      const positions = snapshots.get(w.address);
      return positions ? [{ address: w.address, label: w.label, positions }] : [];
    }),
  }).catch((err) => console.error(`sentinel: snapshot write failed: ${err instanceof Error ? err.message : err}`));

  sweepCount++;
  console.log(
    `sentinel: sweep #${sweepCount} watchlist=${watchlist.length} polled=${polled} errors=${errors} events=${newEvents.length} durationMs=${Date.now() - startedAt}`,
  );
  if (newEvents.length > 0) {
    for (const e of newEvents) {
      console.log(`  exit: ${e.address} ${e.label ?? "unlabeled"} ${e.coin} ${e.side} ${e.action} value=$${e.valueUsd.toFixed(2)}`);
    }
  }
}

function parseSweepsArg(): number | null {
  const idx = process.argv.indexOf("--sweeps");
  if (idx === -1) return null;
  const n = Number(process.argv[idx + 1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main(): Promise<void> {
  const maxSweeps = parseSweepsArg();
  let watchlist = await loadWatchlistFromDisk();
  let lastRefresh = Date.now();
  console.log(`sentinel: starting, watchlist=${watchlist.length}${maxSweeps ? ` (exiting after ${maxSweeps} sweeps)` : ""}`);

  for (;;) {
    if (Date.now() - lastRefresh > WATCHLIST_REFRESH_MS) {
      watchlist = await loadWatchlistFromDisk();
      lastRefresh = Date.now();
      console.log(`sentinel: watchlist refreshed, size=${watchlist.length}`);
    }
    await sweep(watchlist).catch((err) => console.error("sentinel: sweep failed:", err instanceof Error ? err.message : err));
    if (maxSweeps !== null && sweepCount >= maxSweeps) break;
    await sleep(SWEEP_MS);
  }
}

main().catch((err) => {
  console.error("sentinel: fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
