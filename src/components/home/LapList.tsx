"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingRows } from "../States";
import { type FeedItem } from "../feed";
import { formatUsd, shortAddr, toMs, walletLabel } from "../format";

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** Newest Smart Money reduces, like a lap list: time since, coin, who, size. */
export function LapList({ exits, loading, error, onRetry }: { exits: FeedItem[]; loading: boolean; error: string | null; onRetry: () => void }) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (error) return <ErrorState message={`The Smart Money tape did not load (${error}).`} onRetry={onRetry} />;
  if (loading && exits.length === 0) return <LoadingRows label="Smart Money exits" rows={6} />;
  if (exits.length === 0) return <EmptyState title="No labeled wallet reduced a position in the last 24 hours." hint="The list refreshes every minute." />;

  return (
    <ol className="border-t border-ink">
      {exits.slice(0, 8).map((f, i) => (
        <li key={`${f.trader_address}-${f.timestamp}-${i}`} className="border-b border-rule">
          <Link
            href={`/w/${f.trader_address}`}
            className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-3 py-2.5 no-underline text-ink transition-[background-color] duration-150 hover:bg-bezel"
          >
            <span className="fig text-[13px] text-late">{ago(toMs(f.timestamp), now)}</span>
            <span className="min-w-0 truncate">
              <span className="fig text-[14px]">{f.token_symbol}</span>
              <span className="text-[13px] text-ink-3"> {f.side === "Long" ? "long" : "short"} reduced by </span>
              <span className="text-[13px] text-ink-2">{walletLabel(f.trader_address_label, f.trader_address)}</span>
            </span>
            <span className="fig text-[13px] text-ink-2 text-right">{formatUsd(f.value_usd)}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
