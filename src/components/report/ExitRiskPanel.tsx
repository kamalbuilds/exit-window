import type { ExitRisk, FollowLateSummary } from "@/lib/types";

const DELAY_LABEL: Record<number, string> = { 60: "1 min", 300: "5 min", 900: "15 min", 3600: "1 hour" };
const LEVEL: Record<ExitRisk["level"], { text: string; chip: string; ring: string }> = {
  high: { text: "High", chip: "chip-late", ring: "border-late" },
  medium: { text: "Medium", chip: "chip-mute", ring: "border-rule" },
  low: { text: "Low", chip: "chip-lume", ring: "border-rule" },
  unknown: { text: "Not enough exits yet", chip: "chip-mute", ring: "border-rule" },
};

/** Holder risk: will this wallet's first reduce turn into a full exit, and what did following it
 * late cost a holder on each past exit. Positive pct = the holder gave back that much. */
export function ExitRiskPanel({ risk, followLate }: { risk?: ExitRisk | null; followLate?: FollowLateSummary | null }) {
  if (!risk && !followLate) return null;
  const lv = LEVEL[risk?.level ?? "unknown"];
  const rows = followLate?.perDelay ?? [];
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.meanPct)));

  return (
    <section className={`panel overflow-hidden border ${lv.ring}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-rule">
        <h2 className="display text-[16px]">Holder risk if this wallet starts selling</h2>
        <span className={`chip ${lv.chip} text-[13px] px-2.5 py-1.5`}>{lv.text}</span>
      </div>
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-5 p-4">
        <div>
          {risk && <p className="text-[15px] text-ink leading-relaxed">{risk.sentence}</p>}
          {risk && risk.sample > 0 && (
            <dl className="mt-4 grid grid-cols-3 gap-4">
              <div>
                <dt className="label">First reduce to full exit</dt>
                <dd className="fig text-[20px] mt-1">{Math.round(risk.fullExitPct)}%</dd>
              </div>
              <div>
                <dt className="label">Time to flat</dt>
                <dd className="fig text-[20px] mt-1">{risk.minutesToFlat === null ? "n/a" : risk.minutesToFlat < 1 ? "<1m" : `${Math.round(risk.minutesToFlat)}m`}</dd>
              </div>
              <div>
                <dt className="label">Exits judged</dt>
                <dd className="fig text-[20px] mt-1">{risk.sample}</dd>
              </div>
            </dl>
          )}
        </div>
        {rows.length > 0 && (
          <div>
            <p className="label mb-2">If you follow its exit late, on average</p>
            <ul className="flex flex-col gap-2">
              {rows.map((r) => {
                const cost = r.meanPct > 0;
                return (
                  <li key={r.delaySec} className="grid grid-cols-[4.5rem_minmax(0,1fr)_6.5rem] items-center gap-3">
                    <span className="text-[13px] text-ink-2">{DELAY_LABEL[r.delaySec] ?? `${r.delaySec}s`}</span>
                    <span className="h-1.5 rounded-full bg-rule overflow-hidden">
                      <span className={`block h-full rounded-full ${cost ? "bg-late" : "bg-lume"}`} style={{ width: `${(Math.abs(r.meanPct) / maxAbs) * 100}%` }} />
                    </span>
                    <span className={`fig text-[13px] text-right ${cost ? "text-late" : "text-lume"}`}>
                      {cost ? `-${r.meanPct.toFixed(1)}%` : `+${Math.abs(r.meanPct).toFixed(1)}%`}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[12px] text-ink-3">
              {rows.every((r) => r.meanPct <= 0)
                ? "Price kept moving your way after this wallet sold: its exits have been early, not a signal to run."
                : "Red: what a holder gave back by reacting that late after its first reduce."}
              {followLate?.worst && followLate.worst.pct > 0
                ? ` Worst case: ${followLate.worst.coin}, followed ${DELAY_LABEL[followLate.worst.delaySec] ?? `${followLate.worst.delaySec}s`} late, cost ${followLate.worst.pct.toFixed(1)}%.`
                : ""}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
