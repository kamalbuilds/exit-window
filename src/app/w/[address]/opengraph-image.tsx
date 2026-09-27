import { ImageResponse } from "next/og";
import { buildReport } from "@/lib/report";
import type { WalletReport } from "@/lib/types";

// Exit DNA card shown when a wallet report is shared. Colours are DESIGN.md token values
// (ImageResponse cannot read CSS variables).
const C = { paper: "#0B1015", dial: "#11181F", rule: "#222D38", ink: "#E7ECF0", ink2: "#A3ADB6", ink3: "#7C8892", lume: "#3FD49A", late: "#F0616D" };

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Exit Window: how this Hyperliquid wallet exits";

const STYLE: Record<string, string> = {
  nuclear: "Nuclear: dumps the whole position at once",
  scaler: "Scaler: sells in several steps",
  trimmer: "Trimmer: trims and keeps holding",
  mixed: "Mixed exits",
};

function fmtMin(m: number | null | undefined): string {
  if (m === null || m === undefined) return "held 24h+";
  if (m < 1) return "<1m";
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** Same log scale as the dial: 10 s to 24 h over a 330 degree sweep. */
function ringPath(windowMin: number | null): string {
  const sec = windowMin === null ? 86_400 : Math.min(Math.max(windowMin * 60, 10), 86_400);
  const pos = Math.log(sec / 10) / Math.log(86_400 / 10);
  const r = 120;
  const a0 = -Math.PI / 2;
  const a1 = a0 + (330 * pos * Math.PI) / 180;
  const x0 = 150 + r * Math.cos(a0), y0 = 150 + r * Math.sin(a0);
  const x1 = 150 + r * Math.cos(a1), y1 = 150 + r * Math.sin(a1);
  const large = 330 * pos > 180 ? 1 : 0;
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  let report: WalletReport | null = null;
  try {
    report = await buildReport(address);
  } catch {
    report = null;
  }
  const m = report?.medianWindowMin ?? null;
  const dna = report?.exitDna ?? null;
  const replay = report?.alarmReplay ?? null;
  const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
  const track = `M 150 30 A 120 120 0 1 1 ${(150 + 120 * Math.cos(-Math.PI / 2 + (330 * Math.PI) / 180)).toFixed(1)} ${(150 + 120 * Math.sin(-Math.PI / 2 + (330 * Math.PI) / 180)).toFixed(1)}`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: C.paper, color: C.ink, padding: 56, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, color: C.lume, fontSize: 26, fontWeight: 700 }}>Exit Window</div>
            <div style={{ display: "flex", marginTop: 28, fontSize: 28, color: C.ink3 }}>Hyperliquid wallet {short}</div>
            <div style={{ display: "flex", marginTop: 16, fontSize: 64, fontWeight: 700, lineHeight: 1.05, maxWidth: 620 }}>
              {m === null ? "Holds through its exits." : `Its exits leave a copier ${fmtMin(m)}.`}
            </div>
            <div style={{ display: "flex", marginTop: 24, fontSize: 28, color: C.ink2 }}>
              {dna ? STYLE[dna.style] ?? dna.style : "Exit DNA from Nansen fills"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 40, fontSize: 24, color: C.ink3 }}>
            {dna ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span>first reduce to full exit</span>
                <span style={{ fontSize: 40, color: C.ink, marginTop: 6 }}>{Math.round(dna.fullExitAfterFirstReducePct)}%</span>
              </div>
            ) : null}
            {replay ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span>alarm vs holding 24h</span>
                <span style={{ fontSize: 40, color: replay.savedVsHoldingPct >= 0 ? C.lume : C.late, marginTop: 6 }}>
                  {replay.savedVsHoldingPct >= 0 ? "+" : ""}
                  {replay.savedVsHoldingPct.toFixed(1)}%
                </span>
              </div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span>data</span>
              <span style={{ fontSize: 40, color: C.ink, marginTop: 6 }}>Nansen API</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", width: 300, alignItems: "center", justifyContent: "center", position: "relative" }}>
          <svg width="300" height="300" viewBox="0 0 300 300">
            <path d={track} fill="none" stroke={C.rule} strokeWidth="18" strokeLinecap="round" />
            <path d={ringPath(m)} fill="none" stroke={C.lume} strokeWidth="18" strokeLinecap="round" />
          </svg>
          <div style={{ position: "absolute", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: 22, color: C.ink3 }}>median window</span>
            <span style={{ fontSize: 44, fontWeight: 700 }}>{fmtMin(m)}</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
