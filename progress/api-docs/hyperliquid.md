> For the complete documentation index, see [llms.txt](https://docs.nansen.ai/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.nansen.ai/api/hyperliquid.md).

# Hyperliquid

Nansen's Hyperliquid API endpoints help you track positions, analyze trades, screen tokens and follow smart money activity across the fastest-growing perps platform.

To open, manage or close your own perpetual positions, start from [API > Trading > Perpetual Trading](/api/trade.md#perpetual-trading).

## What can you do?

With Hyperliquid endpoints, you can:

* **Track wallet positions:** Monitor real-time perpetual positions, PnL, and account health
* **Analyze trading activity:** View detailed trade history and execution data of any address
* **Screen perp trading activity:** Find high-volume tokens and smart money flows on Hyperliquid
* **Find top performers:** Discover the most profitable traders on specific tokens.

## Which endpoints can I use?

| I want to...                                                                                     | Use this endpoint                                                                              | Best for                                     |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------- |
| See all open positions for a wallet including leverage, PnL, and liquidation prices              | [Address Perp Positions](https://docs.nansen.ai/api/hyperliquid-apis/address-perp-positions)   | Snapshot of current positions                |
| View a wallet's trading history with entry/exit prices, fees, and PnL                            | [Address Perp Trades](https://docs.nansen.ai/api/hyperliquid-apis/address-perp-trades)         | Trade by trade breakdown of address activity |
| See top profitable wallets on Hyperliquid over a given period                                    | [Hyperliquid Leaderboard](https://docs.nansen.ai/api/hyperliquid-apis/hyperliquid-leaderboard) | Find profitable wallets and copy trading     |
| Find high-volume perp tokens or see where smart money is trading                                 | [Perp Screener](https://docs.nansen.ai/api/hyperliquid-apis/perp-screener)                     | Market discovery & trends                    |
| Find the most profitable traders on a specific perp token                                        | [Perp PnL Leaderboard](https://docs.nansen.ai/api/hyperliquid-apis/perp-pnl-leaderboard)       | Performance rankings                         |
| Track what smart money wallets are trading on Hyperliquid                                        | [Smart Money Perp Trades](/api/hyperliquid/smart-money-perp-trades.md)                         | Real-time smart money                        |
| See all open positions for a specific perp token including leverage, PnL, and liquidation prices | [Token Perp Positions](/api/hyperliquid/token-perp-positions.md)                               | Snapshot of current positions for a token    |
| View trading history for a specific perp token over a time period                                | [Token Perp Trades](/api/hyperliquid/token-perp-trades.md)                                     | All trading activity for a specific token    |

## Key Differences: Hyperliquid vs. Other Chains

#### Token Identification

**Important**: Hyperliquid perp endpoints use **token symbols** instead of token addresses in Token God Mode Inputs

| Other Chains                 | Hyperliquid                              |
| ---------------------------- | ---------------------------------------- |
| `token_address: "0x1234..."` | `token_symbol: "BTC"`                    |
| Use contract addresses       | Use ticker symbols (BTC, ETH, SOL, etc.) |

**Example**:

```json
// Other chains
{"token_address": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"}

// Hyperliquid
{"token_symbol": "BTC"}  // For leaderboard endpoint
```

#### Positive and Negative Positions

Some endpoints (Eg. Token Perp Positions) have negative Position value. This usually represents a short and a positive value represents a long.

## Quick Start Checklist

1. **Get your API key** from Nansen
2. **Choose your use case**:
   * Wallet monitoring → Use `/perp-positions` + `/perp-trades`
   * Market discovery → Use `/perp-screener`
   * Copy trading → Use `/perp-leaderboard` + `/tgm/perp-pnl-leaderboard`
   * Trading your own wallet → Follow [API > Trading > Perpetual Trading](/api/trade.md#perpetual-trading)
3. **Remember**: Use token symbols (BTC, ETH) not addresses
4. **Add filters**: Refine results with volume, PnL, or time filters


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.nansen.ai/api/hyperliquid.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
