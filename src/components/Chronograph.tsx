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
  const R = 100; // viewBox radius units
  const bezelIn = 84;
  const arcR = 66;
  const arcW = 16;
  const known = windowMin !== undefined;
  const winPos = known ? (windowMin === null ? 1 : logPos(windowMin * 60)) : 0;
  const arcLen = (2 * Math.PI * arcR * SWEEP_DEG * winPos) / 360;
  const closed = known && windowMin !== null;
  const handPos = elapsed === null ? null : logPos(elapsed);
  const handLate = elapsed !== null && closed && elapsed > (windowMin as number) * 60;

  return (
    <figure className="relative mx-auto" style={{ width: "100%", maxWidth: size }}>
      <svg viewBox="-104 -104 208 208" role="img" aria-label={title} className="block w-full h-auto">
        <circle r={R} fill="var(--color-bezel)" stroke="var(--color-ink)" strokeWidth={1} />
        <circle r={bezelIn} fill="var(--color-dial)" stroke="var(--color-ink)" strokeWidth={0.6} />

        {MINOR_TICKS.map((s) => {
          const [x0, y0] = polar(bezelIn, logPos(s));
          const [x1, y1] = polar(bezelIn - 4, logPos(s));
          return <line key={s} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--color-ink-3)" strokeWidth={0.6} />;
        })}
        {MAJOR_TICKS.map((t) => {
          const p = logPos(t.sec);
          const [x0, y0] = polar(bezelIn, p);
          const [x1, y1] = polar(bezelIn - 9, p);
          const [lx, ly] = polar(bezelIn - 16, p);
          return (
            <g key={t.sec}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--color-ink)" strokeWidth={1.4} />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={6.4}
                fill="var(--color-ink-2)"
                style={{ fontFamily: "var(--font-figure)" }}
              >
                {t.label}
              </text>
            </g>
          );
        })}
        {/* t = 0 marker */}
        <line x1={0} y1={-bezelIn} x2={0} y2={-bezelIn + 12} stroke="var(--color-ink)" strokeWidth={2} />

        {/* The window: open from the first reduce until price moved 1% against a holder. */}
        {known && winPos > 0 && (
          <>
            <path
              d={arcPath(arcR, 0, winPos)}
              fill="none"
              stroke="var(--color-window)"
              strokeWidth={arcW}
            />
            <path
              d={arcPath(arcR + arcW / 2, 0, winPos)}
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth={1.2}
              className="arc-draw"
              style={{ ["--arc-len" as string]: `${(arcLen * (arcR + arcW / 2)) / arcR}` }}
            />
            {closed && (() => {
              const [x0, y0] = polar(arcR - arcW / 2 - 2, winPos);
              const [x1, y1] = polar(arcR + arcW / 2 + 2, winPos);
              return <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--color-late)" strokeWidth={2.4} />;
            })()}
          </>
        )}

        {/* Copier delays on the bezel. */}
        {showDelays &&
          DELAYS.map((d) => {
            const [x, y] = polar((R + bezelIn) / 2, logPos(d.sec));
            const ok = known ? inTime(d.sec, windowMin ?? null) : null;
            const fill = ok === null ? "var(--color-dial)" : ok ? "var(--color-lume)" : "var(--color-late)";
            return (
              <g key={d.sec}>
                <circle cx={x} cy={y} r={4.4} fill={fill} stroke="var(--color-ink)" strokeWidth={0.8} />
                <title>{`${d.label} delay: ${ok === null ? "unknown" : ok ? "out in time" : "window already closed"}`}</title>
              </g>
            );
          })}

        {/* Live hand. */}
        {handPos !== null && (() => {
          const [x, y] = polar(bezelIn - 6, handPos);
          const [tx, ty] = polar(-8, handPos);
          return (
            <g>
              <line x1={tx} y1={ty} x2={x} y2={y} stroke={handLate ? "var(--color-late)" : "var(--color-ink)"} strokeWidth={1.5} strokeLinecap="round" />
              <circle r={3.2} fill="var(--color-ink)" />
              <circle r={1.2} fill="var(--color-dial)" />
            </g>
          );
        })()}
      </svg>
      {children && (
        <figcaption className="absolute inset-0 flex flex-col items-center justify-start text-center pointer-events-none px-[24%] pt-[54%]">
          {children}
        </figcaption>
      )}
    </figure>
  );
}
