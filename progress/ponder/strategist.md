[chatgpt] tool:web.run

Sources:
  https://docs.nansen.ai/api/hyperliquid/smart-money-perp-trades?utm_source=chatgpt.com
  https://docs.nansen.ai/api/hyperliquid?utm_source=chatgpt.com
  https://nansen.featurebase.app/en/help/articles/6239622-ai-smart-alerts-101?utm_source=chatgpt.com
  https://docs.nansen.ai/api/overview?utm_source=chatgpt.com
  https://docs.nansen.ai/api/token-god-mode/perp-trades?utm_source=chatgpt.com
  https://docs.nansen.ai/api/smart-money?utm_source=chatgpt.com
  https://nansen.ai/api?utm_source=chatgpt.com
  https://docs.nansen.ai/api/hyperliquid/perp-screener?utm_source=chatgpt.com
  https://academy.nansen.ai/en/help/articles/9884236-hyperliquid-perps-trading?utm_source=chatgpt.com
  https://docs.nansen.ai/api/token-god-mode/perp-screener?utm_source=chatgpt.com
  https://academy.nansen.ai/help/articles/7113018-perps-trading-hyperliquid-101?utm_source=chatgpt.com
  https://github.com/nansen-ai/nansen-cli/blob/main/skills/nansen-smart-alerts/SKILL.md?utm_source=chatgpt.com
[gpt-5-6 - 19.8s - https://chatgpt.com/c/6ab91382-2b1c-83ee-bdb6-27794b9e2591]
## The ruthless positioning: **do not build a better copy-trading tool. Build the anti-copy-trading product.**

The market insight is already handed to you by users:

> "Copying entries without seeing the exits is how newcomers become exit liquidity"

Your wedge is:

**"Know when the smartest trader you follow is leaving before you become their exit liquidity."**

Nansen already has the ingredients: Smart Money perp trades, wallet positions, PnL, labels, Hyperliquid activity[1].

---

# (1) The sharpest core loop + first 30-second aha

## Landing page should NOT start with wallet tracking.

Current flow:

> Paste wallet → analyze positions → show analytics

Too slow.

The first screen should be:

# "Are you holding what smart money is already exiting?"

Input:

```
Paste your Hyperliquid address
[Analyze my risk]
```

30 seconds later:

---

## Example output:

```
YOUR BTC LONG

Size: $42,000
Entry: $61,200
Current PnL: +18%

You are following:

🐋 0xabc...
$14.2M realized profit
Smart HL Trader

STATUS:

EXIT WINDOW OPEN

They usually begin selling:
18 minutes before BTC drops 1%

Current:
↓ Reduced 35% of position 4 min ago

Your historical copier outcome:

0 min delay: +$820
5 min delay: +$210
15 min delay: -$340
1 hour delay: -$1,900

[Enable Telegram Exit Alarm]
```

The aha:

**"The whale didn't lose money. The person copying him late did."**

That is a painful, instantly understood problem.

---

# The killer loop

## Every day:

1. Trader opens Telegram
2. Gets:

> 🚨 BTC Smart Money Exit Window OPEN

> 3/7 wallets reduced BTC longs  
> Median historical exit window: 22 min  
> Similar events caused -1.8% move after 31 min

3. Opens dashboard
4. Decides:
   - reduce
   - hedge
   - ignore

The product becomes a **risk reflex**, not a dashboard.

---

# (2) What to cut immediately

You have 10 hours. Kill anything that smells like analytics.

## CUT:

### ❌ Public homepage feed

"Smart Money exiting now"

Why:

Every competitor has this.

It becomes another Nansen clone.

---

### ❌ Top wallets leaderboard

You literally compete with Nansen.

Nansen already exposes leaderboard/perp trader discovery[2].

---

### ❌ Paper mirror execution

Dangerous.

Your strongest message is:

"Don't blindly copy."

Auto execution contradicts the thesis.

---

### ❌ Token-wide dashboards

No:

```
BTC smart money activity
ETH flows
SOL holders
```

Nobody wakes up wanting another terminal.

---

### ❌ Full sibling-wallet graph UI

Keep backend only.

The user doesn't care about graph theory.

They care:

> "Did the person I follow exit?"

---

# (3) Three highest-leverage features to add

## Feature 1 — "Exit Window Score"

### Endpoint:
- `/profiler/perp-trades`
- `/smart-money/perp-trades`
- `/tgm/perp-trades`

Nansen exposes granular Hyperliquid trade activity including actions like adds/reduces and trade details[1].

### User quote solved:

> "The only thing I'd copy is the exit, and nobody's seen it yet"

Build:

```
Wallet 0x123

Exit fingerprint:

Average first reduce:
+14.6% PnL

Average price reaction after reduce:
-1.4%

Average exit duration:
23 minutes

Exit style:
███████░ Scale out

Confidence:
87%
```

This is your unique IP.

Nobody else has "how this whale exits."

---

## Feature 2 — "Am I already exit liquidity?"

### Endpoint:

- `/profiler/perp-positions`
- `/tgm/perp-positions`

Nansen supports current perp positions, PnL, account health, and token perp positions[2].

### User quote:

> "people copy trade whales with small amounts after the person they copy is already up, then the whale sells..."

Build:

```
You entered BTC:
14:32

Whale entered:
12:08

Difference:
+2h24m late

Historically:

When entering >90 min after whale:
Win rate: 32%

When entering <15 min:
Win rate: 68%
```

This is insanely understandable.

---

## Feature 3 — Exit Alarm with "severity"

### Endpoint:

- `/smart-alerts`
- `/smart-money/perp-trades`

Nansen Smart Alerts supports Telegram delivery and perp position alerts[3].

Do NOT alert:

> Wallet sold BTC

Too noisy.

Alert:

```
🚨 EXIT WINDOW

BTC LONG

3 smart wallets reduced

Wallets:
- Fund Alpha
- Smart HL Trader
- Whale #92

Historical pattern:
After similar exits:

Median BTC move:
-1.3%

Expected window:
18-32 minutes

Action:
Review position
```

The alarm is the retention engine.

---

# (4) Why traders keep Telegram ON

Not because of information.

Because of **regret avoidance**.

Trading users don't remember:

"That dashboard had nice charts."

They remember:

"I ignored the warning and lost $3k."

You need emotional memory.

The daily habit:

## Morning:

"Your watched wallets are still holding."

## During volatility:

"Exit window detected."

## After:

"Smart wallet exited 26 min ago. BTC moved -1.1%."

The product proves itself.

---

# Add one killer retention mechanic:

## "Wallets I Would Have Been Liquidated By"

Every user gets:

```
Your avoided losses:

September:
BTC whale exit:
+$420 protected

ETH fund exit:
+$280 protected

Total:
+$700 saved
```

Not fake PnL.

Just avoided drawdowns.

---

# (5) Biggest reason it could flop

## The brutal truth:

A trader may say:

"Cool idea."

Then never connect wallet.

Why?

Because most traders do not trust signals.

The failure mode:

You become another:

"smart money alert dashboard."

---

# Defuse this:

Do NOT promise:

"Follow whales."

Promise:

# "Never be the last person holding."

Your homepage copy:

Current:

> Track smart money exits

Better:

> Smart money made money. Don't be the person they sell into.

---

## Your demo should be one story, not features

Do this:

### Demo:

Wallet:
```
NEAR long holder
```

Timeline:

```
Whale enters
↓
User enters 3 hours later
↓
Whale reduces
↓
Exit Window fires
↓
Price dumps
```

Show:

"Copying entry: -$X"

"Copying exit: +$X"

That directly answers the user pain.

---

# Final 10-hour priority order

## Hour 0-2
Build:

**Paste HL address → Exit Window score**

Nothing else.

---

## Hour 2-5
Build:

Telegram alert.

This is the product.

---

## Hour 5-7
Build:

Historical "you would have been exit liquidity" simulation.

---

## Hour 7-9
Polish:

- porcelain dial
- one beautiful case study
- README

---

## Hour 9-10

Record demo:

No explanation.

Just:

1. Paste wallet
2. See exit risk
3. Receive Telegram alert
4. Show avoided loss

---

My strongest bet: **your winning artifact is not "AI trading agent." It is "the first anti-copy-trading risk layer."**

It is a much sharper category. You are taking Nansen's own "who made $50M and how?" thesis and flipping it:

> "The important question isn't who bought. The important question is: when do they leave?"
