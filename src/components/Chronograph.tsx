"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DELAYS, MAJOR_TICKS, MINOR_TICKS, inTime, logPos } from "./timescale";

// Log-scale chronograph: 12 o'clock is t = 0 (first reduce), the dial sweeps 330 degrees to 24 h.
const START_DEG = -90;
const SWEEP_DEG = 330;

function polar(r: number, pos: number): [number, number] {
  const a = ((START_DEG + SWEEP_DEG * pos) * Math.PI) / 180;
  // Rounded so server and client serialize identical attributes (hydration).
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return [round(r * Math.cos(a)), round(r * Math.sin(a))];
}

function arcPath(r: number, from: number, to: number): string {
  const [x0, y0] = polar(r, from);
  const [x1, y1] = polar(r, to);
  const large = SWEEP_DEG * (to - from) > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

/** Seconds since `startedAt`, re-rendered by animation frame (or once a second under reduced motion). */
function useElapsed(startedAt: number | null): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      const id = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(id);
    }
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startedAt]);
  return startedAt === null || now === null ? null : Math.max(0, (now - startedAt) / 1000);
}

export function Chronograph({
  size = 420,
  windowMin,
  startedAt = null,
  showDelays = true,
  children,
  title,
}: {
  size?: number;
  /** Measured window in minutes; null = the window did not close within 24 h; undefined = unknown. */
  windowMin?: number | null;
  /** When set, a hand sweeps with real time elapsed since this moment (ms). */
  startedAt?: number | null;
  showDelays?: boolean;
  children?: ReactNode;
  title: string;
}) {
  const elapsed = useElapsed(startedAt);
  const arcR = 66;
  const arcW = 16;
  const known = windowMin !== undefined;
  const winPos = known ? (windowMin === null ? 1 : logPos(windowMin * 60)) : 0;
  const arcLen = (2 * Math.PI * arcR * SWEEP_DEG * winPos) / 360;
  const closed = known && windowMin !== null;
  const handPos = elapsed === null ? null : logPos(elapsed);
  const handLate = elapsed !== null && closed && elapsed > (windowMin as number) * 60;

  const trackR = 78;
  const labelR = 94;
  return (
    <figure className="relative mx-auto" style={{ width: "100%", maxWidth: size }}>
      <svg viewBox="-110 -110 220 220" role="img" aria-label={title} className="block w-full h-auto overflow-visible">
        <defs>
          <filter id="ew-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="ew-face" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="var(--color-bezel)" />
            <stop offset="100%" stopColor="var(--color-dial)" />
          </radialGradient>
        </defs>

        {/* Face and the full 24 h track. */}
        <circle r={trackR - 12} fill="url(#ew-face)" />
        <path d={arcPath(trackR, 0, 1)} fill="none" stroke="var(--color-rule)" strokeWidth={10} strokeLinecap="round" />

        {/* Hour ticks outside the track, labels on the outer ring. */}
        {MINOR_TICKS.map((s) => {
          const [x0, y0] = polar(trackR + 8, logPos(s));
          const [x1, y1] = polar(trackR + 11, logPos(s));
          return <line key={s} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--color-rule)" strokeWidth={1} />;
        })}
        {MAJOR_TICKS.map((t) => {
          const p = logPos(t.sec);
          const [x0, y0] = polar(trackR + 7, p);
          const [x1, y1] = polar(trackR + 12, p);
          const [lx, ly] = polar(labelR + 6, p);
          return (
            <g key={t.sec}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--color-ink-3)" strokeWidth={1.2} />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fontSize={7} fill="var(--color-ink-3)" style={{ fontFamily: "var(--font-figure)" }}>
                {t.label}
              </text>
            </g>
          );
        })}

        {/* The window: open from the first reduce until price moved 1% against a holder. */}
        {known && winPos > 0 && (
          <g filter="url(#ew-glow)">
            <path
              d={arcPath(trackR, 0, Math.max(winPos, 0.004))}
              fill="none"
              stroke="var(--color-lume)"
              strokeWidth={10}
              strokeLinecap="round"
              className="arc-draw"
              style={{ ["--arc-len" as string]: `${arcLen * (trackR / arcR) + 10}` }}
            />
          </g>
        )}
        {closed && (() => {
          const [x, y] = polar(trackR, winPos);
          return (
            <g>
              <circle cx={x} cy={y} r={7.5} fill="var(--color-paper)" />
              <circle cx={x} cy={y} r={5} fill="var(--color-late)" />
            </g>
          );
        })()}

        {/* t = 0 */}
        {(() => {
          const [x, y] = polar(trackR, 0);
          return <circle cx={x} cy={y} r={3} fill="var(--color-ink)" />;
        })()}

        {/* Copier delays on the track: green if they land inside the window, red if it had closed. */}
        {showDelays &&
          DELAYS.map((d) => {
            const p = logPos(d.sec);
            const [x, y] = polar(trackR, p);
            const ok = known ? inTime(d.sec, windowMin ?? null) : null;
            const col = ok === null ? "var(--color-ink-3)" : ok ? "var(--color-lume)" : "var(--color-late)";
            return (
              <g key={d.sec}>
                <circle cx={x} cy={y} r={3.4} fill="var(--color-paper)" stroke={col} strokeWidth={1.8} />

                <title>{`${d.label} delay: ${ok === null ? "unknown" : ok ? "out in time" : "window already closed"}`}</title>
              </g>
            );
          })}

        {/* Live position: a marker that travels along the track with real elapsed time. */}
        {handPos !== null && (() => {
          const [x, y] = polar(trackR, handPos);
          const [lx, ly] = polar(trackR + 22, handPos);
          const col = handLate ? "var(--color-late)" : "var(--color-ink)";
          return (
            <g>
              <circle cx={x} cy={y} r={9} fill={col} opacity={0.18} />
              <circle cx={x} cy={y} r={5.2} fill={col} stroke="var(--color-paper)" strokeWidth={2} />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fontSize={7} fontWeight={600} fill={col} style={{ fontFamily: "var(--font-body)" }}>
                now
              </text>
            </g>
          );
        })()}
      </svg>
      {children && (
        <figcaption className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-[27%]">
          {children}
        </figcaption>
      )}
    </figure>
  );
}
