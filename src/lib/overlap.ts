// Overlap: the user's own open Hyperliquid positions, matched against the Nansen-labeled
// wallets holding the same coin and side, so "who else is in this trade" is a single call.
// No wallet reports are built here - the UI opens /api/wallet/[addr] per companion on demand,
// which is already cached.
import { attachMarkPrices, dexPrefix, fetchClearinghouseState, fetchMidsForDex, fetchPositionOnCoin } from "./hyperliquid";
import { holdersFromSnapshot, readSnapshot } from "./sentinel";
import { fetchAddressLabels, fetchTgmPerpPositions, findAnyAgeCache, NansenCreditsError, type RawCompanion } from "./nansen";
import type { Companion, OpenPosition, OverlapRow } from "./types";

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
  try {
    const { data: labels } = await fetchAddressLabels(c.address);
    const preferred = labels.find((l) => DISPLAY_KEYWORDS.some((kw) => l.label.includes(kw)));
    return preferred?.label ?? fallbackDisplayLabel(c.cohort);
  } catch (err) {
    if (!(err instanceof NansenCreditsError)) throw err;
    return fallbackDisplayLabel(c.cohort);
  }
}

/** tgm/perp-positions has no address in its key, just (coin, label_type, side) - point-in-time,
 * not date-scoped - so nansenCall's own exact-key stale fallback already covers "any age" for a
 * request shape it's seen before. When even that has nothing (this exact coin/side/labelType
 * combo was never cached), fall back to the newest cached response for that same combo under
 * any request the call log remembers; and if there's truly none, an empty companion list rather
 * than failing the whole overlap row. */
async function fetchCompanionsDegradeAware(
  coin: string,
  side: "Long" | "Short",
  labelType: "smart_money" | "whale",
): Promise<RawCompanion[]> {
  try {
    const { data } = await fetchTgmPerpPositions(coin, side, labelType, FETCH_COMPANIONS);
    return data;
  } catch (err) {
    if (!(err instanceof NansenCreditsError)) throw err;
    const fallback = await findAnyAgeCache<RawCompanion[]>(
      "tgm/perp-positions",
      (s) => s.tokenSymbol === coin && s.side === side && s.labelType === labelType,
      (s) =>
        typeof s.tokenSymbol === "string" && typeof s.side === "string" && typeof s.labelType === "string"
          ? {
              token_symbol: s.tokenSymbol,
              label_type: s.labelType,
              pagination: { page: 1, per_page: FETCH_COMPANIONS },
              filters: { side: s.side },
              order_by: [{ field: "position_value_usd", direction: "DESC" }],
            }
          : null,
    );
    if (fallback?.data.length) return fallback.data;
    if (labelType !== "smart_money") return [];
    // Never cached: the sentinel's last sweep of the Nansen-labeled watchlist, read live from Hyperliquid.
    const snapshot = await readSnapshot();
    if (!snapshot) return [];
    const markPx = (await fetchMidsForDex(dexPrefix(coin)).catch(() => ({}) as Record<string, number>))[coin] ?? null;
    return holdersFromSnapshot(snapshot, coin, side === "Long" ? "long" : "short", markPx, FETCH_COMPANIONS).map((h) => ({
      ...h,
      cohort: "smart_money" as const,
    }));
  }
}

const SNAPSHOT_FRESH_MS = 90_000; // the sentinel sweeps the main dex every 60s
const LIVE_TTL_MS = 30_000;
const liveCache = new Map<string, { at: number; pos: Promise<OpenPosition | null> }>();

/** One Hyperliquid read per wallet+coin per 30s, shared across concurrent overlap requests. */
function cachedPositionOnCoin(address: string, coin: string): Promise<OpenPosition | null> {
  const key = `${address.toLowerCase()}|${coin}`;
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.pos;
  const pos = fetchPositionOnCoin(address, coin);
  liveCache.set(key, { at: Date.now(), pos });
  pos.catch(() => liveCache.delete(key));
  return pos;
}

/** Nansen says who is in the trade; Hyperliquid, the system of record, says where each one gets
 * force-closed right now and whether it is still in at all. A wallet the sentinel swept under 90s
 * ago on the main dex is answered from that sweep (no call); anyone else is read live, cached 30s. */
async function livePosition(
  address: string,
  coin: string,
  direction: OpenPosition["direction"],
  swept: Map<string, OpenPosition[]> | null,
): Promise<Pick<Companion, "liquidationPx" | "stillOpen">> {
  try {
    const known = dexPrefix(coin) === "" ? swept?.get(address.toLowerCase()) : undefined;
    const pos = known ? (known.find((p) => p.coin === coin) ?? null) : await cachedPositionOnCoin(address, coin);
    if (!pos || pos.direction !== direction) return { liquidationPx: null, stillOpen: false };
    return { liquidationPx: pos.liquidationPx, stillOpen: true };
  } catch {
    return { liquidationPx: null, stillOpen: null };
  }
}

export async function buildOverlap(address: string): Promise<OverlapRow[]> {
  const positions = await fetchClearinghouseState(address);
  const withMarks = await attachMarkPrices(positions);
  const lower = address.toLowerCase();
  const lookupBudget = { left: MAX_LABEL_LOOKUPS_PER_REQUEST }; // shared across all rows in this request
  const snapshot = await readSnapshot();
  const swept =
    snapshot && Date.now() - snapshot.at < SNAPSHOT_FRESH_MS
      ? new Map(snapshot.wallets.map((w) => [w.address.toLowerCase(), w.positions]))
      : null;

  return Promise.all(
    withMarks.map(async (p): Promise<OverlapRow> => {
      const side = p.direction === "long" ? "Long" : "Short";
      const smartMoney = await fetchCompanionsDegradeAware(p.coin, side, "smart_money");
      let companions = smartMoney.filter((c) => c.address.toLowerCase() !== lower);

      if (companions.length < MIN_SMART_MONEY) {
        const whales = await fetchCompanionsDegradeAware(p.coin, side, "whale");
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
        companions.map(async (c) => ({
          ...c,
          displayLabel: await resolveDisplayLabel(c, lookupBudget),
          ...(await livePosition(c.address, p.coin, p.direction, swept)),
        })),
      );

      return {
        coin: p.coin,
        direction: p.direction,
        size: p.size,
        entryPx: p.entryPx,
        markPx: p.markPx,
        liquidationPx: p.liquidationPx,
        companions: withLabels,
      };
    }),
  );
}
