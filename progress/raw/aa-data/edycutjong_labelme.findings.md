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
