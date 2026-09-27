// Waitlist storage plus the pure validation the API route and tests share. Storage is a small
// JSON-lines file (path resolved by storePath(), same resolution as alarms.ts) - the waitlist is
// small and this route is the only writer.
import { mkdir, appendFile, readFile } from "node:fs/promises";
import path from "node:path";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX_EMAIL_LEN = 254;

export interface WaitlistEntry {
  email: string;
  address: string | null;
  at: string;
  place: number;
}

export interface ValidationError {
  error: string;
}

export function normalizeEmail(raw: unknown): string | ValidationError {
  if (typeof raw !== "string") return { error: "email is required" };
  const email = raw.trim().toLowerCase();
  if (!email) return { error: "email is required" };
  if (email.length > MAX_EMAIL_LEN) return { error: "email is too long" };
  if (!EMAIL_RE.test(email)) return { error: "that does not look like an email address" };
  return email;
}

export function normalizeAddress(raw: unknown): string | null | ValidationError {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return { error: "address must be a Hyperliquid address" };
  const address = raw.trim();
  if (!ADDRESS_RE.test(address)) {
    return { error: "address should be 0x followed by 40 hex characters" };
  }
  return address;
}

// ---------------------------------------------------------------------------
// Storage (impure)
// ---------------------------------------------------------------------------

export function storePath(): string {
  if (process.env.WAITLIST_STORE) return process.env.WAITLIST_STORE;
  if (process.env.VERCEL) return "/tmp/waitlist.jsonl";
  return path.join(process.cwd(), "data", "waitlist.jsonl");
}

async function readEntries(): Promise<WaitlistEntry[]> {
  try {
    const raw = await readFile(storePath(), "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as WaitlistEntry);
  } catch {
    return [];
  }
}

// ponytail: a promise chain serializes writes within this process so two concurrent joins never
// read the same "next place" before either has appended; a second process (e.g. a second
// deployed instance) sharing the same file could still race. Upgrade to a file lock if the app
// ever runs multiple instances against one volume.
let writeQueue: Promise<unknown> = Promise.resolve();

export interface JoinResult {
  place: number;
  alreadyJoined: boolean;
}

export function joinWaitlist(email: string, address: string | null): Promise<JoinResult> {
  const task = writeQueue.then(async () => {
    const entries = await readEntries();
    const existing = entries.find((e) => e.email === email);
    if (existing) return { place: existing.place, alreadyJoined: true };

    const place = entries.length + 1;
    const entry: WaitlistEntry = { email, address, at: new Date().toISOString(), place };
    const file = storePath();
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify(entry) + "\n");
    return { place, alreadyJoined: false };
  });
  // Keep the queue alive even if this task rejects, so a failed join doesn't wedge every join after it.
  writeQueue = task.catch(() => undefined);
  return task;
}

// ---------------------------------------------------------------------------
// Rate limiting (impure, in-memory per process)
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

// ponytail: per-process in-memory map, resets on deploy/restart and doesn't share across
// instances. Upgrade to a shared store (Redis) if the app ever runs multiple instances.
export function checkRateLimit(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

export function resetRateLimit(): void {
  hits.clear();
}

/** Fly's proxy sets fly-client-ip itself; x-forwarded-for's first hop is whatever the client sent,
 * so trusting it first would let anyone dodge the rate limit by rotating that header. */
export function clientIp(headers: Headers): string {
  const flyClientIp = headers.get("fly-client-ip");
  if (flyClientIp) return flyClientIp.trim();
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",").at(-1)!.trim();
  return "unknown";
}
