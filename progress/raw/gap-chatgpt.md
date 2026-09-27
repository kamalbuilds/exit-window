[chatgpt] tool:web.run

Sources:
  https://nansen.ai/campaigns/meridian-buildathon?utm_source=chatgpt.com
  https://nansen.ai/api?utm_source=chatgpt.com
  https://docs.nansen.ai/api/overview?utm_source=chatgpt.com
  https://release.nansen.ai/help/articles/3540155-nansen-meridian-buildathon-sep-14-27?utm_source=chatgpt.com
  https://docs.meridianai.club/api-reference?utm_source=chatgpt.com
  https://github.com/nansen-ai/nansen-cli/blob/main/skills/nansen-smart-alerts/SKILL.md?utm_source=chatgpt.com
  https://docs.nansen.ai/getting-started?utm_source=chatgpt.com
  https://docs.nansen.ai/api/hyperliquid/smart-money-perp-trades?utm_source=chatgpt.com
  https://release.nansen.ai/en/help/articles/0938495-get-started-with-api?utm_source=chatgpt.com
  https://docs.nansen.ai/?utm_source=chatgpt.com
  https://docs.nansen.ai/api/smart-money?utm_source=chatgpt.com
  https://nansen.featurebase.app/en/help/articles/6239622-ai-smart-alerts-101?utm_source=chatgpt.com
[gpt-5-6 - 19.0s - https://chatgpt.com/c/6ab8f34e-4b44-83e8-900b-f750de75e2f1]
I treated the corpus as **~60 submissions/variants** (some X posts are the same project). I weighted the analysis against the actual rubric: Nansen data must **drive decisions**, not merely decorate a UI; originality matters as much as technical depth[1]. Nansen’s available primitives make the biggest opportunity areas around smart-money behavior, wallet intelligence, token flows, alerts, agents, and execution[2].

# 1. Theme clustering + counts

| Theme | Approx entries | Examples | Saturation |
|---|---:|---|---|
| **Smart Money discovery / rotation / accumulation scanners** | 12 | Fresh Token Radar, Smart Money Rotation Radar, Smart Money Flows Tracker, Whale Radar, Zatto, Vampnet | 🔴 Extremely saturated |
| **AI research agents / due diligence / thesis verification** | 11 | ProofPulse, ThesisArena, Polygraph, Chaincheck, Rebuttal, Ship-or-Exit | 🔴 Extremely saturated |
| **Wallet profiling / wallet games / wallet classification** | 8 | LabelMe, Wallet Witness, Edy wallet games, Smart Money League | 🟠 Saturated |
| **Trading games / simulations / prediction games** | 7 | Trench Trials, Nansen Time Machine, Signal Runner, Whale Gossip | 🟠 Saturated |
| **Token risk / dump detection / exposure analysis** | 6 | Exposure, Dump Risk Alarm, Peregrine, Bagcheck | 🟠 Saturated |
| **Hyperliquid/perp analytics** | 5 | Undertaker, Whale Street, PerpPilot, Bet-or-Book | 🟡 Moderate |
| **Creative visualization / entertainment layer** | 5 | Whale Hunter, Aquarium-style, videos, meme dashboards | 🟡 Moderate |
| **Browser/MCP/connectors** | 3 | Muse connector, Tendril connector | 🟢 Low |
| **Execution agents / trade automation** | 2-3 | SwenAI, Peregrine, Tendril | 🟢 Low |
| **Recovery / operational crypto problems** | 2 | SentWrong, address recovery | 🟢 Very low |

---

# 2. Most saturated themes

## #1 Smart Money "what should I buy?" scanners

Probably 12+ teams attack:

- "what are whales buying?"
- "what tokens are smart wallets accumulating?"
- "where is capital rotating?"

Examples:

- Fresh Token Radar
- Smart Money Rotation Radar
- Smart Money Flows Tracker
- Vampnet
- Zatto
- Whale Radar

Problem:

Judges will see many versions of:

```
Nansen netflow
        ↓
score token
        ↓
show ranking
```

Even if technically good, it risks being perceived as another dashboard.

---

## #2 AI crypto research assistants

Examples:

- ProofPulse
- ThesisArena
- Polygraph
- Chaincheck
- Rebuttal

Pattern:

```
User asks:
"Is ETH bullish?"

Agent:
→ fetch Nansen
→ summarize evidence
→ verdict
```

This is closer to Nansen's own "agent intelligence" direction, so differentiation is hard[2].

---

## #3 Wallet games

Many submissions turned Nansen labels into:

- Guess the whale
- Guess smart money
- Detective game

Creative, but probably capped because:

- Data integration is shallow
- Not obvious trader utility

---

# 3. Three unclaimed trader-demand use cases

These are gaps I see after removing overlapping ideas.

---

# Opportunity #1 — "Smart Money Exit Timing Terminal"

## Concept

Everyone built:

> "Who is buying?"

Almost nobody built:

> "Who is quietly leaving before price reacts?"

A professional trader cares more about:

- Are whales distributing?
- Is smart money exiting into retail?
- Is this a fake breakout?

Product:

**Exit Radar**

Input:

```
Token: ETH
Time horizon: 24h
```

Output:

```
Accumulation: +72

BUT:

5/10 top smart wallets reduced position
3 funds moved tokens to CEX
sell pressure accelerating

Risk:
EXIT WINDOW OPEN
```

---

## Required Nansen endpoints

Core:

- smart-money/netflows
- smart-money/holdings
- smart-money/dex-trades
- token-god-mode:
  - who-bought-sold
  - flow-intelligence
  - holders
  - pnl-leaderboard

Advanced:

- profiler:
  - address trades
  - historical balances
  - counterparties

Optional:

- smart-alerts

These are exactly the primitives Nansen exposes for tracking buying/selling, holdings, labels, and wallet behavior[3].

---

## Closest existing entry

### Peregrine

Why close:

It already has:

- dump-risk scoring
- sell pressure
- execution
- token intelligence

Why different:

Peregrine is:

> "Is this token risky?"

This would be:

> "Are the smartest holders exiting RIGHT NOW?"

Different decision point.

---

### Also close:

Smart Money Flows Tracker

Difference:

They aggregate exits.

This would identify:

- WHICH wallets
- their historical skill
- their exit pattern
- timing

---

## Difficulty

Medium.

10 hours is realistic.

---

# Opportunity #2 — "AI Copy Trader That Filters Bad Smart Money"

## Concept

Everyone assumes:

"copy smart money."

But smart money has:

- lucky traders
- one-hit wonders
- whales dumping bags
- insiders

The missing product:

**Should I copy this wallet?**

Example:

Wallet:

0xABC

Agent returns:

```
Do NOT copy

Reason:

83% PnL came from one meme trade

Average hold:
19 minutes

Counterparties:
mostly deployers

Current position:
down 14%

Confidence:
12%
```

---

## Required endpoints

Profiler:

- address trades
- pnl
- counterparties
- historical balances

Smart money:

- holdings
- dex-trades
- perp-trades

Token:

- pnl leaderboard
- holders

Hyperliquid:

- address positions
- trades
- leaderboard

---

## Closest existing entry

### Vampnet

Very close.

It asks:

"Who are repeat winners?"

Difference:

Vampnet finds good wallets historically.

This answers:

"Should I copy this wallet TODAY?"

---

### Smart Money League

Difference:

Game/fantasy.

This is a real trading tool.

---

## Difficulty

Medium-high.

But huge trader appeal.

---

# Opportunity #3 — "Autonomous Trade Review Agent"

## Concept

Everyone built pre-trade research.

Almost nobody built:

> "Why did my trade fail?"

A trader connects wallet.

Agent reviews:

```
You bought PEPE:

Entry:
$0.000012

Mistakes:

1.
Smart money exited 4 hours earlier

2.
Your counterparty was deployer-linked wallet

3.
Historical holders had 73% sell rate after similar pumps

4.
Hyperliquid funding turned negative

Grade:
D+
```

---

## Required endpoints

Profiler:

- address trades
- counterparties
- pnl
- historical balances

Token:

- holders
- who-bought-sold
- pnl leaderboard
- flow intelligence

Smart money:

- netflows
- dex trades

Hyperliquid:

- positions
- trades

Agent endpoint for reasoning.

---

## Closest existing entry

### ThesisArena

Closest concept.

Difference:

ThesisArena:

> before trade: "is my thesis valid?"

This:

> after trade: "why did I lose money?"

---

### Rebuttal

Difference:

Checks external claims.

This checks personal execution history.

---

## Difficulty

Lowest of the three.

Could ship in 10 hours.

---

# 4. Ranking by win probability (given 10 hours left)

Assuming:

- solo builder
- deadline tonight
- judges value creativity + live demo

| Rank | Idea | Win probability | Why |
|-|-|-|-|
| 🥇 1 | **AI Trade Review Agent** | Highest | New category, easy demo, strong Nansen usage |
| 🥈 2 | **Smart Money Exit Timing Terminal** | High | Huge trader pain, differentiates from buy scanners |
| 🥉 3 | **Smart Money Copy Filter** | Medium-high | Strong demand but overlaps Vampnet |
| 4 | Autonomous perp trader | Medium | Execution complexity risk |
| 5 | Another smart-money scanner | Low | Too crowded |

---

# If I had 10 hours, I would build:

## "PostMortem AI"

Tagline:

> "Nansen tells you what smart money did. PostMortem tells you why your trade failed."

Demo:

1. Paste wallet address
2. Pick losing trade
3. Agent reconstructs:
   - entry
   - smart-money position
   - whale exits
   - counterparties
   - PnL
   - missed signals
4. Generates a trader report

Why:

- Not another dashboard
- Emotional hook ("why did I lose?")
- Uses multiple Nansen surfaces
- Easy 60-second recording
- Strong documentation story

It directly aligns with the rubric emphasis that creativity beats complexity and that working demos matter[4].

My second choice would be Exit Radar. It is probably the strongest pure trading product, but PostMortem has a clearer "never seen this before" angle.
