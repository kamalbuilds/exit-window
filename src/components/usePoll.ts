"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { unwrapEnvelope } from "./format";

interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  fetchedAt: number | null;
  stale: boolean;
}

/**
 * Fetches `url` once, then re-fetches every `intervalMs` while the tab is visible.
 * intervalMs=0 means fetch once, no repeat. Skips ticks while document is hidden
 * and re-fetches immediately when it becomes visible again.
 * ponytail: one hook covers polling for feed/leaders/positions/status; a client
 * data-fetching library would be the next rung if we needed cache dedup across tabs.
 */
export function usePoll<T>(url: string | null, intervalMs: number, enabled = true) {
  const [state, setState] = useState<PollState<T>>({
    data: null,
    error: null,
    loading: true,
    fetchedAt: null,
    stale: false,
  });
  const urlRef = useRef(url);
  urlRef.current = url;

  const load = useCallback(async () => {
    if (!urlRef.current) return;
    try {
      const res = await fetch(urlRef.current);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      const { data, fetchedAt, stale } = unwrapEnvelope<T>(json);
      setState({ data, error: null, loading: false, fetchedAt: fetchedAt ?? Date.now(), stale });
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : "request failed", loading: false }));
    }
  }, []);

  useEffect(() => {
    if (!url || !enabled) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    load();
    if (!intervalMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      load();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, enabled, intervalMs, load]);

  return { ...state, refresh: load };
}
