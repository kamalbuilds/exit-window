import { describe, expect, it } from "vitest";
import { fillsToEpisodes } from "../src/lib/positions";
import type { Fill } from "../src/lib/types";

const BASE = 1_700_000_000_000;

function fill(partial: Partial<Fill> & Pick<Fill, "t" | "isBuy" | "px" | "sz" | "startPosition">): Fill {
  return {
    coin: "BTC",
    closedPnl: 0,
    feeUsd: 0,
    hash: "0xabc",
    oid: 0,
    ...partial,
  };
}

describe("fillsToEpisodes", () => {
  it("opens, adds, reduces and closes a long into one episode", () => {
    // Each pair (open+add, reduce+close) is <=120s apart and same-direction, so per
    // BUILD-SPEC.md ("group consecutive same-direction fills within 120s into one tranche")
    // they merge into a single entry tranche and a single exit tranche; closedAt still dates
    // to the last raw fill (the close), not the tranche's start (the reduce).
    const fills: Fill[] = [
      fill({ t: BASE, isBuy: true, px: 100, sz: 1, startPosition: 0 }), // open
      fill({ t: BASE + 10_000, isBuy: true, px: 110, sz: 1, startPosition: 1 }), // add
      fill({ t: BASE + 20_000, isBuy: false, px: 120, sz: 1, startPosition: 2, closedPnl: 15 }), // reduce
      fill({ t: BASE + 30_000, isBuy: false, px: 130, sz: 1, startPosition: 1, closedPnl: 25 }), // close
    ];
    const episodes = fillsToEpisodes(fills);
    expect(episodes).toHaveLength(1);
    const ep = episodes[0];
    expect(ep.direction).toBe("long");
    expect(ep.observedOpen).toBe(true);
    expect(ep.closedAt).toBe(BASE + 30_000);
    expect(ep.entries).toHaveLength(1);
    expect(ep.exits).toHaveLength(1);
    expect(ep.peakSize).toBe(2);
    expect(ep.avgEntryPx).toBeCloseTo(105, 5); // (100*1 + 110*1) / 2
    expect(ep.avgExitPx).toBeCloseTo(125, 5); // (120*1 + 130*1) / 2
    expect(ep.realizedPnlUsd).toBe(40);
    expect(ep.walletReturnPct).toBeCloseTo((125 - 105) / 105, 5);
  });

  it("still-open position has closedAt null and no exits", () => {
    const fills: Fill[] = [
      fill({ t: BASE, isBuy: true, px: 100, sz: 2, startPosition: 0 }),
      fill({ t: BASE + 10_000, isBuy: true, px: 105, sz: 1, startPosition: 2 }),
    ];
    const episodes = fillsToEpisodes(fills);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].closedAt).toBeNull();
    expect(episodes[0].exits).toHaveLength(0);
    expect(episodes[0].avgExitPx).toBeNull();
    expect(episodes[0].walletReturnPct).toBeNull();
  });

  it("a flip closes one episode and opens the opposite-direction one", () => {
    const fills: Fill[] = [
      fill({ t: BASE, isBuy: true, px: 100, sz: 5, startPosition: 0 }), // open long 5
      // sell 8: closes 5 long (realizes pnl) then opens 3 short, in one fill (flip)
      fill({ t: BASE + 10_000, isBuy: false, px: 90, sz: 8, startPosition: 5, closedPnl: -50 }),
    ];
    const episodes = fillsToEpisodes(fills);
    expect(episodes).toHaveLength(2);
    const [first, second] = episodes;
    expect(first.direction).toBe("long");
    expect(first.closedAt).toBe(BASE + 10_000);
    expect(first.exits).toEqual([{ t: BASE + 10_000, px: 90, sz: 5 }]);
    expect(first.realizedPnlUsd).toBe(-50);

    expect(second.direction).toBe("short");
    expect(second.observedOpen).toBe(true);
    expect(second.entries).toEqual([{ t: BASE + 10_000, px: 90, sz: 3 }]);
    expect(second.closedAt).toBeNull();
  });

  it("an unobserved-open episode (position already open at lookback start) is marked", () => {
    const fills: Fill[] = [
      fill({ t: BASE, isBuy: false, px: 90, sz: 1, startPosition: 4, closedPnl: 5 }), // reduce, no prior open seen
      fill({ t: BASE + 10_000, isBuy: false, px: 85, sz: 3, startPosition: 3, closedPnl: 30 }), // close
    ];
    const episodes = fillsToEpisodes(fills);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].observedOpen).toBe(false);
    expect(episodes[0].avgEntryPx).toBe(0);
    expect(episodes[0].walletReturnPct).toBeNull(); // excluded from backtest per spec
    expect(episodes[0].closedAt).toBe(BASE + 10_000);
  });

  it("groups consecutive same-direction fills within 120s into one tranche", () => {
    const fills: Fill[] = [
      fill({ t: BASE, isBuy: true, px: 100, sz: 1, startPosition: 0 }),
      fill({ t: BASE + 5_000, isBuy: true, px: 102, sz: 1, startPosition: 1 }),
      fill({ t: BASE + 110_000, isBuy: true, px: 104, sz: 1, startPosition: 2 }), // 105s after first, still <=120s of previous
    ];
    const episodes = fillsToEpisodes(fills);
    expect(episodes[0].entries).toHaveLength(1); // merged into one tranche
    expect(episodes[0].entries[0].sz).toBe(3);
  });
});
