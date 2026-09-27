import { describe, expect, it } from "vitest";
import { adverseDistancePct, forcedExitLadder } from "../src/lib/forced";
import type { Companion } from "../src/lib/types";

function c(address: string, liquidationPx: number | null, positionValueUsd: number, stillOpen: boolean | null = true): Companion {
  return {
    address,
    label: null,
    displayLabel: address,
    positionValueUsd,
    size: 1,
    entryPx: 100,
    upnlUsd: null,
    leverage: 10,
    cohort: "smart_money",
    liquidationPx,
    stillOpen,
  };
}

describe("forcedExitLadder", () => {
  it("orders long liquidations nearest first and accumulates USD", () => {
    const l = forcedExitLadder("long", 100, 85, [c("far", 70, 3_000_000), c("near", 92, 1_000_000), c("mid", 88, 2_000_000)])!;
    expect(l.steps.map((s) => s.address)).toEqual(["near", "mid", "far"]);
    expect(l.steps.map((s) => s.cumulativeUsd)).toEqual([1_000_000, 3_000_000, 6_000_000]);
    expect(l.steps[0].distancePct).toBeCloseTo(8);
    expect(l.soldBeforeYouUsd).toBe(3_000_000); // near + mid liquidate before 85
    expect(l.youFirst).toBe(false);
  });

  it("mirrors the direction for shorts", () => {
    const l = forcedExitLadder("short", 100, 105, [c("a", 120, 1), c("b", 110, 1)])!;
    expect(l.steps.map((s) => s.address)).toEqual(["b", "a"]);
    expect(l.youFirst).toBe(true);
    expect(adverseDistancePct("short", 100, 110)).toBeCloseTo(10);
  });

  it("drops wallets that already left and counts unknown liquidations", () => {
    const l = forcedExitLadder("long", 100, null, [c("gone", 90, 5, false), c("cross", null, 5), c("in", 95, 5)])!;
    expect(l.steps.map((s) => s.address)).toEqual(["in"]);
    expect(l.unknown).toBe(1);
    expect(l.you).toBeNull();
    expect(l.youFirst).toBeNull();
  });

  it("returns null without a mark", () => {
    expect(forcedExitLadder("long", null, 80, [c("a", 90, 1)])).toBeNull();
  });
});
