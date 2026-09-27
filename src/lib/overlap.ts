// Overlap: the user's own open Hyperliquid positions, matched against the Nansen-labeled
// wallets holding the same coin and side, so "who else is in this trade" is a single call.
// No wallet reports are built here - the UI opens /api/wallet/[addr] per companion on demand,
// which is already cached.
import { attachMarkPrices, fetchClearinghouseState } from "./hyperliquid";
import { fetchAddressLabels, fetchTgmPerpPositions, type RawCompanion } from "./nansen";
import type { Companion, OverlapRow } from "./types";

const MAX_COMPANIONS = 5;
const MIN_SMART_MONEY = 2; // below this, top up with whale (a paid call) so the row isn't sparse
const FETCH_COMPANIONS = MAX_COMPANIONS + 3; // buffer: excluding the user should still leave 5

// profiler/address/labels is a per-address call, so cap how many a single /api/overlap request
// will pay for even if several rows each have junk-labeled companions.
const MAX_LABEL_LOOKUPS_PER_REQUEST = 5;

const REFERRAL_LABEL = /^Uses ".*" HL Referral Code$/;
const DISPLAY_KEYWORDS = ["Smart", "Fund", "Legend", "Whale", "Position Trader"];

/** A leaderboard label that says nothing about why the wallet matters. */
function isJunkLabel(label: string | null): boolean {
  return label === null || label === "High Balance" || REFERRAL_LABEL.test(label);
}

function fallbackDisplayLabel(cohort: RawCompanion["cohort"]): string {
  if (cohort === "whale") return "Whale";
  if (cohort === "public_figure") return "Public figure";
  return "Smart Money wallet";
}

/** Picks the best label for why this wallet matters. A non-junk leaderboard label is used as-is.
 * A junk one (referral code, "High Balance") is worth a real address/labels lookup, budget
 * permitting: prefers a label naming what kind of trader this is, else a cohort-based fallback. */
async function resolveDisplayLabel(c: RawCompanion, lookupBudget: { left: number }): Promise<string> {
  if (!isJunkLabel(c.label)) return c.label as string;
  if (lookupBudget.left <= 0) return fallbackDisplayLabel(c.cohort);
  lookupBudget.left -= 1;
  const { data: labels } = await fetchAddressLabels(c.address);
  const preferred = labels.find((l) => DISPLAY_KEYWORDS.some((kw) => l.label.includes(kw)));
  return preferred?.label ?? fallbackDisplayLabel(c.cohort);
}

export async function buildOverlap(address: string): Promise<OverlapRow[]> {
  const positions = await fetchClearinghouseState(address);
  const withMarks = await attachMarkPrices(positions);
  const lower = address.toLowerCase();
  const lookupBudget = { left: MAX_LABEL_LOOKUPS_PER_REQUEST }; // shared across all rows in this request

  return Promise.all(
    withMarks.map(async (p): Promise<OverlapRow> => {
      const side = p.direction === "long" ? "Long" : "Short";
      const { data: smartMoney } = await fetchTgmPerpPositions(p.coin, side, "smart_money", FETCH_COMPANIONS);
      let companions = smartMoney.filter((c) => c.address.toLowerCase() !== lower);

      if (companions.length < MIN_SMART_MONEY) {
        const { data: whales } = await fetchTgmPerpPositions(p.coin, side, "whale", FETCH_COMPANIONS);
        const seen = new Set(companions.map((c) => c.address.toLowerCase()));
        for (const w of whales) {
          const wLower = w.address.toLowerCase();
          if (wLower === lower || seen.has(wLower)) continue;
          seen.add(wLower);
          companions.push(w);
        }
      }

      companions = companions.slice(0, MAX_COMPANIONS);
      const withLabels: Companion[] = await Promise.all(
        companions.map(async (c) => ({ ...c, displayLabel: await resolveDisplayLabel(c, lookupBudget) })),
      );

      return {
        coin: p.coin,
        direction: p.direction,
        size: p.size,
        entryPx: p.entryPx,
        markPx: p.markPx,
        companions: withLabels,
      };
    }),
  );
}
