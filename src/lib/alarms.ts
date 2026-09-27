// Telegram alarm storage plus the pure diff/trigger/message logic the worker and the API route
// share. Storage is a small JSON file (path resolved by storePath()) rather than a database -
// alarm count is small and scripts/alarm-worker.mjs is the only writer at any given tick.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Direction, OpenPosition, PositionChange } from "./types";

export interface Watch {
  leader: string;
  label: string | null;
  coin: string;
  direction: Direction;
}

export interface AlarmRecord {
  code: string;
  owner: string;
  watches: Watch[];
  chatId: number | null;
  mirror: boolean;
  createdAt: number;
}

export type AlarmStore = Record<string, AlarmRecord>;

// ---------------------------------------------------------------------------
// Storage (impure)
// ---------------------------------------------------------------------------

export function storePath(): string {
  if (process.env.TELEGRAM_STORE) return process.env.TELEGRAM_STORE;
  if (process.env.VERCEL) return "/tmp/alarms.json";
  return path.join(process.cwd(), "data", "alarms.json");
}

export async function loadStore(): Promise<AlarmStore> {
  try {
    return JSON.parse(await readFile(storePath(), "utf8")) as AlarmStore;
  } catch {
    return {};
  }
}

export async function saveStore(store: AlarmStore): Promise<void> {
  const file = storePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(store, null, 2));
}

// ---------------------------------------------------------------------------
// Pure: code generation, binding, diff/trigger, message formatting.
// ---------------------------------------------------------------------------

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I: easier to type back correctly

export function randomCode(len = 12): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return out;
}

export function createAlarmRecord(owner: string, watches: Watch[]): AlarmRecord {
  return { code: randomCode(), owner, watches, chatId: null, mirror: false, createdAt: Date.now() };
}

/** /start <code>: binds a chat to a pending alarm. Returns the updated store and the bound
 * record, or null when the code is unknown - the caller replies accordingly either way. */
export function bindCode(
  store: AlarmStore,
  code: string,
  chatId: number,
): { store: AlarmStore; record: AlarmRecord } | null {
  const record = store[code];
  if (!record) return null;
  const updated: AlarmRecord = { ...record, chatId };
  return { store: { ...store, [code]: updated }, record: updated };
}

/** /stop: removes every alarm bound to this chat. */
export function unbindChat(store: AlarmStore, chatId: number): AlarmStore {
  const out: AlarmStore = {};
  for (const [code, record] of Object.entries(store)) {
    if (record.chatId !== chatId) out[code] = record;
  }
  return out;
}

export function alarmsForChat(store: AlarmStore, chatId: number): AlarmRecord[] {
  return Object.values(store).filter((r) => r.chatId === chatId);
}

/** The owner closed `coin`, so there is nothing left to protect on it: drops that one watch from
 * the given alarm without touching its other watches. */
export function dropWatch(store: AlarmStore, code: string, coin: string): AlarmStore {
  const record = store[code];
  if (!record) return store;
  const watches = record.watches.filter((w) => w.coin !== coin);
  return { ...store, [code]: { ...record, watches } };
}

/** A watch fires only on a real move toward flat (reduce/close/flip) on the exact coin and side
 * being watched - an open or add is the leader growing the position, not exiting it. */
export function shouldFire(change: PositionChange, watch: Watch): boolean {
  return (
    change.coin === watch.coin &&
    change.direction === watch.direction &&
    change.reducedFraction > 0 &&
    (change.kind === "reduce" || change.kind === "close" || change.kind === "flip")
  );
}

function fmtMin(min: number | null): string {
  if (min === null) return "an unmeasured window";
  if (min < 1) return "under a minute";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function shortAddr(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export interface AlarmMessageInput {
  leaderLabel: string | null;
  leaderAddress: string;
  change: PositionChange;
  medianWindowMin: number | null;
  ownerSize: number;
  appUrl: string;
}

/** The message sent on a fire: what happened, how much runway holders historically had, what
 * the owner is holding, and where to read the leader's full report. */
export function formatAlarmMessage(input: AlarmMessageInput): string {
  const { leaderLabel, leaderAddress, change, medianWindowMin, ownerSize, appUrl } = input;
  const who = leaderLabel || shortAddr(leaderAddress);
  const pctClosed = Math.round(change.reducedFraction * 100);
  const verb = change.kind === "close" ? "closed" : change.kind === "flip" ? "flipped" : "started exiting";
  return (
    `${who} ${verb} your ${change.coin} ${change.direction}: -${pctClosed}%. ` +
    `Its exits have left holders a median ${fmtMin(medianWindowMin)} before a 1% move against them. ` +
    `You hold ${ownerSize} ${change.coin}. Report: ${appUrl}/w/${leaderAddress}`
  );
}

export function formatDropMessage(watch: Watch): string {
  return `You no longer hold ${watch.coin}. Stopped watching ${shortAddr(watch.leader)} on it.`;
}

export function ownerStillHolds(ownerPositions: OpenPosition[], coin: string): boolean {
  return ownerPositions.some((p) => p.coin === coin);
}
