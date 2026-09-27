# Sofiia7/bet-or-book — Meridian Buildathon review

## 1. One line
Paste a Hyperliquid wallet address; the tool returns one of four verdicts (Book, Hedged, Looks like a bet, Unknown) for the account's headline position, with the evidence (positions, resting orders, spot holdings, funding-linked wallets) that decided it, a balance-scale visualization, and a shareable card.

## 2. Nansen endpoints called
Grepped `src/sources/nansen.ts` (the only Nansen client) and `docs/nansen-api-usage.md`.

Live/used in the `NansenClient` interface and shipped code path (4 distinct endpoints):
- `profiler/perp-positions` (`src/sources/nansen.ts:174`, method `perpPositions`)
- `profiler/perp-pnl-summary` (`src/sources/nansen.ts:175-177`, method `perpPnlSummary`)
- `profiler/address/current-balance` (`src/sources/nansen.ts:178-185`, method `currentBalance`, chain=`all`)
- `profiler/address/related-wallets` (`src/sources/nansen.ts:186-193`, method `relatedWallets`)

A 5th endpoint, `profiler/perp-trades`, was tried once (per `docs/nansen-api-usage.md`) and deliberately dropped — it aggregates partial fills into one trade and is not called by the shipped client. So: **4 distinct Nansen endpoints in production use, 5 ever called**.

## 3. Does Nansen data drive logic?
Yes — it drives the verdict decision, not just display. Core logic: `src/engine/verdict.ts`, function `computeVerdict` (starts ~line 310) and its helpers `bookSignals` (~line 224), `isSameAssetBook`/`isDollarBalanced` (~line 265-278), `hedgeCanChangeVerdict` (~line 285).

- `bookSignals()` at `src/engine/verdict.ts:224-249` gates the "book" (market-maker) signal on `input.orders.headlineTwoSided`, `restingOrders`, `bidShare`, `coinsBothSides` — Hyperliquid-sourced order data — combined with `input.positions.headlineNotionalUsd`, whose position set for HIP-3 markets comes from Nansen's `profiler/perp-positions` (README: "134 positions against 86 visible to Hyperliquid's free main-dex endpoint").
- The hedge/coverage rule (`hedged` branch of `computeVerdict`, using thresholds `minHedgeRatio`/`maxHedgeRatio` = 0.85/1.15 at `src/engine/verdict.ts:120-128`) is fed directly from Nansen's `profiler/address/current-balance` (spot holdings on any chain) via the `hedge`/`HedgeFeatures` input — this is the literal Nansen-data-as-decision-input path, since Hyperliquid's own API cannot see other-chain spot balances at all.
- `linkedHedge`/`linkedHedgeRatio` (`VerdictInput` at `src/engine/verdict.ts:163`) comes from `profiler/address/related-wallets` and can flip a reading from Hedged/Bet to Unknown (`linked_exposure_unverified`).
- `hedgeCanChangeVerdict` (`src/engine/verdict.ts:285-299`) is a cost-gating function that decides whether to even spend the Nansen credit for a hedge lookup, based on prior structural signals — showing the pipeline treats each Nansen call as a decision input, not decoration.

This is a real trigger/scoring role: without Nansen's cross-dex position count and cross-chain balance data, the tool could not distinguish Book vs Bet vs Hedged for any account with HIP-3 exposure or non-Hyperliquid collateral — which the README's own three headline examples all turn on.

## 4. Does it EXECUTE anything?
No. Read-only. No transaction signing, no order placement, no on-chain writes. `POST /api/check` only runs the read pipeline and stores a result; `POST /api/og` only renders and caches a PNG. `POST /api/demo-access` only checks an operator key (204/403), spends nothing. Code search across the repo for `sell`/`exit`/webhook/transaction-signing keywords returned no hits, and the Security section of the README states explicitly: "No logins, sessions, uploads, webhooks or SQL; the only user input is an address, a coin and a side; the Worker calls two fixed hosts" (Nansen + Hyperliquid, both GET/POST reads).

## 5. Does it touch SELLS / EXITS?
No. GitHub code search (`search/code` API) for `sell` and `exit` inside the repo returned zero matches. The tool's entire scope is a point-in-time snapshot of currently open positions and current spot/related-wallet holdings (Book / Hedged / Bet / Unknown classification of what an address holds *right now*). It has no concept of exit timing, smart-money sell signals, or exit alerts — that is simply outside what it computes.

## 6. Stack, demo, commits, docs
- **Stack**: Cloudflare Workers + Workers KV + 2 Durable Objects (spend-cap/ledger, rate limiter), TypeScript, Vitest (562 recorded-response tests + 9 workerd/Miniflare runtime tests), no frontend framework (one HTML page + one JS file + canvas), `satori` + `@resvg/resvg-wasm` for social-preview PNG rendering.
- **Live demo**: https://bet-or-book.trade (README claims live, custom domain per commit history "Serve Bet or Book on custom domain (#5)").
- **Commit count**: commits API returns only the 5 most recent (truncated by `per_page=5`, not the true total):
  - `20b48d1` 2026-09-26 "Fit original hero explanation on one desktop line (#7)"
  - `146b141` 2026-09-26 "Keep workers.dev route alongside custom domain (#6)"
  - `aa97095` 2026-09-26 "Serve Bet or Book on custom domain (#5)"
  - `c25e467` 2026-09-26 "Keep OG summary ellipsis visible (#4)"
  - `a8343f5` 2026-09-26 "Clarify coverage when holdings are incomplete (#3)"
  - Note: **truncated at 5** — actual total commit count not fetched (repo created 2026-09-18, so likely well over 5 given the audit trail of daily doc entries from 09-19 through 09-26).
- **Last push**: 2026-09-26T17:16:37Z.
- **README quality**: Very high, and the "Run it locally" section is explicitly scoped to ~10 minutes: `git clone` → `npm install` → `npm test` runs the full suite Hyperliquid-only (no key needed); a live-Nansen run needs only copying `.dev.vars.example` → `.dev.vars` with a key, then `npm run dev`. Commands are copy-pasteable, prerequisites stated (Node 22.12+), and behavior without a Nansen key is explicitly documented (falls back to Hyperliquid-only and says so on the card). This should run in under 10 minutes for anyone with Node 22.12+ already installed.

## 7. Score: 9/10
Nansen data is a genuine decision input (not decoration) across 4 distinct live endpoints, feeding a versioned, documented, threshold-based classifier with an unusually rigorous self-audit trail (5 dated internal audits fixing real classifier bugs); functionality is demonstrably live (deployed URL, 562 tests including real-runtime workerd tests, real credit-spend ledger); docs let a stranger run it in well under 10 minutes. Creativity is strong — "bet vs hedge vs market-maker book" is a genuinely novel framing of whale-watching that most projects don't attempt, with an honest-limits section that is rare for a hackathon submission. Docked one point only because it is read-only with no sell/exit dimension and no execution/alerting layer, which narrows it to "a very good read-only analytics classifier" rather than the more ambitious end of what the rubric's "Functionality" and "Creativity" axes could reward.
