# Win conditions: Nansen Meridian Buildathon

Closes 2026-09-27 23:59 UTC (https://x.com/nansen_ai/status/2103453463371993161). Gate written 10:30 UTC same day.

Scoreboard: no winners yet (first edition). 53 repos code-reviewed (../progress/review-a*.md). Strongest build: Whale Street (14 Nansen endpoints, 153 commits, real capped Hyperliquid orders via /perp/order + /perp/execute, 138 views). Reach leaders: Nansen Time Machine (176 likes, 9,608 views), EXPOSURE (3,845 views), ProofPulse (3,038 views). Other 9/10 builds: bait, CryptoTradingAgent, whichone, NOCK, sentwrong, dejaview, glidepath.
Bar to beat: 176 likes / 9,603 views on the demo post (Time Machine)
Asset we will own: per-wallet exit fingerprint from Nansen Hyperliquid perp-trades + positions: scale-out pattern, realized vs paper PnL, and the exit window (minutes from first REDUCE to adverse move), plus a backtest of copy-entry-only vs copy-entry-and-exit on that wallet's real history
Off-platform buyer: @0x_rckfrd, holding the same NEAR direction as whale 0x7737, "The only thing I'd copy is the exit"
Single entry: Exit Window
Verb the brief names: "Build an agent, game, trading tool, visualization" / "Nansen data drives the logic"
Our product performs that verb: yes. Follow agent polls profiler/perp-positions, fires on the wallet's first REDUCE, and mirrors the reduce on the user's Hyperliquid account through Nansen /perp/order + /perp/execute (paper by default, capped when live). Code path to be written in src/watch
Metric plan: 100+ Nansen API calls during Sep 14-27 (entry rule), demo post reach against 9,603 views, checked on the X post and Nansen API dashboard
Live by: FAILS, deadline is today; live by 2026-09-27 21:00 UTC, three hours before close
Deviation from research: none after full sweep. Token-level exit risk is taken 6 times (EXPOSURE, Dump Risk Alarm, Peregrine, Bagcheck, glidepath, Dawn); wallet-level exit mirroring is not. Closest: Whale Street (entry mirror, exit only shown as on-screen filings) and NOCK (auto-exit on hack contagion, not wallet selling)
Ask it answers: https://x.com/nansen_ai/status/2076633833190068243 ("when they got out"), https://x.com/nansen_ai/status/2050153844907311271
Users who want it: https://x.com/ItsJCOBx/status/2103425326453850425, https://x.com/0x_rckfrd/status/2103481656413655398, https://x.com/Doepie669/status/2101937520292384791, https://x.com/Dan4thepump1/status/2104136005334733276, https://x.com/mr_pschmitt/status/2101869912910098634, https://x.com/MaxOnFumes/status/2103566125560938688, https://x.com/FatimaYappin/status/2104092201546350618 (all low reach, see signals.md caveat)
