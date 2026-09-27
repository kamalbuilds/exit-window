# Batch AE review — Nansen Meridian Buildathon

Method: `gh repo view`, `gh api repos/OWNER/REPO/contents`, `gh api .../git/trees/HEAD?recursive=1`, `gh api .../commits`. No browser used.

## 0xkuzeydurden/exposure — NOT FOUND

`gh repo view 0xkuzeydurden/exposure` returns 404 (GraphQL "Could not resolve to a Repository"). Listing `gh api users/0xkuzeydurden/repos` shows 8 public repos (account-sdk, avail-campaign-listing, base, bitcoinbook, contracts, docs, optimism, v4-core) — none named `exposure`. Either private, deleted, renamed, or the name in the batch list is wrong. Cannot review. Score: 0 (unreachable).

---

## caringbuilders/whale-gossip

1. **Does:** A five-round prediction game — user guesses whether a fictional wallet's next action (within 48h) was Buy/Sell/No-trade, based on a synthetic five-trade tape.
2. **Endpoints:** 1 distinct (`/api/v1/tgm/dex-trades`, constant `NANSEN_DEX_TRADES_ENDPOINT` in `lib/server/nansen-contract.ts:22`) — but this endpoint is used **only** by private, offline "acquisition" tooling (`lib/server/nansen-acquisition*.ts`, `scripts/nansen-acquisition.ts`), never by the public game.
3. **Drives logic:** No, for the shipped product. `lib/server/synthetic-rounds.ts` holds 10 hand-authored synthetic records; `app/game.tsx` and `app/api/guess/route.ts` grade only these fixed fixtures — README states explicitly: "The public deck uses explicitly synthetic, deterministic fixtures. It does not display live wallet data." (README.md, "Nansen integration evidence" section). The one real Nansen endpoint call chain exists only to log call counts for the buildathon quota, never reaches gameplay.
4. **Executes:** No. Read-only; no trades, no alerts, no tx.
5. **Sell/exit side:** No. Fictional wallet "next action" (Buy/Sell/No-trade) is a guessing-game label over synthetic data, not a real exit signal.
6. Stack: Next.js/TS. Live demo: whale-gossip.vercel.app (synthetic, offline). Commits: 27. Last push: 2026-09-25. README: long and honest about limitations, runnable in <10 min with `npm ci && npm run dev`, no key needed.
7. **Score: 2/10.** Real Nansen usage is fully decoupled from the shipped, judged product; the game itself is a synthetic-fixture toy. Honest docs, but zero live data driving anything a judge can see.

---

## CoolCriSyS/poly-edge-scanner

1. **Does:** Scans Polymarket, ranks wallets with a proven all-time positive PnL prediction record who currently hold large positions in active markets; outputs a ranked "edge" list to a JSON dashboard.
2. **Endpoints:** 3 distinct Nansen MCP tools (via `https://mcp.nansen.ai/ra/mcp`): `prediction_market_screener`, `prediction_market_top_holders`, `prediction_market_address_summary` (`scanner.py`, docstring + `screener()`/`top_holders()`/functions).
3. **Drives logic:** Yes. `Edge strength = lifetime PnL × win rate × log(markets traded) × log(position size)` is computed directly from the three Nansen calls' fields (README "What it does"); this scoring is the entire product.
4. **Executes:** No. Read-only scan, writes JSON, GitHub Action (`.github/workflows/scan.yml`) commits fresh data every 6h. No trading, no alerts sent to a user, just a static dashboard refresh.
5. **Sell/exit side:** No. Entirely about entry positioning/track record of winners, not sells or exit timing.
6. Stack: Python scanner + Next.js dashboard (`web/`), deployed at poly-edge-scanner-kappa.vercel.app. Commits: 11. Last push: 2026-09-27. README: clear, quick run command, but requires a Nansen API key/credential setup that isn't fully spelled out for a cold local run (uses a "stored credential" helper as well as env var) — runnable but rougher than glidepath.
7. **Score: 6/10.** Real, distinct multi-endpoint Nansen data genuinely drives a non-trivial score; live-updating dashboard; but it's a display/ranking tool, not very novel, and setup for a fresh local run without CI secrets is a bit unclear.

---

## edycutjong/glidepath — flagged repo, deep review

1. **Does:** User pastes a token they must sell (that they never wanted), a chain, and the amount held; Glidepath outputs a dated, sized daily selling calendar (ICS/CSV) paced to that token's organic (non-pro-wallet) buy demand, so the user is never the largest seller on a day smart money/exchanges are also dumping.
2. **Endpoints:** 7 distinct Nansen REST endpoints, 11 calls/plan (`packages/core/src/nansen.ts`, table in README "Nansen Integration"): `search/general` (0cr), `tgm/token-information`, `tgm/who-bought-sold` (×2, different label filters), `tgm/flow-intelligence` (×2, 1d and 7d), `tgm/flows` (×2, smart_money and exchange labels), `tgm/indicators`, `trade/quote` (×3 on solana/base only).
3. **Drives logic — yes, quoted:**
   - Organic demand = total buy volume minus pro-labelled buy volume, from `tgm/who-bought-sold` with `include_smart_money_labels`/`exclude_smart_money_labels` filters — feeds `packages/core/src/plan.ts` tranche sizing (`organic/day` term, README architecture diagram: `P["plan.ts ... price → organic/day → risk dial k → tranches"]`).
   - Risk dial `k` (participation rate, 10%→3%) driven by `tgm/indicators` peer-percentile scores (liquidity-risk, concentration-risk, btc-reflexivity).
   - "Red day" halving of tranche 1: `smart_trader_net_flow_usd` / `exchange_net_flow_usd` from `tgm/flow-intelligence` (1d) — "a red today (exchange net deposits +$736K) halves the first tranche" (README screenshots section); 7-day/14-day history from `tgm/flows` extends this into a red-day rate.
4. **Executes:** No — explicit and repeated: "It plans. It never trades." `trade/quote` calls are read-only price quotes (routed cost estimate), never a swap/signed tx. No wallet connect, no alerts sent externally (an in-app "call rail" is just a UI log of its own API calls, not an alert to a user about someone else's activity).
5. **Sell/exit side — yes, this is the whole product, at the token-cohort level, not per-wallet.** It plans the *user's own* exit (their bag) as a dated sell calendar; it detects *other* market participants' exits via cohort aggregates — "Smart Money net-selling" and "net deposits to exchanges" (both cohort-level flow-intelligence/flows signals, not identified individual wallets) — to decide whether "today" or the recent history is a red (dump) day and shrink the user's own sell size accordingly. It does not name or track individual wallets' exit timing; it aggregates smart-money/exchange cohorts.
6. Stack: Next.js 15/TS monorepo (Turborepo-style: `packages/core`, `packages/cli`, `apps/web`). Live demo: glidepath.edycu.dev (+ `/judge` page). Commits: 92. Last push: 2026-09-25. README: exceptional — architecture diagram, per-endpoint field table, credit costs, 258 tests, 13 offline-replayable fixtures, `npm run verify` runs with zero network/credits. Runnable in well under 10 min (`npm ci && npm run dev`, or `npm run verify` needs no key at all).
7. **Score: 9/10.** Best-documented, most specific Nansen-endpoint-to-logic mapping of the batch, genuinely novel framing (forced-seller pacing, not a dashboard), read-only by design and says so explicitly, offline-reproducible proof. Minor ding: impact model (constant-product) is a known simplification the docs themselves flag, and it's a planning tool for one's own bag rather than a market-wide alert.

---

## Sacura1/Dawn

1. **Does:** Browser extension: hover over a contract address or cashtag on X/Twitter → popup card shows Nansen token stats (price, holders, buy/sell volume, Smart Trader/Whale/Exchange net flow) plus a derived "signal" label.
2. **Endpoints:** 2 distinct (`server/src/nansen/client.ts:11-12`): `/api/v1/tgm/flow-intelligence`, `/api/v1/tgm/token-information`.
3. **Drives logic:** Yes, thin logic. `server/src/intelligence/signals.ts` `deriveSignal()` applies fixed USD thresholds ($25k/$100k/$10k) and wallet-count minimums to `smartTraderNetflowUsd`/`whaleNetflowUsd` to output one of 5 labels ("Smart money is peeking", "cooling off", "mixed", "unusual", "insufficient data") — file:line `signals.ts:17-66`.
4. **Executes:** No. Read-only hover card; no alerts sent, no tx.
5. **Sell/exit side:** Weak/no. Negative Smart Trader net flow triggers a "cooling off" label, but this is a passive cohort-level display, not an exit-timing feature or alert — no per-wallet exit tracking.
6. Stack: Vite/React extension + small Node server. No live demo (it's a browser extension, install-locally). Commits: 1 (single squashed commit). Last push: 2026-09-17 (10 days stale vs. the 2026-09-27 deadline — oldest last-push in the batch). README: clear step-by-step for Chrome extension install, ~10 min feasible.
7. **Score: 4/10.** Real but shallow (2 endpoints, simple threshold rule), single commit suggests either squash-and-dump or minimal iteration, and it's the staleness leader of the batch.

---

## saireddypulapathuri/smart-money-mafia

1. **Does:** A social-deduction/mystery game: each round shows anonymized "suspect" behavior derived from a token's wallet-segment flows; player deduces whether the suspect is Smart Money, exit liquidity, a whale, an exchange sink, retail noise, or fresh-wallet momentum, then reveals the Nansen-backed answer.
2. **Endpoints:** 6 distinct (README "Nansen API Usage" + `src/services/nansen.ts`): `tgm/flow-intelligence` (primary, live-mode default), `smart-money/netflow`, `tgm/who-bought-sold`, `tgm/holders`, `tgm/token-ohlcv`, `token-screener`.
3. **Drives logic:** Yes. `src/services/agentEngine.ts` computes suspect `status`/`confidence` directly from `actor.netFlowUsd`/`walletCount` (e.g. `status: actor.netFlowUsd < 0 ? "warning" : status`, `confidence: clamp(...)`, `agentEngine.ts:36-58`) — flow magnitude and direction set the round's "convicted"/"watching"/"warning" verdict.
4. **Executes:** No. Pure game UI; no alerts, no tx. Can run entirely off a "local evidence vault" (cached JSON) instead of live calls — `VITE_USE_NANSEN=true` needed to hit Nansen live at all, so out-of-the-box it may be running on saved evidence rather than a fresh call.
5. **Sell/exit side:** Partial/gamified. One of the suspect archetypes is explicitly "exit liquidity," inferred from cohort netflow/outflow behavior, but this is a labeling category inside a guessing game, not a sell-timing tool or alert about a real wallet's exit.
6. Stack: Vite/React/TS. No live demo URL found. Commits: 5. Last push: 2026-09-24. README: decent, includes a submission checklist and a `nansen:calls` logging helper script; local run is standard `npm install && npm run dev`, but live-Nansen mode needs extra env flags to even activate.
7. **Score: 5/10.** Real endpoints and real threshold-driven logic, creative framing (game not dashboard), but default run path may be evidence-vault (not live), and it's thin — one primary endpoint does most of the round logic.

---

## unborn7g/thesis-shredder

1. **Does:** User pastes a trade thesis + token; the app runs an "adversarial red-team" over 5 claimed on-chain checks and returns a 0-100 "Fragility/Shred Score."
2. **Endpoints:** README claims 5 distinct Nansen surfaces including `/v1/profiler/address/.../counterparties`, `/v1/token/.../perp-positions`, `/v1/token/solana/.../jupiter-dcas`. The actual client (`services/nansenClient.js:78-112`) only implements 5 different methods hitting `/smart-money/holdings`, `/smart-money/dex-trades`, `/tgm/flow-intelligence`, `/tgm/holders`, `/profiler/address/related-wallets`. **Neither set matches what the engine actually calls**: `services/shredderEngine.js` (`runLiveEvaluation`, lines ~62-100) calls `this.client.getTokenFlows()`, `this.client.getWhoBoughtSold()`, `this.client.getJupiterDcas()`, `this.client.getPerpPositions()` — none of these methods exist on `NansenClient`. Every one of these calls throws (`TypeError: ... is not a function`), each individually caught by a per-gauntlet `try/catch` that just logs "endpoint unavailable" and leaves the value `null`.
3. **Drives logic:** No, in the live path — it cannot, because the live calls are all broken by the method-name mismatch (see #2). Regardless of whether a valid `NANSEN_API_KEY` is supplied, `parseLiveData()` (`shredderEngine.js:~108`) receives `tokenFlows=null, whoBoughtSold=null, jupiterDcas=null, perpData=null` every time and falls back to hardcoded defaults (`tokenFlows?.netflow_usd || 0`, `market_cap_usd || 10000000`, etc.) and an empty-array cabal analysis. The score a user sees is effectively always the "algorithmic sandbox"/synthetic path (`generateSyntheticData`, `shredderEngine.js:53-56`) dressed as "live."
4. **Executes:** No trades. Output includes an `actionableRecommendation` string like "DO NOT EXECUTE. Thesis is compromised…" — but this is just a text recommendation shown to the user, not an executed action or a sent alert.
5. **Sell/exit side:** Nominal only. One gauntlet is titled "Automated Liquidity Bleed" (meant to scan Jupiter DCA sell ladders) and the smart-money netflow gauntlet is meant to detect "Smart Money dumping into retail breakouts" — but per #2/#3 these never actually run against real data; the exit-detection claim is aspirational/broken code, not a working feature.
6. Stack: Node/vanilla JS + static HTML front end. No live demo URL (recorded `.mp4` walkthrough is bundled in-repo instead). Commits: 9. Last push: 2026-09-25. README: polished with diagrams and video, "any judge can clone and run in <60s" claim is true for the mock path (`npm install && npm start`), but the marquee "live Nansen" claim is not actually reachable in the shipped code.
7. **Score: 2/10.** This is the batch's clearest doc/code mismatch: the README's "Nansen data drives the deterministic logic" claim is false for the live path due to a straightforward method-name bug — every live gauntlet silently no-ops to defaults. Polished presentation, unverified substance.

---

## vybao39-rgb/token-battle ("Dump Risk Alarm") — flagged repo, deep review

1. **Does:** User pastes one token contract address; app auto-detects which supported chains hold that token, then on request runs a full analysis on a chosen chain and returns a 0-100 "distribution-risk" score plus a token-vs-BTC 30-day relative-strength chart.
2. **Endpoints:** 8 distinct Nansen REST endpoints, 11 calls/analysis, ≤23 credits (`lib/nansen.ts:57,76-93`, `API_BASE = https://api.nansen.ai/api/v1`): `tgm/token-information`, `tgm/flows` (×2: smart_money, exchange labels), `tgm/transfers`, `tgm/who-bought-sold` (×2: BUY, SELL), `tgm/holders`, `smart-money/netflow`, `tgm/indicators`, `tgm/token-ohlcv` (×2: token + BTC/Hyperliquid).
3. **Drives logic — yes, quoted, weighted and token-level, not per-wallet:** `lib/nansen.ts:172-183` builds 6 weighted `RiskSignal`s (Smart Money netflow 25%, Exchange flow 20%, Holders/concentration 20%, Large-transfer anomaly 15%, Buy/sell pressure 10%, Liquidity/market health 10%) then: `const riskScore = Math.round(availableSignals.reduce((total, item) => total + (item.riskScore ?? 0) * item.weight, 0) / availableWeight)` (`lib/nansen.ts:183`), classified by `classifyRisk()` (`lib/nansen.ts:390`) into a verdict from "Strong accumulation" to "Strong dump pressure." Signal direction per-item is set at `direction: rounded >= 60 ? "dump" : rounded <= 40 ? "accumulate" : "neutral"` (`lib/nansen.ts:313`). This is real, cited-field-driven scoring, not decoration.
4. **Executes:** No. README states explicitly: "The app is read-only and never connects a wallet or requests a signature." No trades, no orders. It does **not send alerts either** — there's no push/webhook/notification mechanism; the score is computed synchronously on a user-initiated `POST /api/analyze` and displayed in the UI, then optionally cached to a private admin archive.
5. **Sell/exit side — yes, this is the product, but token-level cohort risk, not wallet-level exit alerts.** All 6 signals are about aggregate sell-side pressure on one token: Smart Money netflow direction (accumulating vs. distributing), exchange net-inflow ("Net inflow to labeled exchanges can increase potential sell-side supply," `lib/nansen.ts:173`), top-holder balance reduction count, large CEX-bound transfers, and buy-vs-sell volume. It never names or times an individual wallet's exit — no wallet-level exit alert, no "smart money sold at X" event feed. It's an on-demand token dump-risk score, not an alarm/alert system despite the app's title "Dump Risk Alarm" (no alerting mechanism exists in the code).
6. Stack: Next.js/TS, Vercel Blob for a private admin archive, Drizzle/D1 examples present but not core to the flow. Live demo: token-battle-nansen.vercel.app. Commits: 15. Last push: 2026-09-27 (freshest in batch). README: strong — signal/weight table with exact endpoint names, credit math, rate limits, security notes, clear local run (`npm install`, `.env.local`, `npm run dev`), runnable well under 10 min.
7. **Score: 8/10.** Widest endpoint coverage in the batch (8), a genuinely weighted multi-signal score with quoted formula, honest about being read-only and about "exchange inflow suggests potential sell-side supply but does not prove a sale." Docked slightly because the name "Dump Risk Alarm" implies alerting it doesn't do, and because the risk model is cohort/token-level, not tracking specific smart-money wallets' actual exits.

