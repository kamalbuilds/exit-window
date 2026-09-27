import type { ExitWindow } from "@/lib/types";
import { formatDate, formatMinutes } from "./format";

const TICKS_MIN = [1, 5, 15, 60];

/**
 * The signature visual: a horizontal time axis starting at the wallet's first
 * reduce for that exit. An amber band is the open window. Latency ticks land
 * inside the band (out in time, green) or past its edge (exit liquidity, red).
 * Rows share one time domain so scanning down the stack shows how fast this
 * wallet's windows close relative to each other.
 */
export function ExitTimeline({ windows, episodeIsIncomplete }: { windows: ExitWindow[]; episodeIsIncomplete: (w: ExitWindow) => boolean }) {
  if (windows.length === 0) {
    return null;
  }
  const knownWindows = windows.map((w) => w.windowMin).filter((m): m is number => m !== null);
  const domainMin = Math.max(60, ...(knownWindows.length ? knownWindows.map((m) => m * 1.25) : [90]), ...TICKS_MIN);

  return (
    <div className="flex flex-col gap-3">
      <div className="pl-[132px] pr-[92px] text-[10px] uppercase tracking-widest text-fg-faint num">
        t=0 at first reduce → domain {Math.round(domainMin)}m
      </div>
      {windows.map((w, i) => (
        <ExitTimelineRow
          key={`${w.coin}-${w.direction}-${w.firstReduceAt}-${i}`}
          window={w}
          domainMin={domainMin}
          incomplete={episodeIsIncomplete(w)}
        />
      ))}
    </div>
  );
}

function ExitTimelineRow({ window: w, domainMin, incomplete }: { window: ExitWindow; domainMin: number; incomplete: boolean }) {
  const stillOpen = w.windowMin === null;
  const bandPct = stillOpen ? 100 : Math.min(100, (w.windowMin! / domainMin) * 100);
  const firstRedTick = TICKS_MIN.find((m) => !stillOpen && m > w.windowMin!);

  return (
    <div className="flex items-stretch gap-3">
      <div className="w-[124px] shrink-0 flex flex-col justify-center text-xs">
        <div className="flex items-center gap-1.5">
          <DirectionBadge direction={w.direction} />
          <span className="num font-medium">{w.coin}</span>
        </div>
        <span className="text-fg-faint text-[11px] num">{formatDate(w.firstReduceAt)}</span>
        {incomplete ? (
          <span className="text-[10px] text-fg-faint">opened before lookback</span>
        ) : null}
      </div>

      <div className="relative flex-1 h-10 min-w-0">
        <div className="absolute inset-y-1/2 left-0 right-0 h-px bg-line" />

        <div
          className={`absolute inset-y-2 left-0 rounded-[2px] ${stillOpen ? "bg-amber-dim border-r border-dashed border-amber/60" : "bg-amber-dim"}`}
          style={{ width: `${bandPct}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-amber"
          style={{ left: `${bandPct}%` }}
          aria-hidden
        />

        {TICKS_MIN.map((m) => {
          const pos = Math.min(100, (m / domainMin) * 100);
          const late = !stillOpen && m > w.windowMin!;
          const color = stillOpen ? "var(--green)" : late ? "var(--red)" : "var(--green)";
          return (
            <div
              key={m}
              className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center"
              style={{ left: `${pos}%` }}
            >
              <span
                className="block h-2.5 w-2.5 rounded-full border-2 border-bg"
                style={{ background: color }}
                title={`${m}m ${late ? "exit liquidity" : "out in time"}`}
              />
              <span className="absolute top-4 text-[9px] num text-fg-faint">{m}m</span>
            </div>
          );
        })}

        {firstRedTick ? (
          <span
            className="absolute -top-4 text-[10px] text-red num"
            style={{ left: `${Math.min(85, (firstRedTick / domainMin) * 100)}%` }}
          >
            exit liquidity →
          </span>
        ) : null}
      </div>

      <div className="w-[92px] shrink-0 flex flex-col items-end justify-center text-right">
        <span className="num text-sm font-medium" style={{ color: stillOpen ? "var(--green)" : "var(--amber)" }}>
          {formatMinutes(w.windowMin)}
        </span>
        <span className="text-[10px] text-fg-faint num">worst {w.maxAdversePct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: "long" | "short" }) {
  return (
    <span
      className="text-[9px] uppercase tracking-wider px-1 rounded-[2px] border"
      style={{
        color: direction === "long" ? "var(--green)" : "var(--red)",
        borderColor: direction === "long" ? "var(--green-dim)" : "var(--red-dim)",
      }}
    >
      {direction}
    </span>
  );
}
