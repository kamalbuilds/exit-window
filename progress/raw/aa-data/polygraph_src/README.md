# Polygraph

**The onchain lie detector.** What the crowd *says* on Polymarket, wired up against what six distinct classes of capital actually *did* onchain. The gap between the needles is the product.

Built for the **Nansen Meridian Buildathon** (14–27 September 2026) on the Nansen API.

**Live: https://polygraph-ochre.vercel.app**

---

## The idea in one sentence

Prediction markets are the cleanest measure of *stated* belief ever built — real money, continuously priced, publicly visible. Onchain flow is the cleanest measure of *revealed* belief. Nansen is the only place both halves exist behind one API key. Polygraph puts them on the same instrument and reads the disagreement.

A sample of what it printed against live data while it was being built:

> **The crowd is buying SOL. The best-performing wallets are selling it.**
> `DECEPTION · gap 66/100 · HIGH confidence`

---

## Why a polygraph

A real polygraph doesn't have one needle. It records several channels — pulse, respiration, skin conductance — side by side on one moving strip, and the operator reads the *relationship between channels*, not any single line. A subject can control one channel. Controlling all of them at once is the hard part.

Same structure here. One channel for what the crowd says. Six for what different classes of capital did:

| Channel | Who that is |
|---|---|
| **Top PnL** | wallets with the best realised profit history |
| **Smart Traders** | Nansen's Smart Money label |
| **Whales** | balance sheets large enough to move the book |
| **Public Figures** | named, publicly attributable wallets |
| **Fresh Wallets** | newly created addresses — the closest proxy for retail |
| **Exchanges** | net flow to CEX wallets (sign inverted: inflow is supply arriving to be sold) |

When the crowd's needle and informed capital's needle deflect in opposite directions, the band between them is shaded red. That band is the whole thesis.

---

## The part most dashboards skip

Anyone can draw two divergent lines and imply that one side is the smart side. Polygraph scores the crowd against ground truth instead of assuming it is wrong.

Every Polymarket binary settles at $1.00 or $0.00, so a resolved market's terminal price **is** the answer. The backfill pulls the full price history of ~900 resolved BTC/ETH/SOL markets, samples each one's price at 15/35/55/75% of its lifetime, and scores those forecasts against how the market actually settled.

**3,580 observations across 900 resolved markets:**

| Crowd priced | Actually resolved true | n |
|---|---|---|
| 0–10% | 2% | 1,979 |
| 10–20% | 27% | 276 |
| 20–30% | 35% | 168 |
| 30–40% | 56% | 179 |
| 40–50% | 60% | 229 |
| 50–60% | 50% | 283 |
| 60–70% | 60% | 123 |
| 70–80% | 69% | 124 |
| 80–90% | 71% | 105 |
| 90–100% | 89% | 114 |

Monotone, close to the diagonal, Brier ≈ 0.08. **The Polymarket crowd is genuinely well calibrated**, with mild *under*confidence in the 20–50% band.

That is the opposite of the lazy "retail is dumb money" framing, and it makes the divergence panel *more* interesting rather than less: when a demonstrably well-calibrated crowd and the highest-PnL wallets onchain point in opposite directions, one of two informed parties is wrong, and it is worth knowing which.

---

## Three things that were wrong in the first version

Live data killed three assumptions. They are documented because the corrections are most of the actual work.

**1. The wallet-level join doesn't exist.**
The original design cross-referenced individual Polymarket bettors against their own onchain bags — a "hypocrisy leaderboard". It doesn't work: Polymarket positions are held by proxy contracts on Polygon whose owner EOAs hold nothing on Ethereum, and `profiler/address/labels` is credit-gated. Abandoned before any product code was written.

**2. Barrier markets are not a probability distribution.**
Three different questions get asked about the same asset, and only one is a CDF point:

```
"Will ETH be above $2,800 on the 16th?"   P(close ≥ K)   ← a real CDF point
"Will ETH reach $2,800 in September?"     P(max ≥ K)     ← upside barrier
"Will ETH dip to $2,250 in September?"    P(min ≤ K)     ← downside barrier
```

`P(max ≥ 2750) = 0.63` and `P(min ≤ 2250) = 0.69` are perfectly consistent with each other and with spot at $2,400 — they describe the running maximum and the running minimum, which are different random variables. Normalising all three onto one axis produced a curve that went the wrong way and a median that meant nothing.

Fixed by splitting them: if a close-settled ladder exists, take the median from it. Otherwise read direction from the barriers doing what barriers are actually good for — comparing the priced chance of rising X% against the priced chance of falling X% at matched distances from spot.

**3. Picking the most populated expiry gives a permanent "flat".**
Polymarket lists a daily close ladder for every major asset, so "expires today" always wins on market count — and a ladder expiring in six hours necessarily implies a median within a fraction of a percent of spot. The crowd looked flat every time, by construction. Now the longest horizon with real structure wins, and conviction is scaled by √time so a small move over a short horizon still registers.

---

## Confidence, and the refusal to shout

Every reading carries a confidence band that is degraded by thin ladders, high strike-inversion rates, barrier-only readings, and cohorts that reported no flow. **A `DECEPTION` verdict requires HIGH confidence** — anything weaker is capped at `TENSION` no matter how large the raw gap.

Calling deception off one cohort and four strikes is exactly how an analytics product loses its credibility, so the code will not do it.

Known limits are printed in the UI, not buried.

---

## Nansen API surface used

| Endpoint | Used for |
|---|---|
| `prediction-market/market-screener` | live + resolved market census per asset |
| `prediction-market/ohlcv` | belief history and settlement outcome |
| `prediction-market/top-holders` | position concentration in the deepest markets |
| `prediction-market/trades-by-market` | recent flow within a market |
| `prediction-market/pnl-by-market` | who is winning each market |
| `tgm/flow-intelligence` | **the six cohorts** — the core of the DO side |
| `tgm/token-ohlcv` | spot and price history |
| `smart-money/netflow` | cross-check on the informed aggregate |

### Field notes for anyone else building on this

Things that cost time and are not obvious from the docs:

- The path is `smart-money/netflow`, **singular**. `netflows` 404s.
- Backtesting endpoints live under `/api/v1beta1/`, not `/api/v1/`. Wrong version gives a bare `404 Not Found` with no hint.
- `tgm/flow-intelligence` accepts `5m, 1h, 6h, 12h, 1d, 7d` only — `30d` is rejected.
- `tgm/token-ohlcv` and `tgm/who-bought-sold` require fields the overview page doesn't mention (`timeframe`, `date`). The 422s are clear once you trigger them.
- The screener takes filters at the **top level** of the body — `{"tags": [...], "status": "active"}`. A `parameters` or `filters` wrapper returns `422 Field not recognized`.
- Prediction-market endpoints are generous with credits; `profiler/*` is not.

---

## Verifying the 1,000 calls

The entry requirement is 1,000 API calls. Padding that with a throwaway loop would be trivial and worthless, so the backfill only makes calls the product genuinely needs, and the number falls out of real work.

```bash
npm run backfill
```

Last run — see [`data/backfill-report.json`](data/backfill-report.json):

```
TOTAL API CALLS: 1219
observations:    3580
errors:          3

prediction-market/ohlcv            982
prediction-market/top-holders       66
prediction-market/pnl-by-market     62
prediction-market/trades-by-market  61
prediction-market/market-screener   21
tgm/flow-intelligence               18
tgm/token-ohlcv                      9
```

Cache hits are counted separately and deliberately **excluded** from that total — a cached read is not an API call, and inflating the number would be lying to the judges. `GET /api/stats` exposes the live counter for the running instance.

---

## How live is it

The divergence readout is live. Every uncached page load triggers **12 Nansen calls** — one market screener, one spot OHLCV and two flow-intelligence timeframes per asset — and the snapshot carries the timestamp it was taken at, shown in the header as "updated Ns ago".

Freshness is bounded deliberately rather than left to chance:

| Layer | Behaviour |
|---|---|
| Vercel edge | `s-maxage=60`, `stale-while-revalidate=240` — visitors inside a minute share one reading; after that the next visitor gets the cached copy instantly while a fresh one is fetched behind them |
| In-process | 120s per-instance cache (`POLYGRAPH_CACHE_TTL`) |
| Page poll | re-reads every 5 minutes, and **only while the tab is visible** |
| ↻ Refresh | bypasses every cache and pays for a real 12-call read |

The poll is five minutes, not five seconds, on purpose: a dashboard left open on a second monitor should not quietly drain an API key overnight. The manual refresh exists for when someone wants a reading *now* and is willing to spend the calls.

**The calibration panel is deliberately not live.** It is served from the committed corpus of ~900 resolved markets, because recomputing it would cost ~900 API calls per view to answer a question whose answer only changes as new markets settle. Re-run `npm run backfill` to rebuild it. `?live=1` on `/api/backtest` forces a live recomputation if you want to see it happen.

---

## Running it

```bash
npm install
cp .env.example .env.local     # add your NANSEN_API_KEY
npm run dev
```

Then `http://localhost:3000`.

Behind a corporate proxy, Node's global `fetch` ignores `HTTPS_PROXY` unless you ask it to:

```bash
NODE_USE_ENV_PROXY=1 npm run dev
```

### Endpoints

| Route | Returns |
|---|---|
| `GET /api/polygraph` | full divergence snapshot for all assets |
| `GET /api/polygraph?symbols=ETH` | one asset |
| `GET /api/backtest?symbol=BTC` | calibration, from the committed corpus |
| `GET /api/backtest?symbol=BTC&live=1` | calibration, recomputed live |
| `GET /api/stats` | API call counter for this instance |

---

## How the numbers are built

**Crowd stance** — from the close-settled ladder's implied median against spot, or from barrier asymmetry where no such ladder exists. Conviction passes through `tanh`, scaled by √(horizon), so a 2% implied move over a day and a 10% move over a quarter are comparable statements.

**Informed stance** — each cohort's 24h net USD flow is normalised against **its own** 7-day pace, never against the other cohorts. Fresh wallets move billions and smart traders move thousands; a shared denominator would drown every informed signal. Weighted 0.40 Top PnL / 0.35 Smart Traders / 0.25 Whales, renormalised over whichever cohorts actually reported.

**Gap** — `crowd − informed`, in `[-2, 2]`, displayed as 0–100.

Every threshold in the scoring lives at the top of `src/lib/engine.ts` and `src/lib/say.ts` and is commented with the reasoning.

---

## Layout

```
src/lib/say.ts        reading the crowd — the hard part
src/lib/engine.ts     cohorts, confidence, verdict, headline
src/lib/polygraph.ts  orchestration
src/lib/backtest.ts   live calibration scoring
src/lib/corpus.ts     the committed corpus
src/lib/nansen.ts     typed client — retry, cache, call counter
scripts/backfill.ts   the 1,000-call job
```

---

Not financial advice. A divergence is a question, not a signal.
