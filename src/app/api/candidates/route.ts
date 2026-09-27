import { NextResponse } from "next/server";
import { fetchSmartMoneyPerpTrades, NansenAuthError } from "@/lib/nansen";

const MAX_CANDIDATES = 8;

/** Demo wallets that actually trade: addresses from the (already-cached) Smart Money perp feed
 * with at least one Reduce/Close, so a judge picking one from this list sees a real exit episode
 * rather than an open-only wallet with nothing to backtest. No Nansen call beyond that cached feed. */
export async function GET() {
  try {
    const { data } = await fetchSmartMoneyPerpTrades(24, 50);
    const lastReduce = new Map<string, { label: string; at: number }>();
    for (const t of data) {
      if (!/reduce|close/i.test(t.action)) continue;
      const existing = lastReduce.get(t.traderAddress);
      if (!existing || t.at > existing.at) {
        lastReduce.set(t.traderAddress, { label: t.traderLabel, at: t.at });
      }
    }
    const candidates = [...lastReduce.entries()]
      .map(([address, v]) => ({ address, label: v.label || null, lastReduceAt: v.at }))
      .sort((a, b) => b.lastReduceAt - a.lastReduceAt)
      .slice(0, MAX_CANDIDATES);
    return NextResponse.json(candidates);
  } catch (err) {
    if (err instanceof NansenAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    const message = err instanceof Error ? err.message : "candidates request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
