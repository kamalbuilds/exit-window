# Progress: Nansen Meridian Buildathon research

Deadline: 2026-09-27 23:59 UTC (https://x.com/nansen_ai/status/2103453463371993161)

## Log (UTC, 2026-09-27)

- 10:05 Brief read (nansen.ai/campaigns/meridian-buildathon). Rules: 100 API calls Sep 14-27, demo on X tagging @nansen_ai, public GitHub repo, form.
- 10:25 First pick "Exit Window" written to ../docs/WIN-CONDITIONS.md from 5 verified user posts. Field not yet enumerated; pick provisional.
- 10:33 GitHub search (`gh search repos`, created >= 2026-09-10): 31 repos -> raw/repos.txt, reviewed in review-aa/ab/ac.md.
- 10:40 bhn eval fixed and committed (agentic-tooling 2ae296e): --file IIFE returned null, syntax error returned stale result.
- 10:44 X harvest via skim x, 4 queries, 63 unique posts -> raw/x-*.json. Enriched through api.fxtwitter.com -> raw/fx.jsonl. 14 more repos -> raw/batch-ad (review-ad.md).
- 10:46 Grok enumeration -> raw/grok-list.md. 22 new posts, all resolved via fxtwitter -> raw/fx-grok.jsonl. 8 more repos -> raw/batch-ae (review-ae.md).
- 10:47 ChatGPT and Perplexity cannot enumerate X (both said so). Used for gap analysis over our corpus instead.
- 10:50 All 53 repos reviewed (review-ad.md, review-ae.md). Whale Street strongest build; wallet-level exit mirroring unclaimed. Gate updated in ../docs/WIN-CONDITIONS.md.
- 10:55 skim x throttle fix committed (agentic-tooling 0f2e323): empty-result classifier, 60/120/240s backoff, 8s cross-process pacing, 15 min cache, status URLs via fxtwitter.

Clock was read at 10:19 and 10:51 only; times between are approximate ordering, not reads.

## Files

- raw/entries.json: 85 posts, fxtwitter-verified (author, likes, views, text, expanded links)
- raw/all-repos.txt: 35 GitHub repos linked from posts; raw/repos.txt: 31 from GitHub search
- review-*.md: per-repo code review (endpoints, logic, execution, exit-side, score)
- ../docs/signals.md, ../docs/WIN-CONDITIONS.md: user asks and gate

## Source quality

- X search via skim: good, but throttles on bursts of ~15 searches per few minutes.
- fxtwitter: authoritative for single posts, no account budget.
- Grok (grokweb): only engine that can enumerate X; every URL verified via fxtwitter before use.
- ChatGPT, Perplexity: no X index; useful only for reasoning over supplied corpus.

## Build log

- 11:22 Product gate PASS in .progress (5 evidence items; direct alternative Copin Single Backtesting, no copier-latency model). Nansen key live: perp-leaderboard 200.
- 11:21 Live probes of perp-trades/positions/SM feed: side = position side, action Open/Add/Reduce/Close, start_position signed. Recorded in docs/BUILD-SPEC.md.
- 11:23 Two builders launched: engine+API (src/lib, src/app/api) and UI (pages, components). Persistent Nansen cache required by user: per-endpoint TTL, disk + committed seed, stale-while-error, network vs cache-hit ledger.
- 11:25 jevgrep-laya on Whale Street ("how are Nansen perp orders prepared, signed, executed"): 168 laya calls, 25 s, top hits METHODOLOGY.md, Dockerfile, pnpm-lock.yaml; missed trading.ts and mirror/hl.ts. Plain grep for `perp/execute` found all 3 files instantly. Prior art passed to engine: Nansen /perp/execute rejects approveAgent; agent + builder-fee approvals are main-wallet steps on api.hyperliquid.xyz/exchange.
- 11:34 jevgrep-laya failure traced to adapter bugs (lib/ over-exclusion, no descent into apps/ packages/); fix agent running with bench measurement.
- 12:37 UI rebuilt through the design pipeline after user rejection: DESIGN.md (Chronograph: porcelain dial, log-scale time, Bricolage/Schibsted/Martian), CLAUDE.md binding, uicraft read, design-log entry. Hydration mismatch (float serialization) fixed; uicraft gate 0 high; mobile verified at true 375 via iframe (headless min width is 500).
- 12:55 Credit leak found: home hero built a full report for every new exiting wallet (~7 calls each, 25 perp-trades calls). Hero now cached-only; incremental fill sync and hit logging assigned to engine. /calls proof page added. Lane N (intel: related-wallets, labels, position-intelligence, Smart Alerts) launched.
- 13:53 Deployed to Fly (https://exit-window.fly.dev): clean-worktree deploy after fixing @types/node peer conflict; worker ticking on Fly; live checks: 4 pages 200, feed 50 rows, /calls 127 paid + 26 hits, overlap smart_money cohort. Repo public: https://github.com/kamalbuilds/exit-window. Nansen Smart Alert moved to signed webhook (telegram channel failed: Nansen's own bot never started by user). Queued: alarm replay (proof number), Nansen Agent 'why is it exiting' button, demo-judge review.
