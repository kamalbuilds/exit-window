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
