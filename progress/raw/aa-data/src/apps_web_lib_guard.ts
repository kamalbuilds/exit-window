/**
 * Spend guard for the public /api/draw route (copied from whichone's guard.ts, adapted). The key is server-only and
 * every live draw costs real Nansen credits (13, up to 23 if sourcing pages are retried), so an unattended loop
 * against the URL could drain the shared account. Three ceilings, no new services:
 *
 *   1. per-IP:  IP_PER_MIN draws per rolling minute → 429 with Retry-After;
 *   2. global:  DAILY_CREDITS live credits per UTC day, counted from the draw's own provenance;
 *   3. degrade: past the daily ceiling a draw deals a card from the committed deck instead, labelled as a replay.
 *
 * Counters live in instance memory: a ceiling, not accounting. Vercel may run several instances, so the true daily
 * spend is bounded by DAILY_CREDITS × instances — still far under the balance.
 */
export const IP_PER_MIN = Number(process.env.GUARD_IP_PER_MIN ?? 4);
export const DAILY_CREDITS = Number(process.env.GUARD_DAILY_CREDITS ?? 600);
/** a draw never costs more than this (three sourcing pages + four clue calls) */
export const MAX_DRAW_CREDITS = 23;
const WINDOW_MS = 60_000;

const hits = new Map<string, number[]>();

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip")?.trim() || "unknown";
}

export function ipAllowed(ip: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= IP_PER_MIN) {
    hits.set(ip, recent);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000)) };
  }
  recent.push(now);
  if (hits.size >= 5000) hits.clear(); // bound memory under a distributed scan; a cleared window only errs toward allowing
  hits.set(ip, recent);
  return { ok: true };
}

let day = "";
let spent = 0;
function roll(now: number) {
  const d = new Date(now).toISOString().slice(0, 10);
  if (d !== day) {
    day = d;
    spent = 0;
  }
}
export function creditsLeft(now = Date.now()): number {
  roll(now);
  return Math.max(0, DAILY_CREDITS - spent);
}
export function recordSpend(credits: number, now = Date.now()): void {
  roll(now);
  spent += Math.max(0, credits);
}
/** true when the day's budget cannot cover one more worst-case draw */
export function budgetExhausted(now = Date.now()): boolean {
  return creditsLeft(now) < MAX_DRAW_CREDITS;
}
/** test hook */
export function resetGuard(): void {
  hits.clear();
  day = "";
  spent = 0;
}

export const BUDGET_MESSAGE = "Today's live Nansen budget is used up — this card is a replay from the recorded deck.";
