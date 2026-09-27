// Persists each address's fills so report.ts only ever asks Nansen for what it hasn't seen yet:
// [lastSeen, now] going forward (usually 1 page), plus [from, earliestSeen] on the rare call that
// asks further back than anything stored. Gitignored - this is a local/server cache, not seed data.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Fill } from "./types";

export interface FillsRecord {
  earliestSeen: string; // ISO: the oldest `from` this store has ever been asked to cover
  lastSeen: string; // ISO: the newest `to` this store has ever been fetched up to
  fills: Fill[];
}

function storeDir(): string {
  if (process.env.FILLS_STORE_DIR) return process.env.FILLS_STORE_DIR;
  if (process.env.VERCEL) return "/tmp/fills";
  return path.join(process.cwd(), "data", "fills");
}

function fileFor(address: string): string {
  return path.join(storeDir(), `${address.toLowerCase()}.json`);
}

export async function loadFills(address: string): Promise<FillsRecord | null> {
  try {
    return JSON.parse(await readFile(fileFor(address), "utf8")) as FillsRecord;
  } catch {
    return null;
  }
}

export async function saveFills(address: string, record: FillsRecord): Promise<void> {
  const file = fileFor(address);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(record));
}

function fillKey(f: Fill): string {
  return `${f.hash}:${f.oid}`;
}

/** Dedupe by transaction_hash+oid (hash alone repeats a placeholder value on some rows), newest
 * data winning on a collision, sorted oldest-first the way fillsToEpisodes expects. */
export function mergeFills(existing: Fill[], incoming: Fill[]): Fill[] {
  const byKey = new Map<string, Fill>();
  for (const f of existing) byKey.set(fillKey(f), f);
  for (const f of incoming) byKey.set(fillKey(f), f);
  return [...byKey.values()].sort((a, b) => a.t - b.t);
}
