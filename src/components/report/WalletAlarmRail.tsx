"use client";

import { useEffect, useState } from "react";
import { TelegramLogo } from "@phosphor-icons/react";
import type { AlarmCreated, OpenPosition } from "@/lib/types";
import { TokenIcon } from "../TokenIcon";
import { formatMinutes } from "../format";

const HEX = /^0x[a-fA-F0-9]{40}$/;
const LAST_KEY = "exitwindow:lastAddress";

/** From a wallet's own page: arm a Telegram alarm on this wallet's open coins for the visitor. */
export function WalletAlarmRail({ leader, positions, medianWindowMin }: { leader: string; positions: OpenPosition[]; medianWindowMin: number | null }) {
  const coins = [...positions].sort((a, b) => Math.abs(b.unrealizedPnlUsd ?? 0) - Math.abs(a.unrealizedPnlUsd ?? 0)).slice(0, 8);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(coins.slice(0, 3).map((p) => p.coin)));
  // Read after mount so server and client render the same empty input first.
  const [owner, setOwner] = useState("");
  const [restored, setRestored] = useState(false);
  const [state, setState] = useState<{ status: "idle" | "sending" | "ready" | "error"; link?: string; error?: string }>({ status: "idle" });

  useEffect(() => {
    if (restored) return;
    const last = localStorage.getItem(LAST_KEY);
    const id = window.setTimeout(() => {
      if (last) setOwner((o) => o || last);
      setRestored(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, [restored]);

  const valid = HEX.test(owner.trim());
  const toggle = (coin: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(coin)) n.delete(coin);
      else n.add(coin);
      return n;
    });

  async function arm() {
    setState({ status: "sending" });
    try {
      const watches = coins.filter((p) => picked.has(p.coin)).map((p) => ({ leader, coin: p.coin, direction: p.direction }));
      const res = await fetch("/api/alarm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner: owner.trim(), watches }) });
      const json = (await res.json().catch(() => null)) as (AlarmCreated & { error?: string }) | null;
      if (!res.ok || !json?.deepLink) throw new Error(json?.error ?? "The alarm could not be created. Try again.");
      localStorage.setItem(LAST_KEY, owner.trim());
      setState({ status: "ready", link: json.deepLink });
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : "The alarm could not be created. Try again." });
    }
  }

  return (
    <aside className="panel overflow-hidden" aria-label="Get this wallet's exits on Telegram">
      <div className="px-4 py-3 border-b border-rule">
        <h2 className="display text-[16px]">Get this wallet&apos;s exits on Telegram</h2>
        <p className="text-[13px] text-ink-2 mt-1">
          The moment it reduces a coin you pick, you get a message{medianWindowMin !== null ? `, knowing its exits usually leave holders ${formatMinutes(medianWindowMin)}` : ""}.
        </p>
      </div>
      <div className="p-4 flex flex-col gap-4">
        {coins.length === 0 ? (
          <p className="text-[13px] text-ink-2">This wallet holds no open positions right now, so there is nothing of it to watch.</p>
        ) : (
          <div>
            <p className="label mb-2">Watch its</p>
            <div className="flex flex-wrap gap-2">
              {coins.map((p) => {
                const on = picked.has(p.coin);
                return (
                  <button
                    key={p.coin}
                    type="button"
                    onClick={() => toggle(p.coin)}
                    aria-pressed={on}
                    className={`inline-flex items-center gap-2 h-9 px-3 rounded-lg border text-[13px] transition-[background-color,border-color,color] duration-150 ${
                      on ? "border-accent bg-lume-wash text-ink" : "border-rule text-ink-2 hover:bg-bezel"
                    }`}
                  >
                    <TokenIcon coin={p.coin} size={18} />
                    <span className="fig">{p.coin}</span>
                    <span className={`text-[11px] ${p.direction === "long" ? "text-lume" : "text-late"}`}>{p.direction}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div>
          <label htmlFor="alarm-owner" className="label block mb-2">
            Your Hyperliquid address
          </label>
          <input
            id="alarm-owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="0x..."
            spellCheck={false}
            autoComplete="off"
            className="fig w-full h-10 px-3 rounded-lg bg-paper border border-rule text-[13px] text-ink placeholder:text-ink-3 focus:border-accent outline-none"
          />
        </div>
        {state.status === "ready" && state.link ? (
          <a href={state.link} target="_blank" rel="noreferrer" className="btn-primary h-10 inline-flex items-center justify-center gap-2 text-[14px] no-underline">
            <TelegramLogo size={16} weight="bold" /> Open Telegram to arm it
          </a>
        ) : (
          <button
            type="button"
            onClick={arm}
            disabled={!valid || picked.size === 0 || state.status === "sending"}
            className="btn-primary h-10 inline-flex items-center justify-center gap-2 text-[14px]"
          >
            <TelegramLogo size={16} weight="bold" />
            {state.status === "sending" ? "Creating alarm" : `Alert me on ${picked.size} coin${picked.size === 1 ? "" : "s"}`}
          </button>
        )}
        {state.status === "error" && (
          <p role="alert" className="text-[13px] text-late">
            {state.error}
          </p>
        )}
      </div>
    </aside>
  );
}
