> For the complete documentation index, see [llms.txt](https://docs.nansen.ai/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.nansen.ai/api/trade/perp-trading/perpetual-trading-reference.md).

# Perpetual Trading reference

These endpoint references support the [Perpetual Trading guide](/api/trade/perp-trading.md). They remain under their existing URLs for compatibility with existing links.

| I want to...                            | Use this endpoint                                                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Check account balances and margin usage | [Get perp account state](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-account.md)                     |
| Check the one-time builder-fee approval | [Get builder-fee approval status](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-builder-fee.md)        |
| Prepare the builder-fee approval action | [Prepare a builder-fee approval](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-approve-builder-fee.md) |
| See tradable assets and precision       | [Get perp asset metadata](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-meta.md)                       |
| Prepare an order                        | [Prepare a perp order](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-order.md)                         |
| Submit a signed action                  | [Submit a signed perp action](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-execute.md)                |
| Get open positions                      | [Get open perp positions](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-positions.md)                  |
| Get open orders                         | [Get open perp orders](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-orders.md)                        |
| Prepare a cancel                        | [Prepare a perp cancel](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-cancel.md)                       |
| Prepare a position close                | [Prepare a position close](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-close.md)                     |
| Prepare a leverage update               | [Prepare a leverage update](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-leverage.md)                 |
| Move USDC between spot and perps        | [Prepare a Spot<->Perps transfer](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-transfer.md)           |
| Quote a bridge deposit or withdrawal    | [Get a bridge quote](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-bridge-quote.md)                    |
| Execute a signed bridge withdrawal      | [Execute a bridge step](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-bridge-execute.md)               |
| Track a bridge deposit or withdrawal    | [Check bridge status](https://github.com/nansen-ai/nansen-api/tree/main/gitbook/api/hyperliquid/perp-bridge-status.md)                  |


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.nansen.ai/api/trade/perp-trading/perpetual-trading-reference.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
