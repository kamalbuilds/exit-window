"use client";

import { AddressForm } from "@/components/AddressForm";
import { type FeedItem, isExit } from "@/components/feed";
import { LapList } from "@/components/home/LapList";
import { LiveDial } from "@/components/home/LiveDial";
import { TimingTower } from "@/components/home/TimingTower";
import { usePoll } from "@/components/usePoll";

export default function Home() {
  const feed = usePoll<FeedItem[]>("/api/feed", 60_000);
  const exits = (feed.data ?? []).filter(isExit);

  return (
    <main className="mx-auto w-full max-w-[1320px] px-4 sm:px-8 flex-1">
      <section className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-12 gap-x-12 gap-y-10 pt-10 lg:pt-14 pb-14">
        <div className="lg:col-span-7 order-2 lg:order-1">
          <LiveDial exit={exits[0] ?? null} loading={feed.loading} />
        </div>
        <div className="lg:col-span-5 order-1 lg:order-2 flex flex-col gap-8">
          <div>
            <h1 className="display text-[clamp(40px,6vw,68px)]">Copy the exit, not the entry.</h1>
            <p className="mt-4 text-[18px] text-ink-2 max-w-[46ch]">
              Every copy trader gets the entry late. The damage is done on the way out. Exit Window measures how many
              minutes a wallet leaves you after it starts selling, what copying it cost at your delay, and follows it live.
            </p>
          </div>
          <AddressForm />
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="label">Smart Money exiting now</h2>
              <span className="text-[12px] text-ink-3">Nansen labels, last 24h</span>
            </div>
            <LapList exits={exits} loading={feed.loading} error={feed.error} onRetry={feed.refresh} />
          </div>
        </div>
      </section>

      <section className="border-t border-ink pt-8 pb-16">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h2 className="display text-[28px]">The timing tower</h2>
          <p className="text-[14px] text-ink-3">Top Hyperliquid wallets by 30-day PnL. Open one to see how fast it gets out.</p>
        </div>
        <TimingTower />
      </section>
    </main>
  );
}
