"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingRows } from "./States";
import { formatClock, formatUsd, shortAddr, toMs } from "./format";

/**
 * Shape inferred from BUILD-SPEC's smart-money/perp-trades: labeled perp
 * fills. Not in src/lib/types.ts (lane E owns the route); read defensively
 * since field names on GET /api/feed may shift as that route lands.
 */
export interface FeedItem {
  timestamp: number | string;
  trader_address: string;
  trader_address_label?: string | null;
  token_symbol: string;
  side: "Long" | "Short";
  action: string;
  price: number;
  size: number;
  value_usd: number;
}

const LATENCY_TICKS_MIN = [1, 5, 15, 60];

export function FeedStrip({ feed, loading, error, onRetry }: { feed: FeedItem[] | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (error) return <ErrorState message={`Live feed failed to load: ${error}`} onRetry={onRetry} />;
  if (loading && !feed) return <LoadingRows label="Smart Money exiting right now" rows={5} />;
  const reduces = (feed ?? []).filter((f) => /reduce|close/i.test(f.action));
  if (reduces.length === 0) {
    return <EmptyState title="No Smart Money reduces in the lookback window" hint="Nobody labeled is exiting right now. Check back shortly." />;
  }

  return (
    <ul className="flex flex-col">
      {reduces.slice(0, 12).map((f, i) => (
        <li key={`${f.trader_address}-${f.timestamp}-${i}`} className="border-t border-line first:border-t-0">
          <Link
            href={`/w/${f.trader_address}`}
            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 py-2 px-1 -mx-1 rounded-sm hover:bg-bg-raised"
          >
            <span
              className="text-[9px] uppercase tracking-wider px-1 rounded-[2px] border shrink-0"
              style={{
                color: f.side === "Long" ? "var(--green)" : "var(--red)",
                borderColor: f.side === "Long" ? "var(--green-dim)" : "var(--red-dim)",
              }}
            >
              {f.action}
            </span>
            <span className="flex flex-col min-w-0">
              <span className="num text-sm truncate">{f.token_symbol}</span>
              <span className="text-[11px] text-fg-faint truncate">
                {f.trader_address_label ?? shortAddr(f.trader_address)}
              </span>
            </span>
            <span className="num text-sm text-fg-dim text-right">{formatUsd(f.value_usd)}</span>
            <ElapsedTick at={toMs(f.timestamp)} compact />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Ticks the elapsed time since `at` and lights the nearest latency marker. Real timestamp, real clock. */
function ElapsedTick({ at, compact }: { at: number; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsedMin = (now - at) / 60000;
  const passed = LATENCY_TICKS_MIN.filter((m) => elapsedMin >= m).length;
  const color = passed === 0 ? "var(--green)" : passed >= 3 ? "var(--red)" : "var(--amber)";
  if (compact) {
    return (
      <span className="num text-xs text-right w-14" style={{ color }}>
        {elapsedMin < 1 ? `${Math.round(elapsedMin * 60)}s` : `${Math.round(elapsedMin)}m`} ago
      </span>
    );
  }
  return <span style={{ color }}>{formatClock(elapsedMin * 60)}</span>;
}

/**
 * The hero: animates the single most recent real Smart Money reduce as a
 * closing window. Real data in (the feed timestamp), real clock (elapsed
 * since), and the app's fixed latency methodology (1/5/15/60m) as the only
 * reference marks - no per-wallet band is fabricated for wallets we have not
 * measured yet.
 */
export function HeroClock({ feed }: { feed: FeedItem[] | null }) {
  const reduce = (feed ?? []).filter((f) => /reduce|close/i.test(f.action)).sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp))[0];
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!reduce) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [reduce]);

  if (!reduce) {
    return (
      <div className="border border-dashed border-line rounded-sm px-5 py-6 text-fg-dim text-sm">
        Waiting for a live Smart Money reduce to animate.
      </div>
    );
  }

  const at = toMs(reduce.timestamp);
  const elapsedMin = Math.max(0, (now - at) / 60000);
  const domain = 60;

  return (
    <Link href={`/w/${reduce.trader_address}`} className="block border border-line rounded-sm px-5 py-5 hover:border-line-strong">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-sm">
          <span className="font-medium">{reduce.trader_address_label ?? shortAddr(reduce.trader_address)}</span>
          <span className="text-fg-faint"> started exiting {reduce.token_symbol} </span>
        </p>
        <span className="num text-2xl" style={{ color: "var(--amber)" }}>
          {formatClock(elapsedMin * 60)}
        </span>
      </div>
      <div className="relative h-8">
        <div className="absolute inset-y-1/2 left-0 right-0 h-px bg-line" />
        <div
          className="absolute inset-y-1.5 left-0 bg-amber-dim rounded-[2px]"
          style={{ width: `${Math.min(100, (elapsedMin / domain) * 100)}%` }}
        />
        {LATENCY_TICKS_MIN.map((m) => {
          const passed = elapsedMin >= m;
          return (
            <div key={m} className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${(m / domain) * 100}%` }}>
              <span
                className="block h-2.5 w-2.5 rounded-full border-2 border-bg"
                style={{ background: passed ? "var(--red)" : "var(--green)" }}
              />
              <span className="absolute top-4 text-[9px] num text-fg-faint">{m}m</span>
            </div>
          );
        })}
      </div>
      <p className="mt-5 text-xs text-fg-faint">See this wallet&apos;s measured exit window →</p>
    </Link>
  );
}
