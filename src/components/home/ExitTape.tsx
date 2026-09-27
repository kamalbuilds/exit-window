"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingRows } from "@/components/States";
import { TokenCell } from "@/components/TokenIcon";
import { type FeedItem } from "@/components/feed";
import { formatUsd, shortAddr, toMs, walletLabel, formatPrice } from "@/components/format";

const MIN_USD = 1000;
const MAX_ROWS = 50;

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** Every Smart Money Reduce/Close fill of $1,000 or more, newest first. */
export function ExitTape({
  exits,
  loading,
  error,
  onRetry,
}: {
  exits: FeedItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  if (error) return <ErrorState message={`The exit tape did not load (${error}).`} onRetry={onRetry} />;
  if (loading && exits.length === 0) return <LoadingRows label="Exit tape" rows={6} />;

  const rows = exits
    .filter((f) => f.value_usd >= MIN_USD)
    .sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));
  if (rows.length === 0)
    return <EmptyState title="No Smart Money exits of $1,000 or more in this window." hint="Widen the timeframe above." />;

  const shown = rows.slice(0, MAX_ROWS);

  return (
    <div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-bezel">
            <th scope="col" className="label text-left font-medium px-3 h-9">Token</th>
            <th scope="col" className="label text-left font-medium px-3 h-9">Wallet</th>
            <th scope="col" className="label text-left font-medium px-3 h-9 hidden sm:table-cell">Side</th>
            <th scope="col" className="label text-left font-medium px-3 h-9">Action</th>
            <th scope="col" className="label text-right font-medium px-3 h-9">Value</th>
            <th scope="col" className="label text-right font-medium px-3 h-9 hidden md:table-cell">Price</th>
            <th scope="col" className="label text-right font-medium px-3 h-9">Time</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((f, i) => (
            <tr key={`${f.trader_address}-${f.timestamp}-${i}`} className="border-b border-rule transition-[background-color] duration-150 hover:bg-bezel">
              <td className="px-3 h-11 max-w-[120px]">
                <Link href={`/w/${f.trader_address}`} className="block rounded no-underline hover:underline hover:decoration-ink truncate">
                  <TokenCell coin={f.token_symbol} />
                </Link>
              </td>
              <td className="px-3 h-11 max-w-[170px]">
                <span className="block truncate text-[13px] text-ink-2">{walletLabel(f.trader_address_label, f.trader_address)}</span>
                {f.trader_address_label ? (
                  <span className="fig block truncate text-[12px] text-ink-3">{shortAddr(f.trader_address)}</span>
                ) : null}
              </td>
              <td className="px-3 h-11 whitespace-nowrap hidden sm:table-cell">
                {f.side === "Long" ? <span className="chip chip-lume">Long</span> : <span className="chip chip-late">Short</span>}
              </td>
              <td className="px-3 h-11 whitespace-nowrap">
                <span className="chip chip-late">{/close/i.test(f.action) ? "Close" : "Reduce"}</span>
              </td>
              <td className="fig px-3 h-11 text-right text-[13px] text-ink whitespace-nowrap">{formatUsd(f.value_usd)}</td>
              <td className="fig px-3 h-11 text-right text-[13px] text-ink-2 whitespace-nowrap hidden md:table-cell">
                {(f.price ?? f.price_usd) != null ? formatPrice(f.price ?? f.price_usd) : "n/a"}
              </td>
              <td className="fig px-3 h-11 text-right text-[13px] text-late whitespace-nowrap">{ago(toMs(f.timestamp), now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_ROWS ? (
        <p className="fig px-3 pt-3 text-[12px] text-ink-3">Showing the latest {MAX_ROWS} of {rows.length} exits.</p>
      ) : null}
    </div>
  );
}
