import type { WalletReport } from "@/lib/types";
import { formatUsd } from "./format";

const EXIT_STYLE_COPY: Record<WalletReport["exitStyle"], string> = {
  scaler: "scales out: usually two or more reduces before flat",
  one_shot: "one shot: closes the whole position in a single move",
  mixed: "mixed: sometimes scales, sometimes closes in one",
  unknown: "not enough closed episodes to classify",
};

export function PnlPanel({ report }: { report: WalletReport }) {
  return (
    <div className="border border-line rounded-sm px-4 py-3 flex flex-col gap-3">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-fg-faint">Exit style</p>
        <p className="num text-sm">{EXIT_STYLE_COPY[report.exitStyle]}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <PnlFigure label="Realized" value={report.realizedPnlUsd} />
        <PnlFigure label="Paper (unrealized)" value={report.unrealizedPnlUsd} />
      </div>
    </div>
  );
}

function PnlFigure({ label, value }: { label: string; value: number | null }) {
  const color = value === null ? "var(--fg-dim)" : value >= 0 ? "var(--green)" : "var(--red)";
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-widest text-fg-faint">{label}</span>
      <span className="num text-lg font-medium" style={{ color }}>
        {formatUsd(value, { sign: true })}
      </span>
    </div>
  );
}
