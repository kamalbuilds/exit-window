import { WaitlistForm } from "@/components/waitlist/WaitlistForm";

export default function WaitlistPage() {
  return (
    <main className="px-4 lg:px-8 py-10 max-w-[1440px] w-full">
      <div className="panel p-8 max-w-2xl">
        <h1 className="display text-[28px]">Join the waitlist</h1>
        <p className="mt-2 text-ink-2 max-w-[56ch]">
          Exit Window: see the Smart Money in your Hyperliquid trades, how fast each one exits, and a
          Telegram alarm when they sell.
        </p>
        <div className="mt-6">
          <WaitlistForm />
        </div>
      </div>
    </main>
  );
}
