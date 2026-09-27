import { describe, expect, it } from "vitest";
import { buildWhyFromData, isAgentUnavailable } from "../src/lib/alarms";
import type { WalletReport } from "../src/lib/types";

const report = {
  medianWindowMin: 143.7,
  realizedPnlUsd: 1_250_000,
  unrealizedPnlUsd: -246_500,
  exitDna: { sample: 12, firstReduceToFlatMedianMin: 42, fullExitAfterFirstReducePct: 83, medianClips: 1, firstReduceAtPnlPct: 2.1, style: "nuclear" },
  exitRisk: { level: "high" },
} as unknown as WalletReport;

const cohort = { smartTraderLongUsd: 4_100_000, smartTraderShortUsd: 900_000, whaleLongUsd: 12_000_000, whaleShortUsd: 3_000_000 };

describe("buildWhyFromData", () => {
  it("names its sources, never the Agent, and stays under 80 words", () => {
    const a = buildWhyFromData({ coin: "SOL", direction: "long", report, cohort, othersLastHour: { wallets: 3, valueUsd: 2_400_000 } })!;
    expect(a.startsWith("From Nansen and Hyperliquid data:")).toBe(true);
    expect(a).not.toMatch(/agent/i);
    expect(a.split(/\s+/).length).toBeLessThanOrEqual(80);
    expect(a).toContain("3 other Smart Money wallets cut SOL longs in the last hour ($2.4M)");
    expect(a).toContain("$1.3M realized, -$247K still on paper");
    expect(a).not.toMatch(/—/);
  });

  it("drops whole sentences past the word cap instead of cutting mid-sentence", () => {
    const a = buildWhyFromData({ coin: "SOL", direction: "long", report, cohort, othersLastHour: { wallets: 0, valueUsd: 0 } })!;
    expect(a.split(/\s+/).length).toBeLessThanOrEqual(80);
    expect(a.trim().endsWith(".")).toBe(true);
  });

  it("says a lone exit is its own decision", () => {
    const a = buildWhyFromData({ coin: "ETH", direction: "short", report: null, cohort: null, othersLastHour: { wallets: 0, valueUsd: 0 } })!;
    expect(a).toContain("No other Smart Money wallet cut ETH shorts in the last hour");
  });

  it("returns null with nothing real to say", () => {
    expect(buildWhyFromData({ coin: "SOL", direction: "long", report: null, cohort: null, othersLastHour: null })).toBeNull();
  });
});

describe("isAgentUnavailable", () => {
  it("covers no credits, 403 and no key, not other failures", () => {
    expect(isAgentUnavailable('Nansen agent/fast 403: {"code":"insufficient_credits"}')).toBe(true);
    expect(isAgentUnavailable("NANSEN_API_KEY is not set. Add it to .env")).toBe(true);
    expect(isAgentUnavailable("Nansen agent/fast stream error: boom")).toBe(false);
  });
});
