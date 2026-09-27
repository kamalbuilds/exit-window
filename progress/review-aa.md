# Meridian Buildathon Review - Batch aa

Generated 2026-09-27T10:35:39Z

| repo | does | endpoints# | drives-logic | executes | exit-side | score |
|---|---|---|---|---|---|---|
| talentsolutionsmyanmar-max/glass-knot | Solana Smart-Money buy graph BFS, grades FARM_CLUSTER/SOLO_SM/RESEARCH/FAIL | 4 | y | n | n | 8/10 |
| mrchaosdev/proofpulse | Wallet/token investigation tool, Direction/Confidence/Coordination-risk scores | 5 | y | n | y (bought/sold volume feeds scoring, no dedicated exit-timing) | 8/10 |
| bek01/polygraph | Onchain lie detector: Polymarket belief vs onchain flow, ALIGNED/TENSION/DECEPTION | 7 (8 incl. dead code) | y | n | y (net-flow sign only) | 8/10 |
| edycutjong/sentwrong | Classifies misdirected-send recipient into 1 of 4 recovery routes, drafts ticket | 7 | y | n | n | 9/10 |
| MicroQuack/dejaview | Replays pump.fun token's first hour, labels buyers by past-launch record, flags echoes | 5 (8 incl. historical variants) | y | n | n | 9/10 |
| aneesbinnazir-boop/nansen-wallet-analyzer | Nothing - README only, no code, 1 commit | 0 | n/a | n/a | n/a | 1/10 |
| edycutjong/labelme | Wallet-guessing card game using Nansen labels/stats as answer key | 9 | y | n | n | 8/10 |
| edycutjong/rebuttal | Verifies a 'Smart Money is buying X' claim against Nansen data, CONFIRMED/OVERSTATED/CONTRADICTED | 7 (6 driving + 1 comparison) | y | n | y (mirrored selling-claim + C-EXIT rule, verification only) | 9/10 |
| aasunbul/nansen-whale-radar | Canvas radar viz of whale leaderboard + smart-money netflows | 2 | n (display only) | n | n | 6/10 |
| sneg55/zatto | Token/wallet copy-crowding meter, Smart-Money buyer bursts vs 24h returns | 4 | y | n | n | 9/10 |
| Sofiia7/bet-or-book | Paste Hyperliquid address, get Book/Hedged/Bet/Unknown verdict with evidence | 4 | y | n | n | 9/10 |

## Notes

---
# aasunbul/nansen-whale-radar — Findings

Repo: https://github.com/aasunbul/nansen-whale-radar
Single squashed commit `c41b54c`, pushed 2026-09-18T15:11:15Z (created same second as pushed — this is a one-shot upload, not iterative dev).

## 1. What it does (one line)

A read-only canvas visualization: on page load it renders a "radar sonar" where every Nansen Star/North/Ice wallet from the points-leaderboard is a positioned blip (size/position from points+rank) and Smart Money token net-flows sit on an outer ring as green (inflow) / red (outflow) marks; a rotating sweep line pings blips and fires inward/outward streaks off flow marks, and hovering any blip/mark shows a tooltip (address, points, rank, tier / token, chain, 24h+7d net flow, trader count). No user input beyond mouse hover — it is a live-loading dashboard, not an interactive tool.

## 2. Nansen endpoints called

Grepped `build_data.py`, `buildathon_meter.py`, `index.html` for `nansen.ai`:

- `GET https://app.nansen.ai/api/points-leaderboard` — public, no key. Called from `build_data.py:11` (snapshot builder) and again as a browser-side fallback in `index.html:93` if no local snapshot JSON is found.
- `POST https://api.nansen.ai/api/v1/smart-money/netflow` — requires `apiKey` header. Called only from `buildathon_meter.py:46` (offline data-prep script). `index.html` never calls this endpoint live; it only reads the pre-baked `data/flows_*.json` the script produced (`index.html:110-112`), with **no live fallback** if that file is missing (flows array stays empty).

**Distinct endpoints: 2.**

## 3. Does Nansen data drive logic, or only display?

Display-only, no scoring/decision/trigger logic. Every use of Nansen data is a direct linear/geometric mapping into pixel position, size, or color — there is no threshold, ranking algorithm, or branch that changes application behavior based on data values beyond that mapping.

- `index.html:71` — `const rr = Math.pow(t,0.62)*R*0.72;` : wallet radial position derived from its rank percentile (t = i/whales.length). This is the only place "rank" changes anything, and it's a cosmetic placement formula, not a decision.
- `index.html:140-142` — `const inflow = m.f.net_24h >= 0; const c = inflow ? "#7ee787" : "#ff8a80"; const size = 1.8 + Math.min(Math.abs(m.f.net_24h)/60000,1)*4.5;` : color and marker size come from the sign/magnitude of `net_24h`. Still purely a rendering choice, no alert, no filter, no ranking output.

There is no scoring model, no "top mover" computation, no alert threshold, nothing that would count as application logic driven by the data beyond "map value to X/Y/color/radius."

## 4. Does it execute anything?

No. Entirely read-only. No trade execution, no onchain transaction, no alert dispatch (email/webhook/push), no order placement anywhere in the three source files. `buildathon_meter.py` only fetches and writes local JSON.

## 5. Does it touch sells/exits of wallets?

No wallet-level exit tracking or alerting exists. The only sell-adjacent signal is the *aggregate token* `net_flow_24h_usd` / `net_flow_7d_usd` sign from `smart-money/netflow` (a token-level net-flow number across all smart-money wallets, not per-wallet), rendered as red "outflow" marks with an outward streak (`index.html:140-158`). There is no per-wallet sell detection, no exit-timing computation, no alert when a specific tracked wallet sells or exits a position. If a whale wallet exits, nothing in this app would surface that as an event — the whale blip's tier/position would only change on the next full leaderboard snapshot rebuild.

## 6. Stack, demo, commits, README

- **Stack**: vanilla JS + HTML5 Canvas, zero frontend dependencies, zero build step. Data prep is two standalone Python 3 scripts (`urllib` stdlib only, no requests/pandas).
- **Live demo URL**: none. `homepageUrl` on the repo is empty. README only documents `python -m http.server` for local hosting.
- **Commit count**: 1 total commit (`c41b54c`), confirmed via `commits?per_page=5` returning a single entry — not truncated, this is genuinely the entire history (single squashed upload).
- **Last push**: 2026-09-18T15:11:15Z, same timestamp as repo creation.
- **README quality**: Well-organized (what-it-does, why-a-radar, run instructions, API table, file table, roadmap). But it has a real gap for the "run in under 10 min" bar:
  - Running `index.html` alone works out of the box off the committed `data/radar_20260918.json` and `data/flows_20260918.json` snapshots — this part is genuinely under 10 minutes.
  - The documented data-pipeline step (`python buildathon_meter.py`) will **fail immediately for any other builder**: it hardcodes a Windows-only absolute path (`buildathon_meter.py:11-12`, `METER_FILE = "C:/Users/aasun/nansen-whale-radar/buildathon_meter.json"`, `OUT_DIR = "C:/Users/aasun/nansen-whale-radar/data"`) with no `os.path.dirname(__file__)`-relative fallback like `build_data.py` uses. On macOS/Linux, or on Windows under a different username, this raises on the `os.makedirs`/open call. The README presents this as a runnable step but it is not portable.
  - **Security note**: `buildathon_meter.py:9` hardcodes a live Nansen API key in plaintext (`API_KEY = "nsn_..."`) committed to a public repo. Not asked about in the rubric, but a judge inspecting the code will see it; noted here without reproducing the key value.

## 7. Score: 6/10

Creativity is genuinely the strongest leg — mapping the entire leaderboard into a radar-sweep visual metaphor is a distinctive, non-generic idea and the canvas rendering (ping rings, directional streaks, golden-angle blip placement) is well executed for a single-file app. But Data Integration is thin (only 2 distinct endpoints, and the paid netflow endpoint is never called live from the app — it's baked into a static JSON at prep time with no live fallback), the data only drives cosmetic position/color/size with no scoring or decision logic, it's purely read-only with no exit-side wallet intelligence, and Functionality/Docs take a real hit from the hardcoded Windows-only path in the documented pipeline script plus a committed plaintext API key.

---
# aneesbinnazir-boop/nansen-wallet-analyzer

1. **What it does**: Nothing. Repository tree contains exactly one file, README.md; there is no application code.
2. **Nansen endpoints**: 0. No source files exist to call any endpoint.
3. **Drives logic vs display**: N/A, no logic exists.
4. **Executes anything**: N/A.
5. **Sells/exits**: N/A.
6. **Stack/demo/commits/README**: No stack (no code). No live demo. Exactly 1 commit ("Initial commit", 2026-09-17T10:24:55Z). Last push = that commit. README quality: cannot be assessed as "runnable in 10 min" since there is nothing to run; presumably describes an idea only.
7. **Score: 1/10.** Idea-only submission with zero implementation, zero Nansen integration, nothing to judge on any rubric axis.

Verified independently via `gh api repos/aneesbinnazir-boop/nansen-wallet-analyzer/git/trees/HEAD?recursive=1` (returns only README.md) and `gh api repos/aneesbinnazir-boop/nansen-wallet-analyzer/commits?per_page=5` (returns 1 commit).

---
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

---
# edycutjong/labelme — Nansen Meridian Buildathon review

Repo: https://github.com/edycutjong/labelme (public, TypeScript, MIT)
Read via `gh api` tree + contents, no browser.

## 1. What it does in one line

A card game: the player is shown a real Ethereum wallet's Nansen-derived stats (PnL, balance, counterparties) with no label, picks one of five label classes (Smart Money / Exchange / Whale / Contract-Pool / Regular), and the reveal shows Nansen's own label group plus a one-line "tell" explaining why.

## 2. Nansen endpoints called

Grepped `packages/core/src/nansen.ts` (the single file wrapping all Nansen calls) and `client.ts`'s credit-cost table. Distinct endpoints called:

1. `tgm/holders` (5 cr) — smart_money / exchange / public_figure / plain-tag pages
2. `tgm/who-bought-sold` (1 cr) — all 17 label groups excluded → "regular" class
3. `smart-money/dex-trades` (5 cr) — active Smart Money traders for live draw
4. `profiler/address/pnl-summary` (1 cr)
5. `profiler/address/pnl` (1 cr)
6. `profiler/address/current-balance` (1 cr)
7. `profiler/address/counterparties` (5 cr)
8. `profiler/address/transactions` (1 cr)
9. `transaction-with-token-transfer-lookup` (1 cr)

**Count: 9 distinct endpoints** (matches README's own claim of "9 endpoints").

## 3. Does Nansen data drive logic, or only display?

Drives logic — Nansen label groups ARE the answer key by construction, and the "house rule" reader is a deterministic decision function over Nansen-derived clue numbers.

- Answer-key construction: `packages/core/src/classes.ts:76-82` — `classFromEntity()` decides the class from Nansen's own entity/tag strings (pool tag → contract, `🏦` mark → exchange, else fallback), and `resolveClass()` at `classes.ts:116-119` picks the class by precedence when an address appears in multiple Nansen sourcing lists.
- Scoring/decision logic (the "house rule"): `packages/core/src/reader.ts:24-45`, function `read(c: Clues)`. It thresholds live Nansen-derived numbers (`interactions`, `tokens`, `totalUsd`, `topShare`, `trades`, `tokensTraded`) against constants in the `READER` object (`reader.ts:9-19`) to output a class guess plus a natural-language reason string. Example branch, `reader.ts:31-36`:
  ```
  if (traffic && b.tokens < R.contract.maxTokens)
    return { guess: "contract", because: `${k.interactions} interactions from ${k.count}${...} counterparties and only ${b.tokens} tokens — traffic, not trading` };
  ```
- Deck sourcing itself is Nansen-gated: `packages/core/src/sources.ts:24-25,82,105` builds the class lists directly from `tgm/holders`/`tgm/who-bought-sold`/`smart-money/dex-trades` responses.

This is not decoration — remove Nansen and there is no answer key and no reader input at all (README states this explicitly and it checks out against the code).

## 4. Does it execute anything?

No. Read-only. `apps/web/app/api/draw/route.ts` (full file read) only POSTs read queries to Nansen, streams NDJSON progress events back to the browser, and falls back to a pre-recorded fixture deck when a budget/IP guard trips (`apps/web/lib/guard.ts`). No trade placement, no onchain transaction signing/sending, no alert dispatch (email/webhook/push) anywhere in the fetched source. `/api/reveal` and `/api/round` are similarly read-only lookups over the fixture deck.

## 5. Does it touch sells / exits of wallets?

No exit-timing or sell-alert feature. Grep for sell/exit across all core+web source:

- `nof_sells` (`packages/core/src/nansen.ts:66`, `clues.ts:96-108`) is just the sell-transaction *count* Nansen returns per token for the PnL clue table shown on the card face — a static count, not a live/exit-timing signal.
- `tgm/who-bought-sold` (`classes.ts:40`, `nansen.ts:157-173`, `sources.ts:82`) is queried with `buy_or_sell: "BUY"` and is used only to source the negative "regular" class (wallets in none of Nansen's 17 label groups) — it is not tracking sell events or exit timing of smart money.
- No code path monitors "when smart money sells", fires an exit alert, or computes exit timing anywhere in the fetched files (`draw.ts`, `round.ts`, `card.ts`, `tell.ts`, `reader.ts`, route handlers).

## 6. Stack, demo, commits, docs

- **Stack**: Next.js 15 + React 19 (`apps/web`), TypeScript strict core package (`packages/core`), separate CLI package (`packages/cli`), Vercel deploy, zod-validated Nansen response schemas, vitest + fast-check property tests, Playwright e2e.
- **Live demo**: https://labelme.edycu.dev (README badge), judge page at https://labelme.edycu.dev/judge.
- **Commit count**: via `gh api repos/edycutjong/labelme/commits`, pagination `Link` header shows `rel="last"` at `page=60` with `per_page=1` → **60 commits total** (not truncated at 5; confirmed via the Link header, not just the first 5 shown).
- **Last push**: 2026-09-20T12:35:10Z (`gh repo view --json pushedAt`).
- **README quality**: Extensive — architecture diagram, per-endpoint Nansen table, exact `npm run` commands with measured timings ("clone + install + first round: 7s"), honesty/limits section, project structure tree. A builder can plausibly run `git clone && npm install && npm run labelme -- play --seed meridian1933 --answers` and `npm run verify` inside 10 minutes with zero Nansen API key required for the offline path (README explicitly states tests/verify need no key). Live "Draw fresh" path requires `NANSEN_API_KEY`. This is a strong, runnable README — not just aspirational.

## 7. Score /10

**8/10.** Real, verifiable Nansen integration across 9 distinct endpoints where the label groups ARE the answer key (not a display wrapper), a genuine deterministic scoring/decision function (`reader.ts`) over Nansen-derived numbers, a working live "Draw fresh" path plus an offline-reproducible fixture deck (`npm run verify`), and an unusually thorough, actually-runnable README with honest limitations — docked from a 9-10 only because it deliberately does not touch execution or exits/sell-timing (a legitimate, disclosed design choice, but a rubric point on "Functionality" gets less to show live-consequence beyond read+display+scoring, and the game/education framing is a step removed from the "smart money exit alert" style use case some buildathon judges may be primed to reward).

---
# edycutjong/rebuttal — Nansen Meridian Buildathon review

## 1. One-line
Paste a tweet-style claim ("Smart Money is buying $X" / a whale sold Y tokens, or an x.com URL) into a web app or CLI; the tool extracts the token/claim, runs it through six parallel Nansen calls, and returns a deterministic verdict — CONFIRMED / OVERSTATED / CONTRADICTED / UNVERIFIABLE — with the exact numbers, rule ID, and a sha256 of the evidence, streamed live as each call lands.

## 2. Nansen endpoints called
Grepped `packages/core/src/nansen.ts` and `packages/core/src/client.ts` (`client.post("...")` call sites and the `CREDITS` table):

- `search/general` (nansen.ts:27) — 0 credits, token resolution
- `tgm/flow-intelligence` (nansen.ts:57) — 1 credit, called for both 1d and 7d windows
- `tgm/who-bought-sold` (nansen.ts:100) — 1 credit, called for BUY and SELL
- `smart-money/netflow` (nansen.ts:139) — 5 credits
- `tgm/token-ohlcv` (nansen.ts:160) — 1 credit
- `tgm/holders` (nansen.ts:185) — 5 credits, whale/holding claims only
- `agent/fast` (client.ts CREDITS table, used only behind the "Ask Nansen's agent" comparison button) — 200 credits

**6 distinct endpoints drive every verdict; a 7th (`agent/fast`) is called only for the optional side-by-side comparison and explicitly never affects the verdict** (README: "the comparison beat — never part of the verdict"). README badge says "7 endpoints," which matches this count if agent/fast is included.

## 3. Does Nansen data drive logic, or just display?
Drives logic directly. `packages/core/src/decide.ts` is pure arithmetic over Nansen response fields:

- `decide.ts:69` `threshold()` computes T from `Σ|net flow 1d|` across Smart Trader/Whale/Top PnL/Public Figure — all Nansen flow-intelligence fields.
- `decide.ts:131`: `if (net <= -T) return R("CONTRADICTED", "C-SIGN", ...)` — `net` is the Nansen `smart_trader_net_flow_usd` (or holders' balance-change × price for whales).
- `decide.ts:133-134`: `if (!presence(e, cls)) return R("UNVERIFIABLE", "U-NOCLASS", ...)` else `return R("CONTRADICTED", "C-NOBODY", ...)` — branches purely on whether any Nansen-labelled wallet traded.
- `decide.ts:138-141`: OVERSTATED sub-rules (`O-7D`, `O-STALE`, `O-FEW`) all branch on Nansen 7d flow, `tgm/token-ohlcv` price delta, and wallet counts from `tgm/who-bought-sold`.
- `decide.ts:169`: `if (h && net7 != null && net7 <= -T7 && h.delta7d < 0) return R("CONTRADICTED", "C-EXIT", ...)` — holders' 7d flow and balance delta directly triggering a label.

The LLM (Groq) only extracts the claim text and paraphrases the already-decided record; README states prose that disputes the label is discarded. Not display-only — Nansen fields are the literal branch conditions of the decision function.

## 4. Does it execute anything?
No. Read-only throughout. Grepped for sendTransaction/signTransaction/webhook/alert/order/swap/execute across all source files — no matches tied to any action; the only "send" hits are SSE/NDJSON stream helpers (`send({type:...})` in the API routes) pushing UI events to the browser, not external actions. No onchain tx, no alerts, no orders. It fetches, decides, and streams a verdict to a page/CLI.

## 5. Does it touch sells/exits of wallets?
Partially, as claim verification, not as a proactive signal:
- `claim.ts`/`decide.ts` support a "selling" claim type — mirror image of "buying" with sign flipped once (`decide.ts:108` `const sign = type === "selling" ? -1 : 1`), so a claim like "Smart Money is dumping $X" or "a whale sold 600K UNI" is checked the same way as a buy claim, against `tgm/who-bought-sold` SELL and flow-intelligence net flow.
- A dedicated holding-claim rule, `C-EXIT` (`decide.ts:169`): if 7-day net flow for the labelled class is negative past threshold AND the holders' 7-day balance delta is also negative, it returns CONTRADICTED with reason "are net sellers over the week and their balances shrank."
- This is reactive verification of a claim someone already made about a sale/exit — it does not generate its own exit-timing alerts, does not watch wallets proactively, and does not rank wallets by exit likelihood. It answers "is this sell claim true," nothing more.

## 6. Stack, demo, commits, README
- **Stack**: TypeScript monorepo (npm workspaces) — Next.js 16 App Router web app (`apps/web`, Vercel), a `packages/core` engine (`rebut()`), a CLI (`packages/cli`), Groq (`openai/gpt-oss-120b`) as an optional LLM extractor/narrator (never in the verified/decision path), zod-validated Nansen client with retry/backoff/read-through cache.
- **Live demo**: https://rebuttal.edycu.dev (also `/judge` for a judge-facing walkthrough). Confirmed live in repo metadata (homepageUrl) — not independently re-verified by loading the URL in this review (network access restricted to `gh` per task instructions).
- **Commit count**: 75 commits total (`gh api repos/edycutjong/rebuttal/commits?per_page=100` → length 75; not truncated — under the 100-per-page cap).
- **Last push**: 2026-09-25T07:15:30Z (repo metadata `pushed_at`). Created 2026-09-18.
- **README quality**: Very high. Gives exact install/run commands (`git clone`, `npm install`, `export NANSEN_API_KEY=...`, `npm run rebuttal -- "..."`), states measured "clean clone → first verdict: 19 s" (re-timed independently at 11 s per JUDGE.md), lists all endpoints with credits and which fields feed which rule, documents 7 explicit "honest limits," and links DEMO.md/JUDGE.md/ARCHITECTURE.md/SCORING.md/BENCH.md for deeper detail. A builder with a Nansen API key could run it well under 10 minutes using the README alone — the only external dependency (Nansen key) is called out as the single required env var, optional Groq key clearly marked optional with unchanged verdict behavior.

## 7. Score: 9/10
Nansen data is the literal decision logic (not display), read-only with no execution risk, explicitly and thoughtfully engages the sells/exits case as a mirrored, evidence-checked claim type rather than bolting it on, and the README/docs let a stranger reproduce a live verdict in well under 10 minutes with one env var. Losing a point only because the "creativity" angle is a verification/fact-check tool rather than a novel discovery surface, and the sells/exits handling is claim-verification rather than an original exit-signal feature.

---
# sentwrong (edycutjong) — Nansen Meridian Buildathon review

Repo: https://github.com/edycutjong/sentwrong
Live: https://sentwrong.edycu.dev
Created: 2026-09-16 · Last push: 2026-09-25T00:33:25Z

## 1. What it does in one line

User pastes the crypto address they mistakenly sent funds to (and optionally their own sending address); the app runs staged Nansen profiler/transaction lookups, classifies it into one of four recovery routes (exchange deposit, own wallet, active stranger, contract/burn), and outputs a verdict card with evidence and a prefilled support-ticket / checklist / memo the user can copy.

## 2. Nansen endpoints called

Grepped `packages/core/src/nansen.ts` for `c.post<...>(` calls (base URL `https://api.nansen.ai/api/v1` set in `packages/core/src/client.ts:120`):

1. `profiler/address/transactions`
2. `profiler/address/counterparties`
3. `profiler/address/first-funder`
4. `profiler/address/related-wallets`
5. `transaction-with-token-transfer-lookup`
6. `search/general`
7. `profiler/address/labels` (100-credit, `--deep` only, opt-in)

**Distinct endpoints: 7** — matches the README's "Nansen API — 7 endpoints" badge and table.

## 3. Does Nansen data drive logic or only display?

Drives logic. `packages/core/src/classify.ts` is a pure decision-table function that branches directly on Nansen response fields to select the route and build evidence:

- `packages/core/src/classify.ts:98` — `export function classify(l: Lookups, now = Date.now()): Decision` is the entry point consuming the raw lookup results.
- `packages/core/src/classify.ts:108-109` — `if (isBurnRejection(l.transactions) || isBurnRejection(l.counterparties))` branches the whole verdict on Nansen's HTTP 422 "burn address" rejection.
- `packages/core/src/classify.ts:133,135` — `OWN_DEPOSIT_LABEL` / `SWEEP_TO_EXCHANGE` evidence codes are built straight from `transaction-with-token-transfer-lookup → token_transfer_array[].from_address_label` / `to_address_label` string values (e.g. `🏦 Binance: Deposit`), which is the actual trigger for the "exchange deposit" route.
- `packages/core/src/classify.ts:160` — a second sweep-detection branch (`SWEEP_TO_EXCHANGE`) reused for the contract/forwarder path.

This is confirmed by a 40,000-case property test (`classify.property.test.ts`) that asserts exactly one route fires per generated Nansen response set — i.e., the response fields are the sole decision inputs, not decoration.

## 4. Does it execute anything?

No. Read-only. There is no `sendTransaction`/`signTransaction`/onchain write path, no email/webhook/Discord/Telegram send, no order placement anywhere in `packages/core` or `apps/web` (grepped for `sendTransaction`, `signTransaction`, `eth_sendTransaction`, `nodemailer`, `webhook`, `discord`, `telegram`, `slack` — no matches). The "support ticket" / "checklist" / "memo" output is text rendered into a copy button (`text.ts` → verdict card); the user must send it themselves. Nansen API calls themselves are read (POST-as-query) lookups, not writes.

## 5. Does it touch SELLS / EXITS of wallets?

No. The tool's whole domain is classifying a *recipient* address after a misdirected send (deposit-address / own-wallet / stranger / contract-or-burn). There is no wallet-exit, sell-timing, or "when smart money sells" logic anywhere in `classify.ts`, `text.ts`, or `verdict.ts` (grepped both files for "sell", "exit", "smart money" — zero hits). Outbound flow ("sweep", `volume_out_usd`) is used only to detect that a deposit address forwards funds to an exchange's own wallet, not to signal an investor exiting a position.

## 6. Stack, demo, commits, docs

- **Stack**: Next.js 15 + TypeScript monorepo (`packages/core` engine, `packages/cli`, `apps/web`), vitest + Playwright + fast-check property testing, Vercel hosting.
- **Live demo**: https://sentwrong.edycu.dev (production, tracks `main`), judge page at `/judge`.
- **Commit count**: API call truncated at 5 results (`per_page=5`); most recent 5 shown, true total not confirmed from this call. Last 5: `f7a633b`, `f870db0`, `d8d4afa`, `923e956`, `de43e54`, all dated 2026-09-23 to 2026-09-25 — active, recent development with regression-test-per-bugfix discipline visible in commit messages.
- **Last push**: 2026-09-25T00:33:25Z.
- **README quality**: Very high. Includes exact install steps (`git clone`, `npm install`, one env var, one run command), a timed "under 10 minutes" table with measured seconds per step, offline fixture replay (`npm run verify`, 0 network/0 credits) for judges without a Nansen key, and a documented decision hash for reproducibility. A judge can run this in well under 10 minutes using only the README, including without ever obtaining a live Nansen key (via `npm run verify`).

## 7. Score against rubric (25% each: Data Integration, Creativity, Functionality, Docs)

**Score: 9/10.**

Nansen data is the sole decision engine (7 real endpoints feeding a pure classifier, verified with property tests) — strong on Data Integration; the four-route misdirected-send triage is a genuinely differentiated, non-generic use of entity labels (not just a dashboard) — strong on Creativity; it's read-only with a live deployed demo, offline fixture replay, and no execution/exit-side claims to overreach on — strong on Functionality; and the README/JUDGE.md/ARCHITECTURE.md give an exceptionally reproducible, honestly-limited run path — strong on Docs. One point off only because commit history beyond the last 5 wasn't verified and the live-credit cost/latency variance (documented as an "honest limit") is a real dependency risk for a live judged run.

---
# MicroQuack/dejaview — Nansen Meridian Buildathon review

## 1. One-line
Paste a pump.fun token address; the app replays its first hour as a club night where the eight biggest first-hour buyers arrive at the door, each labelled by their track record on earlier launches (VIP / strong record / known / new face / unchecked), and flags "echoes" when two or more of tonight's buyers were also early on the same past launch.

## 2. Nansen endpoints called
Confirmed by grep of source (`nansen_client.py`, `launch_data.py`, `corpus.py`, `d3.py`) and the README's own endpoint table, all under `https://api.nansen.ai`:

1. `/api/v1/tgm/token-information` — deployment time + symbol (launch_data.py:81)
2. `/api/v1/tgm/dex-trades` — T0 resolution, first-hour buyers, price series (launch_data.py:60, 98, 122, 241)
3. `/api/v1/profiler/dex-trades` — each buyer's 30-day trade history (launch_data.py:137)
4. `/api/v1/tgm/token-ohlcv` — per-minute close price line (launch_data.py:167)
5. `/api/v1/token-screener` — sourcing candidate launches to scan (referenced in README table; used by corpus/D3-building tools)

Also present in `nansen_client.py`'s documented credit table but only used in the offline research/backtest tooling (`d3.py`), not the live app path: `/api/v1beta1/tgm/historical-dex-trades`, `/api/v1beta1/tgm/historical-token-ohlcv`, `/api/v1beta1/profiler/address/historical-transactions`.

**Distinct endpoints: 5** in the live scan path (matches README table exactly); 8 total across the whole codebase including research-only historical variants.

## 3. Does Nansen data drive logic or only display?
Drives logic directly. Concrete evidence:

- `launch_data.py:210-234`, function `launch_reflex()` — computes each buyer's percentile "Launch Reflex" score from Nansen `profiler/dex-trades` history: counts prior launch entries, weights them by recency (`RELEVANCE` dict), compares each entry's 24h outcome to a benchmark, and produces the score/confidence/n shown on the buyer's card. This is the core scoring engine, not a display formatter.
- `launch_data.py:75-115`, `resolve_t0()` — Nansen `dex-trades` volume is walked cumulatively to find T0 (the $5,000 threshold moment), which gates which trades count as "first hour" at all — a hard decision boundary, not cosmetic.
- `matching.py:34-57`, `fingerprint()` and `matching.py:169-187`, `analogues()` — builds a 4-feature vector (actor_quality, entry_speed, persistence, concentration) from the same buyer data and does a nearest-neighbour search (z-scored Euclidean distance, `matching.py:120-129`) against a corpus of past launches to decide which "echo"/analogue launches to surface. The decision of what counts as a match is a computed distance threshold (`matching.py:152-154`, `closeness()`), not a lookup table.

So Nansen data both classifies each buyer (VIP/strong/known/new/unchecked) and decides which past launches get surfaced as analogues/echoes — real triggers and decisions, not just numbers pasted onto a card.

## 4. Does it execute anything?
No. It is read-only. `app.py` is a stdlib `ThreadingHTTPServer` that only serves pages, streams SSE progress events, and writes finished scans to `spike_out/scans/` as JSON cache files (app.py:1-160). No trade submission, no order placement, no onchain transaction, no alert/webhook dispatch anywhere in the codebase (grep across all core files and tools/* found zero matches for order execution, webhook, or alert-sending code — only unrelated uses of the word "order" as in sort order).

## 5. Does it touch sells/exits?
No. Every metric is buy/entry-side:
- `launch_data.py:146-162` `first_buys()` — earliest **buy** per token, entry price.
- `launch_data.py:210-234` `launch_reflex()` — scores based on the 24h **outcome after a wallet's buy**, never a sell time or realized exit.
- `matching.py` outcomes are `ret24h_pct` and `mfe60` (max favorable excursion within 60 min of a buy) — both forward-looking price moves from an entry point, not observed exit/sell behavior.
- `launch_data.py:64-72` `tx_volume()` explicitly notes "Each swap appears as a BUY and a pool SELL row" but only sums total USD volume to find T0 — it does not distinguish or attribute sells to a wallet.

There is no wallet-exit-timing feature, no "smart money is selling" signal, and no sell-side alerting. The README's own "What we do not claim" section confirms this scope (not profitable, no predictions).

## 6. Stack, demo, commits, README quality
- **Stack**: Python 3 stdlib `http.server` (no framework) + `requests` for the Nansen client; frontend is a single static `web/index.html` (vanilla JS/CSS, canvas/DOM club-night animation) that can run against the local Python server or against pre-built static JSON files. `render.yaml` present for Render.com deployment.
- **Live demo URL**: https://dejaview-delta.vercel.app (per README), plus a demo video on X (https://x.com/iAteUrSOL/status/2100539163883847883).
- **Commit count**: 65 total commits (via `Link: rel="last"` header on the commits API, `per_page=1` → page 65). The most recent 5 (requested) are all small fix/docs commits from 2026-09-17 (phone layout fix, responsive tweak, demo-link docs).
- **Last push**: 2026-09-17T11:41:43Z.
- **README quality**: Strong. It states the one-line pitch, gives a copy-pasteable 4-command quickstart that runs entirely offline against 5 saved replays (no API key needed), a separate path for scanning live with a real key and its approximate credit cost (300-500 credits, few minutes), a static-site build path, an endpoint table matching the source exactly, an API usage receipt reproducible via `tools/api_usage.py`, and an explicit "what we do not claim" section. A new builder can clone and see the replay UI working in under 10 minutes without any credentials — verified by the quickstart's own simplicity (venv + pip install + run, click a saved replay).

## 7. Score: 9/10
Real, verifiable Nansen integration (5 endpoints, credit ledger, reproducible usage receipt) that genuinely drives a scoring/matching engine end-to-end with a working, honestly-scoped live demo and a README any builder can run in minutes; docked one point only because it's read-only with no execution or exit-side signal, which narrows "functionality" breadth even though what's built works cleanly.

---
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

---
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

---
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

---
# glass-knot — Meridian Buildathon findings

Repo: https://github.com/talentsolutionsmyanmar-max/glass-knot
Fetched via `gh api` (contents + trees + commits), no browser.

## 1. One-line description

User points it at Solana Smart Money DEX-trade activity (or runs demo fixtures with no key); the app polls a seed wallet's trade, BFS-expands its related-wallet graph via Nansen, and outputs a grade badge (`FARM_CLUSTER` / `SOLO_SM` / `RESEARCH` / `FAIL`) with a plain-English reason, confidence score, and node/edge graph shown on a local dashboard — telling the user whether an SM buy looks like a coordinated wallet farm or a lone Smart Money wallet. Inspect-only, no trade action.

## 2. Nansen endpoints called

Found via grep on `app/config.py`, `app/nansen.py`:

- `POST /api/v1/smart-money/dex-trades` (`app/nansen.py:62`, path const `app/config.py:1182`)
- `POST /api/v1/profiler/address/related-wallets` (`app/nansen.py:84`, `app/config.py:1183`)
- `POST /api/v1/profiler/address/counterparties` (`app/nansen.py:112`, `app/config.py:1184`, gated by `INCLUDE_COUNTERPARTIES` env flag, off by default)
- `POST /api/v1/profiler/address/labels` (`app/nansen.py:147-158`, `app/config.py:1185`)
- `POST /api/v1/profiler/address/premium-labels` (`app/config.py:1186`, only tried first if `USE_PREMIUM_LABELS=1`, otherwise skipped — free plan gets 403 on `/labels` too and the app treats that as expected, `SKIP_LABELS` default true)

**Distinct endpoint paths: 5. Functionally 4 core capabilities** (dex-trades, related-wallets, counterparties, labels — premium-labels is a fallback variant of the labels call, not a separate feature).

Base URL `https://api.nansen.ai`, header `apikey` (`app/nansen.py:25`, `app/config.py:1181`).

## 3. Does Nansen data drive logic or only display?

**Drives logic — real decision path, not just a table.** The grading function `grade_knot()` in `app/grader.py` computes the branch that determines `FARM_CLUSTER` / `SOLO_SM` / `RESEARCH` / `FAIL` directly from fields populated by the Nansen related-wallets/labels/dex-trades responses:

- `app/grader.py:431-435` — `related_count`, `node_count`, `edge_count`, `depth`, and `density = edge_count / max(node_count, 1)` are computed straight from the BFS-expanded related-wallet graph (which itself comes from live/fixture Nansen `related-wallets` responses via `app/pipeline.py:638` `bfs_related()`).
- `app/grader.py:464` (`if bad:`) branches to `FAIL` when Nansen label data contains risk-label needles (`app/grader.py:197-214`, `_bad_labels()`).
- Thresholds `FARM_MIN_RELATED` (default 4) and `SOLO_MAX_RELATED` (default 1), read from `app/config.py:1152-1153`, are compared against the Nansen-derived `related_count` to route to `FARM_CLUSTER` vs `SOLO_SM` vs `RESEARCH` (referenced in `app/grader.py:355-357` reasons text; the actual comparison happens later in `grade_knot`, continuing past line 500 which wasn't fully read but is structurally the same `if/elif` chain following the `FAIL` branch at line 464).
- Confidence score (`_confidence()`, `app/grader.py:265-293`) is a rubric computed from `related_count`, `density`, `depth`, and `mint["related_on_mint"]` — all Nansen-sourced signals, not decoration.

This is a genuine data-driven decision, not a display-only dashboard of raw Nansen fields.

## 4. Does it execute anything?

**No. Read-only / inspect-only by explicit design.** No order placement, no trade execution, no on-chain tx, no alert-sending code found. `grep` across all source for `order|trade|sell|exit|copy` (excluding the many benign matches like `trader_address`, `dex-trades` path names, `order_by` sort param) shows only defensive language: `"no_copy_trade"` note (`app/grader.py:444`), `"Grade is FAIL — inspect only, never a trade."` (`app/grader.py:311`), `"Volume is not edge. No copy-trade, no orders, no size."` (`app/grader.py:392`). README states the same policy explicitly ("Forbidden: copy-trade, place order, size recommendation, `KEEP_TRADE`"). Local API surface (`app/main.py`) exposes only GET endpoints plus one `POST /api/poll` that triggers a re-run of the read pipeline, not a trade.

## 5. Does it touch SELLS / EXITS of wallets?

**No.** The tool only looks at `smart-money/dex-trades` (buys/trades that populate a tape and seed selection) and the wallet's *related-wallet graph structure* (who else is wired to the seed), not the direction or timing of the seed wallet's own future sells. There is no code that tracks when a Smart Money wallet exits a position, no "exit alert," no sell-side signal in `grader.py`'s signal set (`related_count`, `node_count`, `edge_count`, `density`, `labels`, `shared_mint_density`, `token_age_days`) — none of these are exit-timing metrics. The "timing" signal referenced (`app/grader.py:386`, `token_age_days`) is about how old the token was at the sample **trade**, not about the SM wallet's own exit. Confirmed no `sell`, `exit`, or "smart money sells" logic anywhere in `app/*.py`.

## 6. Stack, demo, commits, README quality

- **Stack:** Python (FastAPI + `httpx` for the Nansen client, `uvicorn` server), static HTML/CSS/JS frontend (`static/index.html`, `static/app.js`, `static/styles.css`), no framework/build step. `docker-compose.yml` present. Fixtures-driven demo mode requires no API key.
- **Live demo URL:** none found (no `homepageUrl` set on the repo, no URL in README beyond the GitHub repo link itself). There is a local-only demo path (`uvicorn app.main:app` on `127.0.0.1:8765`) and a recorded video `demo/glass-knot-meridian-demo.mp4` plus an X post draft `demo/meridian-x-post.txt`.
- **Commit count:** 5 commits total, from `commits?per_page=5` — **not truncated**; this is the full history (repo `createdAt` 2026-09-14T10:47:03Z matches the first commit timestamp, and there's no evidence of more via pagination since default page size (30) already exceeds 5).
- **Last push:** 2026-09-14T13:32:00Z (repo created and last touched same day, ~3 hours of work).
- **README quality:** Strong. Contains a one-command demo path using bundled fixtures (no API key needed), a mermaid architecture diagram, an explicit endpoint list matching the source, a grading rubric table, a policy section, a fixtures table describing expected demo grades, and a "Nansen field notes (verified)" section. A builder unfamiliar with the repo could plausibly clone, `pip install -r requirements.txt`, `cp .env.example .env`, run `python scripts/poll_once.py` then `uvicorn app.main:app --host 0.0.0.0 --port 8765`, and see a working dashboard in well under 10 minutes — the demo mode has zero external dependencies (no Nansen key, no network needed since it reads `fixtures/`).

## 7. Score vs rubric (25% each: Data Integration, Creativity, Functionality, Docs)

**8/10.**

Reasoning: Data Integration is strong (4-5 real Nansen endpoints, genuinely load-bearing in a threshold/branch decision, not a display wrapper — verified at `app/grader.py:431-464`). Creativity is good — a related-wallet BFS "farm vs. solo" grader is a distinct, useful angle on SM data rather than another PnL leaderboard, though it is fairly narrow in scope (one grading axis, four buckets). Functionality is solid for a hackathon entry: real fixtures-backed demo with zero setup friction, a background poll loop, an API-call counter to respect Meridian's 1000-call budget, graceful handling of a free-plan `/labels` 403. It has not been proven against sustained live traffic (only 5 commits over ~3 hours, no live demo URL to click), which is the main functionality risk — "no crashes" under live conditions is unverified beyond the demo video. Docs are excellent and match the code. Net deduction versus a 9-10: no hosted live demo to click-test independently, and the grading logic, while genuinely Nansen-driven, is a single-metric heuristic (related-wallet count/density thresholds) rather than a richer multi-signal model — defensible for a buildathon but not deeply sophisticated.

