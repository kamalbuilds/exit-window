// Row shape of GET /api/feed (Nansen smart-money/perp-trades, labeled fills).
export interface FeedItem {
  timestamp: number | string;
  trader_address: string;
  trader_address_label?: string | null;
  token_symbol: string;
  side: "Long" | "Short";
  action: string;
  price_usd?: number;
  value_usd: number;
}

export const isExit = (f: FeedItem) => /reduce|close/i.test(f.action);
