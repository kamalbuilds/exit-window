# 🐋 Nansen Whale Radar

**A live sonar for the Nansen ecosystem.** Every Star / North / Ice wallet is a blip on a radar sweep, and Smart-Money token flows orbit the outer ring — inflows streak inward, outflows streak outward. Hover anything to identify it.

Built for the **Nansen Meridian Buildathon** (Sep 14–27, 2026).

## What it does

Two live data layers, one radar:

1. **Whale Core (inner field)** — the full Nansen Points leaderboard (~54,900 wallets) mapped to blips:
   - Radius = whale size (log-scaled points); the biggest whales glow near the center
   - Golden-angle placement keeps 600 blips readable with zero overlap
   - Sonar sweep: blips flare and ripple as the beam passes; ⭐Star wallets emit ping rings
2. **Token Flow Ring (outer ring)** — Smart Money net flows (`smart-money/netflow`, ETH + Solana):
   - Green marks = net inflow (24h), red = outflow; size = magnitude
   - When the sweep hits a mark, it fires a streak toward (inflow) or away from (outflow) the whale core

Hover any blip → address, points, rank, tier. Hover any flow mark → token, chain, 24h/7d net flow, trader count.

HUD: total wallets, total points, ⭐Star count, blip count, flow count, sweep counter.

Tier colors: ⭐ Star `#FFD700` · North `#4FC3F7` · Ice `#80DEEA`

## Why a radar?

Dashboards show numbers. A radar shows **presence** — where the whales cluster, where smart money is entering, where it's fleeing. The judging criteria reward creativity and deep data integration: here the entire Nansen dataset *is* the interface, not a table on a page.

## Run it

```bash
python -m http.server 8080 --directory nansen-whale-radar
# open http://localhost:8080
```

No build step. No dependencies. One HTML file + two Python data scripts.

## Data pipeline

```bash
python build_data.py         # snapshot: full points-leaderboard (public, no key) -> data/radar_*.json
python buildathon_meter.py   # Smart Money netflows (API key) -> data/flows_*.json
```

The app loads the newest local snapshots, otherwise falls back to the **live public leaderboard API** straight from the browser.

## API usage

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET app.nansen.ai/api/points-leaderboard` | public | Whale Core layer |
| `POST api.nansen.ai/api/v1/smart-money/netflow` | apiKey | Token Flow Ring layer |

## Files

| File | Purpose |
|------|---------|
| `index.html` | The radar app (canvas, zero dependencies) |
| `build_data.py` | Whale snapshot builder |
| `buildathon_meter.py` | Smart Money flow fetcher + buildathon call meter |
| `data/` | Snapshots |

## Roadmap (if we win 🏆)

- Time-travel scrubber: replay whale migrations day-by-day from stored snapshots
- Whale alerts: ping sound + flash when a wallet jumps tier
- Historical netflow replay with the same sweep
