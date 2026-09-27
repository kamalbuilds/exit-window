import { z } from "zod";
import type { NansenClient, CallOptions } from "./client.js";

/** Typed request builders + zod-validated response shapes for every Nansen endpoint the engine calls (openapi.json 2026-09-18). */

export const CHAIN = "ethereum" as const;
export type Chain = typeof CHAIN;

/** every value of the `LabelType` enum — used to EXCLUDE all label groups (the "regular" class) */
export const ALL_LABEL_TYPES = [
  "30D Smart Trader",
  "90D Smart Trader",
  "180D Smart Trader",
  "Fund",
  "Smart Trader",
  "Public Figure",
  "Exchange",
  "Whale",
  "BananaGun Bot User",
  "Top Maestro Bot User",
  "Top BananaGun Bot User",
  "Maestro Bot User",
  "Early MAGIC Miner",
  "First Mover LP",
  "First Mover Staking",
  "Profitable LP",
  "Smart HL Perps Trader",
] as const;
export const SMART_MONEY_LABELS = ["Fund", "30D Smart Trader", "90D Smart Trader", "180D Smart Trader", "Smart Trader"] as const;

const num = z.number().nullable().optional();
const str = z.string().nullable().optional();
const pagination = z.object({ page: z.number().optional(), per_page: z.number().optional(), is_last_page: z.boolean().optional() }).passthrough();

export const HolderRow = z.object({ address: str, address_label: str, value_usd: num, token_amount: num, ownership_percentage: num }).passthrough();
export const HoldersResponse = z.object({ data: z.array(HolderRow), pagination: pagination.optional(), warnings: z.unknown().optional() }).passthrough();
export type HolderRow = z.infer<typeof HolderRow>;

export const WhoBoughtSoldRow = z.object({ address: z.string(), address_label: str, bought_volume_usd: num, sold_volume_usd: num }).passthrough();
export const WhoBoughtSoldResponse = z.object({ data: z.array(WhoBoughtSoldRow), pagination: pagination.optional() }).passthrough();

export const SmartMoneyTradeRow = z.object({ trader_address: z.string(), trader_address_label: str, trade_value_usd: num, block_timestamp: str }).passthrough();
export const SmartMoneyTradesResponse = z.object({ data: z.array(SmartMoneyTradeRow), pagination: pagination.optional() }).passthrough();

export const PnlSummaryResponse = z
  .object({
    top5_tokens: z
      .array(z.object({ token_symbol: str, realized_pnl: num, realized_roi: num, token_address: str }).passthrough())
      .nullable()
      .optional(),
    traded_token_count: num,
    traded_times: num,
    realized_pnl_usd: num,
    realized_pnl_percent: num,
    win_rate: num,
  })
  .passthrough();
export type PnlSummaryResponse = z.infer<typeof PnlSummaryResponse>;

export const PnlRow = z
  .object({
    token_symbol: str,
    pnl_usd_realised: num,
    roi_percent_realised: num,
    nof_buys: z.union([z.string(), z.number()]).nullable().optional(),
    nof_sells: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .passthrough();
export const PnlResponse = z.object({ data: z.array(PnlRow).nullable().optional(), pagination: pagination.optional() }).passthrough();

export const BalanceRow = z.object({ token_symbol: str, token_address: str, value_usd: num, token_amount: num }).passthrough();
export const BalanceResponse = z.object({ data: z.array(BalanceRow).nullable().optional(), pagination: pagination.optional() }).passthrough();

export const CounterpartyRow = z
  .object({
    counterparty_address: str,
    counterparty_address_label: z.array(z.string()).nullable().optional(),
    interaction_count: num,
    total_volume_usd: num,
    volume_in_usd: num,
    volume_out_usd: num,
  })
  .passthrough();
export const CounterpartiesResponse = z.object({ data: z.array(CounterpartyRow).nullable().optional(), pagination: pagination.optional() }).passthrough();

export const TxLookupResponse = z
  .object({
    data: z
      .array(
        z
          .object({
            from_address: str,
            from_address_label: str,
            to_address: str,
            to_address_label: str,
            token_transfer_array: z
              .array(z.object({ from_address: str, from_address_label: str, to_address: str, to_address_label: str }).passthrough())
              .nullable()
              .optional(),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
  })
  .passthrough();
export const TransactionsResponse = z
  .object({
    data: z
      .array(z.object({ transaction_hash: str, block_timestamp: str, method: str }).passthrough())
      .nullable()
      .optional(),
    pagination: pagination.optional(),
  })
  .passthrough();

export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
export const WINDOW_DAYS = 30;
/** the 30-day clue window ending at `now` (whole days, so a replay with the recorded `now` hits the same cache keys) */
export function window(now: number, days = WINDOW_DAYS): { from: string; to: string } {
  return { from: isoDay(now - days * 86_400_000), to: isoDay(now) };
}

async function call<T>(
  c: NansenClient,
  endpoint: string,
  body: Record<string, unknown>,
  fields: string[],
  schema: z.ZodType<T>,
  opts?: CallOptions,
): Promise<T> {
  const raw = await c.post<unknown>(endpoint, body, fields, opts);
  return schema.parse(raw);
}

export type HolderLabelType = "smart_money" | "exchange" | "public_figure" | "all_holders" | "all_holders_plain";

export const nansen = {
  /** tgm/holders (5 cr). `labelType` ≠ all_holders filters by Nansen's own label group — the class is known by construction. */
  holders: (c: NansenClient, token: string, labelType: HolderLabelType, page = 1, perPage = 100, opts?: CallOptions) => {
    const include =
      labelType === "smart_money"
        ? [...SMART_MONEY_LABELS]
        : labelType === "exchange"
          ? ["Exchange"]
          : labelType === "public_figure"
            ? ["Public Figure"]
            : undefined;
    const body: Record<string, unknown> = { chain: CHAIN, token_address: token, pagination: { page, per_page: perPage } };
    if (include) body.filters = { include_smart_money_labels: include };
    else if (labelType === "all_holders") body.filters = { exclude_smart_money_labels: [...ALL_LABEL_TYPES] };
    if (labelType !== "all_holders" && labelType !== "all_holders_plain") body.label_type = labelType;
    return call(c, "tgm/holders", body, ["data[].address", "data[].address_label", "data[].value_usd"], HoldersResponse, opts);
  },
  /** tgm/who-bought-sold (1 cr) with every label group excluded → traders Nansen puts in none of them */
  whoBought: (c: NansenClient, token: string, now: number, opts?: CallOptions) =>
    call(
      c,
      "tgm/who-bought-sold",
      {
        chain: CHAIN,
        token_address: token,
        buy_or_sell: "BUY",
        date: window(now, 7),
        filters: { exclude_smart_money_labels: [...ALL_LABEL_TYPES] },
        pagination: { page: 1, per_page: 100 },
      },
      ["data[].address", "data[].address_label", "data[].bought_volume_usd"],
      WhoBoughtSoldResponse,
      opts,
    ),
  /** smart-money/dex-trades (5 cr): trader addresses are Smart Money by construction */
  smartMoneyTrades: (c: NansenClient, opts?: CallOptions) =>
    call(
      c,
      "smart-money/dex-trades",
      { chains: [CHAIN], pagination: { page: 1, per_page: 100 } },
      ["data[].trader_address", "data[].trader_address_label"],
      SmartMoneyTradesResponse,
      opts,
    ),
  pnlSummary: (c: NansenClient, address: string, now: number, opts?: CallOptions) =>
    call(
      c,
      "profiler/address/pnl-summary",
      { address, chain: CHAIN, date: window(now) },
      [
        "realized_pnl_usd",
        "realized_pnl_percent",
        "win_rate",
        "traded_times",
        "traded_token_count",
        "top5_tokens[].token_symbol",
        "top5_tokens[].realized_roi",
      ],
      PnlSummaryResponse,
      opts,
    ),
  /** the schema marks `date` optional; the API returns HTTP 400 without it (spike 2026-09-18) — always sent */
  pnl: (c: NansenClient, address: string, now: number, opts?: CallOptions) =>
    call(
      c,
      "profiler/address/pnl",
      {
        address,
        chain: CHAIN,
        date: window(now),
        filters: { show_realized: true },
        pagination: { page: 1, per_page: 5 },
        order_by: [{ field: "pnl_usd_realised", direction: "DESC" }],
      },
      ["data[].token_symbol", "data[].pnl_usd_realised", "data[].nof_buys", "data[].nof_sells"],
      PnlResponse,
      opts,
    ),
  balance: (c: NansenClient, address: string, opts?: CallOptions) =>
    call(
      c,
      "profiler/address/current-balance",
      { address, chain: CHAIN, hide_spam_token: true, pagination: { page: 1, per_page: 100 }, order_by: [{ field: "value_usd", direction: "DESC" }] },
      ["data[].token_symbol", "data[].value_usd", "pagination.is_last_page"],
      BalanceResponse,
      opts,
    ),
  counterparties: (c: NansenClient, address: string, now: number, opts?: CallOptions) =>
    call(
      c,
      "profiler/address/counterparties",
      {
        address,
        chain: CHAIN,
        date: window(now),
        source_input: "Combined",
        group_by: "wallet",
        pagination: { page: 1, per_page: 50 },
        order_by: [{ field: "total_volume_usd", direction: "DESC" }],
      },
      ["data[].counterparty_address_label", "data[].interaction_count", "data[].volume_out_usd", "data[].total_volume_usd", "pagination.is_last_page"],
      CounterpartiesResponse,
      { timeoutMs: 12_000, ...opts },
    ),
  transactions: (c: NansenClient, address: string, now: number, opts?: CallOptions) =>
    call(
      c,
      "profiler/address/transactions",
      { address, chain: CHAIN, date: window(now), pagination: { page: 1, per_page: 5 } },
      ["data[].transaction_hash"],
      TransactionsResponse,
      opts,
    ),
  txLookup: (c: NansenClient, transaction_hash: string, opts?: CallOptions) =>
    call(
      c,
      "transaction-with-token-transfer-lookup",
      { chain: CHAIN, transaction_hash },
      ["data[].from_address_label", "data[].to_address_label", "data[].token_transfer_array[].*_address_label"],
      TxLookupResponse,
      opts,
    ),
};
