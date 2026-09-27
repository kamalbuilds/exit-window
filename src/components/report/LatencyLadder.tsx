import type { LatencyResult } from "@/lib/types";
import { formatPct } from "../format";

const LABEL: Record<number, string> = { 0: "instant", 60: "1 min", 300: "5 min", 900: "15 min", 3600: "1 hour" };

/** Five rungs: what a copier mirroring entries and exits made at each delay, and what it cost. */
export function LatencyLadder({
  latency,
  walletReturnPct,
  maxSafeLatencySec,
  note,
}: {
  latency: LatencyResult[];
  walletReturnPct: number | null;
  maxSafeLatencySec: number | null;
  note: string | null;
}) {
  if (latency.length === 0) {
    return (
      <div className="border-t border-ink pt-4">
        <p className="text-[15px] text-ink-2 max-w-[52ch]">{note ?? "There are no fully observed round trips to replay yet."}</p>
        <p className="mt-2 text-[13px] text-ink-3">The exit windows above are still measured; only the copier replay needs a known entry.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 border-t border-b border-ink py-2 label">
        <span>Delay</span>
        <span className="text-right">You made</span>
        <span className="text-right">Tax</span>
        <span className="text-right">Late exits</span>
      </div>
      <ol>
        {latency.map((r) => {
          const safe = maxSafeLatencySec !== null && r.latencySec <= maxSafeLatencySec;
          return (
            <li
              key={r.latencySec}
              className={`grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 items-baseline py-2.5 border-b border-rule ${safe ? "" : "bg-late-wash"}`}
            >
              <span className="text-[14px] text-ink">{LABEL[r.latencySec] ?? `${r.latencySec}s`}</span>
              <span className={`fig text-[14px] text-right ${r.copierReturnPct >= 0 ? "text-lume" : "text-late"}`}>{formatPct(r.copierReturnPct, 2)}</span>
              <span className="fig text-[14px] text-right text-ink-2">{formatPct(-r.taxPct, 2)}</span>
              <span className="fig text-[14px] text-right text-ink-2">{r.lateExitSharePct.toFixed(0)}%</span>
            </li>
          );
        })}
      </ol>
      {walletReturnPct !== null && (
        <p className="mt-3 text-[13px] text-ink-3">
          The wallet itself averaged <span className="fig text-ink-2">{formatPct(walletReturnPct, 2)}</span> per round trip. Shaded rungs lose more than a quarter of that edge.
          {note ? ` ${note}` : ""}
        </p>
      )}
    </div>
  );
}
