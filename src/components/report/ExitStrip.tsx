import type { ExitWindow } from "@/lib/types";
import { TokenIcon } from "../TokenIcon";
import { formatDate, formatMinutes } from "../format";
import { DELAYS, MAJOR_TICKS, inTime, logPos } from "../timescale";

// Column widths shared by the axis and every row so the time scale lines up.
const COLS = "md:grid-cols-[15rem_minmax(0,1fr)_7.5rem]";

/** Shared log time axis, drawn once above the exit rows. */
export function StripAxis() {
  return (
    <div className={`hidden md:grid ${COLS} gap-x-6 px-4 h-8 items-center bg-bezel border-b border-rule`} aria-hidden="true">
      <span className="label">Exit</span>
      <div className="relative h-full">
        <span className="fig absolute top-1/2 left-0 -translate-y-1/2 text-[11px] text-ink-3">0</span>
        {MAJOR_TICKS.map((t) => (
          <span key={t.sec} className="fig absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] text-ink-3" style={{ left: `${logPos(t.sec) * 100}%` }}>
            {t.label}
          </span>
        ))}
      </div>
      <span className="label text-right">Window</span>
    </div>
  );
}

/** One exit as a race: the rail runs from the wallet's first reduce (t = 0) on a log time scale;
 * the green fill is how long a holder had before price moved 1% against them, ending in a red cap
 * where the window closed. Copier delays sit under the rail, green if they got out in time. */
export function ExitStrip({ w, openedBefore }: { w: ExitWindow; openedBefore: boolean }) {
  const held = w.windowMin === null;
  const end = held ? 1 : Math.max(logPos((w.windowMin as number) * 60), 0.02);
  const late = DELAYS.filter((d) => !inTime(d.sec, w.windowMin)).length;
  const verdict = held
    ? "Every copier got out"
    : late === 0
      ? "Every copier got out"
      : late === DELAYS.length
        ? "No copier got out"
        : `${DELAYS.length - late} of ${DELAYS.length} copiers got out`;

  return (
    <li className={`grid ${COLS} items-center gap-x-6 gap-y-3 px-4 py-4 border-b border-rule transition-[background-color] duration-150 hover:bg-bezel/60`}>
      <div className="flex items-center gap-3 min-w-0">
        <TokenIcon coin={w.coin} size={28} />
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span className="fig text-[14px] text-ink truncate">{w.coin}</span>
            <span className={`chip ${w.direction === "long" ? "chip-lume" : "chip-late"}`}>{w.direction === "long" ? "Long" : "Short"}</span>
          </p>
          <p className="fig text-[11px] text-ink-3 truncate mt-0.5" title={openedBefore ? "Position opened before the 30-day lookback" : undefined}>
            {formatDate(w.firstReduceAt)}
          </p>
        </div>
      </div>

      <div
        className="relative h-12"
        role="img"
        aria-label={`${w.coin}: ${held ? "price never moved 1% against holders within 24 hours" : `window closed after ${formatMinutes(w.windowMin)}`}; ${verdict.toLowerCase()}`}
      >
        <div className="absolute left-0 right-0 top-4 h-1.5 rounded-full bg-rule" />
        {MAJOR_TICKS.map((t) => (
          <div key={t.sec} className="absolute top-3.5 h-2.5 w-px bg-paper/70" style={{ left: `${logPos(t.sec) * 100}%` }} />
        ))}
        <div
          className="absolute left-0 top-4 h-1.5 rounded-full"
          style={{
            width: `${end * 100}%`,
            background: "linear-gradient(90deg, color-mix(in srgb, var(--color-lume) 30%, transparent), var(--color-lume))",
            boxShadow: "0 0 12px color-mix(in srgb, var(--color-lume) 45%, transparent)",
          }}
        />
        <div
          className={`absolute top-[11px] w-3.5 h-3.5 -translate-x-1/2 rounded-full border-2 border-paper ${held ? "bg-lume" : "bg-late"}`}
          style={{ left: `${end * 100}%` }}
        />
        <span
          className={`absolute -top-1 -translate-x-1/2 fig text-[10px] leading-none px-1.5 py-1 rounded whitespace-nowrap ${held ? "bg-lume-wash text-lume" : "bg-late-wash text-late"}`}
          style={{ left: `${Math.min(Math.max(end, 0.06), 0.93) * 100}%` }}
        >
          {held ? "held 24h+" : `closed ${formatMinutes(w.windowMin)}`}
        </span>
        {DELAYS.map((d) => {
          const ok = inTime(d.sec, w.windowMin);
          return (
            <span
              key={d.sec}
              title={`${d.label} copier delay: ${ok ? "out in time" : "window had closed"}`}
              className={`absolute top-7 -translate-x-1/2 flex flex-col items-center fig text-[10px] leading-none ${ok ? "text-lume" : "text-late"}`}
              style={{ left: `${logPos(d.sec) * 100}%` }}
            >
              <span className={`w-px h-1.5 mb-0.5 ${ok ? "bg-lume" : "bg-late"}`} />
              {d.label}
            </span>
          );
        })}
      </div>

      <div className="md:text-right">
        <p className={`fig text-[18px] leading-none ${held ? "text-ink-2" : late >= 2 ? "text-late" : "text-ink"}`}>{held ? "24h+" : formatMinutes(w.windowMin)}</p>
        <p className="text-[11px] text-ink-2 mt-1.5">{verdict}</p>
        <p className="fig text-[11px] text-ink-3">worst move {w.maxAdversePct.toFixed(1)}%</p>
      </div>
    </li>
  );
}
