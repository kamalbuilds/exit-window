// Smart Money sentinel: watches Nansen-labeled wallets for real-time Hyperliquid reduce/close
// fills, using zero Nansen credits. The watchlist comes entirely from Nansen responses already
// on disk (smart-money/perp-trades, perp-leaderboard, tgm/perp-positions); Hyperliquid's public
// clearinghouseState (free, no key) supplies the live "when did they move" signal that Nansen's
// own feed can no longer provide once its credits run out.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FeedItem } from "@/components/feed";
import type { Direction, PositionChange } from "./types";

// ---------------------------------------------------------------------------
// Watchlist: address + label + when it was last seen labeled, built from stored Nansen JSON.
// ---------------------------------------------------------------------------

export interface WatchlistEntry {
  address: string;
  label: string | null;
  lastSeenAt: number;
}

/** Shape of one cached-response file on disk: {data, fetchedAt, stale}, per src/lib/nansen.ts's
 * CacheRecord. The sentinel never re-derives what endpoint produced a file from its filename
 * (a content hash) - it reads the already-normalized `data` array and recognizes which of the
 * three watchlist-bearing shapes it is by the fields present on its first row. */
export interface CacheFileLike {
  fetchedAt: number;
  data: unknown;
}

const WATCHLIST_CAP = 300;

function rowsFromRecord(rec: CacheFileLike): { address: string; label: string | null; lastSeenAt: number }[] {
  if (!Array.isArray(rec.data) || rec.data.length === 0) return [];
  const rows = rec.data as Record<string, unknown>[];
  const first = rows[0];

  // smart-money/perp-trades (SmartMoneyPerpTrade[]): traderAddress/traderLabel/at, `at` is the
  // real fill time so it's a better lastSeenAt than the cache file's fetchedAt.
  if (typeof first.traderAddress === "string" && typeof first.at === "number") {
    return rows
      .filter((r) => typeof r.traderAddress === "string" && r.traderAddress)
      .map((r) => ({
        address: (r.traderAddress as string).toLowerCase(),
        label: (r.traderLabel as string) || null,
        lastSeenAt: typeof r.at === "number" && r.at > 0 ? r.at : rec.fetchedAt,
      }));
  }

  // tgm/perp-positions (RawCompanion[]): address/positionValueUsd/cohort - only the smart_money
  // cohort qualifies (the same endpoint is also cached for whale/public_figure label_type).
  if (typeof first.positionValueUsd === "number" && typeof first.cohort === "string") {
    return rows
      .filter((r) => r.cohort === "smart_money" && typeof r.address === "string" && r.address)
      .map((r) => ({
        address: (r.address as string).toLowerCase(),
        label: (r.label as string) || null,
        lastSeenAt: rec.fetchedAt,
      }));
  }

  // perp-leaderboard (LeaderRow[]): address/totalPnlUsd, no per-row timestamp.
  if (typeof first.totalPnlUsd === "number") {
    return rows
      .filter((r) => typeof r.address === "string" && r.address)
      .map((r) => ({
        address: (r.address as string).toLowerCase(),
        label: (r.label as string) || null,
        lastSeenAt: rec.fetchedAt,
      }));
  }

  return [];
}

/** Pure: merges every recognized row across every cached-response file, keeping the most recent
 * appearance per address, and caps at `cap` by that recency. Exported un-wrapped from disk I/O
 * so watchlist construction is unit-testable with fabricated records. */
export function buildWatchlist(records: CacheFileLike[], cap = WATCHLIST_CAP): WatchlistEntry[] {
  const byAddress = new Map<string, WatchlistEntry>();
  for (const rec of records) {
    for (const row of rowsFromRecord(rec)) {
      const existing = byAddress.get(row.address);
      if (!existing || row.lastSeenAt > existing.lastSeenAt) {
        byAddress.set(row.address, { address: row.address, label: row.label ?? existing?.label ?? null, lastSeenAt: row.lastSeenAt });
      } else if (!existing.label && row.label) {
        existing.label = row.label;
      }
    }
  }
  return [...byAddress.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, cap);
}

// ---------------------------------------------------------------------------
// Events: one per watched wallet's reduce/close, built from follow.ts's diffPositions output.
// ---------------------------------------------------------------------------

export interface LiveExitEvent {
  ts: number;
  address: string;
  label: string | null;
  coin: string;
  side: "Long" | "Short";
  action: "Reduce" | "Close";
  reducedFraction: number;
  valueUsd: number;
  price: number;
}

const sideOf = (d: Direction): "Long" | "Short" => (d === "long" ? "Long" : "Short");

/** Pure: converts one PositionChange into a LiveExitEvent, or null when it isn't a reduce/close
 * (open/add/flip never fire the sentinel - a flip is a close-and-reopen but diffPositions already
 * reports it as its own kind, not a reduce or close, so it's intentionally excluded here). price
 * is the dex-scoped mark at detection time; null (mark unavailable, e.g. a delisted coin) values
 * the event at 0 rather than dropping it, since the reduce/close itself is still real. */
export function buildEvent(
  change: PositionChange,
  address: string,
  label: string | null,
  price: number | null,
  ts: number = Date.now(),
): LiveExitEvent | null {
  if (change.kind !== "reduce" && change.kind !== "close") return null;
  const mark = price ?? 0;
  const sizeDelta = Math.abs(change.fromSize - change.toSize);
  return {
    ts,
    address,
    label,
    coin: change.coin,
    side: sideOf(change.direction),
    action: change.kind === "close" ? "Close" : "Reduce",
    reducedFraction: change.reducedFraction,
    valueUsd: sizeDelta * mark,
    price: mark,
  };
}

const MAX_EVENTS = 2000;

/** Pure: keeps only the newest `max` events, oldest-first order preserved. */
export function trimEvents(events: LiveExitEvent[], max = MAX_EVENTS): LiveExitEvent[] {
  return events.length > max ? events.slice(events.length - max) : events;
}

export function eventToFeedItem(e: LiveExitEvent): FeedItem {
  return {
    timestamp: e.ts,
    trader_address: e.address,
    trader_address_label: e.label,
    token_symbol: e.coin,
    side: e.side,
    action: e.action,
    price: e.price,
    value_usd: e.valueUsd,
  };
}

/** Pure: merges the stored-Nansen feed with sentinel-detected events into one newest-first,
 * deduped FeedItem list. Dedupe key rounds to the minute rather than the exact millisecond -
 * the sentinel's detection time and Nansen's own block_timestamp for the same real-world fill
 * rarely land on the same millisecond. ponytail: minute-bucket heuristic; upgrade to a shared
 * fill id if Nansen's smart-money/perp-trades ever exposes one. */
export function mergeFeed(nansenFeed: FeedItem[], liveEvents: LiveExitEvent[]): FeedItem[] {
  const toMsLocal = (t: number | string) => (typeof t === "string" ? Date.parse(t) : t < 1_000_000_000_000 ? t * 1000 : t);
  const merged = [...nansenFeed, ...liveEvents.map(eventToFeedItem)].sort((a, b) => toMsLocal(b.timestamp) - toMsLocal(a.timestamp));
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const f of merged) {
    const key = `${f.trader_address.toLowerCase()}|${f.token_symbol}|${f.action}|${Math.round(f.value_usd)}|${Math.floor(toMsLocal(f.timestamp) / 60_000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Disk I/O: the sentinel's own event log, data/live-exits.jsonl (last MAX_EVENTS events).
// ---------------------------------------------------------------------------

export const EVENTS_PATH = path.join(process.cwd(), "data", "live-exits.jsonl");

export async function readEvents(): Promise<LiveExitEvent[]> {
  let raw: string;
  try {
    raw = await readFile(EVENTS_PATH, "utf8");
  } catch {
    return [];
  }
  const out: LiveExitEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as LiveExitEvent);
    } catch {
      // ponytail: skip a truncated last line (a crash mid-write) rather than fail the whole read.
    }
  }
  return out;
}

/** Appends `events`, then rewrites the file trimmed to the last MAX_EVENTS - cheap since the
 * file never grows past that cap. */
export async function appendEvents(events: LiveExitEvent[]): Promise<LiveExitEvent[]> {
  if (events.length === 0) return readEvents();
  await mkdir(path.dirname(EVENTS_PATH), { recursive: true });
  const combined = trimEvents([...(await readEvents()), ...events]);
  await writeFile(EVENTS_PATH, `${combined.map((e) => JSON.stringify(e)).join("\n")}\n`);
  return combined;
}

// ---------------------------------------------------------------------------
// Watchlist source: reads the two on-disk stores of cached Nansen responses.
// ---------------------------------------------------------------------------

const SOURCE_DIRS = [
  path.join(process.cwd(), "data", "nansen-seed"),
  path.join(process.cwd(), ".cache", "nansen"),
];

async function readSourceDir(dir: string): Promise<CacheFileLike[]> {
  let names: string[];
  try {
    const { readdir } = await import("node:fs/promises");
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: CacheFileLike[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(await readFile(path.join(dir, name), "utf8")) as { fetchedAt?: number; data?: unknown };
      if (typeof raw.fetchedAt === "number") out.push({ fetchedAt: raw.fetchedAt, data: raw.data });
    } catch {
      // ponytail: skip a corrupt or partially-written cache file rather than fail the whole scan.
    }
  }
  return out;
}

/** I/O wrapper around buildWatchlist: reads every cached-response file in the seed and disk
 * cache directories and rebuilds the capped watchlist from them. No Nansen network call. */
export async function loadWatchlistFromDisk(): Promise<WatchlistEntry[]> {
  const records = (await Promise.all(SOURCE_DIRS.map(readSourceDir))).flat();
  return buildWatchlist(records);
}
