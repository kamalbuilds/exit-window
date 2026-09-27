"use client";

import { TimingTower } from "@/components/home/TimingTower";

export default function WalletsPage() {
  return (
    <main className="px-4 lg:px-8 py-6 max-w-[1440px] w-full">
      <h1 className="display text-[24px]">Top wallets</h1>
      <p className="mt-1 text-ink-2">
        Hyperliquid wallets ranked by 30-day PnL (Nansen perp leaderboard). Open one to see how it exits.
      </p>
      <section aria-label="Timing tower" className="panel mt-6 p-5">
        <div className="flex items-baseline justify-between gap-3 pb-4">
          <h2 className="display text-[16px]">Timing tower</h2>
          <span className="label">30d PnL</span>
        </div>
        <TimingTower />
      </section>
    </main>
  );
}
