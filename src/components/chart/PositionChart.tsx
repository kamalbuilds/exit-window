"use client";

import {
  createChart,
  CandlestickSeries,
  ColorType,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartMarker, ChartResponse, MinSizeFilter, WindowBand } from "@/lib/chart";
import { bubbleSize, clusterBubbles, passesMinSize } from "@/lib/chart";
import type { Candle } from "@/lib/hyperliquid";
import { formatDate, formatUsd, shortAddr, walletLabel } from "@/components/format";
import { TokenCell } from "@/components/TokenIcon";
import { WalletAvatar, avatarBackground } from "@/components/WalletAvatar";
import { usePoll } from "@/components/usePoll";

const TIMEFRAMES = ["1h", "4h", "1d", "7d"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const THEME = {
  background: "#11181f",
  grid: "#222d38",
  text: "#a3adb6",
  up: "#3fd49a",
  down: "#f0616d",
  entryRing: "#7c8892",
};

const MIN_SIZE_OPTIONS: { value: MinSizeFilter; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "1k", label: ">$1K" },
  { value: "10k", label: ">$10K" },
  { value: "100k", label: ">$100K" },
];

function toUTC(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

/** Bubbles and bands must land on a real bar or the plugin drops them; snap to the candle that
 * was open at the fill's time. */
function snapToCandle(candles: Candle[], t: number): number | null {
  if (candles.length === 0) return null;
  if (t <= candles[0].t) return candles[0].t;
  let best: number | null = null;
  for (const c of candles) {
    if (c.t > t) break;
    best = c.t;
  }
  return best ?? candles[candles.length - 1].t;
}

/** A tracked Smart Money wallet in the user's trade, passed in by the page. */
export interface ChartWallet {
  address: string;
  label: string;
  cohort?: string;
  positionValueUsd?: number;
  entryPx?: number;
  /** Live from Hyperliquid clearinghouseState; null/undefined = no liquidation price or unread. */
  liquidationPx?: number | null;
}

interface Overlays {
  youLine: boolean;
  smLine: boolean;
  buys: boolean;
  sells: boolean;
  windows: boolean;
  liqs: boolean;
}

/** Reads a DESIGN.md colour token from the live stylesheet; falls back to THEME's hardcoded hex
 * (matches DESIGN.md too) when the token isn't there, e.g. in a test environment without CSS. */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** "#rrggbb" -> "rgba(r, g, b, alpha)"; the token values in globals.css are always plain hex. */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface Props {
  coin: string;
  address?: string;
  height?: number;
  /** Value-weighted Smart Money entry known by the page (overlap data); wins over the API's. */
  smAvgEntry?: number | null;
  /** Smart Money wallets in this trade; each becomes fill bubbles, an entry-price avatar pinned
   * on the axis, and a toggle chip in the legend below the chart. */
  wallets?: ChartWallet[];
  /** Wallets hidden by the page itself (e.g. an already-muted wallet); merges with the chart's
   * own per-wallet legend toggle. */
  hiddenWallets?: string[];
  /** The price-line label for the viewed position: "You" on /me, "This wallet" on /w. */
  entryLabel?: string;
  /** The user's own liquidation price (OverlapRow.liquidationPx); drawn as a solid "You liq." line. */
  youLiquidationPx?: number | null;
}

/** "You vs Smart Money": a live candlestick chart for one coin with the user's entry, the
 * value-weighted Smart Money entry, Smart Money fills as avatar bubbles (fomo.xyz-style, sized
 * by USD and colored by buy/sell) instead of text markers, each tracked wallet's entry pinned on
 * the price axis, and a shaded band after each Smart Money reduce for as long as the exit window
 * stayed open. */
export function PositionChart({
  coin,
  address,
  height = 360,
  smAvgEntry: smAvgProp,
  wallets,
  hiddenWallets,
  entryLabel = "You",
  youLiquidationPx,
}: Props) {
  const [tf, setTf] = useState<Timeframe>("1d");
  const [overlays, setOverlays] = useState<Overlays>({ youLine: true, smLine: true, buys: true, sells: true, windows: true, liqs: true });
  const [minSize, setMinSize] = useState<MinSizeFilter>("any");
  const [localToggled, setLocalToggled] = useState<Set<string>>(() => new Set());

  const url = useMemo(() => {
    const q = new URLSearchParams({ tf });
    if (address) q.set("address", address);
    return `/api/chart/${encodeURIComponent(coin)}?${q.toString()}`;
  }, [coin, address, tf]);
  const { data, error } = usePoll<ChartResponse>(url, 15_000);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bandsRef = useRef<HTMLDivElement | null>(null);
  const bubblesRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const youLineRef = useRef<IPriceLine | null>(null);
  const smLineRef = useRef<IPriceLine | null>(null);
  const youLiqLineRef = useRef<IPriceLine | null>(null);
  // One dashed price line per wallet with a live liquidation price, keyed by lowercased address.
  const liqLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  const bandsDataRef = useRef<{ candles: Candle[]; windows: WindowBand[] }>({ candles: [], windows: [] });
  const bubbleDataRef = useRef<{ candles: Candle[]; fills: ChartMarker[]; wallets: ChartWallet[]; liqWallets: ChartWallet[] }>({
    candles: [],
    fills: [],
    wallets: [],
    liqWallets: [],
  });
  const fittedTfRef = useRef<Timeframe | null>(null);
  // Price lines do not take part in autoscale; the provider below reads these so both stay in view.
  const linesRef = useRef<number[]>([]);

  // hiddenWallets (the page's own hidden list) XOR the chart's local legend toggle: toggling a
  // wallet that's hidden by the page shows it again, toggling a visible one hides it.
  const hiddenSet = useMemo(() => {
    const s = new Set((hiddenWallets ?? []).map((a) => a.toLowerCase()));
    for (const a of localToggled) {
      if (s.has(a)) s.delete(a);
      else s.add(a);
    }
    return s;
  }, [hiddenWallets, localToggled]);

  const toggleWallet = useCallback((addr: string) => {
    const a = addr.toLowerCase();
    setLocalToggled((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
  }, []);

  const filteredFills = useMemo(() => {
    if (!data) return [];
    return data.smFills.filter((m) => {
      if (hiddenSet.has(m.address.toLowerCase())) return false;
      if (!passesMinSize(m.usd, minSize)) return false;
      const isAdd = m.action === "Open" || m.action === "Add";
      if (isAdd && !overlays.buys) return false;
      if (!isAdd && !overlays.sells) return false;
      return true;
    });
  }, [data, overlays.buys, overlays.sells, minSize, hiddenSet]);

  const filteredWallets = useMemo(
    () => (wallets ?? []).filter((w) => w.entryPx && w.entryPx > 0 && !hiddenSet.has(w.address.toLowerCase())),
    [wallets, hiddenSet],
  );

  const filteredLiqWallets = useMemo(
    () =>
      overlays.liqs
        ? (wallets ?? []).filter((w) => w.liquidationPx && w.liquidationPx > 0 && !hiddenSet.has(w.address.toLowerCase()))
        : [],
    [wallets, hiddenSet, overlays.liqs],
  );

  // Chart is created once per mount and torn down on unmount; coin/tf changes update data in
  // place so panning and zoom survive a live refresh.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const liqLines = liqLinesRef.current;
    const chart = createChart(el, {
      height,
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: THEME.background }, textColor: THEME.text },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      rightPriceScale: { borderColor: THEME.grid },
      timeScale: { borderColor: THEME.grid },
      crosshair: { vertLine: { color: THEME.grid }, horzLine: { color: THEME.grid } },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: THEME.up,
      downColor: THEME.down,
      borderUpColor: THEME.up,
      borderDownColor: THEME.down,
      wickUpColor: THEME.up,
      wickDownColor: THEME.down,
      // The built-in last-value line/label would otherwise sit at the same spot as our own You /
      // Smart Money price lines and read as a third, unlabeled line.
      lastValueVisible: false,
      priceLineVisible: false,
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number }; margins?: unknown } | null) => {
        const r = original();
        const lines = linesRef.current;
        if (!r || lines.length === 0) return r;
        return {
          ...r,
          priceRange: {
            minValue: Math.min(r.priceRange.minValue, ...lines),
            maxValue: Math.max(r.priceRange.maxValue, ...lines),
          },
        };
      },
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const reposition = () => {
      renderBands(chart, bandsRef.current, bandsDataRef.current.candles, bandsDataRef.current.windows);
      renderBubbleLayer(
        chart,
        series,
        bubblesRef.current,
        bubbleDataRef.current.candles,
        bubbleDataRef.current.fills,
        bubbleDataRef.current.wallets,
        bubbleDataRef.current.liqWallets,
      );
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(reposition);
    chart.timeScale().subscribeSizeChange(reposition);

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      youLineRef.current = null;
      smLineRef.current = null;
      youLiqLineRef.current = null;
      liqLines.clear();
      fittedTfRef.current = null;
    };
  }, [coin, height]);

  // Data + filter updates: candles, price lines, exit-window bands, fill bubbles and entry
  // avatars. Runs on the initial load, every 15s live refresh, and every overlay/legend toggle,
  // without recreating the chart.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || !data) return;

    series.setData(
      data.candles.map((c) => ({ time: toUTC(c.t), open: c.o, high: c.h, low: c.l, close: c.c })),
    );

    const smAvg = smAvgProp ?? data.smAvgEntry ?? null;
    // A liquidation price only pulls the autoscale in when it's within 25% of the last close;
    // one far away (cross margin, low leverage) would otherwise squash the candles flat.
    const lastClose = data.candles.length > 0 ? data.candles[data.candles.length - 1].c : null;
    const nearLiqs =
      lastClose !== null
        ? [youLiquidationPx, ...filteredLiqWallets.map((w) => w.liquidationPx)].filter(
            (v): v is number => typeof v === "number" && v > 0 && Math.abs(v - lastClose) <= lastClose * 0.25,
          )
        : [];
    linesRef.current = [data.yourEntry, smAvg, ...nearLiqs].filter((v): v is number => typeof v === "number" && v > 0);

    if (data.yourEntry !== undefined) {
      const worse =
        smAvg != null
          ? data.yourDirection === "short"
            ? data.yourEntry < smAvg
            : data.yourEntry > smAvg
          : null;
      const color = worse === null ? THEME.text : worse ? THEME.down : THEME.up;
      const title = `${entryLabel} ${formatPrice(data.yourEntry)}${data.yourSize !== undefined ? ` · ${data.yourSize.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${coin}` : ""}`;
      if (youLineRef.current) youLineRef.current.applyOptions({ price: data.yourEntry, color, title, lineVisible: overlays.youLine, axisLabelVisible: overlays.youLine });
      else
        youLineRef.current = series.createPriceLine({
          price: data.yourEntry,
          color,
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: overlays.youLine,
          lineVisible: overlays.youLine,
          title,
        });
    } else if (youLineRef.current) {
      series.removePriceLine(youLineRef.current);
      youLineRef.current = null;
    }

    if (smAvg != null) {
      const title = `Smart Money avg ${formatPrice(smAvg)}`;
      if (smLineRef.current) smLineRef.current.applyOptions({ price: smAvg, title, lineVisible: overlays.smLine, axisLabelVisible: overlays.smLine });
      else
        smLineRef.current = series.createPriceLine({
          price: smAvg,
          color: THEME.text,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: overlays.smLine,
          lineVisible: overlays.smLine,
          title,
        });
    } else if (smLineRef.current) {
      series.removePriceLine(smLineRef.current);
      smLineRef.current = null;
    }

    const late = cssVar("--color-late", THEME.down);
    if (overlays.liqs && typeof youLiquidationPx === "number" && youLiquidationPx > 0) {
      const title = `You liq. ${formatPrice(youLiquidationPx)}`;
      if (youLiqLineRef.current) youLiqLineRef.current.applyOptions({ price: youLiquidationPx, title });
      else
        youLiqLineRef.current = series.createPriceLine({
          price: youLiquidationPx,
          color: late,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          lineVisible: true,
          title,
        });
    } else if (youLiqLineRef.current) {
      series.removePriceLine(youLiqLineRef.current);
      youLiqLineRef.current = null;
    }

    // Reconcile one dashed liquidation line per wallet: update in place, create for new
    // addresses, drop any whose wallet went hidden, closed, or lost its liquidation price.
    const liqColor = withAlpha(late, 0.6);
    const liqAddrs = new Set(filteredLiqWallets.map((w) => w.address.toLowerCase()));
    for (const w of filteredLiqWallets) {
      const addr = w.address.toLowerCase();
      const price = w.liquidationPx as number;
      const title = `${walletLabel(w.label, w.address)} liq`;
      const existing = liqLinesRef.current.get(addr);
      if (existing) existing.applyOptions({ price, title });
      else
        liqLinesRef.current.set(
          addr,
          series.createPriceLine({
            price,
            color: liqColor,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            lineVisible: true,
            title,
          }),
        );
    }
    for (const [addr, line] of liqLinesRef.current) {
      if (!liqAddrs.has(addr)) {
        series.removePriceLine(line);
        liqLinesRef.current.delete(addr);
      }
    }

    bandsDataRef.current = { candles: data.candles, windows: overlays.windows ? data.windows : [] };
    bubbleDataRef.current = { candles: data.candles, fills: filteredFills, wallets: filteredWallets, liqWallets: filteredLiqWallets };
    renderBands(chart, bandsRef.current, bandsDataRef.current.candles, bandsDataRef.current.windows);
    renderBubbleLayer(
      chart,
      series,
      bubblesRef.current,
      bubbleDataRef.current.candles,
      bubbleDataRef.current.fills,
      bubbleDataRef.current.wallets,
      bubbleDataRef.current.liqWallets,
    );

    if (fittedTfRef.current !== tf) {
      chart.timeScale().fitContent();
      fittedTfRef.current = tf;
    }
  }, [data, coin, tf, smAvgProp, entryLabel, overlays, filteredFills, filteredWallets, filteredLiqWallets, youLiquidationPx]);

  const gap =
    data?.yourEntry !== undefined && (smAvgProp ?? data?.smAvgEntry) != null
      ? ((data.yourEntry - (smAvgProp ?? data.smAvgEntry)!) / (smAvgProp ?? data.smAvgEntry)!) * 100 * (data.yourDirection === "short" ? -1 : 1)
      : null;

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-rule">
        <div className="flex items-center gap-3 min-w-0">
          <TokenCell coin={coin} />
          {data?.yourEntry !== undefined && (
            <span className={`fig text-[12px] ${gap === null ? "text-ink-2" : gap > 0.05 ? "text-late" : gap < -0.05 ? "text-lume" : "text-ink-2"}`}>
              {entryLabel} {formatPrice(data.yourEntry)}
            </span>
          )}
          {(smAvgProp ?? data?.smAvgEntry) != null && <span className="fig text-[12px] text-ink-2">Smart Money avg {formatPrice((smAvgProp ?? data?.smAvgEntry)!)}</span>}
        </div>
        <div className="flex items-center gap-1 bg-bezel rounded-lg p-1">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={`h-7 px-2.5 rounded-md text-[12px] transition-colors duration-150 ${
                t === tf ? "border border-rule text-accent" : "text-ink-3 hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="relative" style={{ height }}>
        {/* lightweight-charts sets explicit z-index (1/2) on its own internal canvases. Divs
         * below otherwise create no stacking context of their own, so those inline z-indexes
         * would escape this subtree and paint over the bands/bubbles regardless of DOM order;
         * giving each an explicit z-index here traps the chart's canvases inside its own context. */}
        <div ref={containerRef} className="absolute inset-0" style={{ zIndex: 0 }} />
        <div ref={bandsRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }} />
        <div ref={bubblesRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }} />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-dial">
            <p className="text-[13px] text-ink-2">Chart data for {coin} is still loading.</p>
          </div>
        )}
        {!error && data && data.candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-dial">
            <p className="text-[13px] text-ink-2">No price history for {coin} yet.</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 border-t border-rule">
        <span className="label">Chart overlays</span>
        <OverlayToggle checked={overlays.youLine} onChange={() => setOverlays((o) => ({ ...o, youLine: !o.youLine }))} label={entryLabel === "You" ? "My entry" : `${entryLabel} entry`} />
        <OverlayToggle checked={overlays.smLine} onChange={() => setOverlays((o) => ({ ...o, smLine: !o.smLine }))} label="Smart Money avg" />
        <OverlayToggle checked={overlays.buys} onChange={() => setOverlays((o) => ({ ...o, buys: !o.buys }))} label="Buys" />
        <OverlayToggle checked={overlays.sells} onChange={() => setOverlays((o) => ({ ...o, sells: !o.sells }))} label="Sells" />
        <OverlayToggle checked={overlays.windows} onChange={() => setOverlays((o) => ({ ...o, windows: !o.windows }))} label="Exit windows" />
        <OverlayToggle checked={overlays.liqs} onChange={() => setOverlays((o) => ({ ...o, liqs: !o.liqs }))} label="Liquidations" />
        <label className="flex items-center gap-1.5 text-[12px] text-ink-2 ml-auto">
          Min size
          <select
            value={minSize}
            onChange={(e) => setMinSize(e.target.value as MinSizeFilter)}
            className="bg-bezel border border-rule rounded-md text-[12px] text-ink px-1.5 py-1"
          >
            {MIN_SIZE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {wallets && wallets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-t border-rule">
          <span className="label mr-1">Wallets</span>
          {wallets.map((w) => {
            const visible = !hiddenSet.has(w.address.toLowerCase());
            return (
              <button
                key={w.address}
                onClick={() => toggleWallet(w.address)}
                aria-pressed={visible}
                aria-label={`${visible ? "Hide" : "Show"} ${walletLabel(w.label, w.address)} on the chart`}
                className={`chip chip-mute transition-opacity duration-150 motion-reduce:transition-none ${visible ? "" : "opacity-40"}`}
              >
                <WalletAvatar address={w.address} size={14} />
                <span className="truncate max-w-[110px]">{walletLabel(w.label, w.address)}</span>
                {w.positionValueUsd !== undefined && <span className="fig text-ink-3">{formatUsd(w.positionValueUsd)}</span>}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function OverlayToggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-ink-2 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-accent size-3.5 rounded-sm" />
      {label}
    </label>
  );
}

function formatPrice(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 4 : 2 });
}

/** Positions one translucent div per exit-window band using the chart's own time->x coordinate
 * mapping, so bands track panning and zoom without a custom chart primitive. timeToCoordinate
 * only maps times that land exactly on a bar, same as priceToCoordinate for bubbles below, so
 * both edges are snapped to a real candle first or they silently resolve to null and mis-render. */
function renderBands(chart: IChartApi, host: HTMLDivElement | null, candles: Candle[], windows: WindowBand[]) {
  if (!host) return;
  host.replaceChildren();
  if (candles.length === 0) return;
  const ts = chart.timeScale();
  for (const w of windows) {
    const from = snapToCandle(candles, w.from);
    const to = snapToCandle(candles, w.to);
    if (from === null || to === null) continue;
    const x0 = ts.timeToCoordinate(toUTC(from) as unknown as Time);
    const x1 = ts.timeToCoordinate(toUTC(to) as unknown as Time);
    if (x0 === null || x1 === null) continue;
    const left = x0;
    const right = x1;
    if (right <= left) continue;
    const band = document.createElement("div");
    band.className = "absolute top-0 h-full bg-window";
    band.style.left = `${left}px`;
    band.style.width = `${right - left}px`;
    host.appendChild(band);
  }
}

interface BubbleItem {
  marker: ChartMarker;
  x: number;
  y: number;
}

function representativeItem(items: BubbleItem[]): BubbleItem {
  return items.reduce((best, it) => (Math.abs(it.marker.usd) > Math.abs(best.marker.usd) ? it : best));
}

function bubbleAriaLabel(items: BubbleItem[]): string {
  const rep = representativeItem(items);
  const isAdd = rep.marker.action === "Open" || rep.marker.action === "Add";
  const label = walletLabel(rep.marker.label, rep.marker.address);
  const extra = items.length > 1 ? `, ${items.length} fills` : "";
  return `${label} ${isAdd ? "buy" : "sell"} ${formatUsd(rep.marker.usd)}${extra}`;
}

function buildHoverCard(): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "absolute z-10 panel px-3 py-2.5 text-[12px] w-56 pointer-events-auto";
  card.style.display = "none";
  return card;
}

function fillHoverCard(card: HTMLDivElement, items: BubbleItem[]) {
  const rep = representativeItem(items);
  const m = rep.marker;
  const isAdd = m.action === "Open" || m.action === "Add";
  const label = walletLabel(m.label, m.address);
  const more = items.length - 1;
  const totalUsd = items.reduce((a, it) => a + Math.abs(it.marker.usd), 0);

  card.replaceChildren();

  const head = document.createElement("div");
  head.className = "flex items-center gap-2 mb-2";
  const avatar = document.createElement("span");
  avatar.className = "inline-block rounded-full shrink-0";
  avatar.style.width = "20px";
  avatar.style.height = "20px";
  avatar.style.background = avatarBackground(m.address);
  const names = document.createElement("span");
  names.className = "min-w-0";
  const nameEl = document.createElement("span");
  nameEl.className = "block truncate text-ink text-[13px]";
  nameEl.textContent = label;
  const addrEl = document.createElement("span");
  addrEl.className = "block fig text-ink-3 text-[11px]";
  addrEl.textContent = shortAddr(m.address);
  names.append(nameEl, addrEl);
  head.append(avatar, names);

  const chip = document.createElement("span");
  chip.className = `chip ${isAdd ? "chip-lume" : "chip-late"} mb-2`;
  chip.textContent = isAdd ? "Buy" : "Sell";

  const rows = document.createElement("div");
  rows.className = "fig text-[12px] text-ink-2 flex flex-col gap-1 mb-2";
  const sizeRow = document.createElement("div");
  sizeRow.textContent = `Size ${formatUsd(totalUsd)}`;
  const priceRow = document.createElement("div");
  priceRow.textContent = `Price ${formatPrice(m.px)}`;
  const timeRow = document.createElement("div");
  timeRow.textContent = formatDate(m.t);
  rows.append(sizeRow, priceRow, timeRow);
  if (more > 0) {
    const moreRow = document.createElement("div");
    moreRow.className = "text-ink-3";
    moreRow.textContent = `+${more} more fill${more > 1 ? "s" : ""}`;
    rows.appendChild(moreRow);
  }

  const link = document.createElement("a");
  link.href = `/w/${m.address}`;
  link.className = "text-accent text-[12px] hover:underline";
  link.textContent = "Open wallet";

  card.append(head, chip, rows, link);
}

/** Clamps a price's y-coordinate to inside the plot area (avatar pins must stay visible even when
 * their price is off the visible range) and reports whether it had to move, so the caller can dim
 * an off-screen pin. Shared by entry pins and liquidation pins. */
function clampToPlot(chart: IChartApi, host: HTMLDivElement, rawY: number): { y: number; offView: boolean } {
  const plotH = host.clientHeight - chart.timeScale().height();
  const y = Math.min(Math.max(rawY, 9), plotH - 9);
  return { y, offView: y !== rawY };
}

/** Every Smart Money fill becomes a circular avatar bubble (WalletAvatar's own gradient, sized by
 * USD, ring green for a buy/add and red for a reduce/close) at (fill time, fill price), plus a
 * small avatar per tracked wallet pinned on the price-axis side at its entry, and, separately, at
 * its live liquidation price (late-colour ring, "liq" caption) when the liquidations overlay is
 * on. Overlapping bubbles within 14px cluster into one with a count badge. Re-run on data, filter,
 * pan/zoom and resize. */
function renderBubbleLayer(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  host: HTMLDivElement | null,
  candles: Candle[],
  fills: ChartMarker[],
  wallets: ChartWallet[],
  liqWallets: ChartWallet[],
) {
  if (!host) return;
  host.replaceChildren();
  if (candles.length === 0) return;
  const ts = chart.timeScale();

  const positioned: BubbleItem[] = [];
  for (const m of fills) {
    const snapped = snapToCandle(candles, m.t);
    if (snapped === null) continue;
    const x = ts.timeToCoordinate(toUTC(snapped) as unknown as Time);
    const y = series.priceToCoordinate(m.px);
    if (x === null || y === null) continue;
    positioned.push({ marker: m, x, y });
  }

  const card = buildHoverCard();
  host.appendChild(card);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelHide = () => {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };
  const scheduleHide = () => {
    hideTimer = setTimeout(() => {
      card.style.display = "none";
    }, 150);
  };
  card.addEventListener("mouseenter", cancelHide);
  card.addEventListener("mouseleave", scheduleHide);

  const clusters = clusterBubbles(positioned, 14);
  for (const cluster of clusters) {
    const rep = representativeItem(cluster.items);
    const isAdd = rep.marker.action === "Open" || rep.marker.action === "Add";
    const totalUsd = cluster.items.reduce((a, it) => a + Math.abs(it.marker.usd), 0);
    const size = bubbleSize(totalUsd);

    const el = document.createElement("a");
    el.href = `/w/${rep.marker.address}`;
    el.tabIndex = 0;
    el.setAttribute("aria-label", bubbleAriaLabel(cluster.items));
    el.className =
      "absolute rounded-full pointer-events-auto transition-transform duration-150 motion-reduce:transition-none hover:scale-110 focus-visible:scale-110";
    el.style.left = `${cluster.x}px`;
    el.style.top = `${cluster.y}px`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.transform = "translate(-50%, -50%)";
    el.style.background = avatarBackground(rep.marker.address);
    el.style.boxShadow = `0 0 0 2px ${isAdd ? THEME.up : THEME.down}`;

    if (cluster.items.length > 1) {
      const badge = document.createElement("span");
      badge.className =
        "absolute -top-1 -right-1 min-w-[14px] h-[14px] px-[3px] rounded-full bg-bezel border border-rule text-[9px] fig text-ink flex items-center justify-center";
      badge.textContent = String(cluster.items.length);
      el.appendChild(badge);
    }

    const show = () => {
      cancelHide();
      fillHoverCard(card, cluster.items);
      card.style.display = "block";
      const hostWidth = host.clientWidth;
      const hostHeight = host.clientHeight;
      const cardWidth = 224;
      let left = cluster.x + 14;
      if (left + cardWidth > hostWidth) left = cluster.x - cardWidth - 14;
      left = Math.max(4, left);
      let top = cluster.y - 10;
      top = Math.max(4, Math.min(top, hostHeight - 140));
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    };
    el.addEventListener("mouseenter", show);
    el.addEventListener("focus", show);
    el.addEventListener("mouseleave", scheduleHide);
    el.addEventListener("blur", scheduleHide);
    host.appendChild(el);
  }

  const axisWidth = chart.priceScale("right").width();
  const totalWidth = host.clientWidth;
  for (const w of wallets) {
    if (!w.entryPx || w.entryPx <= 0) continue;
    const rawY = series.priceToCoordinate(w.entryPx);
    if (rawY === null) continue;
    // Keep pins inside the plot: an entry above or below the visible range sits at the edge, dimmed.
    const { y, offView } = clampToPlot(chart, host, rawY);
    const x = totalWidth - axisWidth / 2;
    const label = walletLabel(w.label, w.address);

    const el = document.createElement("a");
    el.href = `/w/${w.address}`;
    el.tabIndex = 0;
    el.title = `${label} entry ${formatPrice(w.entryPx)}`;
    el.setAttribute("aria-label", `${label} entry ${formatPrice(w.entryPx)}`);
    el.className =
      "absolute rounded-full pointer-events-auto transition-transform duration-150 motion-reduce:transition-none hover:scale-110 focus-visible:scale-110";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = "14px";
    el.style.height = "14px";
    el.style.transform = "translate(-50%, -50%)";
    el.style.background = avatarBackground(w.address);
    if (offView) el.style.opacity = "0.55";
    el.style.boxShadow = `0 0 0 2px ${THEME.entryRing}`;
    host.appendChild(el);
  }

  const late = cssVar("--color-late", THEME.down);
  for (const w of liqWallets) {
    if (!w.liquidationPx || w.liquidationPx <= 0) continue;
    const rawY = series.priceToCoordinate(w.liquidationPx);
    if (rawY === null) continue;
    const { y, offView } = clampToPlot(chart, host, rawY);
    const x = totalWidth - axisWidth / 2;
    const label = walletLabel(w.label, w.address);

    const el = document.createElement("a");
    el.href = `/w/${w.address}`;
    el.tabIndex = 0;
    el.title = `${label} liquidates at ${formatPrice(w.liquidationPx)}`;
    el.setAttribute("aria-label", `${label} liquidates at ${formatPrice(w.liquidationPx)}`);
    el.className =
      "absolute rounded-full pointer-events-auto transition-transform duration-150 motion-reduce:transition-none hover:scale-110 focus-visible:scale-110 flex items-center justify-center";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = "14px";
    el.style.height = "14px";
    el.style.transform = "translate(-50%, -50%)";
    el.style.background = avatarBackground(w.address);
    if (offView) el.style.opacity = "0.55";
    // A 1px late-colour ring distinguishes a liquidation pin from an entry pin's neutral ring.
    el.style.boxShadow = `0 0 0 1px ${late}`;

    const caption = document.createElement("span");
    caption.className = "absolute -bottom-3 text-[8px] fig text-late leading-none";
    caption.textContent = "liq";
    el.appendChild(caption);

    host.appendChild(el);
  }
}
