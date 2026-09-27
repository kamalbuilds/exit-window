"use client";

import { useState } from "react";

/** Hyperliquid serves an SVG per market, including HIP-3 names like "xyz:CL". Monogram if it fails. */
export function TokenIcon({ coin, size = 20 }: { coin: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const letters = coin.replace(/^[a-z]+:/, "").slice(0, 2).toUpperCase();
  if (failed) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center rounded-full bg-bezel text-ink-2 fig shrink-0"
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.38) }}
      >
        {letters}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://app.hyperliquid.xyz/coins/${encodeURIComponent(coin)}.svg`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="rounded-full shrink-0 bg-bezel"
      style={{ width: size, height: size }}
    />
  );
}

/** Icon + symbol, the first cell of every screener row. */
export function TokenCell({ coin, sub }: { coin: string; sub?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 min-w-0">
      <TokenIcon coin={coin} />
      <span className="min-w-0">
        <span className="fig text-[13px] text-ink block truncate">{coin}</span>
        {sub && <span className="text-[12px] text-ink-3 block truncate">{sub}</span>}
      </span>
    </span>
  );
}
