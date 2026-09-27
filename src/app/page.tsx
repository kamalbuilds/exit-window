"use client";

import { AddressForm } from "@/components/AddressForm";
import { FeedStrip, HeroClock, type FeedItem } from "@/components/FeedStrip";
import { LeaderList } from "@/components/LeaderList";
import { usePoll } from "@/components/usePoll";

export default function Home() {
  const { data: feed, loading, error, refresh } = usePoll<FeedItem[]>("/api/feed", 60_000);

  return (
    <div className="flex-1 flex flex-col items-center">
      <div className="w-full max-w-3xl px-6 py-10 flex flex-col gap-12">
        <header className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.2em] text-fg-faint">Exit Window</span>
          <span className="text-[11px] uppercase tracking-[0.2em] text-fg-faint num">Hyperliquid · Nansen</span>
        </header>

        <section className="flex flex-col gap-5">
          <div>
            <h1 className="text-3xl sm:text-4xl font-medium leading-tight tracking-tight">
              Copy the exit, not the entry.
            </h1>
            <p className="mt-2 text-fg-dim max-w-lg">
              Paste a Hyperliquid wallet. See how long you had after it started exiting, and what
              copying it would have cost you at your own reaction speed.
            </p>
          </div>
          <AddressForm />
          <HeroClock feed={feed} />
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm uppercase tracking-widest text-fg-faint">Smart Money exiting right now</h2>
          </div>
          <FeedStrip feed={feed} loading={loading} error={error} onRetry={refresh} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm uppercase tracking-widest text-fg-faint">Top wallets, 30 days</h2>
          <LeaderList />
        </section>

        <footer className="text-[11px] text-fg-faint pt-4 border-t border-line">
          Every number above comes from the Nansen API and Hyperliquid&apos;s public candles, live.
        </footer>
      </div>
    </div>
  );
}
