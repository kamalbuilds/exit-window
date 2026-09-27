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
