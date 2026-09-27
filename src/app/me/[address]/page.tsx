"use client";

import Link from "next/link";
import { CaretDown } from "@phosphor-icons/react";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import type { AlarmCreated, Companion, OverlapRow } from "@/lib/types";
import { EmptyState, ErrorState, LoadingRows } from "@/components/States";
import { PositionChart, type ChartWallet } from "@/components/chart/PositionChart";
import { ForcedExitPanel } from "@/components/report/ForcedExitPanel";
import { forcedExitLadder } from "@/lib/forced";
import { TokenCell } from "@/components/TokenIcon";
import { companionLabel, formatMinutes, formatUsd, shortAddr } from "@/components/format";
import { usePoll } from "@/components/usePoll";
import { useQueuedWalletReport, type QueuedWalletState } from "@/components/walletQueue";
import { SmartMoneyFilterBar, loadFiltersFromStorage, saveFiltersToStorage } from "@/components/filters/SmartMoneyFilterBar";
import { DEFAULT_FILTERS, matchesFilters, type ExitRiskLevel, type SmartMoneyFilters } from "@/components/filters/smartMoneyFilters";
import { ScenarioPanel } from "@/components/alarm/ScenarioPanel";
import type { AlarmRule } from "@/lib/alarmRule";

/** Renders a queued wallet report's timing status. Never "no window": that phrase is reserved for
 * a real medianWindowMin===null; a failed or in-flight fetch says so instead. */
function windowStatusText(q: QueuedWalletState): string {
  if (q.status === "queued" || q.status === "loading") return "timing";
  if (q.status === "retrying") return "timing";
  if (q.status === "error") return "not timed yet";
  if (q.data?.medianWindowMin != null) return formatMinutes(q.data.medianWindowMin);
  // A degraded report with no fills means we could not fetch this wallet's history, not that it never exited.
  if (q.data?.degraded && q.data.episodesAnalyzed === 0) return "not timed yet";
  return "no exit measured in 30 days";
}

/** Full sentence for the position headline; the duration case reads "you have <window>.", every
 * other status gets its own grammar instead of being forced into that template. */
function windowSentence(q: QueuedWalletState): string {
  if (q.status === "queued" || q.status === "loading") return "Still timing when they'd sell.";
  if (q.status === "retrying") return "Timing their exits now.";
  if (q.status === "error") return "Their exit timing is still being assembled.";
  return q.data?.medianWindowMin != null
    ? `When they sell, you have ${formatMinutes(q.data.medianWindowMin)}.`
    : q.data?.degraded && q.data.episodesAnalyzed === 0
      ? "Their exit timing is still being assembled."
      : "No exit measured in 30 days.";
}

interface Cohort {
  available: boolean;
  smartTraderLongUsd?: number;
  smartTraderShortUsd?: number;
  oneLiner?: string;
}

interface Pressure {
  holders: number;
  reducedLast1h: number;
  pressure: "low" | "medium" | "high";
  read: string;
}

/** Value-weighted Smart Money entry on the same side as the user. */
function smAvgEntry(row: OverlapRow): number | null {
  const cs = row.companions.filter((c) => c.entryPx > 0 && c.positionValueUsd > 0);
  const w = cs.reduce((a, c) => a + c.positionValueUsd, 0);
  return w ? cs.reduce((a, c) => a + c.entryPx * c.positionValueUsd, 0) / w : null;
}

/** Your entry vs the value-weighted Smart Money entry on the same side. Positive = you paid worse. */
function entryGapPct(row: OverlapRow): number | null {
  const cs = row.companions.filter((c) => c.entryPx > 0 && c.positionValueUsd > 0);
  const w = cs.reduce((a, c) => a + c.positionValueUsd, 0);
  if (!w || row.entryPx <= 0) return null;
  const sm = cs.reduce((a, c) => a + c.entryPx * c.positionValueUsd, 0) / w;
  const gap = ((row.entryPx - sm) / sm) * 100;
  return row.direction === "long" ? gap : -gap;
}

/** Table cell text for the entry gap, with its tone. */
function gapText(gap: number | null): { text: string; className: string } {
  if (gap === null) return { text: "n/a", className: "text-ink-3" };
  if (gap > 0.05) return { text: `+${gap.toFixed(1)}% worse`, className: "text-late" };
  if (gap < -0.05) return { text: `${Math.abs(gap).toFixed(1)}% better`, className: "text-lume" };
  return { text: "same", className: "text-ink-2" };
}

type WatchKey = string; // `${leader}|${coin}|${direction}`
const key = (leader: string, row: OverlapRow): WatchKey => `${leader.toLowerCase()}|${row.coin}|${row.direction}`;
const rowKey = (r: OverlapRow): string => `${r.coin}-${r.direction}`;

export default function MyTradesPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const overlap = usePoll<OverlapRow[]>(`/api/overlap/${address}`, 0);
  const rows = useMemo(() => overlap.data ?? [], [overlap.data]);
  // Worst entry gap first: the position where the user paid the most above Smart Money leads.
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ga = entryGapPct(a);
      const gb = entryGapPct(b);
      if (ga === null && gb === null) return 0;
      if (ga === null) return 1;
      if (gb === null) return -1;
      return gb - ga;
    });
  }, [rows]);
  const worseCount = useMemo(() => rows.filter((r) => (entryGapPct(r) ?? 0) > 0.05).length, [rows]);
  const smartMoneyCount = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.companions.forEach((c) => {
      if (c.cohort === "smart_money") s.add(c.address.toLowerCase());
    }));
    return s.size;
  }, [rows]);
  const [watch, setWatch] = useState<Set<WatchKey> | null>(null);

  // Smart Money filter bar state, persisted in localStorage. Starts at DEFAULT_FILTERS on both
  // server and first client render (no hydration mismatch), then loads the saved value once mounted.
  const [filters, setFilters] = useState<SmartMoneyFilters>(DEFAULT_FILTERS);
  useEffect(() => {
    setFilters(loadFiltersFromStorage());
  }, []);
  useEffect(() => {
    saveFiltersToStorage(filters);
  }, [filters]);

  // Exit risk level per wallet, filled in as each companion's WalletReport loads (top holder,
  // second auto-timed companion, or a manually timed one). Feeds the exit-risk filter clause.
  const [reportsByAddr, setReportsByAddr] = useState<Record<string, ExitRiskLevel | null>>({});
  const reportExitRisk = useCallback((addr: string, level: ExitRiskLevel | null) => {
    const k = addr.toLowerCase();
    setReportsByAddr((prev) => (prev[k] === level ? prev : { ...prev, [k]: level }));
  }, []);

  // Filtered companions per row, keyed the same as rowKey. Table rendering, the default watch
  // set, the fastest-window KPI, and the chart's wallet list all read from this; entryGapPct/
  // smAvgEntry stay on the unfiltered row since they're factual Smart Money market context.
  const companionsMap = useMemo(() => {
    const m = new Map<string, Companion[]>();
    rows.forEach((r) =>
      m.set(
        rowKey(r),
        r.companions.filter((c) => matchesFilters(c, filters, reportsByAddr[c.address.toLowerCase()] ?? null)),
      ),
    );
    return m;
  }, [rows, filters, reportsByAddr]);
  const companionsFor = useCallback((r: OverlapRow) => companionsMap.get(rowKey(r)) ?? [], [companionsMap]);

  const { shownCount, totalCount } = useMemo(() => {
    const all = new Set<string>();
    const shown = new Set<string>();
    rows.forEach((r) => {
      r.companions.forEach((c) => all.add(c.address.toLowerCase()));
      companionsFor(r).forEach((c) => shown.add(c.address.toLowerCase()));
    });
    return { shownCount: shown.size, totalCount: all.size };
  }, [rows, companionsFor]);

  // Default: watch the three largest (filtered) companions of every position.
  const defaults = useMemo(() => {
    const s = new Set<WatchKey>();
    rows.forEach((r) => companionsFor(r).slice(0, 3).forEach((c) => s.add(key(c.address, r))));
    return s;
  }, [rows, companionsFor]);
  const active = watch ?? defaults;
  const toggle = (k: WatchKey) =>
    setWatch(() => {
      const next = new Set(active);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // The worst position starts expanded.
  const [openKeys, setOpenKeys] = useState<Set<string> | null>(null);
  const open = openKeys ?? new Set(sortedRows.length ? [rowKey(sortedRows[0])] : []);
  const toggleOpen = (k: string) =>
    setOpenKeys(() => {
      const base = openKeys ?? new Set(sortedRows.length ? [rowKey(sortedRows[0])] : []);
      const next = new Set(base);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // Fastest measured exit window, collected from each position's loaded top-holder report.
  const [topWindows, setTopWindows] = useState<Record<string, number | null>>({});
  const reportTopWindow = useCallback((addr: string, v: number | null) => {
    setTopWindows((prev) => (prev[addr] === v ? prev : { ...prev, [addr]: v }));
  }, []);
  const expectedReports = useMemo(() => rows.filter((r) => companionsFor(r).length > 0).length, [rows, companionsFor]);
  const fastestWindow = useMemo(() => {
    const vals = Object.values(topWindows).filter((v): v is number => v !== null && v !== undefined);
    return vals.length ? Math.min(...vals) : null;
  }, [topWindows]);
  const fastestText =
    fastestWindow !== null
      ? formatMinutes(fastestWindow)
      : Object.keys(topWindows).length < expectedReports
        ? "timing"
        : "n/a";

  const aha =
    rows.length === 0
      ? "Who else is in your trades, and how fast they get out."
      : `${worseCount} of your ${rows.length} position${rows.length === 1 ? "" : "s"} ${worseCount === 1 ? "was" : "were"} bought above the Smart Money in ${worseCount === 1 ? "it" : "them"}.`;

  return (
    <main className={`mx-auto w-full max-w-[1440px] px-4 lg:px-8 py-6 flex-1 ${rows.length > 0 ? "pb-40" : "pb-16"}`}>
      <h1 className="display text-balance text-[24px]">{aha}</h1>
      <p className="mt-1 text-[14px] text-ink-2">
        Smart Money wallets on the same side of each position, from Nansen. You get a Telegram message when one starts selling.
      </p>
      <p className="fig mt-1 text-[13px] text-ink-3 break-all">{address}</p>

      {overlap.error ? (
        <div className="mt-6">
          <ErrorState message="Your positions are still loading from Hyperliquid and Nansen. Try again in a moment." onRetry={overlap.refresh} />
        </div>
      ) : overlap.loading && !overlap.data ? (
        <div className="mt-6">
          <LoadingRows label="your positions" rows={4} />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="This address holds no open Hyperliquid perp positions."
            hint="Exit Window watches the exits of wallets that are in the same trade as you. Open a position, or time any wallet from the home page."
          />
        </div>
      ) : (
        <>
          <section aria-label="Summary" className="panel mt-6 flex flex-col divide-y divide-rule md:flex-row md:divide-x md:divide-y-0">
            <div className="flex-1 px-5 py-4">
              <p className="label">Open positions</p>
              <p className="fig mt-1 text-[22px] text-ink">{rows.length}</p>
            </div>
            <div className="flex-1 px-5 py-4">
              <p className="label">Bought above Smart Money</p>
              <p className="fig mt-1 text-[22px] text-late">{worseCount}</p>
            </div>
            <div className="flex-1 px-5 py-4">
              <p className="label">Smart Money wallets in your trades</p>
              <p className="fig mt-1 text-[22px] text-ink">{smartMoneyCount}</p>
            </div>
            <div className="flex-1 px-5 py-4">
              <p className="label">Fastest measured exit window</p>
              <p className="fig mt-1 text-[22px] text-ink">{fastestText}</p>
            </div>
          </section>

          <SmartMoneyFilterBar filters={filters} onChange={setFilters} shownCount={shownCount} totalCount={totalCount} />

          <section aria-label="Your positions" className="panel mt-4 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-rule">
              <h2 className="text-[15px] font-semibold text-ink">Your positions</h2>
              <p className="fig text-[12px] text-ink-3">worst entry gap first</p>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-bezel">
                  <th scope="col" className="label text-left font-medium px-3 h-9">Token</th>
                  <th scope="col" className="label text-right font-medium px-3 h-9 hidden lg:table-cell">Size</th>
                  <th scope="col" className="label text-right font-medium px-3 h-9 hidden lg:table-cell">Entry</th>
                  <th scope="col" className="label text-right font-medium px-3 h-9 hidden lg:table-cell">Mark</th>
                  <th scope="col" className="label text-right font-medium px-3 h-9">Unrealized</th>
                  <th scope="col" className="label text-right font-medium px-3 h-9">Entry gap vs Smart Money</th>
                  <th scope="col" className="label text-right font-medium px-3 h-9 hidden md:table-cell">Smart Money</th>
                  <th scope="col" className="label text-right font-medium px-3 h-9 hidden md:table-cell">Largest holder window</th>
                  <th scope="col" className="label text-right font-medium px-3 h-9 hidden md:table-cell">Pressure</th>
                  <th scope="col" className="w-10"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <PositionRows
                    key={rowKey(r)}
                    row={r}
                    companions={companionsFor(r)}
                    address={address}
                    open={open.has(rowKey(r))}
                    onToggleOpen={() => toggleOpen(rowKey(r))}
                    active={active}
                    onToggle={toggle}
                    onTopWindow={reportTopWindow}
                    onReport={reportExitRisk}
                  />
                ))}
              </tbody>
            </table>
          </section>
          <AlarmBar owner={address} rows={rows} active={active} />
        </>
      )}
    </main>
  );
}

function PositionRows({
  row,
  companions,
  address,
  open,
  onToggleOpen,
  active,
  onToggle,
  onTopWindow,
  onReport,
}: {
  row: OverlapRow;
  /** row.companions after the Smart Money filter bar; drives the table, the top holder and the chart. */
  companions: Companion[];
  address: string;
  open: boolean;
  onToggleOpen: () => void;
  active: Set<WatchKey>;
  onToggle: (k: WatchKey) => void;
  onTopWindow: (addr: string, v: number | null) => void;
  onReport: (addr: string, level: ExitRiskLevel | null) => void;
}) {
  const top = companions[0] ?? null;
  // Auto-timed: the largest holder is always in the shared, one-at-a-time page queue.
  const topWindow = useQueuedWalletReport(top ? top.address : null);
  const side = row.direction === "long" ? "long" : "short";
  const pressure = usePoll<Pressure>(row.companions.length ? `/api/intel/pressure/${encodeURIComponent(row.coin)}?side=${side}` : null, 0);
  const p = pressure.data;
  const pnl = row.markPx !== null ? (row.direction === "long" ? row.markPx - row.entryPx : row.entryPx - row.markPx) * row.size : null;
  const g = gapText(entryGapPct(row));
  const detailId = `pos-${row.coin}-${row.direction}`;

  const topAddr = top?.address.toLowerCase() ?? null;
  useEffect(() => {
    if (topAddr && topWindow.status === "ready") {
      onTopWindow(topAddr, topWindow.data?.medianWindowMin ?? null);
      onReport(topAddr, topWindow.data?.exitRisk?.level ?? null);
    }
  }, [topAddr, topWindow, onTopWindow, onReport]);

  const windowClass =
    topWindow.status === "error"
      ? "text-late"
      : topWindow.status === "ready" && topWindow.data?.medianWindowMin != null && topWindow.data.medianWindowMin < 15
        ? "text-late"
        : "text-ink-2";

  return (
    <>
      <tr onClick={onToggleOpen} className="border-b border-rule cursor-pointer transition-[background-color] duration-150 hover:bg-bezel">
        <td className="px-3 h-11 max-w-[150px]">
          <TokenCell coin={row.coin} sub={row.direction} />
        </td>
        <td className="fig px-3 h-11 text-right text-[13px] whitespace-nowrap hidden lg:table-cell">
          {row.size.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </td>
        <td className="fig px-3 h-11 text-right text-[13px] whitespace-nowrap hidden lg:table-cell">
          {row.entryPx.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </td>
        <td className="fig px-3 h-11 text-right text-[13px] whitespace-nowrap hidden lg:table-cell">
          {row.markPx === null ? "not quoted" : row.markPx.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </td>
        <td className={`fig px-3 h-11 text-right text-[13px] whitespace-nowrap ${pnl === null ? "" : pnl >= 0 ? "text-lume" : "text-late"}`}>
          {formatUsd(pnl, { sign: true })}
        </td>
        <td className={`fig px-3 h-11 text-right text-[13px] whitespace-nowrap ${g.className}`}>{g.text}</td>
        <td className="fig px-3 h-11 text-right text-[13px] text-ink-2 whitespace-nowrap hidden md:table-cell">
          {companions.length}
        </td>
        <td className="px-3 h-11 text-right hidden md:table-cell">
          {top ? (
            <span className={`fig text-[12px] ${windowClass}`}>{windowStatusText(topWindow)}</span>
          ) : row.companions.length > 0 ? (
            <span className="text-[12px] text-ink-3">none match your filters</span>
          ) : (
            <span className="text-[12px] text-ink-3">no Smart Money in this market</span>
          )}
        </td>
        <td className="px-3 h-11 text-right whitespace-nowrap hidden md:table-cell">
          {p ? (
            <span className={`chip ${p.pressure === "high" ? "chip-late" : "chip-mute"}`}>{p.pressure}</span>
          ) : row.companions.length === 0 ? (
            <span className="fig text-[12px] text-ink-3">n/a</span>
          ) : (
            <span className="fig text-[12px] text-ink-3">reading</span>
          )}
        </td>
        <td className="pr-3 h-11 w-10 text-right">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleOpen();
            }}
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={open ? `Hide details for ${row.coin} ${row.direction}` : `Show details for ${row.coin} ${row.direction}`}
            className="inline-flex items-center justify-center size-7 rounded-lg text-ink-3 transition-[background-color,color] duration-150 hover:bg-bezel hover:text-ink"
          >
            <CaretDown
              size={16}
              aria-hidden="true"
              className={`transition-[transform] duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
            />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-rule">
          <td colSpan={10} id={detailId} className="bg-bezel/40 px-4 py-4">
            <PositionDetail
              row={row}
              companions={companions}
              address={address}
              topWindow={top ? topWindow : null}
              pressure={p}
              active={active}
              onToggle={onToggle}
              onReport={onReport}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function PositionDetail({
  row,
  companions,
  address,
  topWindow,
  pressure,
  active,
  onToggle,
  onReport,
}: {
  row: OverlapRow;
  companions: Companion[];
  address: string;
  topWindow: QueuedWalletState | null;
  pressure: Pressure | null | undefined;
  active: Set<WatchKey>;
  onToggle: (k: WatchKey) => void;
  onReport: (addr: string, level: ExitRiskLevel | null) => void;
}) {
  const wallets: ChartWallet[] = useMemo(
    () =>
      companions.map((c) => ({
        address: c.address,
        label: companionLabel(c),
        cohort: c.cohort,
        positionValueUsd: c.positionValueUsd,
        entryPx: c.entryPx,
        liquidationPx: c.liquidationPx,
      })),
    [companions],
  );
  const ladder = useMemo(
    () => forcedExitLadder(row.direction, row.markPx, row.liquidationPx, companions),
    [row.direction, row.markPx, row.liquidationPx, companions],
  );
  return (
    <div className="flex flex-col gap-3">
      <PositionSentence row={row} topWindow={topWindow} />
      {pressure && (
        <p className={`text-[13px] ${pressure.pressure === "high" ? "text-late" : "text-ink-2"}`}>
          <span className="label mr-2">Exit pressure {pressure.pressure}</span>
          {pressure.read}
        </p>
      )}
      <PositionChart
        coin={row.coin}
        address={address}
        height={360}
        smAvgEntry={smAvgEntry(row)}
        wallets={wallets}
        youLiquidationPx={row.liquidationPx}
      />
      <ForcedExitPanel coin={row.coin} direction={row.direction} markPx={row.markPx} ladder={ladder} />
      <CohortBar coin={row.coin} />
      {row.companions.length === 0 ? (
        <p className="text-[13px] text-ink-2 border-t border-rule pt-3">
          No labeled wallet holds {row.coin} {row.direction} right now. Nothing to watch here.
        </p>
      ) : companions.length === 0 ? (
        <p className="text-[13px] text-ink-2 border-t border-rule pt-3">
          No Smart Money wallets in this position match your filters. Loosen them above to see it.
        </p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-bezel">
              <th scope="col" className="w-10 px-3 h-9"><span className="sr-only">Watch</span></th>
              <th scope="col" className="label text-left font-medium px-3 h-9">Wallet</th>
              <th scope="col" className="label text-right font-medium px-3 h-9">Value</th>
              <th scope="col" className="label text-right font-medium px-3 h-9 hidden sm:table-cell">Entry</th>
              <th scope="col" className="label text-right font-medium px-3 h-9">Window</th>
            </tr>
          </thead>
          <tbody>
            {companions.map((c, i) => (
              <SubCompanionRow
                key={c.address}
                c={c}
                row={row}
                index={i}
                checked={active.has(key(c.address, row))}
                onToggle={() => onToggle(key(c.address, row))}
                autoReport={i === 0 ? topWindow : undefined}
                onReport={onReport}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SubCompanionRow({
  c,
  row,
  index,
  checked,
  onToggle,
  autoReport,
  onReport,
}: {
  c: Companion;
  row: OverlapRow;
  index: number;
  checked: boolean;
  onToggle: () => void;
  /** The top holder's queued report is already fetched by the parent for the window cell; reuse it. */
  autoReport?: QueuedWalletState | null;
  onReport: (addr: string, level: ExitRiskLevel | null) => void;
}) {
  const auto = index < 2;
  const [timed, setTimed] = useState(false);
  // Top 2 companions time automatically through the shared queue; the rest need the button.
  const secondAuto = useQueuedWalletReport(index === 1 ? c.address : null);
  const manual = useQueuedWalletReport(!auto && timed ? c.address : null);
  const q = index === 0 ? autoReport : index === 1 ? secondAuto : timed ? manual : null;
  useEffect(() => {
    if (q?.status === "ready") onReport(c.address.toLowerCase(), q.data?.exitRisk?.level ?? null);
  }, [q, c.address, onReport]);
  const id = `watch-${row.coin}-${c.address}`;
  const cohortChip =
    c.cohort === "smart_money" ? (
      <span className="chip chip-lume">Smart Money</span>
    ) : c.cohort === "whale" ? (
      <span className="chip chip-mute">Whale</span>
    ) : (
      <span className="chip chip-mute">Public figure</span>
    );
  return (
    <tr className="border-b border-rule last:border-b-0 transition-[background-color] duration-150 hover:bg-bezel">
      <td className="pl-3 h-11 w-10">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Watch ${companionLabel(c)} on ${row.coin}`}
          className="w-4 h-4 accent-[var(--color-ink)]"
        />
      </td>
      <td className="px-3 h-11 min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <label htmlFor={id} className="text-[13px] text-ink cursor-pointer">
            {companionLabel(c)}
          </label>
          {cohortChip}
          {c.stillOpen === false && <span className="chip chip-late" title="Hyperliquid shows this wallet no longer holds this position">Already out</span>}
        </span>
        <Link href={`/w/${c.address}`} className="fig text-[12px] text-ink-3 underline decoration-rule hover:decoration-ink">
          {shortAddr(c.address)}
        </Link>
      </td>
      <td className="fig px-3 h-11 text-right text-[13px] text-ink-2 whitespace-nowrap">{formatUsd(c.positionValueUsd)}</td>
      <td className="fig px-3 h-11 text-right text-[13px] text-ink-2 whitespace-nowrap hidden sm:table-cell">
        {c.entryPx > 0 ? c.entryPx.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "n/a"}
      </td>
      <td className="px-3 h-11 text-right whitespace-nowrap">
        {q ? (
          <span
            className={`fig text-[12px] ${q.status === "error" ? "text-late" : q.status === "ready" && q.data?.medianWindowMin !== null && q.data !== null && q.data.medianWindowMin < 15 ? "text-late" : "text-ink-2"}`}
          >
            {windowStatusText(q)}
          </span>
        ) : (
          <button onClick={() => setTimed(true)} className="text-[12px] text-ink-2 underline decoration-rule hover:decoration-ink">
            time it
          </button>
        )}
      </td>
    </tr>
  );
}

const DEFAULT_RULE: AlarmRule = { trigger: "any", minReducePct: 0, action: "alert", askAgent: true };

function AlarmBar({ owner, rows, active }: { owner: string; rows: OverlapRow[]; active: Set<WatchKey> }) {
  const [state, setState] = useState<{ status: "idle" | "sending" | "ready" | "error"; link?: string; error?: string }>({ status: "idle" });
  const [rule, setRule] = useState<AlarmRule>(DEFAULT_RULE);
  const [panelOpen, setPanelOpen] = useState(false);

  // ?arm=1 opens the scenario panel on load, for a direct link into the builder.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("arm") === "1") setPanelOpen(true);
  }, []);

  const watches = useMemo(
    () =>
      rows.flatMap((r) =>
        r.companions
          .filter((c) => active.has(key(c.address, r)))
          .map((c) => ({ leader: c.address, coin: r.coin, direction: r.direction, positionValueUsd: c.positionValueUsd })),
      ),
    [rows, active],
  );
  const coins = useMemo(() => new Set(watches.map((w) => w.coin)), [watches]);
  const previewCoin = coins.size === 1 ? [...coins][0] : null;

  async function create() {
    setState({ status: "sending" });
    try {
      const res = await fetch("/api/alarm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner, watches, rule }) });
      const json = (await res.json().catch(() => null)) as (AlarmCreated & { error?: string }) | null;
      if (!res.ok || !json?.deepLink) throw new Error(json?.error ?? `${res.status} ${res.statusText}`);
      setState({ status: "ready", link: json.deepLink });
      setPanelOpen(false);
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : "could not create the alarm" });
    }
  }

  return (
    <>
      <section aria-label="Telegram alarm" className="fixed inset-x-0 bottom-0 z-10 bg-dial border-t border-rule" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto w-full max-w-[1440px] px-4 lg:px-8 py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <p className="text-[14px] text-ink-2">
            <span className="fig text-ink">{watches.length}</span> wallet{watches.length === 1 ? "" : "s"} across{" "}
            <span className="fig text-ink">{coins.size}</span> of your positions.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            {state.status === "ready" && state.link ? (
              <a href={state.link} target="_blank" rel="noreferrer" className="btn-primary h-10 px-5 inline-flex items-center text-[14px] no-underline whitespace-nowrap">
                Open Telegram to arm it
              </a>
            ) : (
              <button
                onClick={() => setPanelOpen(true)}
                disabled={watches.length === 0}
                className="btn-primary h-10 px-5 text-[14px] whitespace-nowrap disabled:cursor-not-allowed"
              >
                Arm exit alarm
              </button>
            )}
          </div>
        </div>
        {state.status === "error" && (
          <p role="alert" className="mx-auto w-full max-w-[1440px] px-4 lg:px-8 pb-3 -mt-1 text-[13px] text-late">
            {state.error}
          </p>
        )}
      </section>
      <ScenarioPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        rule={rule}
        onChange={setRule}
        watchedCount={watches.length}
        coin={previewCoin}
        onArm={create}
        arming={state.status === "sending"}
      />
    </>
  );
}

function PositionSentence({ row, topWindow }: { row: OverlapRow; topWindow: QueuedWalletState | null }) {
  const gap = entryGapPct(row);
  const side = row.direction === "long" ? "long" : "short";
  const dirWord = row.direction === "long" ? "above" : "below";
  const windowClause = topWindow ? <> <span className="fig">{windowSentence(topWindow)}</span></> : null;
  return (
    <p className="text-balance text-[14px] text-ink">
      {gap === null ? (
        <>No Smart Money entry to compare your {row.coin} {side} against.</>
      ) : gap > 0.05 ? (
        <>
          You {row.direction === "long" ? "bought" : "shorted"} {row.coin}{" "}
          <span className="text-late">{gap.toFixed(1)}% {dirWord} Smart Money</span>.{windowClause}
        </>
      ) : gap < -0.05 ? (
        <>
          You got into {row.coin} <span className="text-lume">{Math.abs(gap).toFixed(1)}% better</span> than the Smart Money in it.{windowClause}
        </>
      ) : (
        <>You entered {row.coin} at the same price as the Smart Money in it.</>
      )}
    </p>
  );
}

/** Smart Trader long vs short USD on this coin (Nansen tgm/position-intelligence). */
function CohortBar({ coin }: { coin: string }) {
  const { data } = usePoll<Cohort>(`/api/intel/cohort/${encodeURIComponent(coin)}`, 0);
  if (!data?.available || !data.smartTraderLongUsd || data.smartTraderShortUsd === undefined) return null;
  const total = data.smartTraderLongUsd + data.smartTraderShortUsd;
  const longPct = total > 0 ? (data.smartTraderLongUsd / total) * 100 : 50;
  return (
    <div className="w-full md:max-w-72">
      <div className="flex h-1.5 bg-late" role="img" aria-label={`Smart Traders: ${formatUsd(data.smartTraderLongUsd)} long vs ${formatUsd(data.smartTraderShortUsd)} short`}>
        <span className="h-full bg-lume" style={{ width: `${longPct}%` }} />
      </div>
      <p className="mt-1 text-[12px] text-ink-3">
        Smart Traders: <span className="fig text-ink-2">{formatUsd(data.smartTraderLongUsd)}</span> long vs{" "}
        <span className="fig text-ink-2">{formatUsd(data.smartTraderShortUsd)}</span> short.
      </p>
    </div>
  );
}
