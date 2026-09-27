// Formatting helpers owned by lane U. Pure functions, no API calls.

import type { Companion } from "@/lib/types";

/** overlap.ts already resolves displayLabel server-side (junk labels like "High Balance" or a
 * referral code become a cohort fallback such as "Smart Money wallet"); fall back to the raw
 * label defensively in case an older payload doesn't carry it yet. */
export function companionLabel(c: Companion & { displayLabel?: string | null }): string {
  return c.displayLabel || c.label || "Unlabeled";
}

export function cohortLabel(cohort: Companion["cohort"]): string {
  return cohort === "smart_money" ? "smart money" : cohort === "whale" ? "whale" : "public figure";
}

export function shortAddr(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatUsd(n: number | null | undefined, opts?: { sign?: boolean }): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  const abs = Math.abs(n);
  const scaled = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(2)}M` : abs >= 1_000 ? `${(abs / 1_000).toFixed(1)}K` : abs.toFixed(abs < 10 ? 2 : 0);
  const sign = opts?.sign && n !== 0 ? (n > 0 ? "+" : "-") : n < 0 ? "-" : "";
  return `${sign}$${scaled}`;
}

export function formatPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

/** roi from the leaderboard may arrive as a fraction (0.42) or already as a percent (42); normalize. */
export function formatRoiPct(roi: number | null | undefined): string {
  if (roi === null || roi === undefined || Number.isNaN(roi)) return "n/a";
  const pct = Math.abs(roi) > 5 ? roi : roi * 100;
  return formatPct(pct);
}

export function formatMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return "still open";
  if (min < 1) return "<1m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatAgo(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  const deltaSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (deltaSec < 5) return "just now";
  if (deltaSec < 60) return `${deltaSec}s old`;
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)}m old`;
  return `${Math.round(deltaSec / 3600)}h old`;
}

/** Nansen timestamps have shown up as epoch seconds, epoch ms, and ISO strings; normalize to ms. */
export function toMs(timestamp: number | string): number {
  if (typeof timestamp === "string") return Date.parse(timestamp);
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Unwraps a possible {data, fetchedAt, stale} envelope; falls back to treating the payload itself as data. */
export function unwrapEnvelope<T>(json: unknown): { data: T; fetchedAt: number | null; stale: boolean } {
  if (
    json &&
    typeof json === "object" &&
    !Array.isArray(json) &&
    "data" in (json as Record<string, unknown>)
  ) {
    const obj = json as Record<string, unknown>;
    return {
      data: obj.data as T,
      fetchedAt: typeof obj.fetchedAt === "number" ? obj.fetchedAt : null,
      stale: obj.stale === true,
    };
  }
  return { data: json as T, fetchedAt: null, stale: false };
}
