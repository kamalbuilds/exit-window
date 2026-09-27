"use client";

import { useState } from "react";
import type { OpenPosition } from "@/lib/types";
import { formatUsd } from "../format";

const SHOWN = 10;

function px(n: number | null): string {
  if (n === null) return "not quoted";
  return n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n >= 1 ? n.toFixed(2) : n.toPrecision(3);
}

function notional(p: OpenPosition): number {
  return p.size * (p.markPx ?? p.entryPx);
}

export function Positions({ positions }: { positions: OpenPosition[] }) {
  const [showAll, setShowAll] = useState(false);
  if (positions.length === 0) return <p className="text-[15px] text-ink-2 border-t border-ink pt-4">Flat. This wallet holds no open perp positions right now.</p>;
  const sorted = [...positions].sort((a, b) => notional(b) - notional(a));
  const visible = showAll ? sorted : sorted.slice(0, SHOWN);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr className="border-t border-b border-ink label">
              <th className="py-2 font-medium">Coin</th>
              <th className="py-2 font-medium">Side</th>
              <th className="py-2 font-medium text-right">Size</th>
              <th className="py-2 font-medium text-right">Entry</th>
              <th className="py-2 font-medium text-right">Mark</th>
              <th className="py-2 font-medium text-right">Unrealized</th>
              <th className="py-2 font-medium text-right">Lev</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.coin} className="border-b border-rule">
                <td className="py-2.5 fig text-[14px]">{p.coin}</td>
                <td className={`py-2.5 text-[13px] font-medium ${p.direction === "long" ? "text-lume" : "text-late"}`}>{p.direction}</td>
                <td className="py-2.5 fig text-[13px] text-right text-ink-2">{p.size.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td className="py-2.5 fig text-[13px] text-right text-ink-2">{px(p.entryPx)}</td>
                <td className="py-2.5 fig text-[13px] text-right text-ink-2">{px(p.markPx)}</td>
                <td className={`py-2.5 fig text-[13px] text-right ${(p.unrealizedPnlUsd ?? 0) >= 0 ? "text-lume" : "text-late"}`}>
                  {formatUsd(p.unrealizedPnlUsd, { sign: true })}
                </td>
                <td className="py-2.5 fig text-[13px] text-right text-ink-3">{p.leverage ? `${p.leverage}x` : "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > SHOWN && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="mt-3 text-[13px] text-ink-2 underline decoration-rule hover:decoration-ink"
        >
          {showAll ? "Show top 10 by notional" : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  );
}
