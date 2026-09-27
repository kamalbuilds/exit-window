import { describe, expect, it } from "vitest";
import { computeExitDna } from "../src/lib/report";
import type { Episode } from "../src/lib/types";

const BASE = 1_700_000_000_000;

/** A closed long episode with `clips` sequential exit tranches, each `px` apart, spaced 10 minutes
 * apart, entered at `entryPx`. The last exit is always the full close. */
function episode(opts: { entryPx: number; clips: number; exitStartPx: number; exitStepPx: number }): Episode {
  const { entryPx, clips, exitStartPx, exitStepPx } = opts;
  const exits = Array.from({ length: clips }, (_, i) => ({
    t: BASE + 3_600_000 + i * 600_000,
    px: exitStartPx + i * exitStepPx,
    sz: 1,
  }));
  const closedAt = exits[exits.length - 1].t;
  const avgExitPx = exits.reduce((s, e) => s + e.px, 0) / exits.length;
  return {
    coin: "BTC",
    direction: "long",
    openedAt: BASE,
    closedAt,
    observedOpen: true,
    entries: [{ t: BASE, px: entryPx, sz: clips }],
    exits,
    peakSize: clips,
    avgEntryPx: entryPx,
    avgExitPx,
    realizedPnlUsd: (avgExitPx - entryPx) * clips,
    walletReturnPct: (avgExitPx - entryPx) / entryPx,
  };
}

describe("computeExitDna", () => {
  it("returns null with no eligible (observed, closed, exited) episodes", () => {
    const unobserved: Episode = { ...episode({ entryPx: 100, clips: 1, exitStartPx: 110, exitStepPx: 0 }), observedOpen: false };
    expect(computeExitDna([unobserved])).toBeNull();
    expect(computeExitDna([])).toBeNull();
  });

  it("classifies nuclear: one clip, closed in a single full exit", () => {
    const episodes = [
      episode({ entryPx: 100, clips: 1, exitStartPx: 110, exitStepPx: 0 }),
      episode({ entryPx: 100, clips: 1, exitStartPx: 120, exitStepPx: 0 }),
      episode({ entryPx: 100, clips: 1, exitStartPx: 90, exitStepPx: 0 }),
    ];
    const dna = computeExitDna(episodes);
    expect(dna).not.toBeNull();
    expect(dna?.sample).toBe(3);
    expect(dna?.medianClips).toBe(1);
    expect(dna?.fullExitAfterFirstReducePct).toBe(100);
    expect(dna?.style).toBe("nuclear");
    // first reduce IS the close here (single clip), so zero minutes between them
    expect(dna?.firstReduceToFlatMedianMin).toBe(0);
  });

  it("classifies scaler: 3+ clips per episode", () => {
    const episodes = [
      episode({ entryPx: 100, clips: 3, exitStartPx: 105, exitStepPx: 2 }),
      episode({ entryPx: 100, clips: 4, exitStartPx: 105, exitStepPx: 2 }),
    ];
    const dna = computeExitDna(episodes);
    expect(dna?.medianClips).toBeGreaterThanOrEqual(3);
    expect(dna?.style).toBe("scaler");
    // 3-clip episode: exits at +0min, +10min, +20min from the 1h-after-open first reduce;
    // 4-clip: +0,+10,+20,+30. First reduce to flat: 20min and 30min -> median 25.
    expect(dna?.firstReduceToFlatMedianMin).toBe(25);
  });

  it("classifies trimmer: mostly partial reduces, under 40% single-clip full exits, under 3 clips median", () => {
    const episodes = [
      episode({ entryPx: 100, clips: 2, exitStartPx: 105, exitStepPx: 2 }),
      episode({ entryPx: 100, clips: 2, exitStartPx: 105, exitStepPx: 2 }),
      episode({ entryPx: 100, clips: 2, exitStartPx: 105, exitStepPx: 2 }),
      episode({ entryPx: 100, clips: 1, exitStartPx: 110, exitStepPx: 0 }),
    ];
    const dna = computeExitDna(episodes);
    expect(dna?.fullExitAfterFirstReducePct).toBeCloseTo(25, 5); // 1 of 4
    expect(dna?.medianClips).toBe(2);
    expect(dna?.style).toBe("trimmer");
  });

  it("classifies mixed when neither nuclear, scaler, nor trimmer thresholds are met", () => {
    // medianClips 2 (not >=3), fullExitAfterFirstReducePct 50% (not >=70 and not <40)
    const episodes = [
      episode({ entryPx: 100, clips: 1, exitStartPx: 110, exitStepPx: 0 }),
      episode({ entryPx: 100, clips: 2, exitStartPx: 105, exitStepPx: 2 }),
    ];
    const dna = computeExitDna(episodes);
    expect(dna?.fullExitAfterFirstReducePct).toBe(50);
    expect(dna?.medianClips).toBe(1.5);
    expect(dna?.style).toBe("mixed");
  });

  it("firstReduceAtPnlPct is direction-adjusted: a long's first reduce above entry is positive", () => {
    const dna = computeExitDna([episode({ entryPx: 100, clips: 1, exitStartPx: 110, exitStepPx: 0 })]);
    expect(dna?.firstReduceAtPnlPct).toBeCloseTo(10, 5);
  });
});
