// Telegram alarm storage plus the pure diff/trigger/message logic the worker and the API route
// share. Storage is a small JSON file (path resolved by storePath()) rather than a database -
// alarm count is small and scripts/alarm-worker.mjs is the only writer at any given tick.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Direction, ExitDna, OpenPosition, PositionChange, WalletReport } from "./types";
import type { MirrorResult } from "./mirror";

export interface ProtectRule {
  reducePct: number; // 1..100: cut the owner's position by this much when the leader reduces
}

export interface Watch {
  leader: string;
  label: string | null;
  coin: string;
  direction: Direction;
  protect?: ProtectRule | null;
  everHeld?: boolean; // true once ownerStillHolds has been observed true for this coin; gates the
  // "owner fully closed it" drop so a watch is never dropped just because the owner didn't hold
  // the coin yet at bind time
}

export interface AlarmRecord {
  code: string;
  owner: string;
  watches: Watch[];
  chatId: number | null;
  mirror: boolean;
  createdAt: number;
  smartAlerts?: Record<string, string>; // coin -> Nansen smart-alert id, created on /start, deleted on /stop
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

/** Records that the owner has been observed holding `coin` at least once. Only ever flips
 * everHeld false -> true, so a watch already marked held stays held even on a tick where the
 * owner's position fetch failed and this isn't called. */
export function markHeld(store: AlarmStore, code: string, coin: string): AlarmStore {
  const record = store[code];
  if (!record) return store;
  let changed = false;
  const watches = record.watches.map((w) => {
    if (w.coin !== coin || w.everHeld) return w;
    changed = true;
    return { ...w, everHeld: true };
  });
  if (!changed) return store;
  return { ...store, [code]: { ...record, watches } };
}

/** A watch is only dropped for "owner fully closed it" once the owner has actually held the
 * coin at some point (everHeld) and no longer does. Never drop for not holding it yet at bind
 * time - that would kill a watch armed before the owner's fill lands, and would kill test
 * alarms where owner === leader before the position is even open. */
export function shouldDropForClose(watch: Watch, ownerHoldsCoinNow: boolean): boolean {
  return !!watch.everHeld && !ownerHoldsCoinNow;
}

/** Records a Nansen smart-alert id created for one coin of this alarm (one alert per distinct
 * coin, regardless of how many leaders watch it). */
export function setSmartAlertId(store: AlarmStore, code: string, coin: string, alertId: string): AlarmStore {
  const record = store[code];
  if (!record) return store;
  const smartAlerts = { ...(record.smartAlerts ?? {}), [coin]: alertId };
  return { ...store, [code]: { ...record, smartAlerts } };
}

/** Every smart-alert id bound to this chat's alarms, across every alarm record - what /stop
 * needs to delete before it unbinds the chat. */
export function smartAlertIdsForChat(store: AlarmStore, chatId: number): string[] {
  return alarmsForChat(store, chatId).flatMap((r) => Object.values(r.smartAlerts ?? {}));
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

export function shortAddr(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export interface AlarmMessageInput {
  leaderLabel: string | null;
  leaderAddress: string;
  change: PositionChange;
  medianWindowMin: number | null;
  ownerSize: number;
  appUrl: string;
  exitDna?: string | null;
  protectionLine?: string | null;
}

/** The message sent on a fire: what happened, how much runway holders historically had, what
 * the owner is holding, and where to read the leader's full report. */
export function formatAlarmMessage(input: AlarmMessageInput): string {
  const { leaderLabel, leaderAddress, change, medianWindowMin, ownerSize, appUrl, exitDna, protectionLine } = input;
  const who = leaderLabel || shortAddr(leaderAddress);
  const pctClosed = Math.round(change.reducedFraction * 100);
  const verb = change.kind === "close" ? "closed" : change.kind === "flip" ? "flipped" : "started exiting";
  let msg =
    `${who} ${verb} your ${change.coin} ${change.direction}: -${pctClosed}%. ` +
    `Its exits have left holders a median ${fmtMin(medianWindowMin)} before a 1% move against them. ` +
    `You hold ${ownerSize} ${change.coin}. Report: ${appUrl}/w/${leaderAddress}`;
  if (exitDna) msg += ` ${exitDna}`;
  if (protectionLine) msg += `\n${protectionLine}`;
  return msg;
}

/** Only sent once the owner has actually held the coin and then fully closed it - see
 * shouldDropForClose. Says so plainly rather than the ambiguous "no longer hold". */
export function formatDropMessage(watch: Watch): string {
  return `You held ${watch.coin} and have now closed it fully. Stopped watching ${shortAddr(watch.leader)} on it.`;
}

export function ownerStillHolds(ownerPositions: OpenPosition[], coin: string): boolean {
  return ownerPositions.some((p) => p.coin === coin);
}

// ---------------------------------------------------------------------------
// Consensus: more than one watched leader reducing the same coin+direction within an hour.
// ---------------------------------------------------------------------------

export interface RecentReduce {
  leader: string;
  label: string | null;
  pctClosed: number; // 0..100
  usdValue: number;
  medianWindowMin: number | null;
  exitDna: string | null;
  at: number;
}

const CONSENSUS_WINDOW_MS = 60 * 60_000;

/** Drops entries older than the consensus window; the caller appends the new one after. */
export function pruneRecent<T extends { at: number }>(entries: T[], now: number, windowMs = CONSENSUS_WINDOW_MS): T[] {
  return entries.filter((e) => now - e.at < windowMs);
}

export function distinctLeaderCount(history: { leader: string }[]): number {
  return new Set(history.map((h) => h.leader)).size;
}

export interface ConsensusMessageInput {
  coin: string;
  direction: Direction;
  totalWatched: number; // leaders watched on this coin+direction for this alarm
  events: RecentReduce[]; // distinct leaders that reduced within the window
  ownerSize: number;
  appUrl: string;
  protectionLine?: string | null;
}

/** "3 of 5 Smart Money wallets in your STRK long reduced in the last hour", then one line per
 * leader with its own reduce size, median window and Exit DNA sentence when available. */
export function formatConsensusMessage(input: ConsensusMessageInput): string {
  const { coin, direction, totalWatched, events, ownerSize, appUrl, protectionLine } = input;
  const lines = [`${events.length} of ${totalWatched} Smart Money wallets in your ${coin} ${direction} reduced in the last hour.`];
  for (const e of events) {
    const who = e.label || shortAddr(e.leader);
    let line = `${who}: reduced by ${Math.round(e.pctClosed)}% ($${Math.round(e.usdValue).toLocaleString()}), median ${fmtMin(e.medianWindowMin)} window.`;
    if (e.exitDna) line += ` ${e.exitDna}`;
    lines.push(line);
  }
  lines.push(`You hold ${ownerSize} ${coin}. Report: ${appUrl}/w/${events[events.length - 1].leader}`);
  if (protectionLine) lines.push(protectionLine);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Protection rule: reporting the mirror path's result in the fire message.
// ---------------------------------------------------------------------------

/** Reports what the protection rule's mirror call actually did, in the same message as the
 * fire that triggered it. */
export function formatProtectionLine(result: MirrorResult): string {
  if (result.refusalReason) return `Protection rule: not triggered - ${result.refusalReason}`;
  const modeWord = result.mode === "paper" ? "Paper" : "Live";
  const cappedNote = result.capped ? " (capped by MIRROR_MAX_USD)" : "";
  const verb = result.executed ? "closed" : "would close";
  return `Protection rule: ${modeWord} mode ${verb} ${result.sizeToClose.toFixed(4)} ${result.coin} (~$${Math.round(result.usdValue).toLocaleString()})${cappedNote}.`;
}

// ---------------------------------------------------------------------------
// Exit DNA: distills a wallet's WalletReport.exitDna into one display sentence.
// ---------------------------------------------------------------------------

function exitDnaStyleSentence(dna: ExitDna): string {
  switch (dna.style) {
    case "nuclear":
      return `Nuclear exiter: usually flat in one clip (${Math.round(dna.fullExitAfterFirstReducePct)}% of the time).`;
    case "scaler":
      return `Scaler: usually takes ${Math.round(dna.medianClips)} clips to get flat.`;
    case "trimmer":
      return "Trimmer: usually trims rather than closes on the first reduce.";
    default:
      return "Mixed exit style: no strong single pattern.";
  }
}

/** Turns the wallet's own closed-episode history into one sentence, or null when there isn't
 * enough sample to say anything (WalletReport.exitDna is null in that case). */
export function readExitDna(report: WalletReport): string | null {
  const dna = report.exitDna;
  if (!dna) return null;
  const windowText =
    dna.firstReduceToFlatMedianMin === null ? "" : ` Median ${fmtMin(dna.firstReduceToFlatMedianMin)} from first reduce to flat.`;
  return `${exitDnaStyleSentence(dna)}${windowText}`;
}

// ---------------------------------------------------------------------------
// Onboarding (/start) and /test messages.
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function usdValueOf(position: OpenPosition, markPx: number | null): number {
  return position.size * (markPx ?? position.entryPx);
}

export interface OnboardingWatchInput {
  watch: Watch;
  leaderPosition: OpenPosition | null; // leader's current position on watch.coin
  leaderMarkPx: number | null;
  medianWindowMin: number | null;
  exitDna: string | null;
  ownerPosition: OpenPosition | null; // owner's current position on watch.coin
}

function formatOneOnboardingWatch(w: OnboardingWatchInput, appUrl: string): string {
  const { watch, leaderPosition, leaderMarkPx, medianWindowMin, exitDna, ownerPosition } = w;
  const who = escapeHtml(watch.label || shortAddr(watch.leader));
  const lines = [`<a href="${appUrl}/w/${watch.leader}">${who}</a> - ${watch.coin} ${watch.direction}`];

  if (leaderPosition) {
    const usd = usdValueOf(leaderPosition, leaderMarkPx);
    lines.push(`Position: ${leaderPosition.size} ${watch.coin} (~$${Math.round(usd).toLocaleString()}), entry $${leaderPosition.entryPx}`);
  } else {
    lines.push(`Position: not currently open on ${watch.coin}.`);
  }

  lines.push(`Median exit window: ${fmtMin(medianWindowMin)} before a 1% move against holders.`);
  if (exitDna) lines.push(`Exit DNA: ${exitDna}`);

  if (ownerPosition && leaderPosition && leaderPosition.entryPx > 0) {
    const gapPct = ((ownerPosition.entryPx - leaderPosition.entryPx) / leaderPosition.entryPx) * 100;
    const dir = gapPct >= 0 ? "above" : "below";
    lines.push(`You entered ${Math.abs(gapPct).toFixed(1)}% ${dir} this wallet.`);
  }

  if (watch.protect) {
    lines.push(`Protection: on a reduce, cut your position ${watch.protect.reducePct}%.`);
  }

  return lines.join("\n");
}

export interface SmartAlertOnboardingInput {
  coin: string;
  direction: Direction;
  status: "created" | "skipped";
  detail: string; // for "skipped", the reason (e.g. no resolvable spot token for a HIP-3 market)
}

/** Turns a raw Nansen error (often a full JSON error body from nansenCall/askWhyExiting) into
 * one plain sentence for a Telegram user - never dump the raw "{"error":"Bad
 * Request","message":"...","code":"...","request_id":"..."}" body into a chat message. */
export function friendlyNansenError(rawMessage: string): string {
  if (/insufficient.credits|credits exhausted/i.test(rawMessage)) {
    return "Nansen credits are exhausted right now.";
  }
  if (/plan limit/i.test(rawMessage)) {
    return "Nansen's plan limit for this feature was reached.";
  }
  return "Nansen is temporarily unavailable.";
}

/** One line per distinct coin on whether Nansen's own on-chain smart alert got armed alongside
 * the Hyperliquid one. Long watches Smart Money outflow (selling = pulling out); short watches
 * inflow (buying = piling in) - matches intel.ts's buildSmartAlertRequest. */
function formatSmartAlertLine(s: SmartAlertOnboardingInput): string {
  if (s.status === "skipped") return `Nansen on-chain alert skipped for ${s.coin}: ${friendlyNansenError(s.detail)}`;
  const verb = s.direction === "long" ? "pulls out of" : "piles into";
  return `Nansen will also message you directly if Smart Money ${verb} ${s.coin} on-chain.`;
}

/** Sent once, on /start: what got armed, in enough detail that the user can tell it's actually
 * watching something real, not the one-line "Watching: STRK (long)" this replaces. */
export function formatOnboardingMessage(
  watches: OnboardingWatchInput[],
  appUrl: string,
  smartAlerts: SmartAlertOnboardingInput[] = [],
): string {
  if (watches.length === 0) {
    return "No watches bound to this code yet. Create a new alarm from the app.";
  }
  const blocks = watches.map((w) => formatOneOnboardingWatch(w, appUrl));
  const smartAlertLines = smartAlerts.map(formatSmartAlertLine);
  return (
    `Alarm armed on ${watches.length} watch${watches.length === 1 ? "" : "es"}.\n\n` +
    blocks.join("\n\n") +
    (smartAlertLines.length > 0 ? `\n\n${smartAlertLines.join("\n")}` : "") +
    `\n\nCommands: /list watches, /stop all alarms, /test to see a sample alert.`
  );
}

export interface TestMessageInput {
  watch: Watch;
  leaderPosition: OpenPosition | null;
  medianWindowMin: number | null;
  appUrl: string;
}

/** A sample alert built from the chat's real watch data, clearly labeled so it can never be
 * mistaken for a real reduce. */
export function formatTestMessage(input: TestMessageInput): string {
  const { watch, leaderPosition, medianWindowMin, appUrl } = input;
  const who = watch.label || shortAddr(watch.leader);
  const posLine = leaderPosition
    ? `${who} currently holds ${leaderPosition.size} ${watch.coin} (${watch.direction}).`
    : `${who} has no open ${watch.coin} position right now.`;
  return (
    `Test alert - no reduce has happened. This is the format you'll get if ${who} reduces your ` +
    `${watch.coin} ${watch.direction}. ${posLine} Historically, holders had a median ${fmtMin(medianWindowMin)} ` +
    `before a 1% move against them. Report: ${appUrl}/w/${watch.leader}`
  );
}

// ---------------------------------------------------------------------------
// "Why is it exiting?" - the inline-button question sent to the Nansen Agent, and the reply
// formatting/cache key for its answer. The HTTP/SSE call itself and the callback_query wiring
// live in scripts/alarm-worker.ts (impure); this stays pure and unit-testable.
// ---------------------------------------------------------------------------

export interface WhyQuestionInput {
  leaderAddress: string;
  leaderLabel: string | null;
  coin: string;
  direction: Direction;
  pctClosed: number;
  usdValue: number;
  atMs: number;
}

/** Exact template for a real reduce: claims a reduce happened, so it must never be used for a
 * /test message (see buildWhyTestQuestion for that). */
export function buildWhyQuestion(input: WhyQuestionInput): string {
  const { leaderAddress, leaderLabel, coin, direction, pctClosed, usdValue, atMs } = input;
  const who = leaderLabel || shortAddr(leaderAddress);
  const time = new Date(atMs).toISOString();
  return (
    `Hyperliquid wallet ${leaderAddress} (${who}) just reduced its ${coin} ${direction} by ` +
    `${Math.round(pctClosed)}% (~$${Math.round(usdValue).toLocaleString("en-US")}) at ${time}. ` +
    `What on-chain context explains Smart Money exiting ${coin} right now? Answer in under 80 words.`
  );
}

export interface WhyTestQuestionInput {
  leaderAddress: string;
  leaderLabel: string | null;
  coin: string;
  direction: Direction;
}

/** For /test's "Why is it exiting?" button: /test must never claim a reduce happened, so this
 * asks the hypothetical version of the same question instead of reusing buildWhyQuestion's
 * "just reduced" wording against a reduce that never occurred. */
export function buildWhyTestQuestion(input: WhyTestQuestionInput): string {
  const { leaderAddress, leaderLabel, coin, direction } = input;
  const who = leaderLabel || shortAddr(leaderAddress);
  return (
    `Hyperliquid wallet ${leaderAddress} (${who}) is currently holding a ${coin} ${direction} position. ` +
    `No reduce has happened yet - this is a test. If Smart Money started exiting ${coin} right now, what ` +
    `on-chain context would likely explain it? Answer in under 80 words.`
  );
}

/** Reply text for the agent's answer: the answer itself, plus which Nansen tools it used (from
 * the SSE stream's finish event), when there were any. */
export function formatWhyAnswer(answer: string, tools: string[]): string {
  const trimmed = answer.trim();
  if (tools.length === 0) return trimmed;
  return `${trimmed}\n\nTools used: ${tools.join(", ")}`;
}

/** Per (leader, coin, hour): the same reduce asked about twice within the same hour reuses the
 * cached answer instead of spending another Agent call. */
export function whyCacheKey(leader: string, coin: string, atMs: number): string {
  return `${leader}:${coin}:${Math.floor(atMs / 3_600_000)}`;
}
