# For the judge — Label Me

*Mirror of https://labelme.edycu.dev/judge — no login, no key, no setup.*

## Ten real wallets. Guess the Nansen label. The answer key is the label; the clues are Nansen's fields.

A card game on labelled ethereum wallets: PnL summary, top trades, balance profile and the counterparty label-class mix — all Nansen-computed — and the reveal is Nansen's own label group, sourced by construction. The default round is a recorded deck (0 credits, 0 crash surface); "Draw fresh" pulls one unseen labelled holder live and streams the five calls as they land.

## The 30-second path

1. Open **https://labelme.edycu.dev/r/meridian1933**. Ten cards from the recorded deck, the same ten for everyone. Guess with the chips (or keys 1–5); the reveal shows the class, the free-tier tag, the entity name where the 1-credit lookup found one, and a one-line tell written from the card's numbers.
2. Press **Draw fresh**: one `tgm/holders` / `smart-money/dex-trades` row and four profiler calls stream in with credits and latency; the card appears; guess; the house rule's read is shown next to Nansen's answer. **Provenance** lists every call.
3. Finish the round: "You read wallets N/10", per-class breakdown, the house rule's score on the same ten, a share link whose OG card carries the score and the seed.

## Receipts

| | |
|---|---|
| The deck | **62 cards**, ethereum — 12 Smart Money · 16 exchange · 12 whale · 10 contract/pool · 12 regular — recorded live by `scripts/seed.ts`; every raw response committed under `fixtures/cards/`; `fixtures/dropped.json` lists the 101 addresses dropped and why |
| Determinism | `npm run verify` replays all 62 cards offline — same clues, same tell, same `cardHash` — zero network, zero credits |
| Live draw, benchmarked | 10 draws: **cold p50 2.1 s · p95 2.6 s · warm 1 ms · 12.2 credits / 5 calls per draw · 0 failed**; the house rule read 7/10 fresh cards (out-of-sample) — [docs/BENCH.md](docs/BENCH.md) is the script's output |
| The house rule | a deterministic reader over the same four clues reads **50/62** of the deck (thresholds in [docs/RULES.md](docs/RULES.md), set on this deck — in-sample; the bench is out-of-sample) |
| Nansen endpoints | `tgm/holders` (label_type smart_money · exchange · public_figure · plain · label-excluded) · `tgm/who-bought-sold` (label-excluded) · `smart-money/dex-trades` · `profiler/address/pnl-summary` · `profiler/address/pnl` · `profiler/address/current-balance` · `profiler/address/counterparties` · `profiler/address/transactions` + `transaction-with-token-transfer-lookup` |
| Tests | **134 tests** (vitest) · **12,000 generated cases** (fast-check) · **10,000 generated malformed ids** rejected before any network call · 40 Playwright runs (20 tests × desktop + Pixel 7) on a built app with no key |
| Clean clone → first output | **7 s** to the first round, **11 s** through verify and the 134 tests (clone 2 s · install 5 s · round < 1 s · verify 1 s · tests 3 s; re-measured 2026-09-19; 6 s / 9 s on 2026-09-18) |

## Reproduce

The deck (0 credits, no key) and the live path (≤ 13 credits):

```bash
git clone https://github.com/edycutjong/labelme && cd labelme && npm install
npm run labelme -- play --seed meridian1933 --answers   # the recording's ten cards with the answer key, 0 credits
export NANSEN_API_KEY=nsn_...                        # your key from https://app.nansen.ai/api
npm run labelme -- draw --explain                    # one unseen wallet live: five calls, credits, the reveal
```

**CI / deterministic replay** (not the product — a check that the engine has not drifted):

```bash
npm run verify                                       # 62/62 cards reproduced offline, no key, no network
```

## Honest limitations

- Free-tier `address_label` is a wealth or structural tag (Token Millionaire, Liquidity Pool), not an entity name. The class comes from the `label_type` filter that returned the row; entity names (🏦 Binance) appear only where the optional 1-credit tx-lookup found one (23 of 62 cards).
- "Regular" is a negative: Nansen put the wallet in none of its 17 label groups. Public Figure was dropped after the spike — a person label is not a wallet behaviour.
- A dormant Smart Money wallet (0 trades this month) is unreadable from cheap clues; the deck keeps only active ones (≥ 5 trades), a live draw can still deal one and says so in the tell.
- Nansen latency swings by the minute; a live draw takes 1–3 s cold on Vercel, up to 12 s on a bad minute. The default round never touches the network.

## Links

- Live: https://labelme.edycu.dev · `/judge` · `/r/meridian1933` (fallback alias: https://labelme-edycutjong.vercel.app)
- Repo: https://github.com/edycutjong/labelme — [README](README.md), [DEMO.md](DEMO.md), [ARCHITECTURE.md](ARCHITECTURE.md), [docs/RULES.md](docs/RULES.md), [docs/BENCH.md](docs/BENCH.md), [docs/DX-REPORT.md](docs/DX-REPORT.md)
- Built by [@edycutjong](https://x.com/edycutjong) for the [Nansen Meridian Buildathon](https://nansen.ai/campaigns/meridian-buildathon)
