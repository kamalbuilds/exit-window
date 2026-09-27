// Overlap: the user's own open Hyperliquid positions, matched against the Nansen-labeled
// wallets holding the same coin and side, so "who else is in this trade" is a single call.
// No wallet reports are built here - the UI opens /api/wallet/[addr] per companion on demand,
// which is already cached.
import { attachMarkPrices, fetchClearinghouseState } from "./hyperliquid";
import { fetchTgmPerpPositions } from "./nansen";
import type { OverlapRow } from "./types";

const MAX_COMPANIONS = 5;
const FETCH_COMPANIONS = MAX_COMPANIONS + 3; // buffer: excluding the user should still leave 5

export async function buildOverlap(address: string): Promise<OverlapRow[]> {
  const positions = await fetchClearinghouseState(address);
  const withMarks = await attachMarkPrices(positions);
  const lower = address.toLowerCase();

  return Promise.all(
    withMarks.map(async (p): Promise<OverlapRow> => {
      const side = p.direction === "long" ? "Long" : "Short";
      const { data } = await fetchTgmPerpPositions(p.coin, side, FETCH_COMPANIONS);
      const companions = data.filter((c) => c.address.toLowerCase() !== lower).slice(0, MAX_COMPANIONS);
      return {
        coin: p.coin,
        direction: p.direction,
        size: p.size,
        entryPx: p.entryPx,
        markPx: p.markPx,
        companions,
      };
    }),
  );
}
