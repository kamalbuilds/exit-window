import { NextResponse } from "next/server";
import type { FeedItem } from "@/components/feed";
import { fetchSmartMoneyPerpTrades } from "@/lib/nansen";
import { mergeFeed, readEvents } from "@/lib/sentinel";

/** src/components/FeedStrip.tsx reads the raw snake_case shape from BUILD-SPEC's
 * smart-money/perp-trades directly (it predates this route); map back to that shape here
 * rather than the camelCase SmartMoneyPerpTrade nansen.ts normalizes to internally. */
export async function GET() {
  // Nansen's smart-money/perp-trades freezes when its credits run out (nansenCall still falls
  // back to a stale cached response when one exists) - the sentinel's own live-exits.jsonl fills
  // the gap either way, so a Nansen failure degrades this feed rather than failing it outright.
  let nansenFeed: FeedItem[] = [];
  try {
    const { data } = await fetchSmartMoneyPerpTrades(24, 50);
    nansenFeed = data.map((t) => ({
      timestamp: t.at,
      trader_address: t.traderAddress,
      trader_address_label: t.traderLabel || null,
      token_symbol: t.coin,
      side: t.side,
      action: t.action,
      price: t.priceUsd,
      value_usd: t.valueUsd,
    }));
  } catch (err) {
    console.error("feed: Nansen smart-money/perp-trades unavailable, serving sentinel-only feed:", err instanceof Error ? err.message : err);
  }

  const liveEvents = await readEvents();
  const feed = mergeFeed(nansenFeed, liveEvents);
  return NextResponse.json(feed);
}
