"use client";

import Link from "next/link";
import { XLogo } from "@phosphor-icons/react";
import { use, useState, type ReactNode } from "react";
import type { AlarmReplay, Episode, ExitDna, ExitWindow, WalletReport } from "@/lib/types";
import { Chronograph } from "@/components/Chronograph";
import { ErrorState } from "@/components/States";
import { formatAgo, formatDate, formatMinutes, formatPct, formatUsd, shortAddr } from "@/components/format";
import { usePoll } from "@/components/usePoll";
import { ExitStrip, StripAxis } from "@/components/report/ExitStrip";
import { FollowRail } from "@/components/report/FollowRail";
import { LatencyLadder } from "@/components/report/LatencyLadder";
import { Positions } from "@/components/report/Positions";
import { DELAYS, inTime } from "@/components/timescale";

const STYLE_GLOSS: Record<ExitDna["style"], string> = {
  nuclear: "dumps the whole position at once",
  scaler: "sells in several steps",
  trimmer: "trims and keeps holding",
  mixed: "no single consistent pattern",
};

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

function exitStyleSentence(r: WalletReport): string {
  if (r.exitStyle === "scaler") return "Exit style: scales out over several reduces.";
  if (r.exitStyle === "one_shot") return "Exit style: closes in a single move.";
  if (r.exitStyle === "mixed") return "Exit style: sometimes scales out, sometimes dumps at once.";
  return "Exit style: not enough closed positions to tell.";
}

export default function WalletPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const { data: report, error, loading, fetchedAt, refresh } = usePoll<WalletReport>(`/api/wallet/${address}`, 0);

  return (
    <main className="px-4 lg:px-8 py-6 max-w-[1440px] w-full">
      {error ? (
        <div className="mt-4">
          <ErrorState message={`This wallet's exit history is still being assembled. Try again in a moment.`} onRetry={refresh} />
        </div>
      ) : !report ? (
        <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-12 gap-x-8 gap-y-8 items-center pt-4" role="status" aria-live="polite">
          <div className="lg:col-span-5">
            <LoadingDial />
          </div>
          <div className="lg:col-span-7">
            <p className="label">Timing {shortAddr(address)}</p>
            <h1 className="display text-[24px] mt-2 max-w-[40ch]">{loading ? "Replaying 30 days of fills against the tape." : "No report."}</h1>
            <p className="mt-2 text-ink-2 max-w-[60ch]">Nansen perp trades, PnL and positions, then Hyperliquid candles for every exit.</p>
          </div>
        </div>
      ) : (
        <Report report={report} address={address} fetchedAt={fetchedAt} />
      )}
    </main>
  );
}

function PanelTitle({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 border-b border-rule">
      <h2 className="display text-[16px]">{children}</h2>
      {meta ? <span className="text-[12px] text-ink-3">{meta}</span> : null}
    </div>
  );
}

function Report({ report, address, fetchedAt }: { report: WalletReport; address: string; fetchedAt: number | null }) {
  const v = verdictSentence(report);
  const before = openedBefore(report.episodes);
  const m = report.medianWindowMin;
  const windows = [...report.windows].sort((a, b) => b.firstReduceAt - a.firstReduceAt);
  // Worst exit window = the fastest one to close: least time an unaware copier had to react.
  const closedMins = report.windows.map((w) => w.windowMin).filter((w): w is number => w !== null);
  const worst = closedMins.length ? Math.min(...closedMins) : null;
  const inTimeCount = DELAYS.filter((d) => inTime(d.sec, m)).length;

  return (
    <div className="flex flex-col gap-6">
      <section className="panel p-4 lg:p-5">
        <div className="flex items-start justify-between gap-4">
          <p className="fig text-[13px] text-ink-2 break-all">{address}</p>
          <a
            href={`https://x.com/intent/post?text=${encodeURIComponent(`${v.lead} How fast does the Smart Money in your trade get out? Built on @nansen_ai`)}&url=${encodeURIComponent(`https://exit-window.fly.dev/w/${address}`)}`}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary h-9 px-3 inline-flex items-center gap-2 text-[13px] no-underline whitespace-nowrap shrink-0"
          >
            <XLogo size={15} weight="bold" /> Share Exit DNA
          </a>
        </div>
        <ClusterLine address={address} />

        <h1 className={`display text-[24px] mt-3 max-w-[52ch] ${v.tone === "late" ? "text-late" : v.tone === "lume" ? "text-lume" : "text-ink"}`}>{v.lead}</h1>
        <p className="mt-1.5 text-[14px] text-ink-2 max-w-[70ch]">{exitStyleSentence(report)}</p>

        <dl className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-y-5 border-t border-rule pt-4">
          <Stat
            term="Median window"
            value={m === null ? "none closed" : formatMinutes(m)}
            title="Exit window: how long a copier can hold after this wallet's first reduce before price moves 1% against them."
          />
          <Stat term="Fastest window" value={worst === null ? "none closed" : formatMinutes(worst)} div />
          <Stat term="Exits timed" value={String(report.windows.length)} div />
          <Stat term="Realized 30d" value={formatUsd(report.realizedPnlUsd, { sign: true })} tone={(report.realizedPnlUsd ?? 0) >= 0 ? "lume" : "late"} div />
          <Stat term="Still on paper" value={formatUsd(report.unrealizedPnlUsd, { sign: true })} tone={(report.unrealizedPnlUsd ?? 0) >= 0 ? "lume" : "late"} div />
        </dl>

        <p className="fig mt-4 text-[12px] text-ink-3">
          {windows.length > 0 ? `latest timed exit ${formatDate(windows[0].firstReduceAt)}` : ""}
        </p>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 flex flex-col gap-6 min-w-0">
          {report.exitDna && <ExitDnaBlock dna={report.exitDna} />}
          {report.alarmReplay && <AlarmReplayBlock ar={report.alarmReplay} />}

          <section className="panel overflow-hidden">
            <PanelTitle meta="t = 0 at the first reduce">Every exit, timed</PanelTitle>
            {windows.length === 0 ? (
              <p className="px-4 py-5 text-[14px] text-ink-2">This wallet has not reduced a position in the last {report.lookbackDays} days.</p>
            ) : (
              <>
                <div className="px-4 pt-3 pb-1">
                  <StripAxis />
                </div>
                <p className="px-4 pb-2 text-[12px] text-ink-3">Shaded until price moved 1% against a holder. Dots are copier delays: green gets out in time, red arrives after the window closed.</p>
                <ol>
                  {windows.map((w) => (
                    <ExitStrip key={`${w.coin}-${w.firstReduceAt}`} w={w} openedBefore={before(w)} />
                  ))}
                </ol>
              </>
            )}
          </section>

          <section className="panel overflow-hidden">
            <PanelTitle meta="4.5 bps fees, 5 bps slippage each way">What copying it cost</PanelTitle>
            <LatencyLadder latency={report.latency} walletReturnPct={meanWalletReturn(report.episodes)} maxSafeLatencySec={report.maxSafeLatencySec} note={report.backtestNote ?? null} />
          </section>

          <section className="panel overflow-hidden">
            <PanelTitle meta={`${report.openPositions.length} open`}>Open right now</PanelTitle>
            <Positions positions={report.openPositions} />
          </section>
        </div>

        <div className="lg:col-span-4 flex flex-col gap-6 min-w-0">
          <section className="panel overflow-hidden">
            <PanelTitle meta="10s to 24h">Exit window</PanelTitle>
            <div className="px-4 pt-2 pb-4">
              <Chronograph size={340} windowMin={m} title={`Median exit window ${m === null ? "unknown" : formatMinutes(m)}`}>
                <span className="label">median window</span>
                <span className="display fig text-[26px] leading-none mt-1">{m === null ? "open" : formatMinutes(m)}</span>
                <span className="text-[12px] text-ink-2 mt-1.5 block">
                  {m === null ? "no window closed in 24h" : `${inTimeCount} of 4 delays get out in time`}
                </span>
              </Chronograph>
              <p className="mt-2 text-[12px] text-ink-3">
                {worst !== null && worst !== m ? `Fastest close ${formatMinutes(worst)}. ` : ""}Red point: where the window closed. Dots on the ring: copier delays, green if they get out in time.</p>
            </div>
          </section>

          <div className="lg:sticky lg:top-20">
            <FollowRail address={address} medianWindowMin={m} />
          </div>
        </div>
      </div>

      <footer className="mt-2 pt-4 border-t border-rule flex flex-wrap justify-between gap-2 text-[12px] text-ink-3">
        <span>Built from Nansen profiler/perp-trades, perp-pnl-summary and perp-positions, timed on Hyperliquid candles.</span>
      </footer>
    </div>
  );
}

function Stat({ term, value, tone, title, div }: { term: string; value: string; tone?: "lume" | "late"; title?: string; div?: boolean }) {
  return (
    <div className={div ? "lg:border-l lg:border-rule lg:pl-5" : ""}>
      <dt className="label" title={title}>
        {term}
      </dt>
      <dd className={`fig text-[20px] mt-0.5 ${tone === "lume" ? "text-lume" : tone === "late" ? "text-late" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

/** How this wallet tends to leave a position, distilled from its own closed episodes. */
function ExitDnaBlock({ dna }: { dna: ExitDna }) {
  const clipsLabel = Number.isInteger(dna.medianClips) ? String(dna.medianClips) : dna.medianClips.toFixed(1);
  return (
    <section className="panel overflow-hidden">
      <PanelTitle meta={`${dna.sample} closed trade${dna.sample === 1 ? "" : "s"}`}>Exit DNA</PanelTitle>
      <div className="px-4 py-4">
        <p className="flex flex-wrap items-center gap-2">
          <span className="chip chip-mute capitalize">{dna.style}</span>
          <span className="text-[13px] text-ink-3">{STYLE_GLOSS[dna.style]}</span>
        </p>
        <p className="mt-2.5 text-[14px] text-ink-2 max-w-[64ch]">
          First reduce became a full exit <span className="fig text-ink">{Math.round(dna.fullExitAfterFirstReducePct)}%</span> of the time
          {dna.firstReduceToFlatMedianMin != null ? (
            <>
              , usually within <span className="fig text-ink">{formatMinutes(dna.firstReduceToFlatMedianMin)}</span>
            </>
          ) : null}
          , in <span className="fig text-ink">{clipsLabel}</span> clip{dna.medianClips === 1 ? "" : "s"}.
        </p>
      </div>
    </section>
  );
}

/** Backtests the alarm itself against this wallet's own closed episodes. */
function AlarmReplayBlock({ ar }: { ar: AlarmReplay }) {
  return (
    <section className="panel overflow-hidden">
      <PanelTitle meta={`${ar.episodes} replayed`}>Alarm replay</PanelTitle>
      <div className="px-4 py-4">
        <p className="text-[14px] text-ink-2 max-w-[64ch]">
          Acting on the alarm within a minute saved a holder <span className="fig text-ink">{formatPct(ar.savedVsWaitingPct, 1)}</span> on average vs waiting
          for this wallet&apos;s last exit (<span className="fig text-ink">{ar.episodes}</span> exit{ar.episodes === 1 ? "" : "s"}).
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-rule pt-4">
          <div>
            <dt className="label">vs holding 24h</dt>
            <dd className={`fig text-[28px] mt-0.5 ${ar.savedVsHoldingPct >= 0 ? "text-lume" : "text-late"}`}>{formatPct(ar.savedVsHoldingPct, 1)}</dd>
          </div>
          <div className="lg:border-l lg:border-rule lg:pl-6">
            <dt className="label">vs waiting for the last exit</dt>
            <dd className={`fig text-[28px] mt-0.5 ${ar.savedVsWaitingPct >= 0 ? "text-lume" : "text-late"}`}>{formatPct(ar.savedVsWaitingPct, 1)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function LoadingDial() {
  const [t0] = useState(() => Date.now());
  return <Chronograph size={340} startedAt={t0} title="Building the report" />;
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
    <div className="mt-2 flex flex-col gap-2">
      {data.labels.length > 0 && (
        <p className="flex flex-wrap gap-1.5">
          {data.labels.map((l) => (
            <span key={l} className="chip chip-mute">
              {l}
            </span>
          ))}
        </p>
      )}
      {data.siblings.length > 0 && (
        <p className="text-[12px] text-ink-3">
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
