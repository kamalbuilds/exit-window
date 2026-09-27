import type { OpenPosition } from "@/lib/types";
import { EmptyState } from "./States";
import { formatUsd } from "./format";

export function OpenPositionsTable({ positions }: { positions: OpenPosition[] }) {
  if (positions.length === 0) {
    return <EmptyState title="No open positions" hint="Everything this wallet held is flat right now." />;
  }
  return (
    <table className="w-full text-sm num">
      <thead>
        <tr className="text-[10px] uppercase tracking-widest text-fg-faint">
          <th className="text-left py-1">Coin</th>
          <th className="text-left py-1">Dir</th>
          <th className="text-right py-1">Size</th>
          <th className="text-right py-1">Entry</th>
          <th className="text-right py-1">Mark</th>
          <th className="text-right py-1">uPnL</th>
          <th className="text-right py-1">Lev</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr key={p.coin} className="border-t border-line">
            <td className="py-1.5">{p.coin}</td>
            <td className="py-1.5" style={{ color: p.direction === "long" ? "var(--green)" : "var(--red)" }}>
              {p.direction}
            </td>
            <td className="py-1.5 text-right">{p.size}</td>
            <td className="py-1.5 text-right">{formatUsd(p.entryPx)}</td>
            <td className="py-1.5 text-right">{p.markPx !== null ? formatUsd(p.markPx) : "n/a"}</td>
            <td
              className="py-1.5 text-right"
              style={{ color: p.unrealizedPnlUsd === null ? "var(--fg-dim)" : p.unrealizedPnlUsd >= 0 ? "var(--green)" : "var(--red)" }}
            >
              {formatUsd(p.unrealizedPnlUsd, { sign: true })}
            </td>
            <td className="py-1.5 text-right">{p.leverage !== null ? `${p.leverage}x` : "n/a"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
