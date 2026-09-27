import type { ExitWindow } from "@/lib/types";
import { TokenIcon } from "../TokenIcon";
import { formatDate, formatMinutes } from "../format";
import { DELAYS, MAJOR_TICKS, inTime, logPos } from "../timescale";

/** Shared log axis drawn once above the exit log. The inner layer is inset to sit over the strip track. */
export function StripAxis() {
  return (
    <div className="h-6 bg-bezel border-b border-rule" aria-hidden="true">
      <div className="relative h-full ml-0 md:ml-[17rem] md:mr-[8rem]">
        {MAJOR_TICKS.map((t) => (
          <span
            key={t.sec}
            className="fig absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] text-ink-3"
            style={{ left: `${logPos(t.sec) * 100}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One exit: t = 0 at the first reduce, shaded until price moved 1% against a holder, delays as dots. */
export function ExitStrip({ w, openedBefore }: { w: ExitWindow; openedBefore: boolean }) {
  const end = w.windowMin === null ? 1 : logPos(w.windowMin * 60);
  const lateCount = DELAYS.filter((d) => !inTime(d.sec, w.windowMin)).length;
  return (
    <li className="grid md:grid-cols-[16rem_minmax(0,1fr)_7rem] items-center gap-x-4 gap-y-2 px-4 py-2.5 border-b border-rule transition-[background-color] duration-150 hover:bg-bezel">
      <div className="flex items-center gap-2.5 min-w-0">
        <TokenIcon coin={w.coin} />
        <div className="min-w-0">
          <p className="flex items-center gap-2 min-w-0">
            <span className="fig text-[13px] text-ink truncate">{w.coin}</span>
            <span className={`chip ${w.direction === "long" ? "chip-lume" : "chip-late"}`}>{w.direction === "long" ? "Long" : "Short"}</span>
          </p>
          <p className="fig text-[11px] text-ink-3 truncate">
            {formatDate(w.firstReduceAt)}
            {openedBefore ? (
              <span title="This position was already open when the lookback started, so its entry is not fully observed."> · pre-lookback</span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="relative h-8" role="img" aria-label={`${w.coin} window ${w.windowMin === null ? "stayed open 24 hours" : formatMinutes(w.windowMin)}; ${lateCount} of 4 delays late`}>
        <div className="absolute inset-x-0 top-1/2 h-px bg-rule" />
        {MAJOR_TICKS.map((t) => (
          <div key={t.sec} className="absolute top-[30%] h-[40%] w-px bg-rule" style={{ left: `${logPos(t.sec) * 100}%` }} />
        ))}
        <div className="absolute top-[22%] h-[56%] left-0 bg-window border-t border-ink" style={{ width: `${end * 100}%` }} />
        {w.windowMin !== null && (
          <div className="absolute top-[10%] h-[80%] w-[3px] -translate-x-1/2 bg-late" style={{ left: `${end * 100}%` }} />
        )}
        {DELAYS.map((d) => {
          const ok = inTime(d.sec, w.windowMin);
          return (
            <span
              key={d.sec}
              title={`${d.label} delay: ${ok ? "out in time" : "window already closed"}`}
              className={`absolute top-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ink ${ok ? "bg-lume" : "bg-late"}`}
              style={{ left: `${logPos(d.sec) * 100}%` }}
            />
          );
        })}
      </div>

      <div className="md:text-right">
        <p className={`fig text-[14px] ${w.windowMin === null ? "text-ink-2" : lateCount >= 2 ? "text-late" : "text-ink"}`}>
          {w.windowMin === null ? "held 24h+" : formatMinutes(w.windowMin)}
        </p>
        <p className="fig text-[11px] text-ink-3">worst {w.maxAdversePct.toFixed(1)}%</p>
      </div>
    </li>
  );
}
