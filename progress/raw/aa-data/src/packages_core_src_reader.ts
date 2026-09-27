import type { LabelClass } from "./classes.js";
import type { Clues } from "./clues.js";

/**
 * The house reader: a deterministic rule that guesses the class from the cheap clues alone — the spike's "tell per
 * class" made testable. Thresholds live in one object so docs/RULES.md can quote them; `npm run reader` prints its
 * accuracy and confusion matrix on the committed deck. It is a bar for the player, not an oracle.
 */
export const READER = {
  /** a pool: traffic without a trader, and few tokens (a two-sided pool holds two) — exchange hot wallets have traffic AND 20–100 tokens */
  contract: { minInteractions: 2000, interactionsPerCounterparty: 20, maxTokens: 20 },
  /** an exchange: big, many tokens, no DEX trades; either its counterparties are wealth-tagged/exchange wallets or it simply holds 50+ tokens */
  exchange: { minUsd: 10_000_000, maxTrades: 5, minTokens: 15, minWealthMix: 0.5, manyTokens: 50 },
  /** a whale: one position is most of a $1M+ balance and it barely trades */
  whale: { minUsd: 1_000_000, minTopShare: 0.8, maxTrades: 10 },
  /** Smart Money (active): many trades across many tokens in 30 days — win rate and sign of PnL do NOT separate it from a regular buyer on this deck */
  smartMoney: { minTrades: 25, minTokensTraded: 6 },
} as const;

export type Read = { guess: LabelClass; because: string };

export function read(c: Clues): Read {
  const b = c.balance,
    p = c.pnl,
    k = c.counterparties;
  const R = READER;
  const perCp = k.count > 0 ? k.interactions / k.count : 0;
  const traffic = k.interactions >= R.contract.minInteractions || (k.countCapped && perCp >= R.contract.interactionsPerCounterparty);
  if (traffic && b.tokens < R.contract.maxTokens)
    return {
      guess: "contract",
      because: `${k.interactions} interactions from ${k.count}${k.countCapped ? "+" : ""} counterparties and only ${b.tokens} tokens — traffic, not trading`,
    };
  const wealthy = k.mix.wealth + k.mix.entity;
  if (
    b.totalUsd >= R.exchange.minUsd &&
    p.trades <= R.exchange.maxTrades &&
    ((b.tokens >= R.exchange.minTokens && wealthy >= R.exchange.minWealthMix) || b.tokens >= R.exchange.manyTokens)
  )
    return {
      guess: "exchange",
      because: `${b.tokens}${b.tokensCapped ? "+" : ""} tokens, $${Math.round(b.totalUsd / 1e6)}M, ${Math.round(wealthy * 100)}% wealth-tagged counterparties, ${p.trades} trades`,
    };
  if (b.totalUsd >= R.whale.minUsd && (b.topShare ?? 0) >= R.whale.minTopShare && p.trades <= R.whale.maxTrades)
    return {
      guess: "whale",
      // topShare is guaranteed non-null here: the guard above only passes when (topShare ?? 0) >= minTopShare (0.8),
      // and 0 never clears that bar, so a null topShare could never have reached this branch.
      because: `one position is ${Math.round(b.topShare! * 100)}% of $${Math.round(b.totalUsd / 1e6)}M and only ${p.trades} trades`,
    };
  if (p.trades >= R.smartMoney.minTrades && p.tokensTraded >= R.smartMoney.minTokensTraded)
    return { guess: "smart-money", because: `${p.trades} trades across ${p.tokensTraded} tokens in 30 days — an active multi-token trader` };
  return { guess: "regular", because: `${p.trades} trades, ${b.tokens} tokens, $${b.totalUsd} — nothing that reads like a label` };
}
