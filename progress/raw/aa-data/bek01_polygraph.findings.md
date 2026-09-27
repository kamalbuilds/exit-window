# bek01/polygraph — Meridian Buildathon Review

## 1. One-line: what it does

User loads the dashboard (or hits `GET /api/polygraph`); the app fetches live Polymarket-derived "crowd belief" (via Nansen's `prediction-market` endpoints) and live onchain flow for six wallet cohorts (via Nansen's `tgm/flow-intelligence`) for BTC/ETH/SOL, and outputs a per-asset verdict — `ALIGNED` / `TENSION` / `DECEPTION` / `INCONCLUSIVE` — showing where the crowd's stated bet and informed onchain capital's actual flow disagree, plus a static calibration panel scoring how well Polymarket has historically priced ~900 resolved markets.

## 2. Nansen endpoints called

Grepped `nansen()` / `nansenSafe()` call sites and typed comments across `src/lib/*.ts` and `scripts/backfill.ts`:

Actually invoked in code (7 distinct):
- `prediction-market/market-screener` (`src/lib/polygraph.ts:29`, `src/lib/backtest.ts:49`, `scripts/backfill.ts:87,170`)
- `prediction-market/ohlcv` (`src/lib/backtest.ts:76`, `scripts/backfill.ts:139,183`)
- `prediction-market/top-holders` (`scripts/backfill.ts:155`, backfill-only)
- `prediction-market/trades-by-market` (`scripts/backfill.ts:156`, backfill-only)
- `prediction-market/pnl-by-market` (`scripts/backfill.ts:157`, backfill-only)
- `tgm/flow-intelligence` (`src/lib/polygraph.ts:60,65`, `scripts/backfill.ts:111`)
- `tgm/token-ohlcv` (`src/lib/polygraph.ts:44`, `scripts/backfill.ts:119`)

Typed but never called in any code path (README claims it as a "cross-check on the informed aggregate", but no call site exists):
- `smart-money/netflow` (only in `src/lib/types.ts:99` as a type comment)

**Count: 7 distinct endpoints actually called in code** (8 if counting the documented-but-unused `smart-money/netflow`). Per live page load the app makes 4 calls/asset × 3 assets = 12 calls (market-screener + token-ohlcv + flow-intelligence×2), matching the README's "12 Nansen calls" claim exactly.

## 3. Does Nansen data drive logic, or only display?

**Drives logic.** The verdict is computed directly from live Nansen flow data, not just rendered.

Core logic: `src/lib/engine.ts:219-238` (`verdictFor`):
```
export function verdictFor(gap, say, doStance, confidence) {
  if (confidence.score === 0) return 'INCONCLUSIVE';
  const opposed = Math.sign(say) !== 0 && Math.sign(doStance) !== 0 && Math.sign(say) !== Math.sign(doStance);
  const mag = Math.abs(gap);
  if (opposed && mag >= 0.8 && confidence.band === 'HIGH') return 'DECEPTION';
  if (opposed && mag >= 0.8) return 'TENSION';
  if (mag >= 0.5) return 'TENSION';
  if (mag < 0.25) return 'ALIGNED';
  return 'TENSION';
}
```
`doStance` (the "DO" side of the verdict) is computed in `src/lib/engine.ts:135-146` (`doStanceFrom`) directly from `tgm/flow-intelligence` cohort net-flow numbers (`readCohorts`, `engine.ts:102-123`), weighted 0.40 Top PnL / 0.35 Smart Traders / 0.25 Whales. Confidence gating that can suppress a DECEPTION call down to TENSION also depends on how many cohorts actually reported live flow (`engine.ts:193-204`). This is decision logic, not a chart of raw numbers.

## 4. Does it execute anything?

**No. Read-only.** No trade execution, no order placement, no onchain transactions, no alerting/notification system found anywhere in the codebase (checked `src/app/api/*`, `src/lib/*`). It only returns JSON from GET routes (`/api/polygraph`, `/api/backtest`, `/api/stats`) for a dashboard to render.

## 5. Does it touch sells/exits of wallets?

**Only indirectly, via net-flow sign — no dedicated exit-timing or exit-alert feature.** `engine.ts:240-248` (`verbPhrase`) converts a cohort's net-flow stance into "buying" vs. "selling" language purely from the sign of net USD flow (negative = selling). The headline generator (`engine.ts:250-290`) can say "The best-performing wallets are selling it" (matches the README's sample output). There is no tracking of individual wallet exit timing, no distinct "when did smart money start selling" signal, and no exit-specific alerting — it is a snapshot of aggregate net direction, not an exit-timing product.

## 6. Stack, demo, commits, README

- **Stack:** Next.js 16.3.5, React 19.3, TypeScript 5.7.2, deployed on Vercel. No backend DB; in-memory cache + committed JSON corpus (`data/calibration-corpus.json`, `data/backfill-report.json`) for the static calibration panel.
- **Live demo:** https://polygraph-ochre.vercel.app (confirmed via `gh repo view` homepageUrl).
- **Commit count:** API returned only the 5 most recent (per_page=5, **truncated**, not the full count):
  - `daa4871` 2026-09-16 "Make freshness visible and controllable"
  - `9377b23` 2026-09-15 "Serve the submission demo as a static asset"
  - `3f1ffa3` 2026-09-15 "Add the demo recording pipeline"
  - `e1d1abe` 2026-09-15 "Upgrade to Next.js 16.3.5 and deploy"
  - `51f1970` 2026-09-15 "Add link preview, favicon, parser tests and API field notes"
- **Last push:** 2026-09-16T00:06:19Z (from `gh repo view --json pushedAt`).
- **README quality:** Strong. Clear one-sentence pitch, explicit endpoint table, explicit "field notes" for Nansen API gotchas (singular vs plural paths, `v1beta1` vs `v1`, filter body shape), explicit run steps (`npm install`, `cp .env.example .env.local` + add `NANSEN_API_KEY`, `npm run dev`), documented API routes, and an honest "three things that were wrong in the first version" section showing real iteration against live data rather than a plan-only README. **Runnable in under 10 minutes** by anyone with a Nansen API key — the only blocker is obtaining that key, which is outside the README's control.

## 7. Score: 8/10

Rubric-weighted reasoning: Data Integration is the strongest quadrant — Nansen's `tgm/flow-intelligence` cohort data is the direct input to the DECEPTION/TENSION/ALIGNED verdict math, not decoration (engine.ts:135-146, 219-238), and the endpoint gotchas documented in the README/API-NOTES read like real live-API scars, not guesses. Creativity is high (a "polygraph" framing of stated-vs-revealed belief, plus the calibration-corpus self-check that scores Polymarket's own honesty before blaming the crowd, is a genuinely distinct idea for this buildathon). Functionality is solid — retry/backoff, TTL caching, and `nansenSafe` error containment (`src/lib/nansen.ts`) suggest it won't crash on a bad response, though this review did not hit the live endpoint to confirm current uptime. Docs are excellent and clearly runnable. Points held back: one advertised endpoint (`smart-money/netflow`) is typed but dead code, and the "touches exits" claim is only an implicit sign-of-net-flow read, not a dedicated exit-timing signal — both are minor honesty gaps against an otherwise unusually well-documented and well-evidenced entry.
