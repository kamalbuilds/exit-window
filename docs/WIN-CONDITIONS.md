# Win conditions: Nansen Meridian Buildathon

Closes 2026-09-27 23:59 UTC (https://x.com/nansen_ai/status/2103453463371993161). Gate written 10:25 UTC, revised 11:20 UTC after the full competitor sweep.

Scoreboard: no winners yet (first edition). 53 repos code-reviewed (../progress/review-a*.md). Strongest build: Whale Street (14 Nansen endpoints, 153 commits, real capped Hyperliquid orders via /perp/order + /perp/execute, 138 views). Reach leaders: Nansen Time Machine (176 likes, 9,608 views), EXPOSURE (3,845 views), ProofPulse (3,038 views). Other 9/10 builds: bait, CryptoTradingAgent, whichone, NOCK, sentwrong, dejaview, glidepath.
Bar to beat: 176 likes / 9,608 views on the demo post (Time Machine); 14 endpoints with real execution (Whale Street)
Asset we will own: per-wallet exit fingerprint computed from Nansen profiler/perp-trades fills + Hyperliquid public candles: scale-out pattern, realized vs paper PnL (profiler/perp-pnl-summary), exit window (minutes from first reduce to a 1% adverse move), and a copier-latency backtest at 0s/1m/5m/15m/60m
Off-platform buyer: @0x_rckfrd, holding the same NEAR direction as whale 0x7737, "The only thing I'd copy is the exit"
Single entry: Exit Window
Verb the brief names: "Build an agent, game, trading tool, visualization" / "Nansen data drives the logic"
Our product performs that verb: yes. Follow agent polls Nansen profiler/perp-positions, fires on the followed wallet's reduce, and mirrors it through Nansen /perp/close + /perp/execute signed by the user's Hyperliquid API wallet (paper by default). Code path: src/lib/follow.ts, src/app/api/mirror/route.ts
Metric plan: 100+ Nansen API calls during Sep 14-27 (entry rule, counted in the app's call ledger and the Nansen API dashboard); demo post reach against 9,608 views, checked on the X post at 23:00 UTC
Live by: 2026-09-27 21:00 UTC on Vercel (the 7-days-before rule cannot be met; the build started the day of the deadline)
Deviation from research: none after the full sweep. Token-level exit risk is taken 6 times (EXPOSURE, Dump Risk Alarm, Peregrine, Bagcheck, glidepath, Dawn); wallet-level exit mirroring is not. Closest: Whale Street (entry mirror, exits only shown as on-screen filings), NOCK (auto-exit on hack contagion), Copin Single Backtesting (no copier latency model)
Ask it answers: https://x.com/nansen_ai/status/2076633833190068243 ("when they got out"), https://x.com/nansen_ai/status/2050153844907311271
Users who want it: https://x.com/ItsJCOBx/status/2103425326453850425, https://x.com/0x_rckfrd/status/2103481656413655398, https://x.com/Doepie669/status/2101937520292384791, https://x.com/Dan4thepump1/status/2104136005334733276, https://x.com/mr_pschmitt/status/2101869912910098634, https://x.com/MaxOnFumes/status/2103566125560938688, https://x.com/FatimaYappin/status/2104092201546350618 (all low reach, see signals.md caveat)
