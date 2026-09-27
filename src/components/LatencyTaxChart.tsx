import type { LatencyResult } from "@/lib/types";
import { formatPct } from "./format";

const LABELS: Record<number, string> = { 0: "0s", 60: "1m", 300: "5m", 900: "15m", 3600: "1h" };

/**
 * Copier return vs delay, plain SVG, no chart lib. The wallet's own mean
 * return is a dashed reference line: the tax is the gap below it.
 */
export function LatencyTaxChart({ latency, walletMeanReturnPct }: { latency: LatencyResult[]; walletMeanReturnPct: number | null }) {
  if (latency.length === 0) return null;

  const W = 560;
  const H = 200;
  const padL = 40;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const values = latency.map((l) => l.copierReturnPct);
  if (walletMeanReturnPct !== null) values.push(walletMeanReturnPct);
  const maxV = Math.max(0, ...values);
  const minV = Math.min(0, ...values);
  const span = maxV - minV || 1;
  const pad = span * 0.15;
  const yMax = maxV + pad;
  const yMin = minV - pad;

  const x = (i: number) => padL + (i / (latency.length - 1 || 1)) * innerW;
  const y = (v: number) => padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
  const zeroY = y(0);

  const points = latency.map((l, i) => `${x(i)},${y(l.copierReturnPct)}`).join(" ");

  return (
    <div className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Copier return versus reaction delay">
        <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="var(--line)" strokeWidth={1} />

        {walletMeanReturnPct !== null ? (
          <>
            <line
              x1={padL}
              y1={y(walletMeanReturnPct)}
              x2={W - padR}
              y2={y(walletMeanReturnPct)}
              stroke="var(--fg-dim)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text x={W - padR} y={y(walletMeanReturnPct) - 4} textAnchor="end" className="num" fontSize={9} fill="var(--fg-dim)">
              wallet {formatPct(walletMeanReturnPct)}
            </text>
          </>
        ) : null}

        <polyline points={points} fill="none" stroke="var(--amber)" strokeWidth={2} />

        {latency.map((l, i) => (
          <g key={l.latencySec}>
            <circle cx={x(i)} cy={y(l.copierReturnPct)} r={3.5} fill={l.latencySec === 0 ? "var(--green)" : "var(--amber)"} />
            <text x={x(i)} y={H - 8} textAnchor="middle" className="num" fontSize={10} fill="var(--fg-faint)">
              {LABELS[l.latencySec] ?? `${l.latencySec}s`}
            </text>
          </g>
        ))}
      </svg>

      <div className="grid grid-cols-5 gap-2 text-[11px] num">
        {latency.map((l) => (
          <div key={l.latencySec} className="flex flex-col gap-0.5 border border-line rounded-sm px-2 py-1.5">
            <span className="text-fg-faint">{LABELS[l.latencySec] ?? `${l.latencySec}s`}</span>
            <span style={{ color: l.copierReturnPct >= 0 ? "var(--green)" : "var(--red)" }}>{formatPct(l.copierReturnPct)}</span>
            <span className="text-fg-faint">tax {formatPct(l.taxPct)}</span>
            <span className="text-fg-faint">{l.lateExitSharePct.toFixed(0)}% late</span>
          </div>
        ))}
      </div>
    </div>
  );
}
