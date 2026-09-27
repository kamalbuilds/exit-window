# mrchaosdev/proofpulse — Nansen Meridian Buildathon review

## 1. What it does in one line
An evidence-first onchain wallet/token investigation workspace: a user enters a chain + token/wallet address and timeframe, and it returns three separately-scored answers (Direction, Confidence, Coordination Risk) plus an evidence ledger tracing every claim back to the underlying Nansen record, with an optional wallet-relationship expansion.

## 2. Exact Nansen endpoints called
From `src/integrations/nansen/nansen-endpoints.ts` (`ENDPOINTS` map, base `/api/v1`):

1. `POST /token-screener` (capability `token-context`) — also reused in list form for `liquidity-peers`
2. `POST /tgm/flow-intelligence` (capability `cohort-flows`)
3. `POST /tgm/who-bought-sold` (capability `buyers`/`sellers`)
4. `POST /profiler/address/related-wallets` (capability `related-wallets`)
5. `POST /tgm/flows` (capability `smart-money-history`)

**Count: 5 distinct endpoint paths** (4 distinct capabilities plus the screener reused for the peers view; README's table lists 4 "capabilities" but the code has a 5th, `tgm/flows`, for smart-money history).

## 3. Does Nansen data drive logic, or only display?
Drives logic directly — it is the sole input to all three scores.

- `src/domain/scoring/calculate-direction.ts:76-104` — `calculateDirection()` takes `segmentFlows` (from Nansen flow-intelligence) and `tokenLiquidityUsd` (from Nansen token-screener), computes a `tanh`-normalized, weighted mean per cohort segment, and clamps to a -100..100 Direction score. This is a real numeric transform of Nansen values, not a display pass-through.
- `src/domain/scoring/calculate-coordination-risk.ts:63-93` — `calculateCoordinationRisk()` consumes Nansen buyer/seller actor volumes and related-wallet edges to compute concentration (`concentrationComponent`, line ~136), relationship density (`densityComponent`, line ~168), and diversity (Herfindahl-based, `diversityComponent`, line ~217), summing into a 0-100 score with state machine `not-assessed` / `preliminary` / `assessed` gated on whether relationship data was actually fetched.
- Every `ScoreComponent` carries `evidenceIds` pointing back to specific Nansen records (evidence.ts), and scores explicitly report "unavailable"/"not-assessed" rather than defaulting to a fabricated neutral value when Nansen data is missing.

This is genuine decision logic (weights, normalization, capping, exclusion rules like zero-weighting the `exchange` segment because its sign convention is unverified), not a dashboard reformatting API responses.

## 4. Does it EXECUTE anything?
No. It is read-only. `src/integrations/nansen/nansen-client.ts:112-128` (`callNansen`) issues only `fetch(..., { method: "POST" })` calls to Nansen's read endpoints to *retrieve* data; there is no trade execution, no onchain transaction signing/sending, no wallet connection, and no outbound alert/notification system anywhere in the tree. The README explicitly states this as a design constraint: "No trade execution, wallet connection, custody, price target or position sizing exists anywhere in it."

## 5. Does it touch SELLS / EXITS of wallets?
Partially, as data, not as a feature. `src/integrations/nansen/normalizers/normalize-who-bought-sold.ts` ingests Nansen's `bought_volume_usd` / `sold_volume_usd` per actor and derives `netUsd = bought - sold`; this seller-side volume feeds into `Actor.soldUsd`/`side: "seller"` and into the coordination-risk concentration/diversity components alongside buyers. Direction's `netFlowUsd` per cohort segment also implicitly nets sell pressure against buy pressure.

There is **no dedicated exit-timing, "when smart money sells," or exit-alert capability** — no code path named around exits, no timing-based sell-signal, and the one component that would need sell timestamps (`timingComponent` in `calculate-coordination-risk.ts`) is explicitly hard-coded to contribute 0 because "consistent source-time coverage is unverified" (open question P-04 in the docs). So: sells are tracked as volume/actor-side data feeding concentration scoring, but exit timing/exit alerts are not implemented.

## 6. Stack, demo, commits, README quality
- **Stack:** Next.js 16.3.5 (App Router), React 19.3, TypeScript 5.9, Zod 4 for schema validation, Tailwind 4, GSAP for animation, Vitest for unit/integration tests, Playwright for e2e. No database — server-side in-memory/shared cache (`src/server/cache`), fixture-based demo mode.
- **Live demo URL:** repo's GitHub `homepage` field is `https://proofpulse-eta.vercel.app` (Vercel deploy exists), but the README itself says "Live demo: Not deployed yet" and points to fixture mode instead. Conflicting signals — the Vercel URL exists but README doesn't claim it live; treat the Vercel link as unverified/possibly stale rather than a confirmed live deploy.
- **Commit count:** commits API returned 5 most recent (default page size), all within 2026-09-14 to 2026-09-23 (repo created 2026-09-14, last pushed 2026-09-23T15:15:58Z). Could not confirm total count beyond these 5 without paging further; **note: the 5 returned may be truncated** (only checked `?per_page=5` per instructions) — actual total commit count is unverified.
- **Last push:** 2026-09-23T15:15:58Z.
- **README quality:** Strong. It explains the problem, the three-score philosophy, has a literal endpoint table with the same 4 capabilities as the code (missing the 5th `tgm/flows` call), gives exact copy-paste run commands (`npm install && npm run build && npm run start`), a working fixture-mode URL with no credential needed, explicit test commands (`npm run quality`, `npm run test-e2e`), and clearly stated limitations (uncalibrated thresholds, unwired model provider, exchange-flow exclusion). A builder could plausibly go from clone to a running fixture-mode demo in well under 10 minutes using only the README. Live-mode setup (copy `.env.example`, add `NANSEN_API_KEY`) is also documented but untested here.

## 7. Score against rubric (25% each: Data Integration, Creativity, Functionality, Docs)
**8/10.**

Rationale: Data Integration is strong — 5 distinct live Nansen endpoints feed real, published scoring formulas (not just rendered tables), with explicit handling of upstream quirks (zero-weighted unverified segments, null-vs-zero semantics, missing-timestamp gating) that shows genuine engagement with Nansen's data rather than a naive wrapper. Creativity is above average for a hackathon: refusing to collapse three questions into one score, and stating "unavailable" instead of a fake neutral value, is a real design point most entrants skip. Functionality is good but capped — no verified live deployment (README itself says "not deployed yet" despite a Vercel homepage link, so judges must run it locally or trust fixture mode), and no live smart-money sell/exit signal despite touching sell volume. Docs are excellent and would let a builder run the fixture demo in well under 10 minutes. The main point loss: unclear whether it can actually be judged live without judges configuring a Nansen API key themselves, and the sell/exit angle from the prompt's interest area is present only as raw data, not a feature.
