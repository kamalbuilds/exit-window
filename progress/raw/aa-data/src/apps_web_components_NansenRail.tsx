"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Call, CallStart } from "@labelme/core/browser";
import { REPO } from "@/lib/site";

/**
 * One row of the rail. `call` is undefined while the call is in flight (the `start` event arrived, the `Call` has not) —
 * every landed row is the SAME `Call` object the provenance drawer prints; nothing here is synthesised.
 */
export type RailRow = {
  key: string;
  /** which run (example replay, a reveal, a live draw) the row belongs to — the header counters follow the latest run */
  run: number;
  origin: "live" | "replayed";
  endpoint: string;
  body: Record<string, unknown>;
  startedAt: number;
  call?: Call;
  /** client clock when the Call landed (wall time for the counters; replayed rows land instantly) */
  landedAt?: number;
  /** ISO date the replayed response was recorded (fixture clock) */
  recordedAt?: string;
};

export const RAIL_CAP = 200;

export function rowFromStart(run: number, s: CallStart): RailRow {
  return { key: `${run}:${s.seq}`, run, origin: "live", endpoint: s.endpoint, body: s.body, startedAt: s.startedAt };
}
/** land a call: resolve the pending row with the same run+seq, else append (a client without `start` events) */
export function landCall(rows: RailRow[], run: number, call: Call, origin: RailRow["origin"] = "live", recordedAt?: string): RailRow[] {
  const key = `${run}:${call.seq ?? `x${rows.length}`}`;
  const i = rows.findIndex((r) => r.key === key && !r.call);
  const landedAt = Date.now();
  if (i >= 0) return rows.map((r, n) => (n === i ? { ...r, call, origin, recordedAt, landedAt } : r));
  return cap([...rows, { key, run, origin, endpoint: call.endpoint, body: call.body, startedAt: landedAt - (call.totalMs || 0), call, recordedAt, landedAt }]);
}
export function replayRows(run: number, calls: Call[], recordedAt?: string): RailRow[] {
  return calls.map((call, n) => ({
    key: `${run}:r${call.seq ?? n}`,
    run,
    origin: "replayed",
    endpoint: call.endpoint,
    body: call.body,
    startedAt: Date.now(),
    call,
    recordedAt,
  }));
}
export function cap(rows: RailRow[]): RailRow[] {
  return rows.length > RAIL_CAP ? rows.slice(rows.length - RAIL_CAP) : rows;
}

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const TOKEN_SYMBOLS: Record<string, string> = {
  "0x6982508145454ce325ddbe47a25d4ec3d2311933": "PEPE",
  "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce": "SHIB",
  "0x514910771af9ca656af840dff83e8264ecf986ca": "LINK",
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": "UNI",
  "0xaaee1a9723aadb7afa2810263653a34ba2c21c7a": "MOG",
  "0xa35923162c49cf95e6bf26623385eb431ad920d3": "TURBO",
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "WETH",
};
/** One line of params, never a key, never a full body: `0x5aad…0f6e · ethereum · 30 d`, `WETH · exchange · p2`. */
export function summarize(body: Record<string, unknown>): string {
  const out: string[] = [];
  const b = body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (typeof b.address === "string") out.push(short(b.address));
  if (typeof b.token_address === "string") out.push(TOKEN_SYMBOLS[b.token_address.toLowerCase()] ?? short(b.token_address));
  if (typeof b.chain === "string") out.push(b.chain);
  else if (Array.isArray(b.chains)) out.push(b.chains.join(","));
  if (b.date && typeof b.date.from === "string" && typeof b.date.to === "string") {
    const days = Math.round((Date.parse(b.date.to) - Date.parse(b.date.from)) / 86_400_000);
    if (Number.isFinite(days) && days > 0) out.push(`${days} d`);
  }
  if (typeof b.label_type === "string") out.push(b.label_type);
  else if (b.filters && Array.isArray(b.filters.exclude_smart_money_labels)) out.push(`−${b.filters.exclude_smart_money_labels.length} label groups`);
  if (typeof b.buy_or_sell === "string") out.push(b.buy_or_sell.toLowerCase());
  const page = b.pagination && typeof b.pagination.page === "number" ? b.pagination.page : 1;
  if (page > 1) out.push(`p${page}`);
  return out.join(" · ");
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
/** Count-up over 240 ms (`--ease`-like) — a counter that TICKS as rows land. Reduced motion: jumps. */
function useCountUp(target: number, decimals = 0): string {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target); // the value on screen right now — a cancelled animation resumes from here, never from a stale start
  const raf = useRef(0);
  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    const reduce = prefersReducedMotion(); // reduced motion: one frame, straight to the value
    const t0 = performance.now();
    const step = (t: number) => {
      const k = reduce ? 1 : Math.min(1, (t - t0) / 240);
      const e = 1 - Math.pow(1 - k, 3);
      const v = k >= 1 ? target : from + (target - from) * e;
      shownRef.current = v;
      setShown(v);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);
  return decimals ? shown.toFixed(decimals) : String(Math.round(shown));
}

export function railTotals(rows: RailRow[]) {
  const landed = rows.filter((r) => r.call);
  const live = landed.filter((r) => r.origin === "live" && r.landedAt);
  // wall time of the run (first start → last landing), not the sum of parallel latencies
  const ms = live.length ? Math.max(...live.map((r) => r.landedAt!)) - Math.min(...rows.filter((r) => r.origin === "live").map((r) => r.startedAt)) : 0;
  return {
    calls: rows.length,
    credits: landed.reduce((a, r) => a + (r.call?.credits ?? 0), 0),
    ms: Math.max(0, ms),
    pending: rows.length - landed.length,
  };
}
const plural = (n: number, word: string) => `${word}${n === 1 ? "" : "s"}`;

function Row({ r }: { r: RailRow }) {
  const c = r.call;
  const state = !c ? "pending" : !c.ok ? "error" : r.origin === "replayed" ? "replayed" : c.cached ? "cached" : "live";
  const parts = r.endpoint.split("/");
  return (
    <li className={`rail-row ${state}`} data-state={state}>
      <i className="rail-dot" aria-hidden />
      <div className="rail-ep">
        <span className="rail-method">POST</span>{" "}
        <code>
          {parts.map((p, n) => (
            <span key={n}>
              {n > 0 && (
                <>
                  /<wbr />
                </>
              )}
              <span className={n < parts.length - 1 ? "rail-group" : undefined}>{p}</span>
            </span>
          ))}
        </code>
      </div>
      <span className="rail-cr-slot">
        {!c ? (
          <span className="rail-wait" aria-hidden>
            …
          </span>
        ) : !c.ok ? (
          <span className="rail-cr err">{c.status ? `HTTP ${c.status}` : (c.error ?? "failed")}</span>
        ) : (
          <span className="rail-cr">{r.origin === "replayed" ? "0 cr · replayed" : c.cached ? "0 cr · cached" : `${c.credits} cr`}</span>
        )}
      </span>
      <div className="rail-sub">
        <div className="rail-params">{summarize(r.body) || "—"}</div>
        <div className="rail-meta">
          {!c ? null : !c.ok ? (
            <span className="rail-ms">{c.totalMs} ms</span>
          ) : (
            <>
              <span className="rail-ms">{r.origin === "replayed" ? (r.recordedAt ?? "").slice(0, 10) : c.cached ? "cache" : `${c.totalMs} ms`}</span>
              {c.responseHash && (
                <span className="rail-hash" title={`sha256 ${c.responseHash}`}>
                  sha256 {c.responseHash.slice(0, 4)}…
                </span>
              )}
            </>
          )}
        </div>
      </div>
      {!c && <i className="rail-shimmer" aria-hidden />}
      <span className="sr-only">{state}</span>
    </li>
  );
}

/**
 * The Nansen call rail (LANDING_DESIGN §13 A3): a persistent right-hand panel that streams every Nansen call the page
 * makes, as it happens — the live meter. The drawer stays the receipt; both print the same `Call` objects.
 * ≥ 1280 px: fixed rail. Below: a 44 px bottom bar that expands into a sheet.
 */
export function NansenRail({
  rows,
  currentRun,
  onClear,
  onOpenReceipt,
  onRunLive,
  liveBusy,
}: {
  rows: RailRow[];
  currentRun: number;
  onClear: () => void;
  onOpenReceipt: () => void;
  onRunLive: () => void;
  liveBusy: boolean;
}) {
  const [open, setOpen] = useState(false);
  // below 1280 px the sheet is collapsed by max-height only — mark its body inert so hidden controls leave the tab order
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const listRef = useRef<HTMLOListElement>(null);
  const titleId = useId();
  const run = rows.filter((r) => r.run === currentRun);
  const cur = railTotals(run);
  const all = railTotals(rows);
  const calls = useCountUp(cur.calls);
  const credits = useCountUp(cur.credits);
  const secs = useCountUp(cur.ms / 1000, 1);
  const liveInRun = run.some((r) => r.origin === "live");

  // oldest at top, auto-scroll to the newest row as it lands
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [rows.length, cur.pending]);

  return (
    <aside className={`rail ${open ? "open" : ""}`} aria-label="Nansen API calls" aria-live="polite" aria-busy={cur.pending > 0}>
      <button type="button" className="rail-bar" aria-expanded={open} aria-controls={titleId} onClick={() => setOpen((o) => !o)} data-testid="rail-bar">
        <span className="kicker">Nansen API</span>
        <span className="rail-bar-text">
          Nansen calls · <b>{all.calls}</b> · <b>{all.credits}</b> cr
        </span>
        <span className="rail-chevron" aria-hidden>
          {open ? "▾" : "▴"}
        </span>
      </button>
      <div className="rail-body" id={titleId} inert={!wide && !open ? true : undefined}>
        <header className="rail-head">
          <div className="rail-title">
            <span className="kicker">Nansen API</span>
            <span>Live call log</span>
          </div>
          {/* the animated counters are hidden from AT (a count-up would be announced 15 times); the sr line carries the settled totals */}
          <div className="rail-counters" data-testid="rail-counters" aria-hidden>
            <b>{calls}</b> {plural(Number(calls), "call")} · <b>{credits}</b> cr ·{" "}
            {liveInRun ? (
              <>
                <b>{secs}</b> s
              </>
            ) : run.length ? (
              "replayed"
            ) : (
              <>
                <b>0.0</b> s
              </>
            )}
          </div>
          <span className="sr-only">
            {cur.calls} {plural(cur.calls, "call")}, {cur.credits} credits{cur.pending ? `, ${cur.pending} pending` : ""}
          </span>
        </header>
        {rows.length === 0 ? (
          <div className="rail-empty">
            <p>No calls yet.</p>
            <button type="button" className="btn" onClick={onRunLive} disabled={liveBusy}>
              Draw a fresh card live · 13 credits
            </button>
            <small>Guessing a recorded card replays its four calls here at 0 credits.</small>
          </div>
        ) : (
          <ol className="rail-rows" ref={listRef}>
            {rows.map((r) => (
              <Row key={r.key} r={r} />
            ))}
          </ol>
        )}
        <footer className="rail-foot">
          <span>
            session · <b>{all.calls}</b> {plural(all.calls, "call")} · <b>{all.credits}</b> {plural(all.credits, "credit")}
          </span>
          <span className="rail-foot-links">
            {run.some((r) => r.call) && (
              <button type="button" className="rail-link" onClick={onOpenReceipt}>
                receipt
              </button>
            )}
            {rows.length > 0 && (
              <button type="button" className="rail-link" onClick={onClear}>
                clear
              </button>
            )}
            <a className="rail-link" href={`${REPO}#-nansen-integration`} target="_blank" rel="noreferrer">
              same calls: <code>--explain</code> in the CLI
            </a>
          </span>
        </footer>
      </div>
    </aside>
  );
}
