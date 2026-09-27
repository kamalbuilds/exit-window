# Nansen API field notes

Reconnaissance log from building Polygraph, 15 September 2026. Everything here was found by calling the live API, not by reading the docs — in several places the two disagree. Written down because it cost time and might save someone else some.

## Basics

- Base: `https://api.nansen.ai/api/v1` (and `/api/v1beta1` for backtesting).
- Auth header is `apikey`, not `Authorization`.
- **Every endpoint is POST**, including the ones that read like GETs.
- Responses are `{ pagination: { page, per_page, is_last_page }, data: [...] }`.
- Errors come back as `{ message: "..." }` with a useful HTTP status. The 422s in particular are excellent — they name the missing field and list valid values.
- CORS is permissive, so the API can be called straight from a browser console for exploration. Don't ship a key that way.

## Paths that differ from the docs

| Documented / expected | Actually works |
|---|---|
| `smart-money/netflows` | `smart-money/netflow` — **singular**. The plural 404s, and the error helpfully suggests the fix. |
| `tgm/token-screener` | 404s. `tgm/perp-screener` and `tgm/token-information` are live. |
| `/api/v1/tgm/historical-*` | These live under **`/api/v1beta1/`**. Wrong version gives a bare `404 Not Found` with no hint that the path is right and the version is wrong. |
| `prediction-market/top-holders` | Works, though the docs page is filed as `market-top-holders`. |

## Request bodies

Filters go at the **top level** of the body. A `parameters` or `filters` wrapper is rejected:

```json
// 422 Field 'parameters' is not recognized
{ "parameters": { "category": "Crypto" } }

// correct
{
  "tags": ["Bitcoin"],
  "status": "active",
  "order_by": [{ "field": "volume_24hr", "direction": "DESC" }],
  "pagination": { "page": 1, "per_page": 100 }
}
```

Required fields the overview page doesn't mention:

- `tgm/token-information` — needs `chain` **and** `timeframe`.
- `tgm/token-ohlcv` — needs `timeframe` and `date: { from, to }`.
- `tgm/who-bought-sold` — needs `date: { from, to }`.
- `smart-money/holdings` — needs `chains: [...]` (array, plural).

Enum gotcha:

- `tgm/flow-intelligence` accepts `5m`, `1h`, `6h`, `12h`, `1d`, `7d` only. **`30d` is rejected**, even though 30-day flow appears elsewhere in the product.

## Credits

Credit gating is per-endpoint, not global. On a low-credit key:

- `prediction-market/*` — generous, kept working throughout a 1,219-call run.
- `tgm/flow-intelligence`, `tgm/token-ohlcv` — fine.
- `profiler/address/labels` — `403 Insufficient credits remaining to call this endpoint` immediately.

Worth probing the specific endpoints a design depends on before committing to it. Polygraph's original design rested on `profiler/address/labels` and had to be redesigned.

## Data shape notes

**`tgm/flow-intelligence` is the most underrated endpoint in the API.** It does not return one net-flow number; it returns six cohorts, each with net flow, average flow and wallet count:

```
public_figure · top_pnl · whale · smart_trader · exchange · fresh_wallets
```

Cohorts routinely report `0` — that means "no flow observed for this cohort", not "flat". Treating zero as a neutral vote drags aggregates toward the middle and makes everything look uneventful. Polygraph excludes zero-reporting cohorts and renormalises the weights.

The magnitudes across cohorts are not comparable. Fresh wallets can show billions on the same token where smart traders show thousands, partly because wrapping and routing inflate the fresh-wallet figure. Normalise each cohort against its own recent pace, never against the others.

**Polymarket addresses.** `prediction-market/top-holders` returns both `address` (the Polygon proxy that holds the position) and `owner_address` (the EOA). `owner_address` is frequently `"0x"`, and when present it usually holds nothing on Ethereum. Any design that depends on joining Polymarket traders to their onchain portfolios should be validated before it's built.

**Question text is not structured.** Strike, direction and settlement style all have to be parsed out of an English sentence, and the three families that come back look similar but mean very different things:

```
"Will BTC be above $82,000 on September 16?"   P(close ≥ K)   a CDF point
"Will BTC reach $80,000 in September?"         P(max ≥ K)     upside barrier
"Will BTC dip to $65,000 in September?"        P(min ≤ K)     downside barrier
```

`P(max ≥ 2750) = 0.63` and `P(min ≤ 2250) = 0.69` are jointly consistent with spot at $2,400. Normalising all three onto one "probability the price ends above K" axis produces a curve that goes the wrong way. See `src/lib/say.ts`.

**Expiries are mixed in the same response.** A single screener call returns markets expiring in six hours alongside markets expiring next year, and the daily ladder dominates on count. Group by expiry before doing anything with the prices.

**`prediction-market/ohlcv` returns both legs.** Each market has a Yes series and a No series, distinguished by `side` / `outcome_index`. Scoring both double-counts every market and forces any calibration curve to look symmetric by construction.

**Settled markets are ground truth.** A resolved binary's terminal close sits at ~0.00 or ~1.00, so no external price oracle is needed to score a forecast. Markets whose final price sits mid-range never cleanly resolved and should be dropped.

## Rate limiting

No 429s observed at 4 concurrent requests with a ~120 ms pace between calls per worker — roughly 1,000 calls in three minutes. The client backs off exponentially on 429 anyway.
