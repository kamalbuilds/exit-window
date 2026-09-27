"use client";

import Link from "next/link";
import type { LeaderRow } from "@/lib/types";
import { EmptyState, ErrorState, LoadingRows } from "../States";
import { formatRoiPct, formatUsd, shortAddr } from "../format";
import { usePoll } from "../usePoll";

/** Top Hyperliquid wallets by 30-day PnL, in two dense columns. */
export function TimingTower() {
  const { data, loading, error, refresh } = usePoll<LeaderRow[]>("/api/leaders", 0);
  if (error) return <ErrorState message={`The leaderboard did not load (${error}).`} onRetry={refresh} />;
  if (loading && !data) return <LoadingRows label="leaderboard" rows={6} />;
  const rows = (data ?? []).slice(0, 10);
  if (rows.length === 0) return <EmptyState title="Nansen returned no leaderboard rows for the last 30 days." />;

  const half = Math.ceil(rows.length / 2);
  const cols = [rows.slice(0, half), rows.slice(half)];
  return (
    <div className="grid md:grid-cols-2 gap-x-10">
      {cols.map((col, c) => (
        <ol key={c} start={c * half + 1} className="border-t border-ink">
          {col.map((r, i) => (
            <li key={r.address} className="border-b border-rule">
              <Link
                href={`/w/${r.address}`}
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto_4.5rem] items-baseline gap-3 py-2.5 no-underline text-ink transition-[background-color] duration-150 hover:bg-bezel"
              >
                <span className="fig text-[12px] text-ink-3">{String(c * half + i + 1).padStart(2, "0")}</span>
                <span className="min-w-0 truncate">
                  <span className="fig text-[13px]">{shortAddr(r.address)}</span>
                  {r.label && <span className="text-[13px] text-ink-3"> {r.label}</span>}
                </span>
                <span className={`fig text-[13px] text-right ${r.totalPnlUsd >= 0 ? "text-lume" : "text-late"}`}>
                  {formatUsd(r.totalPnlUsd, { sign: true })}
                </span>
                <span className="fig text-[12px] text-ink-3 text-right">{formatRoiPct(r.roi)}</span>
              </Link>
            </li>
          ))}
        </ol>
      ))}
    </div>
  );
}
