[chatgpt] tool:web.run

Sources:
  https://nansen.ai/campaigns/meridian-buildathon?utm_source=chatgpt.com
  https://release.nansen.ai/help/articles/3540155-nansen-meridian-buildathon-sep-14-27?utm_source=chatgpt.com
  https://academy.nansen.ai/en/help/collections/2914331-nansen-meridian?utm_source=chatgpt.com
  https://release.nansen.ai/changelog?utm_source=chatgpt.com
  https://nansen.ai/api?utm_source=chatgpt.com
  https://docs.nansen.ai/?utm_source=chatgpt.com
  https://docs.nansen.ai/getting-started/agents?utm_source=chatgpt.com
  https://www.aicoin.com/en/news-flash/3095075?utm_source=chatgpt.com
  https://www.aicoin.com/en/news-flash/3079979?utm_source=chatgpt.com
  https://docs.meridianai.club/api-reference?utm_source=chatgpt.com
  https://docs.meridianai.club/?utm_source=chatgpt.com
  https://zen5d8e08.twstalker.com/nansen_ai?utm_source=chatgpt.com
[gpt-5-6 - 17.7s - https://chatgpt.com/c/6ab9141f-c7ac-83ee-910f-59c101acef31]
I would **not pivot the product**. You have a rare wedge: everyone built “who is buying?”; almost nobody built “the person you copied is leaving — now what?” This maps extremely well to Nansen's stated direction around agents that eventually execute strategies, and their judging explicitly rewards cases where Nansen data drives the logic rather than being a dashboard layer[1].

The biggest risk tonight: **you accidentally market this as another copy-trading tool.** Your enemy is the copy-trading stigma. Your positioning should be:

> "Copy trading solved discovery. Exit Window solves survival."

---

# 1. X DEMO POST STRATEGY

## Hook options (pick ONE)

### Option A (strongest)
> **"Everyone built whale trackers. Nobody built the thing traders actually need: the whale exit alarm."**

### Option B (more viral)
> **"You copied the whale's entry. Congratulations. You became the exit liquidity."**

### Option C (more Nansen-native)
> **"Nansen tells you who bought. Exit Window tells you when smart money stops believing."**

---

## First frame (0-3 seconds)

Do NOT start with homepage.

Start with a fake painful event:

```
NEAR-PERP LONG

You entered:
$7.42

Smart Money entered:
$6.98

+6.3% later...

🐋 Wallet 0x82A... reduced 40%

Your exit window:
14 minutes

Telegram alert:
"Whale started leaving"
```

Then immediately:

```
What if you knew this BEFORE liquidation?
```

---

# 60-second silent demo storyboard

## 0-5 sec
**Pain**

Screen:

```
COPY TRADING FAILURE

ENTRY:
Whale buys

YOU:
Buy 8 minutes later

EXIT:
Whale sells

YOU:
Still holding
```

---

## 5-15 sec
Paste wallet.

Show:

```
Track your Hyperliquid position
↓
BTC-PERP LONG
↓
Smart Money holding same side: 14 wallets
```

This proves Nansen integration.

---

## 15-30 sec
Click whale.

Show "Exit DNA":

```
WHALE EXIT DNA

Wallet:
Fund XYZ

Historical exits:
27

Median first reduce:
18 min before -1% move

Style:
72% scale-out
28% instant dump

Copier survival:
0m delay +12%
15m delay -4%
1h delay -19%
```

This is your killer artifact.

---

## 30-45 sec
Live alert.

Show Telegram:

```
🚨 EXIT WINDOW OPEN

Wallet:
Smart Money #483

Reduced:
ETH-PERP LONG -35%

Your position:
ETH-PERP LONG

Historical exit window:
11 minutes

Action:
Review position
```

---

## 45-60 sec
End:

```
Stop copying entries.

Start watching exits.

Exit Window
Built with @nansen_ai API

github.com/...
```

---

## Tagging

Required:
- @nansen_ai

Additional:
- @nansen_ai team members if they are active
- Hyperliquid ecosystem accounts
- crypto traders who post PnL screenshots

Avoid tagging 50 accounts. Looks spammy.

---

# 2. GET REAL USERS TODAY

Your goal is NOT thousands.

Your goal:

**20 wallets armed before judging.**

That is a stronger judge metric than 2k impressions.

---

# Target communities

## A. Hyperliquid traders (highest conversion)

Places:
- Hyperliquid Discord
- Hyperliquid X replies
- HL leaderboard traders' followers

Message:

> "I built a free exit alarm for Hyperliquid. Paste your wallet and it shows when wallets with the same position historically started reducing."

Do NOT say:
"copy trade"

---

## B. Whale followers

Find traders posting:

- "I'm long ETH"
- "Bought SOL"
- "Following smart money"

Reply:

> "Interesting entry. I built a tool that watches when wallets with the same position start reducing. Want an exit alert?"

The product literally solves their tweet.

---

## C. CT alpha communities

Examples:
- The DeFi Edge audience
- Miles Deutscher audience
- TraderSZ audience
- Hyperliquid traders

Don't DM influencers.

Reply under existing conversations.

---

# The shareable artifact

This is the thing I would build before anything else.

## "Exit DNA Card"

Every wallet gets a public URL:

```
exitwindow.xyz/wallet/0xabc

--------------------------------

🐋 Smart Money Exit DNA

Wallet:
0x82A...

Favorite markets:
BTC / ETH / SOL

Average holding:
9.4 days

Exit personality:

████████░░
Scale-out trader

First reduce:
Median 22 min before reversal

Worst copier delay:
15 minutes

Historical copier PnL:

0 min:
+34%

5 min:
+11%

15 min:
-8%

--------------------------------

Powered by Nansen
```

Why?

Because whales themselves become distribution.

A trader posts:

> "Apparently my wallet exits like this 😂"

Free marketing.

---

# Viral mechanic

## "Your Whale IQ"

Every user gets:

```
Your copy-trader survival score:

78/100

You entered after smart money by:
11 minutes

You usually miss:
73% of exits
```

Share button:

> "Apparently I am the exit liquidity 😂"

Crypto users share humiliation more than dashboards.

---

# Another viral loop

## "Guess the exit"

Before revealing wallet:

```
This wallet bought $3.2M SOL.

Question:

When did they start selling?

A) immediately
B) after +20%
C) after retail entered

Reveal →
```

Then:

```
Median first reduce:
17 minutes before dump
```

This creates a game.

Nansen already has examples of creative/game-like uses being encouraged[2].

---

# 3. Tonight's build priority

I would cut:

❌ sibling wallets  
❌ auto execution  
❌ smart alerts integration  
❌ fancy home feed  

unless already working.

Why?

Judges need:

1. Nansen drives insight
2. User understands instantly
3. Demo cannot fail

Your winning loop:

```
Wallet
 ↓
Position
 ↓
Matching smart money
 ↓
Exit DNA
 ↓
Telegram alert
```

That is enough.

Nansen itself highlights alerts, wallet monitoring, trading tools, and execution agents as valid API use cases, so your story fits their ecosystem[2].

---

# 4. Judge metrics at 23:00 UTC

Make a final dashboard slide:

## Usage

```
Live users:
23

Wallets armed:
31

Positions monitored:
74

Telegram alerts sent:
18
```

---

## Intelligence generated

```
Smart Money wallets analyzed:
126

Historical exits analyzed:
4,821

Median exit window calculated:
13 min

Copier backtests simulated:
312
```

---

## Nansen usage

Show:

```
Nansen API calls:
1,842

Endpoints:

✓ profiler/perp-positions
✓ profiler/perp-trades
✓ profiler/pnl-summary
✓ tgm/position-intelligence
✓ smart-money/perp-trades
✓ price OHLCV
```

---

# One last recommendation

Your homepage currently sounds like a product.

For tonight, make it feel like a **warning system**.

Change:

> "Track Smart Money exits"

to:

> **"The first alarm that tells you when your alpha becomes someone else's exit."**

That sentence explains the entire product in 3 seconds.
