"use client";

import { useState } from "react";
import type { OpenPosition } from "@/lib/types";
import { TokenCell } from "../TokenIcon";
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
  if (positions.length === 0) return <p className="px-4 py-5 text-[14px] text-ink-2">Flat. This wallet holds no open perp positions right now.</p>;
  const sorted = [...positions].sort((a, b) => notional(b) - notional(a));
  const visible = showAll ? sorted : sorted.slice(0, SHOWN);
  return (
    <div>
      <table className="w-full text-left">
        <thead>
          <tr className="bg-bezel border-b border-rule">
            <th className="h-9 pl-4 pr-2 label font-medium">Coin</th>
            <th className="h-9 px-2 label font-medium">Side</th>
            <th className="h-9 px-2 label font-medium text-right hidden sm:table-cell">Size</th>
            <th className="h-9 px-2 label font-medium text-right hidden sm:table-cell">Entry</th>
            <th className="h-9 px-2 label font-medium text-right hidden lg:table-cell">Mark</th>
            <th className="h-9 px-2 label font-medium text-right">Unrealized</th>
            <th className="h-9 pl-2 pr-4 label font-medium text-right hidden xl:table-cell">Lev</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((p) => (
            <tr key={p.coin} className="h-11 border-b border-rule transition-[background-color] duration-150 hover:bg-bezel">
              <td className="pl-4 pr-2">
                <TokenCell coin={p.coin} />
              </td>
              <td className="px-2">
                <span className={`chip ${p.direction === "long" ? "chip-lume" : "chip-late"}`}>{p.direction === "long" ? "Long" : "Short"}</span>
              </td>
              <td className="px-2 fig text-[13px] text-right text-ink-2 hidden sm:table-cell">{p.size.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
              <td className="px-2 fig text-[13px] text-right text-ink-2 hidden sm:table-cell">{px(p.entryPx)}</td>
              <td className="px-2 fig text-[13px] text-right text-ink-2 hidden lg:table-cell">{px(p.markPx)}</td>
              <td className={`px-2 fig text-[13px] text-right ${(p.unrealizedPnlUsd ?? 0) >= 0 ? "text-lume" : "text-late"}`}>{formatUsd(p.unrealizedPnlUsd, { sign: true })}</td>
              <td className="pl-2 pr-4 fig text-[13px] text-right text-ink-3 hidden xl:table-cell">{p.leverage ? `${p.leverage}x` : "n/a"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > SHOWN && (
        <div className="px-4 py-3">
          <button onClick={() => setShowAll((s) => !s)} className="btn-secondary h-8 px-3 text-[13px] font-medium text-ink whitespace-nowrap">
            {showAll ? "Show top 10 by notional" : `Show all ${sorted.length}`}
          </button>
        </div>
      )}
    </div>
  );
}
