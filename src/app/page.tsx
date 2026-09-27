"use client";

import { useEffect, useMemo, useState } from "react";
import { type FeedItem, isExit } from "@/components/feed";
import { formatUsd, toMs } from "@/components/format";
import { ExitTape } from "@/components/home/ExitTape";
import { LiveDial } from "@/components/home/LiveDial";
import { PressureBoard } from "@/components/home/PressureBoard";
import { usePoll } from "@/components/usePoll";

type Window = "1h" | "6h" | "24h";

const WINDOWS: { key: Window; ms: number }[] = [
  { key: "1h", ms: 3_600_000 },
  { key: "6h", ms: 6 * 3_600_000 },
  { key: "24h", ms: 24 * 3_600_000 },
];

export default function Home() {
  const feed = usePoll<FeedItem[]>("/api/feed", 60_000);
  const [window, setWindow] = useState<Window>("24h");
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const exits = useMemo(() => {
    const span = WINDOWS.find((w) => w.key === window)?.ms ?? 24 * 3_600_000;
    const cutoff = now - span;
    return (feed.data ?? []).filter((f) => isExit(f) && toMs(f.timestamp) >= cutoff);
  }, [feed.data, window, now]);

  const windowReduced = useMemo(() => exits.reduce((sum, f) => sum + f.value_usd, 0), [exits]);

  return (
    <main className="px-4 lg:px-8 py-6 max-w-[1440px] w-full mx-auto flex-1">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div className="min-w-0">
          <h1 className="display text-[24px]">Smart Money exiting now</h1>
          <p className="mt-1 text-[14px] text-ink-2">
            Hyperliquid reduces by Nansen-labeled wallets. Hold one of these coins? Paste your address above to arm an exit alarm.
          </p>
        </div>
        <div role="group" aria-label="Timeframe" className="inline-flex items-center gap-1 rounded-lg bg-bezel p-1 shrink-0">
          {WINDOWS.map((w) => {
            const active = w.key === window;
            return (
              <button
                key={w.key}
                type="button"
                aria-pressed={active}
                onClick={() => setWindow(w.key)}
                className={`fig h-8 px-3 rounded-md text-[13px] whitespace-nowrap border transition-[background-color,color,border-color] duration-150 ${
                  active
                    ? "bg-dial border-rule text-accent font-medium"
                    : "bg-transparent border-transparent text-ink-2 hover:text-ink"
                }`}
              >
                {w.key}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <section aria-label="Live exit" className="panel p-5 lg:col-span-5">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="display text-[20px]">Live exit</h2>
            <span className="fig text-[12px] text-ink-3 whitespace-nowrap">{formatUsd(windowReduced)} out</span>
          </div>
          <LiveDial exits={exits} loading={feed.loading} />
        </section>

        <section aria-label="Exit pressure by coin" className="panel p-5 lg:col-span-7">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="display text-[20px]">Exit pressure by coin</h2>
            <span className="text-[12px] text-ink-3 whitespace-nowrap">Reduced size, this window</span>
          </div>
          <PressureBoard exits={exits} loading={feed.loading} error={feed.error} onRetry={feed.refresh} />
        </section>
      </div>

      <section aria-label="Exit tape" className="panel p-5 mt-4">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="display text-[20px]">Exit tape</h2>
          <span className="text-[12px] text-ink-3 whitespace-nowrap">Reduce and Close fills of $1,000 or more</span>
        </div>
        <ExitTape exits={exits} loading={feed.loading} error={feed.error} onRetry={feed.refresh} />
      </section>
    </main>
  );
}
