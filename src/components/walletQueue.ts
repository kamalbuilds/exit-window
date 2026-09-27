"use client";

import { useEffect, useRef, useState } from "react";
import type { WalletReport } from "@/lib/types";

// ponytail: a page-wide serial queue via one module-level promise chain. No client cache/dedup
// library, add one if the same address ever needs to be queued from two places at once.
type Job = () => Promise<void>;
let chain: Promise<void> = Promise.resolve();
function enqueue(job: Job) {
  chain = chain.then(job, job);
}

export interface QueuedWalletState {
  status: "queued" | "loading" | "retrying" | "ready" | "error";
  data: WalletReport | null;
  error: string | null;
  retryAfterSec?: number;
}

interface Timeout503 {
  error: "nansen_timeout";
  retryAfterSec: number;
}

/**
 * Fetches GET /api/wallet/[address] through one shared, page-wide serial queue so a page that
 * auto-times several companions never fires more than one Nansen report build at a time. A 503
 * {error:"nansen_timeout", retryAfterSec} is retried once after the given delay, then surfaced as
 * an error, never rendered as "no window" (that phrase is reserved for a real medianWindowMin===null).
 */
export function useQueuedWalletReport(address: string | null): QueuedWalletState {
  const [state, setState] = useState<QueuedWalletState>({ status: "queued", data: null, error: null });
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!address || started.current === address) return;
    started.current = address;

    async function attempt(): Promise<
      { ok: true; data: WalletReport } | { ok: false; retry: boolean; error: string; retryAfterSec?: number }
    > {
      try {
        const res = await fetch(`/api/wallet/${address}`);
        if (res.status === 503) {
          const json = (await res.json().catch(() => null)) as Timeout503 | null;
          return { ok: false, retry: true, error: "Nansen timed out", retryAfterSec: json?.retryAfterSec ?? 5 };
        }
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as { error?: string } | null;
          return { ok: false, retry: false, error: json?.error ?? `${res.status} ${res.statusText}` };
        }
        const data = (await res.json()) as WalletReport;
        return { ok: true, data };
      } catch (e) {
        return { ok: false, retry: false, error: e instanceof Error ? e.message : "request failed" };
      }
    }

    enqueue(async () => {
      setState((s) => ({ ...s, status: "loading" }));
      let result = await attempt();
      if (!result.ok && result.retry) {
        const retryAfterSec = result.retryAfterSec ?? 5;
        setState({ status: "retrying", data: null, error: result.error, retryAfterSec });
        await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
        result = await attempt();
      }
      if (result.ok) setState({ status: "ready", data: result.data, error: null });
      else setState({ status: "error", data: null, error: result.error });
    });
  }, [address]);

  return state;
}
