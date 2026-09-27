import type { Verdict } from "@/lib/types";
import { formatMinutes } from "./format";

const COLOR: Record<Verdict, string> = {
  copyable: "var(--green)",
  tight: "var(--amber)",
  not_copyable: "var(--red)",
  insufficient_data: "var(--fg-dim)",
};

function sentence(verdict: Verdict, maxSafeLatencySec: number | null, medianWindowMin: number | null): string {
  const median = formatMinutes(medianWindowMin);
  switch (verdict) {
    case "copyable":
      return `Copyable if you react within ${maxSafeLatencySec}s. Median window ${median}.`;
    case "tight":
      return `Tight: only safe inside ${maxSafeLatencySec}s. Median window ${median}.`;
    case "not_copyable":
      return `Not copyable: this wallet is out before you are. Median window ${median}.`;
    case "insufficient_data":
      return "Not enough closed exits yet to call this.";
  }
}

export function VerdictBanner({
  verdict,
  maxSafeLatencySec,
  medianWindowMin,
}: {
  verdict: Verdict;
  maxSafeLatencySec: number | null;
  medianWindowMin: number | null;
}) {
  const color = COLOR[verdict];
  return (
    <div className="border rounded-sm px-4 py-3 flex items-center gap-3" style={{ borderColor: color }}>
      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
      <p className="text-base leading-snug">{sentence(verdict, maxSafeLatencySec, medianWindowMin)}</p>
    </div>
  );
}
