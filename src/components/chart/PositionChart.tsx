"use client";

import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  ColorType,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartMarker, ChartResponse, WindowBand } from "@/lib/chart";
import type { Candle } from "@/lib/hyperliquid";
import { formatUsd } from "@/components/format";
import { TokenCell } from "@/components/TokenIcon";
import { usePoll } from "@/components/usePoll";

const TIMEFRAMES = ["1h", "4h", "1d", "7d"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const THEME = {
  background: "#11181f",
  grid: "#222d38",
  text: "#a3adb6",
  up: "#3fd49a",
  down: "#f0616d",
};

function toUTC(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

/** Markers must land on a real bar or the plugin drops them; snap to the candle that was open
 * at the fill's time. */
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

function markerFor(m: ChartMarker, candles: Candle[]): SeriesMarker<Time> | null {
  const snapped = snapToCandle(candles, m.t);
  if (snapped === null) return null;
  const isAdd = m.action === "Open" || m.action === "Add";
  const signedUsd = isAdd ? m.usd : -m.usd;
  return {
    time: toUTC(snapped) as unknown as Time,
    position: isAdd ? "belowBar" : "aboveBar",
    shape: isAdd ? "arrowUp" : "arrowDown",
    color: isAdd ? THEME.up : THEME.down,
    text: `${m.label} ${formatUsd(signedUsd, { sign: true })}`,
  };
}

interface Props {
  coin: string;
  address?: string;
  height?: number;
}

/** "You vs Smart Money": a live candlestick chart for one coin with the user's entry, the
 * value-weighted Smart Money entry, Smart Money fill markers, and a shaded band after each
 * Smart Money reduce for as long as the exit window stayed open. */
export function PositionChart({ coin, address, height = 360 }: Props) {
  const [tf, setTf] = useState<Timeframe>("1d");
  const url = useMemo(() => {
    const q = new URLSearchParams({ tf });
    if (address) q.set("address", address);
    return `/api/chart/${encodeURIComponent(coin)}?${q.toString()}`;
  }, [coin, address, tf]);
  const { data, error } = usePoll<ChartResponse>(url, 15_000);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bandsRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const youLineRef = useRef<IPriceLine | null>(null);
  const smLineRef = useRef<IPriceLine | null>(null);
  const bandsDataRef = useRef<{ candles: Candle[]; windows: WindowBand[] }>({ candles: [], windows: [] });
  const fittedTfRef = useRef<Timeframe | null>(null);

  // Chart is created once per mount and torn down on unmount; coin/tf changes update data in
  // place so panning and zoom survive a live refresh.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
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
    });
    chartRef.current = chart;
    seriesRef.current = series;
    markersApiRef.current = createSeriesMarkers(series, []);

    const reposition = () => renderBands(chart, bandsRef.current, bandsDataRef.current.candles, bandsDataRef.current.windows);
    chart.timeScale().subscribeVisibleLogicalRangeChange(reposition);
    chart.timeScale().subscribeSizeChange(reposition);

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersApiRef.current = null;
      youLineRef.current = null;
      smLineRef.current = null;
      fittedTfRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin, height]);

  // Data updates: candles, markers, price lines, exit-window bands. Runs on the initial load and
  // every 15s live refresh without recreating the chart.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || !data) return;

    series.setData(
      data.candles.map((c) => ({ time: toUTC(c.t), open: c.o, high: c.h, low: c.l, close: c.c })),
    );

    const markers = data.smFills.map((m) => markerFor(m, data.candles)).filter((m): m is SeriesMarker<Time> => m !== null);
    markersApiRef.current?.setMarkers(markers);

    if (data.yourEntry !== undefined) {
      const worse =
        data.smAvgEntry !== undefined
          ? data.yourDirection === "short"
            ? data.yourEntry < data.smAvgEntry
            : data.yourEntry > data.smAvgEntry
          : null;
      const color = worse === null ? THEME.text : worse ? THEME.down : THEME.up;
      const title = `You ${formatPrice(data.yourEntry)}${data.yourSize !== undefined ? ` · ${data.yourSize.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${coin}` : ""}`;
      if (youLineRef.current) youLineRef.current.applyOptions({ price: data.yourEntry, color, title });
      else
        youLineRef.current = series.createPriceLine({
          price: data.yourEntry,
          color,
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title,
        });
    } else if (youLineRef.current) {
      series.removePriceLine(youLineRef.current);
      youLineRef.current = null;
    }

    if (data.smAvgEntry !== undefined) {
      const title = `Smart Money avg ${formatPrice(data.smAvgEntry)}`;
      if (smLineRef.current) smLineRef.current.applyOptions({ price: data.smAvgEntry, title });
      else
        smLineRef.current = series.createPriceLine({
          price: data.smAvgEntry,
          color: THEME.text,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title,
        });
    } else if (smLineRef.current) {
      series.removePriceLine(smLineRef.current);
      smLineRef.current = null;
    }

    bandsDataRef.current = { candles: data.candles, windows: data.windows };
    renderBands(chart, bandsRef.current, data.candles, data.windows);

    if (fittedTfRef.current !== tf) {
      chart.timeScale().fitContent();
      fittedTfRef.current = tf;
    }
  }, [data, coin, tf]);

  const gap =
    data?.yourEntry !== undefined && data?.smAvgEntry !== undefined
      ? ((data.yourEntry - data.smAvgEntry) / data.smAvgEntry) * 100 * (data.yourDirection === "short" ? -1 : 1)
      : null;

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-rule">
        <div className="flex items-center gap-3 min-w-0">
          <TokenCell coin={coin} />
          {data?.yourEntry !== undefined && (
            <span className={`fig text-[12px] ${gap === null ? "text-ink-2" : gap > 0.05 ? "text-late" : gap < -0.05 ? "text-lume" : "text-ink-2"}`}>
              You {formatPrice(data.yourEntry)}
            </span>
          )}
          {data?.smAvgEntry !== undefined && <span className="fig text-[12px] text-ink-2">Smart Money avg {formatPrice(data.smAvgEntry)}</span>}
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
        {/* lightweight-charts sets explicit z-index (1/2) on its own internal canvases. Neither
         * div below otherwise creates a stacking context, so those inline z-indexes would escape
         * this subtree and paint over the bands regardless of DOM order; giving each an explicit
         * z-index here traps the chart's canvases inside its own context and keeps bands on top. */}
        <div ref={containerRef} className="absolute inset-0" style={{ zIndex: 0 }} />
        <div ref={bandsRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }} />
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
    </section>
  );
}

function formatPrice(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 4 : 2 });
}

/** Positions one translucent div per exit-window band using the chart's own time->x coordinate
 * mapping, so bands track panning and zoom without a custom chart primitive. timeToCoordinate
 * only maps times that land exactly on a bar, same as the marker plugin, so both edges are
 * snapped to a real candle first or they silently resolve to null and the band mis-renders. */
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
