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
      <div className="px-4 py-5">
        <p className="text-[14px] text-ink-2 max-w-[64ch]">{note ?? "There are no fully observed round trips to replay yet."}</p>
        <p className="mt-1.5 text-[12px] text-ink-3">The exit windows above are still measured; only the copier replay needs a known entry.</p>
      </div>
    );
  }
  return (
    <div>
      <table className="w-full text-left">
        <thead>
          <tr className="bg-bezel border-b border-rule">
            <th className="h-9 px-3 label font-medium">Delay</th>
            <th className="h-9 px-3 label font-medium text-right">You made</th>
            <th className="h-9 px-3 label font-medium text-right" title="Latency tax: the return a copier gives up at this delay versus the wallet's own return.">
              Tax
            </th>
            <th className="h-9 px-3 label font-medium text-right hidden sm:table-cell">Late exits</th>
          </tr>
        </thead>
        <tbody>
          {latency.map((r) => {
            const safe = maxSafeLatencySec !== null && r.latencySec <= maxSafeLatencySec;
            return (
              <tr key={r.latencySec} className="h-11 border-b border-rule transition-[background-color] duration-150 hover:bg-bezel">
                <td className="px-3">
                  <span className="inline-flex items-center gap-2">
                    <span className="text-[13px] text-ink">{LABEL[r.latencySec] ?? `${r.latencySec}s`}</span>
                    {safe ? null : <span className="chip chip-late">too slow</span>}
                  </span>
                </td>
                <td className={`px-3 fig text-[13px] text-right ${r.copierReturnPct >= 0 ? "text-lume" : "text-late"}`}>{formatPct(r.copierReturnPct, 2)}</td>
                <td className={`px-3 fig text-[13px] text-right ${safe ? "text-ink-2" : "text-late"}`}>{formatPct(-r.taxPct, 2)}</td>
                <td className="px-3 fig text-[13px] text-right text-ink-2 hidden sm:table-cell">{r.lateExitSharePct.toFixed(0)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {walletReturnPct !== null && (
        <p className="px-4 py-3 text-[12px] text-ink-3">
          The wallet itself averaged <span className="fig text-ink-2">{formatPct(walletReturnPct, 2)}</span> per round trip. Rungs marked too slow lose
          more than a quarter of that edge.
          {note ? ` ${note}` : ""}
        </p>
      )}
    </div>
  );
}
