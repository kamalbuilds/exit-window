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
