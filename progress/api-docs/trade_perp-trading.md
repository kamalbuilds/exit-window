> For the complete documentation index, see [llms.txt](https://docs.nansen.ai/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.nansen.ai/api/trade/perp-trading.md).

# Perpetual Trading

Open, manage and close Hyperliquid perpetual positions with your own keys — the prepare, sign and execute flow end to end.

This page is part of [API > Trading](/api/trade.md). It remains at its existing URL for compatibility with existing links.

The Hyperliquid trading endpoints let you place, manage and close perpetual positions on Hyperliquid, and move USDC on and off the venue.

**Your keys never leave your side.** Nansen builds an unsigned action and returns the typed data for it. You sign locally, and you send the signature back to be submitted. No endpoint ever accepts a private key, and no endpoint can act on a wallet that has not signed.

These endpoints trade with real funds. Read [Availability](#availability) before you start.

### The prepare → sign → execute flow <a href="#the-flow" id="the-flow"></a>

Every state change on Hyperliquid — an order, a cancel, a leverage change, a transfer, even the one-time fee approval — goes through the same three steps:

1. **Prepare.** Call the endpoint for what you want to do (`/perp/order`, `/perp/close`, `/perp/cancel`, `/perp/leverage`, `/perp/transfer`, `/perp/approve-builder-fee`). You get back an unsigned `action`, a `nonce`, and an `eip712` object. Nothing has happened on the exchange yet.
2. **Sign.** Sign the `eip712` payload locally with the wallet's key. You get an `{r, s, v}` signature.
3. **Execute.** Post `action`, `nonce` and `signature` to `/perp/execute`. This is the only call that changes anything.

```
  ┌────────────┐   unsigned action    ┌──────────┐   {r,s,v}    ┌───────────────┐
  │  prepare   │ ───────────────────► │   sign   │ ───────────► │    execute    │
  │ (6 routes) │      + eip712        │ (local)  │              │ (1 route)     │
  └────────────┘                      └──────────┘              └───────────────┘
       no state change                  your keys                  real money
```

Two rules make or break this flow:

* **Pass `action` and `nonce` through byte-for-byte.** They are part of what you signed. Re-serializing the JSON, reordering keys, rounding a number or "cleaning up" a field all invalidate the signature and the action is rejected.
* **Don't cache a prepared payload.** `nonce` is a millisecond timestamp, so a prepare response goes stale. Prepare, sign and execute in one go; if the user takes a while to confirm, prepare again.

### Which endpoints can I use? <a href="#which-endpoints-can-i-use" id="which-endpoints-can-i-use"></a>

| I want to...                               | Use this endpoint                                       | Notes                                       |
| ------------------------------------------ | ------------------------------------------------------- | ------------------------------------------- |
| Check the one-time fee approval            | `GET /perp/builder-fee`                                 | Do this before a wallet's first order       |
| Approve the builder fee                    | `POST /perp/approve-builder-fee`                        | Once per wallet, signed by the wallet's key |
| Fund the account from another chain        | `POST /perp/bridge/quote`                               | Deposit; you broadcast the transaction      |
| See what I can trade and at what precision | `GET /perp/meta`                                        | Symbols, size precision, max leverage       |
| Set leverage or margin mode                | `POST /perp/leverage`                                   | Per asset, applies to new positions         |
| Open a position                            | `POST /perp/order`                                      | Market or limit, optional TP/SL bracket     |
| Submit anything I've signed                | `POST /perp/execute`                                    | The only endpoint that changes state        |
| See balances and margin usage              | `GET /perp/account`                                     | Includes the spot USDC balance              |
| See open positions                         | `GET /perp/positions`                                   | Source of truth for closing                 |
| See resting and trigger orders             | `GET /perp/orders`                                      | Gives you the `oid` to cancel               |
| Cancel a resting order                     | `POST /perp/cancel`                                     | One order per call                          |
| Close a position                           | `POST /perp/close`                                      | Reduce-only market order                    |
| Move USDC between spot and perps           | `POST /perp/transfer`                                   | Only perps USDC is usable as margin         |
| Withdraw to another chain                  | `POST /perp/bridge/quote` → `POST /perp/bridge/execute` | Follow with bridge status                   |
| Track a deposit or withdrawal              | `GET /perp/bridge/status`                               | Poll until `success`                        |

All paths are under `/api/v1/`.

### Before the first order: approve the builder fee <a href="#builder-fee" id="builder-fee"></a>

Orders placed through these endpoints carry Nansen's builder code. Hyperliquid **rejects** an order carrying a builder code until the wallet has approved a maximum fee rate at least as high as the fee on that order. This is a one-time, per-wallet approval, and skipping it is the most common reason a first order fails.

```bash
# 1. Check
curl -s "https://api.nansen.ai/api/v1/perp/builder-fee?wallet_address=0xYourWallet" \
  -H "apikey: YOUR_API_KEY"
# {"approved": false, "max_fee_rate": 0, "required_fee": 80, "builder_address": "0x..."}
```

`required_fee` and `max_fee_rate` are in **tenths of a basis point**, so `80` means 8 basis points. When `approved` is false, prepare the approval, sign it, and submit it like any other action:

```bash
# 2. Prepare the approval
curl -s -X POST "https://api.nansen.ai/api/v1/perp/approve-builder-fee" \
  -H "apikey: YOUR_API_KEY" -H "Content-Type: application/json" \
  -d '{"wallet_address": "0xYourWallet"}'

# 3. Sign the returned eip712 payload locally, then
curl -s -X POST "https://api.nansen.ai/api/v1/perp/execute" \
  -H "apikey: YOUR_API_KEY" -H "Content-Type: application/json" \
  -d '{"action": {...}, "nonce": 1754476800000, "signature": {"r": "0x..", "s": "0x..", "v": 28}}'
```

The approval must be signed by the wallet's **own key**. An approval signed by an API (agent) wallet is not accepted. Trading actions, unlike this one, may be signed either by the wallet's key or by an API wallet it has approved.

### Funding the account <a href="#funding" id="funding"></a>

Hyperliquid keeps two USDC balances per wallet, and **only the perpetuals balance can be used as margin**. This trips up more integrations than anything else: a wallet holds USDC, `/perp/account` shows a balance, and orders still fail for insufficient margin because the funds are sitting in spot.

* `GET /perp/account` reports both — the perpetuals figures plus `spotUsdc`.
* `POST /perp/transfer` moves USDC between them (`to_perp: true` for spot → perps).
* On a bridge deposit, pass `perps` as the destination token to land the funds straight into the tradeable balance.

To bring USDC in from another chain, quote it and broadcast the resulting transactions yourself:

```bash
curl -s -X POST "https://api.nansen.ai/api/v1/perp/bridge/quote" \
  -H "apikey: YOUR_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "wallet_address": "0xYourWallet",
    "origin_chain": "base",
    "destination_chain": "hyperliquid",
    "origin_token": "USDC",
    "destination_token": "perps",
    "amount": "10000000"
  }'
```

Deposits are supported from Ethereum, Base, Arbitrum, Polygon and BNB Chain; withdrawals go to Ethereum, Base and Arbitrum.

**Amounts are in the origin token's base units, and the two sides of a Hyperliquid route are not on the same scale** — USDC has 8 decimals on Hyperliquid and 6 on the EVM chains:

| You want to bridge | From an EVM chain | From Hyperliquid |
| ------------------ | ----------------- | ---------------- |
| 1 USDC             | `1000000`         | `100000000`      |
| 10 USDC            | `10000000`        | `1000000000`     |

A wrong scale is quoted **without any error** — it just quotes the wrong size. Always check `amount_in` and `amount_out` in the response before signing anything; `amount_formatted` gives you the decoded figure, and the token `name` (`USDC (Perps)` vs `USDC (Spot)`) is the only field that tells you which balance the quote touches.

The quote's `execution_type` tells you what to do next:

| `execution_type`        | Direction  | What you do                                                                   |
| ----------------------- | ---------- | ----------------------------------------------------------------------------- |
| `evm_transaction`       | Deposit    | Sign the `steps` transactions and broadcast them yourself on the origin chain |
| `hyperliquid_signature` | Withdrawal | Sign the step's typed data and submit it to `POST /perp/bridge/execute`       |

Then poll `GET /perp/bridge/status` with the quote's `request_id` (or a deposit's origin transaction hash) until it reports `success`. A just-broadcast transfer reads `not_found` for a short while before it is indexed — retry for a bounded window, then treat it as terminal. `refund` means the funds returned to the origin chain instead of completing.

### Placing an order <a href="#placing-an-order" id="placing-an-order"></a>

```bash
curl -s -X POST "https://api.nansen.ai/api/v1/perp/order" \
  -H "apikey: YOUR_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "wallet_address": "0xYourWallet",
    "coin": "BTC",
    "is_buy": true,
    "size": 0.01,
    "price": 65000,
    "order_type": "market",
    "slippage": 0.03
  }'
```

**`size` is in units of the asset, not USD.** `0.01` on BTC is 0.01 BTC.

**Market vs limit.** Hyperliquid has no separate market order type: `order_type: "market"` takes the current mark price you pass as `price`, adjusts it by `slippage` (a fraction — `0.03` is 3%), and submits an immediate-or-cancel limit order at that price. For `order_type: "limit"`, `price` is the limit price and `tif` decides how it rests (`Gtc`, `Ioc`, `Alo`).

**Sizes and prices are rounded** to the precision the asset accepts, which you can read as `sz_decimals` from `/perp/meta`. The prepare response echoes the `size` and `price` actually encoded in the signed action, and both can differ from what you sent. Requesting `size: 0.0071111` on BTC (5 size decimals) comes back as `0.00711`, and a market order at `price: 65000` with 3% slippage comes back as `66950` — the immediate-or-cancel limit that will actually be submitted. Show the echoed values to the user, not the raw request.

**Brackets.** Setting `take_profit` and/or `stop_loss` adds reduce-only trigger orders to the same signed action, so the entry and its protection are submitted together. The sides must be consistent: a take-profit above the entry and a stop-loss below it for a long, and the reverse for a short. The wrong side is rejected with a `422` rather than triggering the moment the position opens.

### Managing and closing <a href="#managing-and-closing" id="managing-and-closing"></a>

Read state from the API rather than tracking it yourself — fills, funding and partial closes all move a position, and trigger legs may fire between your calls.

* `GET /perp/positions` gives each position's signed size (negative is short), entry price, leverage, unrealized PnL and liquidation price.
* `GET /perp/orders` lists resting limit orders plus untriggered TP/SL legs, each with the `oid` you pass to `/perp/cancel`.

Closing takes the position's size and the **opposite** side:

```bash
# Closing a long: is_buy is false (sell to close)
curl -s -X POST "https://api.nansen.ai/api/v1/perp/close" \
  -H "apikey: YOUR_API_KEY" -H "Content-Type: application/json" \
  -d '{"wallet_address": "0xYourWallet", "coin": "BTC", "size": 0.01, "price": 65000, "is_buy": false}'
```

`price` here is only used to derive the slippage-adjusted limit; the close is always reduce-only and immediate-or-cancel, so it can never flip your position into the other direction.

Leverage is set per asset with `/perp/leverage` and applies to positions opened afterwards — it does not re-margin a position you already hold. Check the asset's `max_leverage` in `/perp/meta` first.

### Signing the typed data <a href="#signing" id="signing"></a>

The `eip712` object contains everything a standard EIP-712 signer needs: `domain`, `types`, `primaryType` and `message`.

There are **two payload families**, and they do not share a domain or a `primaryType`:

| Action                                   | `domain.name`                | `primaryType`              | Signed by                                              |
| ---------------------------------------- | ---------------------------- | -------------------------- | ------------------------------------------------------ |
| Trading — order, close, cancel, leverage | `Exchange`                   | `Agent`                    | The wallet's key **or** an approved API (agent) wallet |
| Wallet-signed — transfer, fee approval   | `HyperliquidSignTransaction` | `HyperliquidTransaction:*` | The wallet's own key only                              |

So sign whatever the `eip712` field contains rather than hard-coding a shape from a previous response — that is the whole reason it is returned per call. A signer that assumes the trading domain will produce a signature the exchange rejects on a transfer, and vice versa.

If a response carries a `vault_address`, forward it to `/perp/execute` exactly as received. The prepare response's `size` and `price` are `null` for actions that carry no order (cancel, leverage, transfer) — that is expected, not a missing field.

### Errors <a href="#errors" id="errors"></a>

| Status | What it means                                                                             |
| ------ | ----------------------------------------------------------------------------------------- |
| `422`  | Your request was rejected, or the exchange refused the action. The reason is in `detail`. |
| `451`  | Perpetual trading is not available in your region. See [Availability](#availability).     |
| `502`  | Hyperliquid could not be reached. Retry.                                                  |
| `503`  | Your region could not be verified, or a compliance check could not complete. Retry.       |

**A `2xx` from `/perp/execute` means the exchange really accepted the action.** Hyperliquid reports a refused action inside an otherwise successful response, so these endpoints inspect the result and surface the reason as a `422` instead of handing back a success envelope. The same applies to `/perp/bridge/execute` for withdrawals. You do not need to parse the response body to find out whether your order was rejected.

Common `422` reasons worth handling explicitly: the builder fee is not approved, the size or price is too imprecise for the asset (re-prepare rather than rounding yourself), insufficient margin because the USDC is in spot, a stop-loss on the wrong side of the entry, or a cancel for an order that already filled.

### Cost and limits <a href="#cost-and-limits" id="cost-and-limits"></a>

Trading actions — prepare, execute, transfer, the fee approval, and everything under `/perp/bridge/` — **do not consume plan credits**. The cost of trading is the exchange's own fees, the builder fee, and on-chain gas where you broadcast a transaction yourself.

The read endpoints (`/perp/account`, `/perp/positions`, `/perp/orders`, `/perp/meta`, `/perp/builder-fee`) cost 1 credit per call.

Every trading endpoint carries its own rate limit, sized for real trading rather than for polling. They are the same on every plan, because trading throughput is not a plan feature. Order placement, closes and executes are the tightest; cancels get more headroom so cancel/replace loops work. Poll `/perp/positions` and `/perp/orders` on a sensible interval rather than in a tight loop.

### Availability <a href="#availability" id="availability"></a>

Perpetual trading is **not available in every jurisdiction**, and requests from restricted regions are rejected with `451`. If your region cannot be determined, requests are rejected with `503` rather than allowed through.

Wallet addresses are screened against sanctions lists before an action is prepared and again when a signed action is submitted, where the signer is recovered from the signature itself. A blocked address is rejected regardless of which wallet was named in the request.

These controls apply to the bridge endpoints too — funding and defunding a perpetuals account follow the same policy as trading on it.


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.nansen.ai/api/trade/perp-trading.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
