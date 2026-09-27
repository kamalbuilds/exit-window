"use client";

import type { ForcedExitLadder } from "@/lib/forced";
import { formatPct, formatPrice, formatUsd } from "@/components/format";
import { WalletAvatar } from "@/components/WalletAvatar";

/** Forced exits: where the Smart Money on the user's side gets liquidated, nearest first,
 * with the user's own liquidation slotted in. Dense Nansen-like read, tokens only. */
export function ForcedExitPanel({
  coin,
  direction,
  markPx,
  ladder,
}: {
  coin: string;
  direction: "long" | "short";
  markPx: number | null;
  ladder: ForcedExitLadder | null;
}) {
  if (ladder === null) return null;

  const steps = ladder.steps;
  const you = ladder.you;

  const maxDist =
    Math.max(1, ...steps.map((s) => s.distancePct), you?.distancePct ?? 0) * 1.1;
  const posPct = (d: number) => `${Math.min(100, Math.max(0, (d / maxDist) * 100))}%`;
  // Prose reads the distance unsigned; the table shows the signed price move that gets there.
  const away = (d: number) => `${d.toFixed(1)}%`;
  const move = (d: number) => formatPct(direction === "long" ? -d : d);
  const farLabel = direction === "long" ? `-${maxDist.toFixed(1)}%` : `+${maxDist.toFixed(1)}%`;

  const railLabel =
    steps.length > 0
      ? `Forced exit ladder for ${coin}: nearest Smart Money liquidation ${away(
          steps[0].distancePct,
        )} away at ${formatPrice(steps[0].liquidationPx)}.`
      : `Forced exit ladder for ${coin}: no Smart Money liquidation price within reach.`;

  type Row =
    | {
        type: "step";
        key: string;
        address: string;
        label: string;
        liquidationPx: number;
        distancePct: number;
        positionValueUsd: number;
        cumulativeUsd: number;
      }
    | { type: "you"; key: string };
  const rows: Row[] = steps.map((s) => ({
    type: "step" as const,
    key: s.address,
    address: s.address,
    label: s.label,
    liquidationPx: s.liquidationPx,
    distancePct: s.distancePct,
    positionValueUsd: s.positionValueUsd,
    cumulativeUsd: s.cumulativeUsd,
  }));
  if (you) {
    const idx = rows.findIndex((r) => r.type === "step" && r.distancePct >= you.distancePct);
    const youRow: Row = { type: "you", key: "you" };
    if (idx === -1) rows.push(youRow);
    else rows.splice(idx, 0, youRow);
  }

  return (
    <section className="border-t border-rule pt-3" aria-label={`Forced exits for ${coin}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[14px] font-medium text-ink">Forced exits</h2>
        <p className="label">Where the Smart Money on your side gets liquidated. Live from Hyperliquid.</p>
      </div>

      {you && ladder.soldBeforeYouUsd > 0 ? (
        <p className="mt-2 text-[13px] leading-relaxed text-late">
          <span className="fig">{formatUsd(ladder.soldBeforeYouUsd)}</span> of Smart Money is force-sold
          before you are liquidated at <span className="fig">{formatPrice(you.liquidationPx)}</span>.
        </p>
      ) : ladder.youFirst === true && you ? (
        <p className="mt-2 text-[13px] leading-relaxed text-late">
          You are liquidated first, at <span className="fig">{formatPrice(you.liquidationPx)}</span>,{" "}
          <span className="fig">{away(you.distancePct)}</span> away. No Smart Money on your side is
          closer.
        </p>
      ) : steps.length > 0 ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          Nearest Smart Money liquidation is <span className="fig">{away(steps[0].distancePct)}</span>{" "}
          away at <span className="fig">{formatPrice(steps[0].liquidationPx)}</span>.
        </p>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          No Smart Money on your side has a liquidation price within reach.
        </p>
      )}

      <div className="mt-2 px-3 pt-7">
        <div role="img" aria-label={railLabel} className="relative h-2 w-full rounded-full bg-rule">
          {steps.map((s) => (
            <span
              key={s.address}
              className="absolute"
              style={{ left: posPct(s.distancePct), top: -28, transform: "translateX(-50%)" }}
            >
              <WalletAvatar
                address={s.address}
                size={20}
                title={`${s.label} liquidates at ${formatPrice(s.liquidationPx)}`}
              />
            </span>
          ))}
          {you && (
            <span
              className="absolute"
              style={{ left: posPct(you.distancePct), top: -4, transform: "translateX(-50%)" }}
            >
              <span className="block h-4 w-[2px] rounded-full bg-late" />
              <span className="mt-1 block text-center text-[12px] font-medium text-late">You</span>
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="label fig">Now {formatPrice(markPx)}</span>
          <span className="label fig">{farLabel}</span>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-bezel border-b border-rule">
                <th scope="col" className="label h-9 px-3 font-medium">
                  Wallet
                </th>
                <th scope="col" className="label h-9 px-3 text-right font-medium">
                  Liquidation price
                </th>
                <th scope="col" className="label h-9 px-3 text-right font-medium">
                  Distance
                </th>
                <th scope="col" className="label h-9 px-3 text-right font-medium">
                  Size
                </th>
                <th scope="col" className="label h-9 px-3 text-right font-medium">
                  Force-sold by then
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) =>
                r.type === "you" && you ? (
                  <tr
                    key="you"
                    className="h-11 border-b border-rule text-late transition-[background-color] duration-150 hover:bg-bezel"
                  >
                    <td className="px-3 text-[13px] font-medium">You</td>
                    <td className="fig px-3 text-right text-[13px]">{formatPrice(you.liquidationPx)}</td>
                    <td className="fig px-3 text-right text-[13px]">{move(you.distancePct)}</td>
                    <td className="fig px-3 text-right text-[13px]">-</td>
                    <td className="fig px-3 text-right text-[13px]">
                      {formatUsd(ladder.soldBeforeYouUsd)}
                    </td>
                  </tr>
                ) : r.type === "step" ? (
                  <tr
                    key={r.key}
                    className="h-11 border-b border-rule transition-[background-color] duration-150 hover:bg-bezel"
                  >
                    <td className="px-3">
                      <span className="inline-flex max-w-[11rem] items-center gap-2">
                        <WalletAvatar
                          address={r.address}
                          size={20}
                          title={`${r.label} liquidates at ${formatPrice(r.liquidationPx)}`}
                        />
                        <span className="truncate text-[13px] text-ink">{r.label}</span>
                      </span>
                    </td>
                    <td className="fig px-3 text-right text-[13px] text-ink">
                      {formatPrice(r.liquidationPx)}
                    </td>
                    <td className="fig px-3 text-right text-[13px] text-ink-2">
                      {move(r.distancePct)}
                    </td>
                    <td className="fig px-3 text-right text-[13px] text-ink">
                      {formatUsd(r.positionValueUsd)}
                    </td>
                    <td className="fig px-3 text-right text-[13px] text-ink-2">
                      {formatUsd(r.cumulativeUsd)}
                    </td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </div>
      )}

      {ladder.unknown > 0 && (
        <p className="label mt-3">
          {ladder.unknown} {ladder.unknown === 1 ? "wallet has" : "wallets have"} no liquidation price on Hyperliquid (cross margin with room to
          spare), not shown.
        </p>
      )}
    </section>
  );
}
