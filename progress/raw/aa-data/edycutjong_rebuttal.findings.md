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
