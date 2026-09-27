"use client";

import { AddressForm } from "@/components/AddressForm";

export default function MeIndex() {
  return (
    <main className="px-4 lg:px-8 py-10 max-w-[1440px] w-full">
      <div className="panel p-8 max-w-2xl">
        <h1 className="display text-[28px]">Your trades</h1>
        <p className="mt-2 text-ink-2 max-w-[56ch]">
          Paste the Hyperliquid address you trade from. Exit Window finds the Smart Money wallets holding the same positions,
          shows how far above them you bought, and arms a Telegram alarm for when they start selling.
        </p>
        <div className="mt-6">
          <AddressForm target="me" />
        </div>
      </div>
    </main>
  );
}
