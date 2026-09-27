"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenPosition, PositionChange } from "@/lib/types";
import { diffPositions } from "@/lib/follow";
import { StatusBadge, isLiveEnabled, type StatusPayload } from "./StatusBadge";
import { usePoll } from "./usePoll";
import { formatAgo, formatClock, formatUsd, shortAddr } from "./format";

const POLL_MS = 20_000;

interface LedgerEntry {
  id: string;
  change: PositionChange;
  status: "sending" | "done" | "error";
  result?: unknown;
  error?: string;
}

export function FollowPanel({ address, medianWindowMin }: { address: string; medianWindowMin: number | null }) {
  const [following, setFollowing] = useState(false);
  const [positions, setPositions] = useState<OpenPosition[] | null>(null);
  const [positionsAt, setPositionsAt] = useState<number | null>(null);
  const [posError, setPosError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [countdown, setCountdown] = useState<{ coin: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const prevRef = useRef<OpenPosition[] | null>(null);
  const { data: status } = usePoll<StatusPayload>("/api/status", 0);

  const mirror = useCallback(async (change: PositionChange) => {
    const id = `${change.coin}-${change.at}`;
    setLedger((l) => [{ id, change, status: "sending" }, ...l]);
    try {
      const res = await fetch("/api/mirror", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leader: address, change }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `${res.status} ${res.statusText}`);
      setLedger((l) => l.map((e) => (e.id === id ? { ...e, status: "done", result: json } : e)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "mirror failed";
      setLedger((l) => l.map((e) => (e.id === id ? { ...e, status: "error", error: message } : e)));
    }
  }, [address]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/positions/${address}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      const next: OpenPosition[] = Array.isArray(json) ? json : (json.data ?? []);
      const now = Date.now();
      if (prevRef.current) {
        const changes = diffPositions(prevRef.current, next, now);
        for (const change of changes) {
          if (change.kind === "reduce" || change.kind === "close") {
            setCountdown({ coin: change.coin, expiresAt: now + (medianWindowMin ?? 15) * 60_000 });
            mirror(change);
          }
        }
      }
      prevRef.current = next;
      setPositions(next);
      setPositionsAt(now);
      setPosError(null);
    } catch (e) {
      setPosError(e instanceof Error ? e.message : "positions request failed");
    }
  }, [address, medianWindowMin, mirror]);

  useEffect(() => {
    if (!following) return;
    poll();
    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      poll();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [following, poll]);

  useEffect(() => {
    if (!countdown) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [countdown]);

  const remainingSec = countdown ? Math.max(0, (countdown.expiresAt - now) / 1000) : null;

  return (
    <div className="border border-line rounded-sm px-4 py-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Follow this wallet</p>
          <StatusBadge status={status} />
        </div>
        <button
          onClick={() => setFollowing((f) => !f)}
          className="text-xs uppercase tracking-widest border rounded-sm px-2.5 py-1"
          style={{
            borderColor: following ? "var(--amber)" : "var(--line)",
            color: following ? "var(--amber)" : "var(--fg-dim)",
          }}
        >
          {following ? "following" : "follow"}
        </button>
      </div>

      {following ? (
        <>
          {posError ? (
            <p className="text-xs text-red">Positions poll failed: {posError} (retrying every 20s)</p>
          ) : positions === null ? (
            <p className="text-xs text-fg-faint">Loading current positions…</p>
          ) : (
            <p className="text-xs text-fg-faint">
              {positions.length} open position{positions.length === 1 ? "" : "s"} watched
              {positionsAt ? <span className="num"> · {formatAgo(positionsAt)}</span> : null} · polling every 20s
            </p>
          )}

          {countdown && remainingSec !== null && remainingSec > 0 ? (
            <div className="border border-amber rounded-sm px-3 py-2 bg-amber-dim">
              <p className="num text-sm">
                {countdown.coin} reduced. Median window {medianWindowMin ?? "n/a"}m. {formatClock(remainingSec)} left.
              </p>
            </div>
          ) : null}

          <div>
            <p className="text-[10px] uppercase tracking-widest text-fg-faint mb-1.5">Mirror ledger</p>
            {ledger.length === 0 ? (
              <p className="text-xs text-fg-faint">No reduces mirrored yet. This fills the moment the wallet reduces.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {ledger.map((e) => (
                  <LedgerRow key={e.id} entry={e} live={isLiveEnabled(status)} />
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-fg-faint">
          Starts polling <span className="num">/api/positions/{shortAddr(address)}</span> every 20s. On a reduce, mirrors it
          {isLiveEnabled(status) ? " for real on your Hyperliquid account." : " on paper (no keys configured)."}
        </p>
      )}
    </div>
  );
}

function LedgerRow({ entry, live }: { entry: LedgerEntry; live: boolean }) {
  const { change, status, result, error } = entry;
  return (
    <li className="text-xs border border-line rounded-sm px-2.5 py-1.5 flex items-center justify-between gap-2">
      <span className="num">
        {change.kind} {change.coin} · {(change.reducedFraction * 100).toFixed(0)}%
      </span>
      {status === "sending" ? (
        <span className="text-fg-faint">sending…</span>
      ) : status === "error" ? (
        <span className="text-red" title={error}>
          failed
        </span>
      ) : (
        <MirrorResultTag result={result} live={live} />
      )}
    </li>
  );
}

function MirrorResultTag({ result, live }: { result: unknown; live: boolean }) {
  const r = (result ?? {}) as Record<string, unknown>;
  const usd = typeof r.sizeUsd === "number" ? formatUsd(r.sizeUsd) : typeof r.value_usd === "number" ? formatUsd(r.value_usd) : null;
  return (
    <span className="flex items-center gap-1.5">
      {usd ? <span className="num text-fg-dim">{usd}</span> : null}
      <span
        className="uppercase tracking-widest text-[10px] px-1 rounded-[2px] border"
        style={{ color: live ? "var(--red)" : "var(--green)", borderColor: live ? "var(--red-dim)" : "var(--green-dim)" }}
      >
        {live ? "live" : "paper"}
      </span>
    </span>
  );
}
