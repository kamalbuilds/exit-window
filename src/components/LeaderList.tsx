"use client";

import Link from "next/link";
import type { LeaderRow } from "@/lib/types";
import { usePoll } from "./usePoll";
import { EmptyState, ErrorState, LoadingRows } from "./States";
import { formatUsd, formatRoiPct, shortAddr } from "./format";

export function LeaderList() {
  const { data, error, loading, refresh } = usePoll<LeaderRow[]>("/api/leaders", 0);

  if (error) return <ErrorState message={`Leaderboard failed to load: ${error}`} onRetry={refresh} />;
  if (loading && !data) return <LoadingRows label="Top wallets, 30d" rows={6} />;
  if (!data || data.length === 0) return <EmptyState title="No leaderboard data yet" hint="The 30-day perp leaderboard came back empty." />;

  return (
    <ol className="flex flex-col">
      {data.map((row, i) => (
        <li key={row.address}>
          <Link
            href={`/w/${row.address}`}
            className="grid grid-cols-[24px_1fr_auto_auto] items-center gap-3 py-2 border-t border-line first:border-t-0 hover:bg-bg-raised px-1 -mx-1 rounded-sm"
          >
            <span className="num text-fg-faint text-xs">{i + 1}</span>
            <span className="flex flex-col min-w-0">
              <span className="num text-sm truncate">{shortAddr(row.address)}</span>
              {row.label ? <span className="text-[11px] text-fg-faint truncate">{row.label}</span> : null}
            </span>
            <span className="num text-sm text-right" style={{ color: row.totalPnlUsd >= 0 ? "var(--green)" : "var(--red)" }}>
              {formatUsd(row.totalPnlUsd, { sign: true })}
            </span>
            <span className="num text-xs text-fg-faint text-right w-14">{formatRoiPct(row.roi)}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
