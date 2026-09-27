"use client";

import { AddressForm } from "@/components/AddressForm";
import { type FeedItem, isExit } from "@/components/feed";
import { LapList } from "@/components/home/LapList";
import { LiveDial } from "@/components/home/LiveDial";
import { TimingTower } from "@/components/home/TimingTower";
import { usePoll } from "@/components/usePoll";

const LAP_MIN_USD = 1000;

export default function Home() {
  const feed = usePoll<FeedItem[]>("/api/feed", 60_000);
  const exits = (feed.data ?? []).filter(isExit);
  const lapExits = exits.filter((f) => f.value_usd >= LAP_MIN_USD);

  return (
    <main className="mx-auto w-full max-w-[1320px] px-4 sm:px-8 flex-1">
      <section className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-12 gap-x-12 gap-y-10 pt-10 lg:pt-14 pb-14">
        <div className="lg:col-span-7 order-2 lg:order-1">
          <LiveDial exits={exits} loading={feed.loading} />
        </div>
        <div className="lg:col-span-5 order-1 lg:order-2 flex flex-col gap-8">
          <div>
            <h1 className="display text-[clamp(38px,5.6vw,64px)]">You copied the whale&apos;s entry. You became its exit liquidity.</h1>
            <p className="mt-4 text-[18px] text-ink-2 max-w-[46ch]">
              Paste your Hyperliquid address. Exit Window finds the Smart Money wallets holding the same positions as you,
              shows how far above them you bought, how each one exits, and messages you on Telegram the moment they start
              selling.
            </p>
          </div>
          <AddressForm target="me" />
          <p className="-mt-4 text-[13px] text-ink-3">
            Not in a trade? Open any wallet exiting now to see its Exit DNA.
          </p>
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="label">Smart Money exiting now</h2>
              <span className="text-[12px] text-ink-3">Nansen labels, last 24h, $1,000+</span>
            </div>
            <LapList exits={lapExits} loading={feed.loading} error={feed.error} onRetry={feed.refresh} />
          </div>
        </div>
      </section>

      <section className="pb-16 border-t border-ink pt-10">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="display text-[26px]">Timing tower</h2>
          <span className="text-[12px] text-ink-3">Top 30d PnL, Hyperliquid perps</span>
        </div>
        <TimingTower />
      </section>
    </main>
  );
}
