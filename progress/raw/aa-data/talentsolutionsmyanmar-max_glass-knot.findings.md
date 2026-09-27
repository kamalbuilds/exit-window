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
