"use client";

import Link from "next/link";
import { use, useState } from "react";
import type { Episode, ExitWindow, WalletReport } from "@/lib/types";
import { Chronograph } from "@/components/Chronograph";
import { ErrorState } from "@/components/States";
import { formatAgo, formatMinutes, formatUsd, shortAddr } from "@/components/format";
import { usePoll } from "@/components/usePoll";
import { ExitStrip, StripAxis } from "@/components/report/ExitStrip";
import { FollowRail } from "@/components/report/FollowRail";
import { LatencyLadder } from "@/components/report/LatencyLadder";
import { Positions } from "@/components/report/Positions";
import { DELAYS, inTime } from "@/components/timescale";

function meanWalletReturn(episodes: Episode[]): number | null {
  const r = episodes.filter((e) => e.observedOpen && e.walletReturnPct !== null).map((e) => e.walletReturnPct as number);
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
}

function openedBefore(episodes: Episode[]) {
  return (w: ExitWindow) => {
    const ep = episodes.find((e) => e.coin === w.coin && e.direction === w.direction && Math.abs((e.exits[0]?.t ?? -Infinity) - w.firstReduceAt) < 1000);
    return ep ? !ep.observedOpen : false;
  };
}

function verdictSentence(r: WalletReport): { lead: string; tone: "lume" | "late" | "ink" } {
  const m = r.medianWindowMin;
  if (r.verdict === "copyable") return { lead: `Copyable if you react within ${r.maxSafeLatencySec !== null ? formatMinutes(r.maxSafeLatencySec / 60) : "5 minutes"}.`, tone: "lume" };
  if (r.verdict === "tight") return { lead: "Only copyable at near-instant speed.", tone: "late" };
  if (r.verdict === "not_copyable") return { lead: "Not copyable. This wallet is out before you are.", tone: "late" };
  if (m !== null) return { lead: `Its exits leave a copier ${formatMinutes(m)}.`, tone: "ink" };
  return { lead: "No exit has been timed for this wallet yet.", tone: "ink" };
}

export default function WalletPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const { data: report, error, loading, fetchedAt, refresh } = usePoll<WalletReport>(`/api/wallet/${address}`, 0);

  return (
    <main className="mx-auto w-full max-w-[1320px] px-4 sm:px-8 flex-1 pb-16">
      <nav className="pt-6 text-[13px]">
        <Link href="/" className="text-ink-2 underline decoration-rule hover:decoration-ink">
          All exits
        </Link>
        <span className="text-ink-3"> / </span>
        <span className="fig text-ink-3">{shortAddr(address)}</span>
      </nav>

      {error ? (
        <div className="mt-8">
          <ErrorState message={`This wallet's report did not load (${error}).`} onRetry={refresh} />
        </div>
      ) : !report ? (
        <div className="mt-10 grid grid-cols-[minmax(0,1fr)] lg:grid-cols-12 gap-12 items-center" role="status" aria-live="polite">
          <div className="lg:col-span-5">
            <LoadingDial />
          </div>
          <div className="lg:col-span-7">
            <p className="label">Timing {shortAddr(address)}</p>
            <p className="display text-[40px] mt-2">{loading ? "Replaying 30 days of fills against the tape." : "No report."}</p>
            <p className="mt-3 text-ink-2">Nansen perp trades, PnL and positions, then Hyperliquid candles for every exit.</p>
          </div>
        </div>
      ) : (
        <Report report={report} address={address} fetchedAt={fetchedAt} />
      )}
    </main>
  );
}

function Report({ report, address, fetchedAt }: { report: WalletReport; address: string; fetchedAt: number | null }) {
  const v = verdictSentence(report);
  const before = openedBefore(report.episodes);
  const m = report.medianWindowMin;
  const windows = [...report.windows].sort((a, b) => b.firstReduceAt - a.firstReduceAt);

  return (
    <>
      <section className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-12 gap-x-12 gap-y-8 pt-6 pb-12 border-b border-ink">
        <div className="lg:col-span-7 flex flex-col justify-center">
          <p className="fig text-[13px] text-ink-3 break-all">{address}</p>
          <ClusterLine address={address} />
          <h1 className={`display text-[clamp(36px,5vw,60px)] mt-5 ${v.tone === "late" ? "text-late" : "text-ink"}`}>{v.lead}</h1>
          <dl className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5 border-t border-ink pt-5">
            <Stat term="Median window" value={m === null ? "none closed" : formatMinutes(m)} />
            <Stat term="Exits timed" value={String(report.windows.length)} />
            <Stat term="Realized 30d" value={formatUsd(report.realizedPnlUsd, { sign: true })} tone={(report.realizedPnlUsd ?? 0) >= 0 ? "lume" : "late"} />
            <Stat term="Still on paper" value={formatUsd(report.unrealizedPnlUsd, { sign: true })} tone={(report.unrealizedPnlUsd ?? 0) >= 0 ? "lume" : "late"} />
          </dl>
          <p className="mt-5 text-[13px] text-ink-3">
            Exit style: {report.exitStyle === "scaler" ? "scales out over several reduces" : report.exitStyle === "one_shot" ? "closes in a single move" : report.exitStyle === "mixed" ? "sometimes scales out, sometimes dumps at once" : "not enough closed positions to tell"}.
            {fetchedAt ? ` Data ${formatAgo(fetchedAt)}.` : ""}
          </p>
        </div>
        <div className="lg:col-span-5">
          <Chronograph size={480} windowMin={m} title={`Median exit window ${m === null ? "unknown" : formatMinutes(m)}`}>
            <span className="label">median window</span>
            <span className="display text-[clamp(28px,3.4vw,46px)] leading-none mt-1">{m === null ? "open" : formatMinutes(m)}</span>
            <span className="text-[12px] text-ink-2 mt-2">
              {m === null ? "no window closed in 24h" : `${DELAYS.filter((d) => inTime(d.sec, m)).length} of 4 delays get out in time`}
            </span>
          </Chronograph>
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-12 gap-x-12 gap-y-12 pt-10">
        <div className="lg:col-span-8 flex flex-col gap-14 min-w-0">
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h2 className="display text-[28px]">Every exit, timed</h2>
              <p className="text-[13px] text-ink-3">t = 0 at the first reduce. Shaded until price moved 1% against a holder.</p>
            </div>
            {windows.length === 0 ? (
              <p className="text-[15px] text-ink-2 border-t border-ink pt-4">This wallet has not reduced a position in the last {report.lookbackDays} days.</p>
            ) : (
              <>
                <StripAxis />
                <ol className="border-t border-ink">
                  {windows.map((w) => (
                    <ExitStrip key={`${w.coin}-${w.firstReduceAt}`} w={w} openedBefore={before(w)} />
                  ))}
                </ol>
              </>
            )}
          </section>

          <section>
            <h2 className="display text-[28px] mb-1">What copying it cost</h2>
            <p className="text-[13px] text-ink-3 mb-4">A copier mirroring every entry and every exit at your delay, after 4.5 bps fees and 5 bps slippage each way.</p>
            <LatencyLadder latency={report.latency} walletReturnPct={meanWalletReturn(report.episodes)} maxSafeLatencySec={report.maxSafeLatencySec} note={report.backtestNote ?? null} />
          </section>

          <section>
            <h2 className="display text-[28px] mb-4">Open right now</h2>
            <Positions positions={report.openPositions} />
          </section>
        </div>
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-6">
            <FollowRail address={address} medianWindowMin={m} />
          </div>
        </div>
      </div>

      <footer className="mt-14 pt-4 border-t border-ink flex flex-wrap justify-between gap-2 text-[12px] text-ink-3">
        <span>
          Built from Nansen profiler/perp-trades, perp-pnl-summary and perp-positions, timed on Hyperliquid candles.
        </span>
        <span className="fig">
          this report: {report.nansenCalls} new Nansen call{report.nansenCalls === 1 ? "" : "s"}, rest from cache
        </span>
      </footer>
    </>
  );
}

function Stat({ term, value, tone }: { term: string; value: string; tone?: "lume" | "late" }) {
  return (
    <div>
      <dt className="label">{term}</dt>
      <dd className={`fig text-[20px] mt-1 ${tone === "lume" ? "text-lume" : tone === "late" ? "text-late" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function LoadingDial() {
  const [t0] = useState(() => Date.now());
  return <Chronograph size={420} startedAt={t0} title="Building the report" />;
}

interface Cluster {
  labels: string[];
  siblings: { address: string; label: string | null; relation: string }[];
}

/** Nansen labels for this wallet and the wallets it is funded through. */
function ClusterLine({ address }: { address: string }) {
  const { data } = usePoll<Cluster>(`/api/intel/cluster/${address}`, 0);
  if (!data) return null;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {data.labels.length > 0 && (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-[14px] text-ink-2">
          {data.labels.map((l) => (
            <span key={l} className="border-b border-rule">{l}</span>
          ))}
        </p>
      )}
      {data.siblings.length > 0 && (
        <p className="text-[13px] text-ink-3">
          Linked wallets, watched with it:{" "}
          {data.siblings.slice(0, 3).map((s, i) => (
            <span key={s.address}>
              {i > 0 ? ", " : ""}
              <Link href={`/w/${s.address}`} className="fig underline decoration-rule hover:decoration-ink">
                {shortAddr(s.address)}
              </Link>{" "}
              ({s.relation.toLowerCase()})
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
