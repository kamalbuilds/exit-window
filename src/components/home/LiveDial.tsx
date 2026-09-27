"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { WalletReport } from "@/lib/types";
import { Chronograph } from "../Chronograph";
import { type FeedItem } from "../feed";
import { formatClock, formatMinutes, formatUsd, shortAddr, toMs } from "../format";

const CANDIDATES = 5;

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const sec = Math.max(0, (now - since) / 1000);
  return <>{sec >= 3600 ? formatMinutes(sec / 60) : formatClock(sec)}</>;
}

interface Pick {
  exit: FeedItem;
  report: WalletReport | null; // set only once a cached report with a measured window is found
  checking: boolean;
}

/** Picks the most recent Smart Money reduce that already has a cached report with a measured
 * window. Probes up to 5 newest candidates one at a time via ?cached=1 (a cache read, never a
 * Nansen call), stopping at the first with medianWindowMin != null. If none of the probed
 * candidates have a window yet, falls back to the newest reduce, unwindowed. */
interface Resolved {
  key: string;
  exit: FeedItem;
  report: WalletReport | null;
}

function usePickLiveExit(candidates: FeedItem[]): Pick | null {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const key = candidates
    .slice(0, CANDIDATES)
    .map((c) => `${c.trader_address}-${c.timestamp}`)
    .join(",");

  useEffect(() => {
    if (candidates.length === 0) return;
    let cancelled = false;

    (async () => {
      for (const exit of candidates.slice(0, CANDIDATES)) {
        if (cancelled) return;
        try {
          const res = await fetch(`/api/wallet/${exit.trader_address}?cached=1`);
          if (res.ok) {
            const report = (await res.json()) as WalletReport;
            if (report.medianWindowMin != null) {
              if (!cancelled) setResolved({ key, exit, report });
              return;
            }
          }
        } catch {
          // try the next candidate
        }
      }
      if (!cancelled) setResolved({ key, exit: candidates[0], report: null });
    })();

    return () => {
      cancelled = true;
    };
    // key captures the candidate set; candidates itself is a new array every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (candidates.length === 0) return null;
  if (resolved && resolved.key === key) return { exit: resolved.exit, report: resolved.report, checking: false };
  // resolution for this candidate set hasn't landed yet: show the newest candidate optimistically
  return { exit: candidates[0], report: null, checking: true };
}

/** The most recent Smart Money reduce with a known exit window, timed live against it. */
export function LiveDial({ exits, loading }: { exits: FeedItem[]; loading: boolean }) {
  const pick = usePickLiveExit(exits);
  const exit = pick?.exit ?? null;
  const since = exit ? toMs(exit.timestamp) : null;
  const median = pick?.report?.medianWindowMin;
  const who = exit ? (exit.trader_address_label ?? shortAddr(exit.trader_address)) : "";

  return (
    <div className="flex flex-col gap-5">
      <Chronograph
        size={600}
        startedAt={since}
        windowMin={pick?.report ? (median ?? null) : undefined}
        title={exit ? `${who} started reducing ${exit.token_symbol}; live elapsed time against its measured exit window` : "Waiting for a live Smart Money exit"}
      >
        {exit && since ? (
          <>
            <span className="label">since first reduce</span>
            <span className="fig text-[clamp(26px,4.4vw,46px)] leading-none mt-1 text-ink">
              <Elapsed since={since} />
            </span>
            <span className="mt-3 text-[13px] text-ink-2 leading-snug">
              {pick?.checking ? (
                "Checking this wallet's timed exits"
              ) : median != null ? (
                <>
                  its windows close in <span className="fig text-ink">{formatMinutes(median)}</span> (median)
                </>
              ) : (
                "open the wallet to time it"
              )}
            </span>
          </>
        ) : (
          <span className="text-[14px] text-ink-3">{loading ? "Reading the Smart Money tape" : "No labeled wallet is exiting right now"}</span>
        )}
      </Chronograph>

      {exit && (
        <p className="text-[15px] text-ink-2 max-w-[60ch]">
          <Link href={`/w/${exit.trader_address}`} className="text-ink font-medium underline decoration-rule hover:decoration-ink">
            {who}
          </Link>{" "}
          just reduced a {exit.side.toLowerCase()} in <span className="fig text-ink">{exit.token_symbol}</span> worth{" "}
          <span className="fig text-ink">{formatUsd(exit.value_usd)}</span>. The hand is the time since. A copier still holding
          is safe while it sits inside the shaded window.
        </p>
      )}
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-2" aria-label="Legend">
        <li className="flex items-center gap-2"><Dot tone="lume" /> delay lands inside the window</li>
        <li className="flex items-center gap-2"><Dot tone="late" /> window closed first: you were the exit liquidity</li>
        <li className="flex items-center gap-2"><span className="inline-block w-5 h-2 bg-window border-t border-ink" /> measured window</li>
      </ul>
    </div>
  );
}

function Dot({ tone }: { tone: "lume" | "late" }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full border border-ink ${tone === "lume" ? "bg-lume" : "bg-late"}`} />;
}
