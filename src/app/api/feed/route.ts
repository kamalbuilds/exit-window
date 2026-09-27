import { NextResponse } from "next/server";
import { fetchSmartMoneyPerpTrades, NansenAuthError } from "@/lib/nansen";

/** src/components/FeedStrip.tsx reads the raw snake_case shape from BUILD-SPEC's
 * smart-money/perp-trades directly (it predates this route); map back to that shape here
 * rather than the camelCase SmartMoneyPerpTrade nansen.ts normalizes to internally. */
export async function GET() {
  try {
    const { data } = await fetchSmartMoneyPerpTrades(24, 50);
    const feed = data.map((t) => ({
      timestamp: t.at,
      trader_address: t.traderAddress,
      trader_address_label: t.traderLabel || null,
      token_symbol: t.coin,
      side: t.side,
      action: t.action,
      price: t.priceUsd,
      size: t.size,
      value_usd: t.valueUsd,
    }));
    return NextResponse.json(feed);
  } catch (err) {
    if (err instanceof NansenAuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    const message = err instanceof Error ? err.message : "feed request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
