"use client";

import { use } from "react";
import Link from "next/link";
import type { Episode, ExitWindow, WalletReport } from "@/lib/types";
import { usePoll } from "@/components/usePoll";
import { ErrorState, LoadingRows } from "@/components/States";
import { ExitTimeline } from "@/components/ExitTimeline";
import { LatencyTaxChart } from "@/components/LatencyTaxChart";
import { VerdictBanner } from "@/components/VerdictBanner";
import { PnlPanel } from "@/components/PnlPanel";
import { OpenPositionsTable } from "@/components/OpenPositionsTable";
import { FollowPanel } from "@/components/FollowPanel";
import { formatAgo, shortAddr } from "@/components/format";

function walletMeanReturnPct(episodes: Episode[]): number | null {
  const rets = episodes.filter((e) => e.observedOpen && e.walletReturnPct !== null).map((e) => e.walletReturnPct as number);
  if (rets.length === 0) return null;
  return rets.reduce((a, b) => a + b, 0) / rets.length;
}

/** An ExitWindow doesn't carry observedOpen directly; match it back to the episode it came from. */
function makeIncompleteCheck(episodes: Episode[]) {
  return (w: ExitWindow) => {
    const match = episodes.find(
      (e) => e.coin === w.coin && e.direction === w.direction && Math.abs((e.exits[0]?.t ?? -Infinity) - w.firstReduceAt) < 1000
    );
    return match ? !match.observedOpen : false;
  };
}

export default function WalletReportPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const { data: report, error, loading, fetchedAt, refresh } = usePoll<WalletReport>(`/api/wallet/${address}`, 0);

  return (
    <div className="flex-1 flex flex-col items-center">
      <div className="w-full max-w-3xl px-6 py-10 flex flex-col gap-10">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-[11px] uppercase tracking-[0.2em] text-fg-faint hover:text-fg-dim">
            ← Exit Window
          </Link>
          <span className="num text-[11px] text-fg-faint">{shortAddr(address)}</span>
        </header>

        {error ? (
          <ErrorState message={`Report failed to load: ${error}`} onRetry={refresh} />
        ) : loading && !report ? (
          <LoadingRows label={`Building the report for ${shortAddr(address)}`} rows={5} />
        ) : !report ? (
          <ErrorState message="No report returned." onRetry={refresh} />
        ) : (
          <ReportBody report={report} address={address} fetchedAt={fetchedAt} />
        )}
      </div>
    </div>
  );
}

function ReportBody({ report, address, fetchedAt }: { report: WalletReport; address: string; fetchedAt: number | null }) {
  const meanReturn = walletMeanReturnPct(report.episodes);
  const incomplete = makeIncompleteCheck(report.episodes);

  return (
    <>
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-medium">{report.label ?? shortAddr(address)}</h1>
          <span className="num text-xs text-fg-faint">{fetchedAt ? formatAgo(fetchedAt) : null}</span>
        </div>
        <p className="text-xs text-fg-faint">
          {report.episodesAnalyzed} episodes analyzed over {report.lookbackDays}d
        </p>
      </section>

      <VerdictBanner verdict={report.verdict} maxSafeLatencySec={report.maxSafeLatencySec} medianWindowMin={report.medianWindowMin} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm uppercase tracking-widest text-fg-faint">Exit windows</h2>
        {report.windows.length === 0 ? (
          <p className="text-sm text-fg-dim">No closed exits with a measurable window in this lookback.</p>
        ) : (
          <ExitTimeline windows={report.windows} episodeIsIncomplete={incomplete} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm uppercase tracking-widest text-fg-faint">Latency tax</h2>
        {report.latency.length === 0 ? (
          <p className="text-sm text-fg-dim">Not enough episodes with a known entry to backtest copier latency.</p>
        ) : (
          <LatencyTaxChart latency={report.latency} walletMeanReturnPct={meanReturn} />
        )}
      </section>

      <PnlPanel report={report} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm uppercase tracking-widest text-fg-faint">Open positions</h2>
        <OpenPositionsTable positions={report.openPositions} />
      </section>

      <FollowPanel address={address} medianWindowMin={report.medianWindowMin} />

      <footer className="text-[11px] text-fg-faint pt-2 border-t border-line num">
        This report cost {report.nansenCalls} Nansen API call{report.nansenCalls === 1 ? "" : "s"}.
      </footer>
    </>
  );
}
