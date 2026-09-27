"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import type { AlarmCreated, Companion, OverlapRow, WalletReport } from "@/lib/types";
import { Chronograph } from "@/components/Chronograph";
import { EmptyState, ErrorState, LoadingRows } from "@/components/States";
import { formatMinutes, formatUsd, shortAddr } from "@/components/format";
import { usePoll } from "@/components/usePoll";

type WatchKey = string; // `${leader}|${coin}|${direction}`
const key = (leader: string, row: OverlapRow): WatchKey => `${leader.toLowerCase()}|${row.coin}|${row.direction}`;

export default function MyTradesPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const overlap = usePoll<OverlapRow[]>(`/api/overlap/${address}`, 0);
  const rows = useMemo(() => overlap.data ?? [], [overlap.data]);
  const [watch, setWatch] = useState<Set<WatchKey> | null>(null);

  // Default: watch the three largest companions of every position.
  const defaults = useMemo(() => {
    const s = new Set<WatchKey>();
    rows.forEach((r) => r.companions.slice(0, 3).forEach((c) => s.add(key(c.address, r))));
    return s;
  }, [rows]);
  const active = watch ?? defaults;
  const toggle = (k: WatchKey) =>
    setWatch(() => {
      const next = new Set(active);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <main className="mx-auto w-full max-w-[1320px] px-4 sm:px-8 flex-1 pb-16">
      <nav className="pt-6 text-[13px]">
        <Link href="/" className="text-ink-2 underline decoration-rule hover:decoration-ink">
          Exit Window
        </Link>
        <span className="text-ink-3"> / your trades / </span>
        <span className="fig text-ink-3">{shortAddr(address)}</span>
      </nav>

      <header className="pt-6 pb-8 border-b border-ink grid grid-cols-[minmax(0,1fr)] lg:grid-cols-12 gap-8 items-end">
        <div className="lg:col-span-8">
          <h1 className="display text-[clamp(34px,5vw,56px)]">Who else is in your trades, and how fast they get out.</h1>
          <p className="mt-4 text-[17px] text-ink-2 max-w-[60ch]">
            For every position you hold, these are the Smart Money wallets on the same side, from Nansen. When one of them starts
            selling, you get a Telegram message with how long its exits usually leave a holder.
          </p>
        </div>
        <p className="lg:col-span-4 fig text-[13px] text-ink-3 break-all lg:text-right">{address}</p>
      </header>

      {overlap.error ? (
        <div className="mt-8">
          <ErrorState message={`Your positions did not load (${overlap.error}).`} onRetry={overlap.refresh} />
        </div>
      ) : overlap.loading && !overlap.data ? (
        <div className="mt-8">
          <LoadingRows label="your positions" rows={4} />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="This address holds no open Hyperliquid perp positions."
            hint="Exit Window watches the exits of wallets that are in the same trade as you. Open a position, or time any wallet from the home page."
          />
        </div>
      ) : (
        <>
          <ol className="mt-2">
            {rows.map((r) => (
              <TradeBand key={`${r.coin}-${r.direction}`} row={r} active={active} onToggle={toggle} />
            ))}
          </ol>
          <AlarmBar owner={address} rows={rows} active={active} />
        </>
      )}
    </main>
  );
}

function TradeBand({ row, active, onToggle }: { row: OverlapRow; active: Set<WatchKey>; onToggle: (k: WatchKey) => void }) {
  const top = row.companions[0] ?? null;
  const topReport = usePoll<WalletReport>(top ? `/api/wallet/${top.address}` : null, 0);
  const pnl = row.markPx !== null ? (row.direction === "long" ? row.markPx - row.entryPx : row.entryPx - row.markPx) * row.size : null;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-12 gap-x-10 gap-y-6 py-8 border-b border-ink">
      <div className="lg:col-span-3">
        <p className="label">You hold</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="display text-[34px]">{row.coin}</span>
          <span className={`text-[14px] font-medium ${row.direction === "long" ? "text-lume" : "text-late"}`}>{row.direction}</span>
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-y-2 text-[13px]">
          <dt className="text-ink-3">Size</dt>
          <dd className="fig text-right">{row.size.toLocaleString(undefined, { maximumFractionDigits: 4 })}</dd>
          <dt className="text-ink-3">Entry</dt>
          <dd className="fig text-right">{row.entryPx.toLocaleString(undefined, { maximumFractionDigits: 4 })}</dd>
          <dt className="text-ink-3">Mark</dt>
          <dd className="fig text-right">{row.markPx === null ? "not quoted" : row.markPx.toLocaleString(undefined, { maximumFractionDigits: 4 })}</dd>
          <dt className="text-ink-3">Unrealized</dt>
          <dd className={`fig text-right ${pnl === null ? "" : pnl >= 0 ? "text-lume" : "text-late"}`}>{formatUsd(pnl, { sign: true })}</dd>
        </dl>
      </div>

      <div className="lg:col-span-6 min-w-0">
        <p className="label mb-2">Smart Money on the same side</p>
        {row.companions.length === 0 ? (
          <p className="text-[14px] text-ink-2 border-t border-ink pt-3">No labeled wallet holds {row.coin} {row.direction} right now. Nothing to watch here.</p>
        ) : (
          <ol className="border-t border-ink">
            {row.companions.map((c) => (
              <CompanionRow key={c.address} c={c} row={row} checked={active.has(key(c.address, row))} onToggle={() => onToggle(key(c.address, row))} report={c.address === top?.address ? topReport.data : null} />
            ))}
          </ol>
        )}
      </div>

      <div className="lg:col-span-3">
        {top ? (
          <Chronograph
            size={260}
            windowMin={topReport.data ? topReport.data.medianWindowMin : undefined}
            title={`${top.label ?? shortAddr(top.address)} median exit window`}
          >
            <span className="label">largest holder</span>
            <span className="display text-[24px] leading-none mt-1">
              {topReport.loading ? "timing" : topReport.data?.medianWindowMin != null ? formatMinutes(topReport.data.medianWindowMin) : "no window"}
            </span>
          </Chronograph>
        ) : null}
      </div>
    </li>
  );
}

function CompanionRow({ c, row, checked, onToggle, report }: { c: Companion; row: OverlapRow; checked: boolean; onToggle: () => void; report: WalletReport | null }) {
  const [timed, setTimed] = useState(false);
  const own = usePoll<WalletReport>(timed && !report ? `/api/wallet/${c.address}` : null, 0);
  const r = report ?? own.data;
  const id = `watch-${row.coin}-${c.address}`;
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto_6rem] items-center gap-3 py-2.5 border-b border-rule">
      <input id={id} type="checkbox" checked={checked} onChange={onToggle} className="w-4 h-4 accent-[var(--color-ink)]" />
      <label htmlFor={id} className="min-w-0 truncate cursor-pointer">
        <span className="text-[14px] text-ink">{c.label ?? "Unlabeled"}</span>{" "}
        <Link href={`/w/${c.address}`} className="fig text-[12px] text-ink-3 underline decoration-rule hover:decoration-ink">
          {shortAddr(c.address)}
        </Link>
      </label>
      <span className="fig text-[13px] text-ink-2 text-right">{formatUsd(c.positionValueUsd)}</span>
      <span className="text-right">
        {r ? (
          <span className={`fig text-[13px] ${r.medianWindowMin !== null && r.medianWindowMin < 15 ? "text-late" : "text-ink"}`}>
            {r.medianWindowMin === null ? "no window" : formatMinutes(r.medianWindowMin)}
          </span>
        ) : own.loading && timed ? (
          <span className="text-[12px] text-ink-3">timing</span>
        ) : (
          <button onClick={() => setTimed(true)} className="text-[12px] text-ink-2 underline decoration-rule hover:decoration-ink">
            time it
          </button>
        )}
      </span>
    </li>
  );
}

function AlarmBar({ owner, rows, active }: { owner: string; rows: OverlapRow[]; active: Set<WatchKey> }) {
  const [state, setState] = useState<{ status: "idle" | "sending" | "ready" | "error"; link?: string; error?: string }>({ status: "idle" });
  const watches = useMemo(
    () =>
      rows.flatMap((r) => r.companions.filter((c) => active.has(key(c.address, r))).map((c) => ({ leader: c.address, coin: r.coin, direction: r.direction }))),
    [rows, active],
  );

  async function create() {
    setState({ status: "sending" });
    try {
      const res = await fetch("/api/alarm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner, watches }) });
      const json = (await res.json().catch(() => null)) as (AlarmCreated & { error?: string }) | null;
      if (!res.ok || !json?.deepLink) throw new Error(json?.error ?? `${res.status} ${res.statusText}`);
      setState({ status: "ready", link: json.deepLink });
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : "could not create the alarm" });
    }
  }

  return (
    <section className="sticky bottom-0 mt-10 -mx-4 sm:-mx-8 px-4 sm:px-8 py-4 bg-bezel border-t border-ink" aria-label="Telegram alarm">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <p className="text-[15px] text-ink">
          <span className="fig">{watches.length}</span> wallet{watches.length === 1 ? "" : "s"} across <span className="fig">{new Set(watches.map((w) => w.coin)).size}</span> of your
          positions. The alarm fires the moment one of them reduces.
        </p>
        {state.status === "ready" && state.link ? (
          <a href={state.link} target="_blank" rel="noreferrer" className="h-11 px-5 inline-flex items-center bg-late text-dial font-medium rounded-[var(--radius-control)] whitespace-nowrap no-underline transition-[background-color] duration-150 hover:bg-ink">
            Open Telegram to arm it
          </a>
        ) : (
          <button
            onClick={create}
            disabled={watches.length === 0 || state.status === "sending"}
            className="h-11 px-5 bg-ink text-paper font-medium rounded-[var(--radius-control)] whitespace-nowrap transition-[background-color] duration-150 hover:bg-ink-2 disabled:bg-ink-3 disabled:cursor-not-allowed"
          >
            {state.status === "sending" ? "Creating alarm" : "Alert me on Telegram"}
          </button>
        )}
      </div>
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-[13px] text-late">
          {state.error}
        </p>
      )}
    </section>
  );
}
