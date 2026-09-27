/** Numbers the home page and /judge quote. Each is checked against its source by scripts/check_submission_readiness.ts. */
export const PROOF = {
  tests: 134, // vitest count (readiness script reads vitest's JSON reporter)
  propertyCases: 12_000, // 6 properties × 2,000 runs (packages/core/test/property.test.ts NUM_RUNS)
  coldP50s: "2.1", // docs/BENCH.md cold p50
  creditsPerDraw: "12.2", // mean over the 10 bench draws; docs/BENCH.md: 13 for a class-list draw, 9 for a regular draw (mean 12.2); up to 23 when sourcing pages are retried
  cloneSeconds: 11, // timed clean clone from GitHub → first round (7 s) + verify + tests (11 s), re-measured 2026-09-19 (9 s on 2026-09-18)
};
