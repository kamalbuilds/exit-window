# Exit Window build spec

Deadline 2026-09-27 23:59 UTC. Live on Vercel by 21:00 UTC. Shared contract: `src/lib/types.ts` (do not change field names without telling the other lane).

## Product in one line

Paste a Hyperliquid wallet. Exit Window measures how long a copier had after that wallet started exiting, what copying it cost at your delay, and then follows it live and mirrors its reduces.

## Data sources

- Nansen API, base `https://api.nansen.ai/api/v1`, header `apikey: $NANSEN_API_KEY`, all POST JSON unless noted. Specs: `progress/api-docs/*.md` (OpenAPI JSON is embedded on the line starting `{"openapi"`).
  - `profiler/perp-trades` {address, date:{from,to} ISO datetime, pagination:{page, per_page}, order_by} -> data[] {timestamp, side, action, price, size, value_usd, start_position, closed_pnl, fee_usd, transaction_hash, token_symbol}
  - `profiler/perp-positions` {address} -> current positions (read the schema for field names)
  - `profiler/perp-pnl-summary` {address, date} -> realized/unrealized
  - `perp-leaderboard` {date:{from,to} date-only, pagination, order_by} -> data[] {trader_address, trader_address_label, total_pnl, realized_pnl_usd, unrealized_pnl_usd, roi, volume_usd, account_value}
  - `smart-money/perp-trades` {lookback_hours, pagination} -> recent Smart Money perp fills with labels (live feed on the home page)
  - Trading: `perp/close` {wallet_address, coin, size, price, is_buy} -> {action, nonce, eip712}; `perp/execute` {action, nonce, signature:{r,s,v}}; pass action and nonce through byte-for-byte; never cache a prepared payload. `GET perp/builder-fee?wallet_address=`, `GET perp/positions?wallet_address=` for the follower's own account.
  - Respect 429: read `RateLimit-Reset` / `X-RateLimit-*`, back off, retry max 3.
- Hyperliquid public info API (free, no key): `POST https://api.hyperliquid.xyz/info` `{"type":"candleSnapshot","req":{"coin":"BTC","interval":"1m","startTime":ms,"endTime":ms}}`. Max ~5000 candles per interval back from now, so pick interval by event age: 1m < 3 days, 5m < 17 days, 15m < 52 days, else 1h.

## Engine (lane E)

1. `src/lib/nansen.ts`: typed client, server-only, counts calls (module-level ledger with per-endpoint counts, exposed by `GET /api/ledger`), retry on 429/5xx, clear error when key missing.
2. `src/lib/hyperliquid.ts`: candles, `allMids`.
3. `src/lib/positions.ts`: `fillsToEpisodes(fills: Fill[]): Episode[]`. Use signed `startPosition` and fill size/side to track position; do not trust `action` strings alone. Flips close one episode and open another.
4. `src/lib/exitwindow.ts`: `measureWindow(ep, candles, thresholdPct=1, horizonMin=1440): ExitWindow`. Long: first candle whose low <= p0*(1-th). Short: high >= p0*(1+th). Minutes from firstReduceAt.
5. `src/lib/backtest.ts`: `latencyTax(episodes, candlesByEpisode, latenciesSec, {feeBps: 4.5, slippageBps: 5})`. Copier enters each entry tranche at the price at t+L and exits each exit tranche at the price at t+L, same proportions. Price at time = open of the candle containing it. `lateExitSharePct` uses the episode's window. `maxSafeLatencySec` and verdict: copyable if tax at 300s < 25% of the wallet's mean return, tight if only at <= 60s, not_copyable otherwise, insufficient_data if < 3 closed episodes.
6. `src/lib/report.ts`: `buildReport(address, {lookbackDays=30, maxEpisodes=25})`. Fetch fills (paginate, cap 5 pages), pnl summary, positions, candles per episode (parallel, bounded), compute everything. Cache in memory 10 min per address.
7. `src/lib/follow.ts`: `diffPositions(prev: OpenPosition[], next: OpenPosition[], at): PositionChange[]`.
8. `src/lib/mirror.ts`: server-side signing with viem `privateKeyToAccount(HL_API_WALLET_KEY).signTypedData(eip712)` for the Exchange/Agent family, for the account `HL_ACCOUNT_ADDRESS`. Mirror = size the follower's close by the leader's `reducedFraction` of the follower's own open position on that coin (from `perp/positions`). Hard caps: `MIRROR_MAX_USD` (default 100). Paper mode when keys absent: record the would-be close with price from allMids.
9. API routes (App Router, `src/app/api`): `GET /api/wallet/[address]` -> WalletReport; `GET /api/leaders` -> LeaderRow[] (30d, top 50); `GET /api/feed` -> recent Smart Money perp reduces/closes; `GET /api/positions/[address]` -> OpenPosition[]; `POST /api/mirror` {leader, change} -> paper or live result with the Nansen execute response; `GET /api/ledger` -> call counts.
10. Tests (`vitest`, `tests/`): positions (open/add/reduce/close/flip, still-open), exit window (long and short, never-closes within horizon), backtest (latency 0 equals wallet minus costs), diffPositions. Each test must fail if the logic under it breaks: prove one by breaking it once.

Verification with a real key (when `.env` has NANSEN_API_KEY): run a report on a top leaderboard address, print episodes count, median window and latency table. Never print the key.

## UI (lane U)

Read `ui-craft` / `design-md-pipeline` skill guidance first. Concept, render the noun: an exit is a window that closes.

- `/` Hero states the problem in one line ("Copy the exit, not the entry.") with an address input, then a list of top Hyperliquid wallets from `/api/leaders` (Nansen labels shown) and a live strip of Smart Money reduces from `/api/feed`.
- `/w/[address]` The report:
  - Verdict line: "Copyable if you react within 5 minutes" / "Not copyable: this wallet is out before you are" with the median window.
  - Exit windows: one row per exit. The time axis starts at the wallet's first reduce; a band shows the open window until the adverse move; latency ticks at 1m, 5m, 15m, 60m sit inside the band (out in time) or past it (you are the exit liquidity). This is the signature visual.
  - Latency tax curve: copier return vs delay against the wallet's own return.
  - Exit style and realized vs paper PnL.
  - Follow panel: start following (client polls `/api/positions/[address]` every 20s, diff via the same logic as `diffPositions`), on a reduce show the countdown "Median window 14m, 11:32 left" and call `/api/mirror`. Paper ledger visible. Live mode badge only when the server reports keys present.
- Every number on screen comes from the API. Loading, empty and error states are real states, not placeholders.

## Real API facts (probed 11:25 UTC with the live key; samples in progress/api-docs/sample-*.json)

- `profiler/perp-trades`: `side` is the POSITION side ("Long" | "Short"), not buy/sell. `action` in {"Open","Add","Reduce","Close"}. `start_position` is SIGNED (+ long, - short). Numbers are JSON numbers. A buy = (Long and Open/Add) or (Short and Reduce/Close).
- One human exit arrives as dozens of fills within seconds (TWAP/iceberg). Group consecutive same-direction fills on the same coin within 120s into one tranche (size-weighted px).
- A 30-day window often starts mid-position (first fill has start_position != 0). Such episodes have unknown entries: keep them for exit windows, exclude them from the latency backtest, and mark them.
- Many top wallets only Add (accumulating). The home page should surface wallets that are actually exiting: `smart-money/perp-trades` {lookback_hours, pagination} returns labeled fills with action incl. "Reduce".
- `profiler/perp-positions` returns `data.asset_positions[].position` with string numbers: token_symbol, size (signed), entry_price_usd, position_value_usd, unrealized_pnl_usd, leverage_value, liquidation_price_usd.
- `perp-leaderboard` works with date-only range; labels like "HL Perps Whale", "Token Millionaire".
- Coins include HIP-3 prefixed markets ("xyz:BRENTOIL", "io:NBIS"). Try candleSnapshot with the full name; if Hyperliquid returns nothing, skip that episode's window and say so in the report.
