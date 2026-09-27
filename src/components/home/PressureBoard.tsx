"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingRows } from "@/components/States";
import { TokenCell } from "@/components/TokenIcon";
import { type FeedItem } from "@/components/feed";
import { formatUsd, toMs } from "@/components/format";

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

interface CoinRow {
  coin: string;
  wallets: number;
  reduced: number;
  longs: number;
  shorts: number;
  latest: number;
  topTrader: string;
}

/** Aggregate Reduce/Close fills by coin: who is being sold, by how many wallets, how much. */
export function PressureBoard({
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

  const rows = useMemo<CoinRow[]>(() => {
    const byCoin = new Map<string, { traders: Map<string, number>; reduced: number; longs: number; shorts: number; latest: number }>();
    for (const f of exits) {
      let g = byCoin.get(f.token_symbol);
      if (!g) {
        g = { traders: new Map(), reduced: 0, longs: 0, shorts: 0, latest: 0 };
        byCoin.set(f.token_symbol, g);
      }
      g.traders.set(f.trader_address, (g.traders.get(f.trader_address) ?? 0) + f.value_usd);
      g.reduced += f.value_usd;
      if (f.side === "Long") g.longs += 1;
      else g.shorts += 1;
      const ms = toMs(f.timestamp);
      if (ms > g.latest) g.latest = ms;
    }
    return [...byCoin.entries()]
      .map(([coin, g]) => {
        let topTrader = "";
        let topUsd = -1;
        for (const [addr, usd] of g.traders) {
          if (usd > topUsd) {
            topUsd = usd;
            topTrader = addr;
          }
        }
        return { coin, wallets: g.traders.size, reduced: g.reduced, longs: g.longs, shorts: g.shorts, latest: g.latest, topTrader };
      })
      .sort((a, b) => b.reduced - a.reduced)
      .slice(0, 10);
  }, [exits]);

  if (error) return <ErrorState message={`Exit pressure did not load (${error}).`} onRetry={onRetry} />;
  if (loading && exits.length === 0) return <LoadingRows label="Exit pressure by coin" rows={6} />;
  if (rows.length === 0)
    return <EmptyState title="No Smart Money exits in this window." hint="Widen the timeframe above." />;

  const max = rows[0].reduced;

  return (
    <div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-bezel">
            <th scope="col" className="label text-left font-medium px-3 h-9">Token</th>
            <th scope="col" className="label text-right font-medium px-3 h-9">Wallets</th>
            <th scope="col" className="label text-right font-medium px-3 h-9">Reduced</th>
            <th scope="col" className="label text-right font-medium px-3 h-9">Side</th>
            <th scope="col" className="label text-right font-medium px-3 h-9 hidden md:table-cell">Flow</th>
            <th scope="col" className="label text-right font-medium px-3 h-9 hidden sm:table-cell">Latest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.coin} className="border-b border-rule transition-[background-color] duration-150 hover:bg-bezel">
              <td className="px-3 h-11 max-w-[140px]">
                <Link href={`/w/${r.topTrader}`} className="block rounded no-underline hover:underline hover:decoration-ink truncate">
                  <TokenCell coin={r.coin} sub={r.longs >= r.shorts ? "long" : "short"} />
                </Link>
              </td>
              <td className="fig px-3 h-11 text-right text-[13px] text-ink-2 whitespace-nowrap">{r.wallets}</td>
              <td className="fig px-3 h-11 text-right text-[13px] text-ink whitespace-nowrap">{formatUsd(r.reduced)}</td>
              <td className="px-3 h-11 text-right whitespace-nowrap">
                <span className="inline-flex gap-1 justify-end">
                  {r.longs > 0 ? <span className="chip chip-lume fig">L {r.longs}</span> : null}
                  {r.shorts > 0 ? <span className="chip chip-late fig">S {r.shorts}</span> : null}
                </span>
              </td>
              <td className="px-3 h-11 hidden md:table-cell">
                <span className="ml-auto block h-1 w-24 rounded-full bg-rule" role="img" aria-label={`${r.coin} holds ${formatUsd(r.reduced)} of the window total leader`}>
                  <span className="block h-full rounded-full bg-late" style={{ width: `${Math.max(4, Math.round((r.reduced / max) * 100))}%` }} />
                </span>
              </td>
              <td className="fig px-3 h-11 text-right text-[13px] text-ink-2 whitespace-nowrap hidden sm:table-cell">{ago(r.latest, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
