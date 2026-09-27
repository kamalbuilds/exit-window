import type { NansenClient } from "./client.js";
import { nansen, type PnlSummaryResponse } from "./nansen.js";
import { counterpartyClass, type CounterpartyClass } from "./classes.js";

/** Everything the card shows. Every number is a Nansen field or arithmetic over Nansen fields; the wallet's own label is never here. */
export type Clues = {
  pnl: {
    ok: boolean;
    realizedUsd: number | null;
    realizedPct: number | null;
    winRate: number | null;
    trades: number;
    tokensTraded: number;
    top: { symbol: string; roi: number | null; pnlUsd: number | null }[];
  };
  trades: { ok: boolean; rows: { symbol: string; pnlUsd: number | null; buys: number; sells: number }[] };
  balance: {
    ok: boolean;
    tokens: number;
    tokensCapped: boolean;
    totalUsd: number;
    topShare: number | null;
    topSymbol: string | null;
    stableShare: number | null;
  };
  counterparties: {
    ok: boolean;
    count: number;
    countCapped: boolean;
    interactions: number;
    topOutShare: number | null;
    /** share of total volume per counterparty class, 0–1 */
    mix: Record<CounterpartyClass, number>;
    counts: Record<CounterpartyClass, number>;
  };
  /** every section came back empty — a dormant or unindexed wallet; still a card */
  empty: boolean;
};

export const STABLECOINS = new Set([
  "USDT",
  "USDC",
  "DAI",
  "USDS",
  "USDE",
  "FDUSD",
  "TUSD",
  "PYUSD",
  "USD1",
  "FRAX",
  "LUSD",
  "GHO",
  "CRVUSD",
  "SUSD",
  "BUSD",
  "USDP",
  "USDD",
  "USDC.E",
  "USDT0",
]);

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r0 = (x: number) => Math.round(x);
const n = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const int = (x: string | number | null | undefined) => {
  const v = typeof x === "string" ? Number(x) : x;
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
};

export const MIX_KEYS: CounterpartyClass[] = ["pool", "entity", "contract", "wealth", "activity", "ens", "other", "unlabelled"];
const zeroMix = () => Object.fromEntries(MIX_KEYS.map((k) => [k, 0])) as Record<CounterpartyClass, number>;

export function extractPnl(s: PnlSummaryResponse | undefined): Clues["pnl"] {
  if (!s) return { ok: false, realizedUsd: null, realizedPct: null, winRate: null, trades: 0, tokensTraded: 0, top: [] };
  const usd = n(s.realized_pnl_usd);
  const pct = n(s.realized_pnl_percent);
  const trades = int(s.traded_times);
  // Nansen reports win_rate 0 and pnl 0 for a wallet with no sales in the window — that is "no data", not "lost every trade"
  return {
    ok: true,
    realizedUsd: usd === null ? null : r0(usd),
    realizedPct: pct === null || trades === 0 ? null : r3(pct),
    winRate: n(s.win_rate) === null || trades === 0 ? null : r3(n(s.win_rate)!),
    trades,
    tokensTraded: int(s.traded_token_count),
    top: (s.top5_tokens ?? []).slice(0, 5).map((t) => ({
      symbol: (t.token_symbol ?? "?").slice(0, 12),
      roi: n(t.realized_roi) === null ? null : r3(n(t.realized_roi)!),
      pnlUsd: n(t.realized_pnl) === null ? null : r0(n(t.realized_pnl)!),
    })),
  };
}

export function extractTrades(
  rows:
    | { token_symbol?: string | null; pnl_usd_realised?: number | null; nof_buys?: string | number | null; nof_sells?: string | number | null }[]
    | null
    | undefined,
  ok = true,
): Clues["trades"] {
  if (!ok || !rows) return { ok: false, rows: [] };
  return {
    ok: true,
    rows: rows.slice(0, 5).map((r) => ({
      symbol: (r.token_symbol ?? "?").slice(0, 12),
      pnlUsd: n(r.pnl_usd_realised) === null ? null : r0(n(r.pnl_usd_realised)!),
      buys: int(r.nof_buys),
      sells: int(r.nof_sells),
    })),
  };
}

export function extractBalance(
  rows: { token_symbol?: string | null; value_usd?: number | null }[] | null | undefined,
  isLastPage: boolean | undefined,
  ok = true,
): Clues["balance"] {
  if (!ok || !rows) return { ok: false, tokens: 0, tokensCapped: false, totalUsd: 0, topShare: null, topSymbol: null, stableShare: null };
  const vals = rows.map((r) => ({ sym: (r.token_symbol ?? "").toUpperCase(), usd: Math.max(0, n(r.value_usd) ?? 0) }));
  const total = vals.reduce((a, v) => a + v.usd, 0);
  const top = vals.reduce<{ sym: string; usd: number } | null>((a, v) => (a === null || v.usd > a.usd ? v : a), null);
  const stable = vals.filter((v) => STABLECOINS.has(v.sym)).reduce((a, v) => a + v.usd, 0);
  return {
    ok: true,
    tokens: rows.length,
    tokensCapped: isLastPage === false,
    totalUsd: r0(total),
    topShare: total > 0 && top ? r3(top.usd / total) : null,
    topSymbol: top && top.usd > 0 ? top.sym.slice(0, 12) : null,
    stableShare: total > 0 ? r3(stable / total) : null,
  };
}

export function extractCounterparties(
  rows:
    | { counterparty_address_label?: string[] | null; interaction_count?: number | null; total_volume_usd?: number | null; volume_out_usd?: number | null }[]
    | null
    | undefined,
  isLastPage: boolean | undefined,
  ok = true,
): Clues["counterparties"] {
  if (!ok || !rows) return { ok: false, count: 0, countCapped: false, interactions: 0, topOutShare: null, mix: zeroMix(), counts: zeroMix() };
  const mix = zeroMix();
  const counts = zeroMix();
  let totalVol = 0,
    totalOut = 0,
    maxOut = 0,
    interactions = 0;
  for (const r of rows) {
    const cls = counterpartyClass(r.counterparty_address_label);
    const vol = Math.max(0, n(r.total_volume_usd) ?? 0);
    const out = Math.max(0, n(r.volume_out_usd) ?? 0);
    counts[cls] += 1;
    mix[cls] += vol;
    totalVol += vol;
    totalOut += out;
    if (out > maxOut) maxOut = out;
    interactions += int(r.interaction_count);
  }
  // volume share when volumes exist, else count share — so a wallet whose volumes are all null still gets a mix
  for (const k of MIX_KEYS) mix[k] = r3(totalVol > 0 ? mix[k] / totalVol : rows.length ? counts[k] / rows.length : 0);
  return {
    ok: true,
    count: rows.length,
    countCapped: isLastPage === false,
    interactions,
    topOutShare: totalOut > 0 ? r3(maxOut / totalOut) : null,
    mix,
    counts,
  };
}

/** true when every clue call failed — there is no card to read, only an error to show */
export function allFailed(c: Clues): boolean {
  return !c.pnl.ok && !c.trades.ok && !c.balance.ok && !c.counterparties.ok;
}

export type ClueFailure = { section: "pnl" | "trades" | "balance" | "counterparties"; error: string };

/**
 * The four clue calls for one wallet, in parallel (8 credits live, 0 cached). A failed call degrades its section
 * (`ok: false`) and is reported in `failures` — the card is still a card, and the failure shows in provenance.
 */
export async function fetchClues(c: NansenClient, address: string, now: number): Promise<{ clues: Clues; failures: ClueFailure[] }> {
  const [ps, pn, ba, cp] = await Promise.allSettled([
    nansen.pnlSummary(c, address, now),
    nansen.pnl(c, address, now),
    nansen.balance(c, address),
    nansen.counterparties(c, address, now),
  ]);
  const failures: ClueFailure[] = [];
  const err = (e: unknown) => (e instanceof Error ? e.message.slice(0, 160) : String(e));
  if (ps.status === "rejected") failures.push({ section: "pnl", error: err(ps.reason) });
  if (pn.status === "rejected") failures.push({ section: "trades", error: err(pn.reason) });
  if (ba.status === "rejected") failures.push({ section: "balance", error: err(ba.reason) });
  if (cp.status === "rejected") failures.push({ section: "counterparties", error: err(cp.reason) });
  const pnl = extractPnl(ps.status === "fulfilled" ? ps.value : undefined);
  const trades = extractTrades(pn.status === "fulfilled" ? pn.value.data : undefined, pn.status === "fulfilled");
  const balance = extractBalance(
    ba.status === "fulfilled" ? ba.value.data : undefined,
    ba.status === "fulfilled" ? ba.value.pagination?.is_last_page : undefined,
    ba.status === "fulfilled",
  );
  const counterparties = extractCounterparties(
    cp.status === "fulfilled" ? cp.value.data : undefined,
    cp.status === "fulfilled" ? cp.value.pagination?.is_last_page : undefined,
    cp.status === "fulfilled",
  );
  const empty = pnl.trades === 0 && trades.rows.length === 0 && balance.tokens === 0 && counterparties.count === 0;
  return { clues: { pnl, trades, balance, counterparties, empty }, failures };
}
