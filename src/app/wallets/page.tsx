"use client";

import { TimingTower } from "@/components/home/TimingTower";

export default function WalletsPage() {
  return (
    <main className="px-4 lg:px-8 py-8 max-w-[1440px] w-full">
      <h1 className="display text-[28px]">Top wallets</h1>
      <p className="mt-1 text-ink-2">Hyperliquid wallets ranked by 30-day PnL (Nansen perp leaderboard). Open one to see how it exits.</p>
      <div className="mt-6 panel overflow-hidden">
        <TimingTower />
      </div>
    </main>
  );
}
