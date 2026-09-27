"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePoll } from "./usePoll";

interface Ledger {
  totalNetwork: number;
  totalCacheHits: number;
}

function UtcClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="fig text-[12px] text-ink-2" aria-label="Current UTC time">
      {now ? now.toISOString().slice(11, 19) : "--:--:--"} UTC
    </span>
  );
}

export function Masthead() {
  const { data } = usePoll<Ledger>("/api/ledger", 60_000);
  return (
    <header className="border-b border-ink bg-paper">
      <div className="mx-auto w-full max-w-[1320px] px-4 sm:px-8 h-14 flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2 no-underline text-ink">
          <svg viewBox="-12 -12 24 24" className="w-5 h-5" aria-hidden="true">
            <circle r={11} fill="none" stroke="var(--color-ink)" strokeWidth={1.6} />
            <path d="M 0 -7 A 7 7 0 0 1 6.06 3.5" fill="none" stroke="var(--color-late)" strokeWidth={2.4} />
            <line x1={0} y1={0} x2={0} y2={-8} stroke="var(--color-ink)" strokeWidth={1.6} />
          </svg>
          <span className="display text-[20px]">Exit Window</span>
        </Link>
        <span className="hidden md:inline text-[13px] text-ink-3">Hyperliquid wallets, timed on Nansen data</span>
        <span className="ml-auto flex items-center gap-5">
          <Link href="/calls" className="hidden sm:inline text-[13px] text-ink-2 underline decoration-rule hover:decoration-ink">
            Nansen call log
          </Link>
          {data && (
            <span className="hidden sm:inline fig text-[12px] text-ink-3" title="Nansen API calls served by this server since it started">
              {data.totalNetwork} live · {data.totalCacheHits} cached calls
            </span>
          )}
          <UtcClock />
        </span>
      </div>
    </header>
  );
}
