// One logarithmic time scale for every dial and strip (DESIGN.md: 10 s to 24 h).

export const T_MIN_S = 10;
export const T_MAX_S = 86_400;

/** Position of `sec` on the log scale, 0..1. */
export function logPos(sec: number): number {
  const s = Math.min(Math.max(sec, T_MIN_S), T_MAX_S);
  return Math.log(s / T_MIN_S) / Math.log(T_MAX_S / T_MIN_S);
}

export const DELAYS = [
  { sec: 60, label: "1m" },
  { sec: 300, label: "5m" },
  { sec: 900, label: "15m" },
  { sec: 3600, label: "1h" },
] as const;

export const MAJOR_TICKS = [
  { sec: 60, label: "1m" },
  { sec: 300, label: "5m" },
  { sec: 900, label: "15m" },
  { sec: 3600, label: "1h" },
  { sec: 14_400, label: "4h" },
  { sec: 86_400, label: "24h" },
] as const;

export const MINOR_TICKS = [20, 30, 120, 600, 1800, 7200, 21_600, 43_200];

/** A delay is in time when it lands before the window closed. `windowMin` null = never closed in 24 h. */
export function inTime(delaySec: number, windowMin: number | null): boolean {
  return windowMin === null || delaySec < windowMin * 60;
}
