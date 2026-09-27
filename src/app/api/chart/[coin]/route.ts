import { NextResponse } from "next/server";
import { bandsFromReduces, fillToMarker, smTradeToMarker, tfConfig, valueWeightedEntry, type ChartMarker, type ChartResponse } from "@/lib/chart";
import { loadFills } from "@/lib/fills-store";
import { fetchCandles, fetchClearinghouseState } from "@/lib/hyperliquid";
import { fetchSmartMoneyPerpTrades, fetchTgmPerpPositions } from "@/lib/nansen";
import type { Direction, OpenPosition } from "@/lib/types";

/** Same (lookback_hours, per_page) the home feed and candidates rails already call, so this
 * almost always hits nansen.ts's cache instead of spending a Nansen call for the chart. */
async function loadSmartMoneyMarkers(coin: string): Promise<ChartMarker[]> {
  try {
    const { data } = await fetchSmartMoneyPerpTrades(24, 50);
    return data.filter((t) => t.coin.toUpperCase() === coin.toUpperCase()).map(smTradeToMarker);
  } catch {
    // Nansen out of credits/timed out and nothing cached for this call shape: render with
    // whatever else the chart has rather than fail the whole panel.
    return [];
  }
}

/** yourEntry/yourSize (free, Hyperliquid) plus, budget permitting, the value-weighted Smart
 * Money entry and the companions' own stored fills as extra markers (no new Nansen call: reads
 * whatever fills-store already has from a prior wallet report). */
interface YourSide {
  yourEntry?: number;
  yourSize?: number;
  yourDirection?: Direction;
  smAvgEntry?: number;
  companionMarkers: ChartMarker[];
}

async function loadYourSide(address: string, coin: string): Promise<YourSide> {
  let position: OpenPosition | undefined;
  try {
    const positions = await fetchClearinghouseState(address);
    position = positions.find((p) => p.coin.toUpperCase() === coin.toUpperCase());
  } catch {
    return { companionMarkers: [] };
  }
  if (!position) return { companionMarkers: [] };

  const out: YourSide = {
    yourEntry: position.entryPx,
    yourSize: position.size,
    yourDirection: position.direction,
    companionMarkers: [],
  };

  // The viewed address's own fill history on this coin, e.g. the /w page's "with that wallet's
  // own fills as markers". Local cache only, so it renders even with Nansen fully out of credits.
  const own = await loadFills(address);
  if (own) {
    for (const f of own.fills) {
      if (f.coin.toUpperCase() !== coin.toUpperCase()) continue;
      out.companionMarkers.push(fillToMarker(f, address, "You"));
    }
  }

  try {
    const side = position.direction === "long" ? "Long" : "Short";
    const { data: companions } = await fetchTgmPerpPositions(coin, side, "smart_money", 10);
    const others = companions.filter((c) => c.address.toLowerCase() !== address.toLowerCase());
    out.smAvgEntry = valueWeightedEntry(others) ?? undefined;
    for (const c of others) {
      const rec = await loadFills(c.address);
      if (!rec) continue;
      for (const f of rec.fills) {
        if (f.coin.toUpperCase() !== coin.toUpperCase()) continue;
        out.companionMarkers.push(fillToMarker(f, c.address, c.label ?? ""));
      }
    }
  } catch {
    // Smart Money side of the chart stays empty; yourEntry/yourSize still render.
  }
  return out;
}

export async function GET(req: Request, { params }: { params: Promise<{ coin: string }> }) {
  const { coin: coinParam } = await params;
  const coin = decodeURIComponent(coinParam);
  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  const cfg = tfConfig(url.searchParams.get("tf"));
  const endTime = Date.now();
  const startTime = endTime - cfg.rangeMs;

  const [candles, smFeedMarkers, yourSide] = await Promise.all([
    fetchCandles(coin, cfg.interval, startTime, endTime).catch(() => null),
    loadSmartMoneyMarkers(coin),
    address ? loadYourSide(address, coin) : Promise.resolve<YourSide>({ companionMarkers: [] }),
  ]);

  const smFills = [...smFeedMarkers, ...yourSide.companionMarkers].sort((a, b) => a.t - b.t);
  const body: ChartResponse = {
    candles: candles ?? [],
    smFills,
    ...(yourSide.yourEntry !== undefined ? { yourEntry: yourSide.yourEntry } : {}),
    ...(yourSide.yourSize !== undefined ? { yourSize: yourSide.yourSize } : {}),
    ...(yourSide.yourDirection !== undefined ? { yourDirection: yourSide.yourDirection } : {}),
    ...(yourSide.smAvgEntry !== undefined ? { smAvgEntry: yourSide.smAvgEntry } : {}),
    windows: bandsFromReduces(smFills, coin, candles ?? []),
  };
  return NextResponse.json(body);
}
