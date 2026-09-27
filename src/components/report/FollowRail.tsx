"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenPosition, PositionChange } from "@/lib/types";
import { diffPositions } from "@/lib/follow";
import { Chronograph } from "../Chronograph";
import { formatClock, formatMinutes, formatUsd } from "../format";
import { usePoll } from "../usePoll";

const POLL_MS = 20_000;

interface Status {
  live?: boolean;
  builderFeeApproved?: boolean;
}

interface MirrorResult {
  mode: "paper" | "live";
  usdValue?: number;
  executed?: boolean;
  capped?: boolean;
  error?: string;
}

interface LedgerEntry {
  id: string;
  change: PositionChange;
  status: "sending" | "done" | "error";
  result?: MirrorResult;
  error?: string;
}

/** Follow a wallet: poll its positions, and on a reduce start the clock and mirror the reduce. */
export function FollowRail({ address, medianWindowMin }: { address: string; medianWindowMin: number | null }) {
  const [following, setFollowing] = useState(false);
  const [positions, setPositions] = useState<OpenPosition[] | null>(null);
  const [polledAt, setPolledAt] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [trigger, setTrigger] = useState<PositionChange | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const prev = useRef<OpenPosition[] | null>(null);
  const { data: status } = usePoll<Status>("/api/status", 0);
  const live = status?.live === true;

  const mirror = useCallback(
    async (change: PositionChange) => {
      const id = `${change.coin}-${change.at}`;
      setLedger((l) => [{ id, change, status: "sending" }, ...l]);
      try {
        const res = await fetch("/api/mirror", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leader: address, change }),
        });
        const json = (await res.json().catch(() => null)) as MirrorResult | null;
        if (!res.ok || !json) throw new Error(json?.error ?? `${res.status} ${res.statusText}`);
        setLedger((l) => l.map((e) => (e.id === id ? { ...e, status: "done", result: json } : e)));
      } catch (err) {
        const message = err instanceof Error ? err.message : "mirror failed";
        setLedger((l) => l.map((e) => (e.id === id ? { ...e, status: "error", error: message } : e)));
      }
    },
    [address],
  );

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/positions/${address}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      const next: OpenPosition[] = Array.isArray(json) ? json : (json.data ?? []);
      const at = Date.now();
      if (prev.current) {
        for (const change of diffPositions(prev.current, next, at)) {
          if (change.kind === "reduce" || change.kind === "close") {
            setTrigger(change);
            mirror(change);
          }
        }
      }
      prev.current = next;
      setPositions(next);
      setPolledAt(at);
      setPollError(null);
    } catch (e) {
      setPollError(e instanceof Error ? e.message : "positions request failed");
    }
  }, [address, mirror]);

  useEffect(() => {
    if (!following) return;
    poll();
    const id = setInterval(() => {
      if (document.visibilityState !== "hidden") poll();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [following, poll]);

  useEffect(() => {
    if (!following) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [following]);

  const left = trigger && medianWindowMin !== null ? medianWindowMin * 60 - (now - trigger.at) / 1000 : null;
  const nextPollIn = polledAt ? Math.max(0, Math.ceil((polledAt + POLL_MS - now) / 1000)) : null;

  return (
    <aside className="bg-dial border border-ink" aria-label="Follow this wallet">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-ink bg-bezel">
        <div>
          <h2 className="display text-[22px]">Watch live</h2>
          <p className="text-[13px] text-ink-3">
            {live ? "Live: reduces are mirrored on your Hyperliquid account, capped." : "Paper: reduces are mirrored and recorded, nothing is sent."}
          </p>
        </div>
        <button
          onClick={() => setFollowing((f) => !f)}
          aria-pressed={following}
          className={`h-10 px-4 rounded-[var(--radius-control)] text-[14px] font-medium whitespace-nowrap transition-[background-color,color] duration-150 ${
            following ? "bg-late text-dial hover:bg-ink" : "bg-ink text-paper hover:bg-ink-2"
          }`}
        >
          {following ? "Stop" : "Start following"}
        </button>
      </div>

      <div className="px-5 py-5 flex flex-col gap-5">
        {trigger ? (
          <Chronograph size={320} startedAt={trigger.at} windowMin={medianWindowMin} title={`${trigger.coin} reduced; time since against the median window`}>
            <span className="label">{trigger.coin} reduced</span>
            <span className={`fig text-[34px] leading-none mt-1 ${left !== null && left <= 0 ? "text-late" : "text-ink"}`}>
              {left === null ? formatClock((now - trigger.at) / 1000) : left > 0 ? formatClock(left) : "closed"}
            </span>
            <span className="text-[12px] text-ink-2 mt-2">{left === null ? "no median window yet" : left > 0 ? "left in the median window" : "the median window has closed"}</span>
          </Chronograph>
        ) : (
          <p className="text-[15px] text-ink-2">
            {!following
              ? `Watches this wallet's positions every 20 seconds. The moment it reduces, the clock starts${medianWindowMin !== null ? ` against its ${formatMinutes(medianWindowMin)} median window` : ""} and the reduce is mirrored.`
              : pollError
                ? `The positions poll failed (${pollError}). Retrying every 20 seconds.`
                : positions === null
                  ? "Reading current positions."
                  : `Watching ${positions.length} open position${positions.length === 1 ? "" : "s"}. No reduce yet.`}
          </p>
        )}

        {following && nextPollIn !== null && (
          <p className="fig text-[12px] text-ink-3">next poll in {nextPollIn}s</p>
        )}

        <p className="text-[13px] text-ink-2 border-t border-rule pt-4">
          Holding the same coin as this wallet? Paste your address on the home page to get its exits on Telegram, even with this tab closed.
        </p>

        <div>
          <h3 className="label mb-2">Mirror ledger</h3>
          {ledger.length === 0 ? (
            <p className="text-[13px] text-ink-3">Empty until the wallet reduces.</p>
          ) : (
            <ol className="border-t border-ink">
              {ledger.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-3 py-2 border-b border-rule text-[13px]">
                  <span className="fig">
                    {e.change.kind} {e.change.coin} {(e.change.reducedFraction * 100).toFixed(0)}%
                  </span>
                  <span className={e.status === "error" ? "text-late" : "text-ink-2"}>
                    {e.status === "sending"
                      ? "sending"
                      : e.status === "error"
                        ? e.error
                        : `${e.result?.mode ?? "paper"} ${e.result?.usdValue ? formatUsd(e.result.usdValue) : ""}${e.result?.capped ? " (capped)" : ""}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </aside>
  );
}
