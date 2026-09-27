"use client";

import Link from "next/link";
import type { LeaderRow } from "@/lib/types";
import { EmptyState, ErrorState, LoadingRows } from "../States";
import { formatRoiPct, formatUsd, shortAddr } from "../format";
import { usePoll } from "../usePoll";

/** Top Hyperliquid wallets by 30-day PnL, one screener table. Rows link to the wallet report. */
export function TimingTower() {
  const { data, loading, error, refresh } = usePoll<LeaderRow[]>("/api/leaders", 0);
  if (error) return <ErrorState message={`The leaderboard did not load (${error}).`} onRetry={refresh} />;
  if (loading && !data) return <LoadingRows label="leaderboard" rows={6} />;
  const rows = (data ?? []).slice(0, 10);
  if (rows.length === 0) return <EmptyState title="Nansen returned no leaderboard rows for the last 30 days." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left">
        <thead>
          <tr className="bg-bezel">
            <th scope="col" className="label py-2 pl-3 pr-2 font-medium w-12">
              Rank
            </th>
            <th scope="col" className="label py-2 px-2 font-medium">
              Wallet
            </th>
            <th scope="col" className="label py-2 px-2 font-medium text-right">
              30d PnL
            </th>
            <th scope="col" className="label py-2 px-2 font-medium text-right">
              ROI
            </th>
            <th scope="col" className="label py-2 pl-2 pr-3 font-medium text-right">
              Account value
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.address}
              className="relative border-b border-rule transition-[background-color] duration-150 last:border-b-0 hover:bg-bezel"
            >
              <td className="fig py-2.5 pl-3 pr-2 text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</td>
              <td className="min-w-0 max-w-[220px] py-2.5 px-2">
                <span className="block truncate text-[13px] text-ink">
                  {r.label || "Unlabeled wallet"}{" "}
                  <span className="fig text-[12px] text-ink-3">{shortAddr(r.address)}</span>
                </span>
              </td>
              <td
                className={`fig whitespace-nowrap py-2.5 px-2 text-right text-[13px] ${
                  r.totalPnlUsd >= 0 ? "text-lume" : "text-late"
                }`}
              >
                {formatUsd(r.totalPnlUsd, { sign: true })}
              </td>
              <td className="fig whitespace-nowrap py-2.5 px-2 text-right text-[12px] text-ink-2">
                {formatRoiPct(r.roi)}
              </td>
              <td className="fig whitespace-nowrap py-2.5 pl-2 pr-3 text-right text-[13px] text-ink-2">
                {r.accountValue ? formatUsd(r.accountValue) : "n/a"}
              </td>
              <td className="w-0 p-0">
                <Link
                  href={`/w/${r.address}`}
                  aria-label={`Open ${r.label || shortAddr(r.address)}`}
                  className="absolute inset-0"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
