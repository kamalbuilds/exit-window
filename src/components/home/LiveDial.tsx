"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { WalletReport } from "@/lib/types";
import { Chronograph } from "../Chronograph";
import { type FeedItem } from "../feed";
import { formatClock, formatMinutes, formatUsd, shortAddr, toMs } from "../format";
import { usePoll } from "../usePoll";

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return <>--:--</>;
  const sec = Math.max(0, (now - since) / 1000);
  return <>{sec >= 3600 ? formatMinutes(sec / 60) : formatClock(sec)}</>;
}

/** The newest real Smart Money reduce, timed live against that wallet's measured median window. */
export function LiveDial({ exit, loading }: { exit: FeedItem | null; loading: boolean }) {
  const report = usePoll<WalletReport>(exit ? `/api/wallet/${exit.trader_address}` : null, 0);
  const since = exit ? toMs(exit.timestamp) : null;
  const median = report.data?.medianWindowMin;
  const who = exit ? exit.trader_address_label ?? shortAddr(exit.trader_address) : "";

  return (
    <div className="flex flex-col gap-5">
      <Chronograph
        size={600}
        startedAt={since}
        windowMin={report.data ? median ?? null : undefined}
        title={exit ? `${who} started reducing ${exit.token_symbol}; live elapsed time against its measured exit window` : "Waiting for a live Smart Money exit"}
      >
        {exit && since ? (
          <>
            <span className="label">since first reduce</span>
            <span className="fig text-[clamp(26px,4.4vw,46px)] leading-none mt-1 text-ink">
              <Elapsed since={since} />
            </span>
            <span className="mt-3 text-[13px] text-ink-2 leading-snug">
              {report.loading
                ? "Timing this wallet's past exits"
                : median != null
                  ? <>its windows close in <span className="fig text-ink">{formatMinutes(median)}</span> (median)</>
                  : report.data
                    ? "no closed window measured yet"
                    : "window history unavailable"}
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
