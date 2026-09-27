// Pure filter logic for the Smart Money filter bar on /me/[address]. No React here, so it stays
// trivially testable and reusable from both the filter bar and the page's memoized filtering.
import type { Companion } from "@/lib/types";

export type FilterCohort = "smart_money" | "whale";

export type LabelType = "fund" | "smart_hl_perps_trader" | "smart_trader" | "position_trader" | "public_figure" | "unlabeled";

export const LABEL_TYPE_OPTIONS: { id: LabelType; text: string }[] = [
  { id: "fund", text: "Fund" },
  { id: "smart_hl_perps_trader", text: "Smart HL Perps Trader" },
  { id: "smart_trader", text: "Smart Trader (30D/90D/180D)" },
  { id: "position_trader", text: "Position Trader" },
  { id: "public_figure", text: "Public figure" },
  { id: "unlabeled", text: "Unlabeled" },
];

export const MIN_POSITION_OPTIONS: { usd: number; text: string }[] = [
  { usd: 0, text: "Any" },
  { usd: 10_000, text: "$10K" },
  { usd: 50_000, text: "$50K" },
  { usd: 250_000, text: "$250K" },
  { usd: 1_000_000, text: "$1M" },
];

export type ExitRiskFilter = "any" | "high" | "medium_plus";

export interface SmartMoneyFilters {
  cohorts: FilterCohort[]; // empty = every cohort passes
  labelTypes: LabelType[]; // empty = every label type passes
  hideReferralOnly: boolean;
  minPositionUsd: number;
  exitRisk: ExitRiskFilter;
}

export const DEFAULT_FILTERS: SmartMoneyFilters = {
  cohorts: [],
  labelTypes: [],
  hideReferralOnly: false,
  minPositionUsd: 0,
  exitRisk: "any",
};

export function isDefaultFilters(f: SmartMoneyFilters): boolean {
  return (
    f.cohorts.length === 0 &&
    f.labelTypes.length === 0 &&
    !f.hideReferralOnly &&
    f.minPositionUsd === 0 &&
    f.exitRisk === "any"
  );
}

const REFERRAL_LABEL = /^Uses ".*" HL Referral Code$/;

/** The referral-only toggle looks at the raw Nansen label, not displayLabel - overlap.ts already
 * cleans displayLabel to a cohort fallback for these, so the junk text only survives on `label`. */
export function isReferralOnly(c: Companion): boolean {
  const label = c.label ?? "";
  return label === "High Balance" || REFERRAL_LABEL.test(label);
}

function labelText(c: Companion): string {
  return `${c.displayLabel} ${c.label ?? ""}`.toLowerCase();
}

export function matchesLabelType(c: Companion, type: LabelType): boolean {
  const text = labelText(c);
  switch (type) {
    case "fund":
      return text.includes("fund");
    case "smart_hl_perps_trader":
      return text.includes("smart hl perps trader");
    case "smart_trader":
      return text.includes("smart trader");
    case "position_trader":
      return text.includes("position trader");
    case "public_figure":
      return c.cohort === "public_figure" || text.includes("public figure");
    case "unlabeled":
      return !c.label && (!c.displayLabel || c.displayLabel.toLowerCase() === "unlabeled");
  }
}

export type ExitRiskLevel = "high" | "medium" | "low" | "unknown";

/** Filter's exit-risk clause. A companion whose report hasn't loaded yet (loadedLevel null) is
 * let through, EXCEPT under "High only" - there's nothing to confirm high risk with, so it's
 * hidden rather than assumed. */
export function matchesExitRisk(loadedLevel: ExitRiskLevel | null, filter: ExitRiskFilter): boolean {
  if (filter === "any") return true;
  if (loadedLevel === null) return filter !== "high";
  if (filter === "high") return loadedLevel === "high";
  return loadedLevel === "high" || loadedLevel === "medium";
}

/** Whether one companion survives the full filter set. `exitRiskLevel` is looked up by the caller
 * (the page holds the shared map of loaded WalletReport.exitRisk by address). */
export function matchesFilters(c: Companion, filters: SmartMoneyFilters, exitRiskLevel: ExitRiskLevel | null): boolean {
  if (filters.hideReferralOnly && isReferralOnly(c)) return false;
  if (filters.cohorts.length > 0 && !filters.cohorts.includes(c.cohort as FilterCohort)) return false;
  if (filters.labelTypes.length > 0 && !filters.labelTypes.some((t) => matchesLabelType(c, t))) return false;
  if (c.positionValueUsd < filters.minPositionUsd) return false;
  if (!matchesExitRisk(exitRiskLevel, filters.exitRisk)) return false;
  return true;
}
