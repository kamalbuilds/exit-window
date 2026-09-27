import { describe, expect, it } from "vitest";
import {
  isReferralOnly,
  matchesExitRisk,
  matchesFilters,
  matchesLabelType,
  DEFAULT_FILTERS,
  type SmartMoneyFilters,
} from "@/components/filters/smartMoneyFilters";
import type { Companion } from "@/lib/types";

function companion(overrides: Partial<Companion> = {}): Companion {
  return {
    address: "0xabc",
    label: null,
    displayLabel: "Smart Money wallet",
    positionValueUsd: 100_000,
    size: 10,
    entryPx: 5,
    upnlUsd: 0,
    liquidationPx: null,
    stillOpen: true,
    leverage: 1,
    cohort: "smart_money",
    ...overrides,
  };
}

describe("isReferralOnly", () => {
  it("flags the exact 'High Balance' junk label", () => {
    expect(isReferralOnly(companion({ label: "High Balance" }))).toBe(true);
  });
  it("flags a referral-code label", () => {
    expect(isReferralOnly(companion({ label: 'Uses "abc123" HL Referral Code' }))).toBe(true);
  });
  it("does not flag a real label", () => {
    expect(isReferralOnly(companion({ label: "Fund" }))).toBe(false);
  });
});

describe("matchesLabelType", () => {
  it("matches Fund via displayLabel", () => {
    expect(matchesLabelType(companion({ displayLabel: "Fund", label: "Some Fund LLC" }), "fund")).toBe(true);
  });
  it("matches Smart Trader with a window suffix", () => {
    expect(matchesLabelType(companion({ displayLabel: "Smart Trader 90D" }), "smart_trader")).toBe(true);
  });
  it("does not cross-match Position Trader against Smart Trader", () => {
    expect(matchesLabelType(companion({ displayLabel: "Position Trader" }), "smart_trader")).toBe(false);
  });
  it("matches unlabeled only when both label and displayLabel are empty", () => {
    expect(matchesLabelType(companion({ label: null, displayLabel: "" }), "unlabeled")).toBe(true);
    expect(matchesLabelType(companion({ label: "Fund" }), "unlabeled")).toBe(false);
  });
});

describe("matchesExitRisk", () => {
  it("any always passes", () => {
    expect(matchesExitRisk(null, "any")).toBe(true);
  });
  it("high only excludes an unloaded (null) report", () => {
    expect(matchesExitRisk(null, "high")).toBe(false);
  });
  it("medium+ lets an unloaded report through", () => {
    expect(matchesExitRisk(null, "medium_plus")).toBe(true);
  });
  it("high only passes exactly level high", () => {
    expect(matchesExitRisk("high", "high")).toBe(true);
    expect(matchesExitRisk("medium", "high")).toBe(false);
  });
  it("medium+ passes high and medium, not low", () => {
    expect(matchesExitRisk("high", "medium_plus")).toBe(true);
    expect(matchesExitRisk("medium", "medium_plus")).toBe(true);
    expect(matchesExitRisk("low", "medium_plus")).toBe(false);
  });
});

describe("matchesFilters", () => {
  it("passes a companion against DEFAULT_FILTERS", () => {
    expect(matchesFilters(companion(), DEFAULT_FILTERS, null)).toBe(true);
  });
  it("rejects below the minimum position size", () => {
    const filters: SmartMoneyFilters = { ...DEFAULT_FILTERS, minPositionUsd: 250_000 };
    expect(matchesFilters(companion({ positionValueUsd: 100_000 }), filters, null)).toBe(false);
    expect(matchesFilters(companion({ positionValueUsd: 300_000 }), filters, null)).toBe(true);
  });
  it("rejects a cohort not in the selected chips", () => {
    const filters: SmartMoneyFilters = { ...DEFAULT_FILTERS, cohorts: ["whale"] };
    expect(matchesFilters(companion({ cohort: "smart_money" }), filters, null)).toBe(false);
    expect(matchesFilters(companion({ cohort: "whale" }), filters, null)).toBe(true);
  });
  it("hides referral-only wallets when the toggle is on", () => {
    const filters: SmartMoneyFilters = { ...DEFAULT_FILTERS, hideReferralOnly: true };
    expect(matchesFilters(companion({ label: "High Balance" }), filters, null)).toBe(false);
    expect(matchesFilters(companion({ label: "Fund" }), filters, null)).toBe(true);
  });

  it("excludes a High-only exit-risk filter when the report has not loaded", () => {
    const filters: SmartMoneyFilters = { ...DEFAULT_FILTERS, exitRisk: "high" };
    expect(matchesFilters(companion(), filters, null)).toBe(false);
    expect(matchesFilters(companion(), filters, "high")).toBe(true);
  });
});
