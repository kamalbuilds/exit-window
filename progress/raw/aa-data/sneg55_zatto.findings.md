# sneg55/zatto — Nansen Meridian Buildathon review

## 1. One-line description
User points Zatto at a Base token or wallet address (or triggers a paid chain-wide scan via `/api/scan/base`); it outputs, per Smart Money buy, the burst of new buyers in the 10 minutes after that buy versus the token's own prior-hour baseline, and what buying one minute later returned 24 hours on — surfaced as per-token/per-wallet crowd verdicts (`CROWDED`/`QUIET`/`THIN`) on token, wallet, and run-leaderboard pages.

## 2. Nansen endpoints called
Grepped in `lib/nansen/endpoints.ts` (the sole caller module):
- `token-screener` — `fetchScreenerTokens()`, discovery of fresh/established tokens with Smart Money buy volume.
- `tgm/dex-trades` — `fetchSmartMoneyBuys()` (Smart-Money-filtered buys for a token) and `fetchTapePage()` (full hourly trade tape, unfiltered, for burst/baseline counting).
- `profiler/dex-trades` — `fetchProfilerBuys()`, a wallet's own trade history.
- `tgm/token-ohlcv` — referenced in `lib/nansen/candles.ts` (not fetched in full but named in README Method section and in `CARRY_FORWARD_MAX_MINUTES` doc) for minute-level close prices used in return calculation.

**Count: 4 distinct endpoints** (`token-screener`, `tgm/dex-trades`, `profiler/dex-trades`, `tgm/token-ohlcv`), matching the README's own "Endpoints used" section. `tgm/dex-trades` is called twice for two different purposes (SM-filtered buys vs. full tape), which is still one endpoint.

## 3. Does Nansen data drive logic or only display?
Drives logic directly — Nansen trade/price data is the sole input to the crowd-detection algorithm and the return/verdict computation. Core logic, `lib/score/perBuy.ts:26-45` (`scoreBuy`):
```
lib/score/perBuy.ts:30   const buys = rows.filter((r) => r.action === "BUY" && r.trader !== wallet);
lib/score/perBuy.ts:32   const prior = new Set(buys.filter((r) => r.ms >= t0 - 3_600_000 && r.ms < t0).map((r) => r.trader));
lib/score/perBuy.ts:33   const baselineRate = prior.size;
...
lib/score/perBuy.ts:40   const crowdRatio10 = within(BURST_MINUTES * 60) / burstBaseline;
lib/score/perBuy.ts:64   return { ..., crowded: crowdRatio10 >= CROWD_RATIO, ... };
```
`rows` and `closes` come straight from `tgm/dex-trades` tape rows and `tgm/token-ohlcv` candle closes (via `lib/score/types.ts` `TapeRow`/`TapeBucket`). The `crowded` boolean (`crowdRatio10 >= CROWD_RATIO`, `lib/score/constants.ts`) is the trigger that feeds the `CROWDED`/`QUIET`/`THIN` verdicts shown on every page. This is not decorative charting of Nansen data — the ratio computed from Nansen trade counts is the decision itself.

## 4. Does it execute anything?
No trading, alerting, or on-chain action tied to the Nansen signal. It is read-only with respect to the market: no order placement, no wallet-following alerts, no automated trade execution. The only on-chain/transactional path in the repo is unrelated to the signal — `lib/x402/server.ts` implements an x402 paywall (`POST /api/scan/base` returns 402, accepts a signed EIP-3009 USDC transfer authorization on Base, settles 1 USDC via a PayAI facilitator) that gates access to running a scan. That is payment settlement for the product itself, not an action taken on the analysis output.

## 5. Does it touch sells/exits of wallets?
No. Grepped `lib/score/*.ts`, `lib/nansen/*.ts`, `lib/jobs/*.ts`, and the API routes for `sell`/`exit` — zero hits (the one "order" match in `lib/score/copied.ts:108` is an array-sort variable name, unrelated). `fetchSmartMoneyBuys` and `fetchProfilerBuys` filter explicitly on `action: "BUY"` / `isQualifyingBuy` (buys only). The README states this directly: "Zatto does not claim any address copied the wallet, and it does not predict," and its three measured claims are all about buyer counts and price return after a buy — no sell-side or exit-timing signal exists anywhere in the product.

## 6. Stack, demo, commits, README quality
- **Stack:** Next.js 16 (App Router) + React 19, deployed as a Cloudflare Worker via OpenNext, Cloudflare D1 for tape/score/job storage, Cloudflare Cron (every 5 min) driving a step-chained job pipeline, x402 (`@x402/core`, `@x402/evm`, `@x402/next`) + viem for the paid-scan flow, Vitest for tests.
- **Live demo:** `https://zatto.nsawinyh.workers.dev` (badge + README link).
- **Commit count:** 73 total (via `Link: rel="last"` header on `commits?per_page=1`, page=73). Only last 5 fetched per instructions (2026-09-18 range, all README/diagram polish commits).
- **Last push:** 2026-09-18T16:39:21Z.
- **README quality:** Very high. Includes architecture + job-state Mermaid diagrams, a worked ASCII timeline of how one buy is measured, a full constants table with rationale for each tunable, explicit quick-start (`git clone` → `wrangler d1 create` → secrets → `npm run proof` → `npm run seed:fixtures` → `npm run dev`), a troubleshooting section for a known stale-build gotcha, and reported live measurement runs with real numbers (run `manual-base-6`, `manual-base-7`) including a self-correction noting an earlier revision's numbers were wrong and why. A developer with a Cloudflare account and a Nansen API key could plausibly clone, configure secrets, run `proof`+`seed:fixtures`, and see the app rendering real scored data locally in well under 10 minutes — this is one of the more runnable Buildathon READMEs reviewed. Minor friction: needs a live `NANSEN_API_KEY` before `proof` will produce fixtures (no fixture snapshot ships in the repo), so a reviewer without a key is limited to reading code/diagrams, not running it end-to-end.

## 7. Score against rubric (25% each: Data Integration, Creativity, Functionality, Docs)
**9/10.** Data Integration is the strongest showing possible short of using every Nansen endpoint: 4 distinct endpoints, all feeding a real decision boundary (`crowded` verdict), not just rendered tables. Creativity is genuine — a burst-vs-baseline "is anyone copying Smart Money" meter with a self-reported, self-corrected base-rate table is a real analytical angle rather than a wrapper dashboard. Functionality is live (real deployed Worker, real cron-driven job pipeline with lease/resume/sweeper resilience, real x402 payment gate, CI badge). Docs are exceptional and honest about limitations (profiler date-window quirk, candle gaps, cluster/fleet double-counting fix). Held back from a 10 only because it's read-only/no-execute and the paid-scan/live-run path depends on funded secrets a judge may not have time to configure within a quick review window.
