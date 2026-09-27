import { isPoolTag, type LabelClass } from "./classes.js";
import type { Clues } from "./clues.js";

import { fmtUsd, pct } from "./format.js";
export { fmtUsd, pct };
const plus = (n: number, capped: boolean) => `${n}${capped ? "+" : ""}`;

/** One line, written from the card's own numbers, that says why the label fits. Deterministic — part of the card hash. */
export function tell(cls: LabelClass, c: Clues, tag = "", entity: string | null = null): string {
  const b = c.balance,
    p = c.pnl,
    k = c.counterparties;
  const dex = Math.min(1, k.mix.pool + k.mix.activity);
  switch (cls) {
    case "exchange":
      return `${plus(b.tokens, b.tokensCapped)} tokens worth ${fmtUsd(b.totalUsd)} · ${plus(k.count, k.countCapped)} counterparties in 30 d, ${pct(k.mix.wealth + k.mix.entity)} of that volume with wealth-tagged or exchange wallets · ${p.trades} DEX trades — money moves in and out, nobody is trading: an exchange wallet`;
    case "whale":
      // REGRESSION (audit 2026-09-19): a wealth-tagged wallet with hundreds of trades is not "sitting still" — say what the numbers say
      return `${b.topSymbol ? `${b.topSymbol} is ` : "one position is "}${pct(b.topShare)} of a ${fmtUsd(b.totalUsd)} balance · ${p.trades} trades · ${plus(k.count, k.countCapped)} counterpart${k.count === 1 ? "y" : "ies"} in 30 d — ${p.trades > 10 ? "a big holder that also trades: a whale by balance, not by behaviour" : "a big holder sitting still: a whale"}`;
    case "smart-money":
      if (p.trades < 5)
        return `${p.trades} trade${p.trades === 1 ? "" : "s"} in 30 d · ${plus(b.tokens, b.tokensCapped)} tokens worth ${fmtUsd(b.totalUsd)} · ${k.count} counterpart${k.count === 1 ? "y" : "ies"} — Nansen tracks this wallet as Smart Money for its record; this month it sat still`;
      return `${p.trades} trades in 30 d · win rate ${pct(p.winRate)} · realised ${p.realizedUsd === null ? "—" : fmtUsd(p.realizedUsd)} across ${p.tokensTraded} tokens · ${pct(dex)} of flow through DEX pools and routers — a trader Nansen tracks as Smart Money`;
    case "contract":
      if (isPoolTag(entity) || isPoolTag(tag))
        return `${k.interactions.toLocaleString("en-US")} interactions from ${plus(k.count, k.countCapped)} counterparties in 30 d · ${plus(b.tokens, b.tokensCapped)} tokens${b.topShare !== null && b.topShare < 0.7 ? ` split ${pct(b.topShare)} / ${pct(1 - b.topShare)}` : ""} · no trades of its own — traffic without a trader: a liquidity pool`;
      return `${plus(b.tokens, b.tokensCapped)} tokens worth ${fmtUsd(b.totalUsd)} · ${p.trades} trade${p.trades === 1 ? "" : "s"} · ${k.count} counterpart${k.count === 1 ? "y" : "ies"} in 30 d${k.topOutShare !== null ? `, ${pct(k.topOutShare)} of outflow to one of them` : ""} — code with signers, not a person: a ${tag || "contract"}`;
    case "regular":
      return `${p.trades} trade${p.trades === 1 ? "" : "s"} · ${plus(b.tokens, b.tokensCapped)} token${b.tokens === 1 ? "" : "s"} worth ${fmtUsd(b.totalUsd)} · ${k.count} counterpart${k.count === 1 ? "y" : "ies"} in 30 d — none of Nansen's label groups: a regular wallet`;
    case "public-figure":
      return `a person, not a pattern — Nansen's Public Figure label`;
  }
}
