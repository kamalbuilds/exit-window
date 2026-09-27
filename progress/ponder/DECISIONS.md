# Product decisions from the ChatGPT pondering round (13:00 UTC)

Sources: strategist.md, judge.md, growth.md in this folder (three separate ChatGPT sessions on the same context.md).

Judge scores as of 13:00 UTC: Data Integration 8, Creativity 9, Functionality 7.5, Docs 8. Judge question to answer: "If this app removed Nansen, would it still exist?"

Taken:
1. Aha: "You entered X% above where Smart Money did." Computed from tgm/perp-positions entry prices against the user's entry. Zero extra calls.
2. Exit DNA per wallet from Nansen fills: first reduce becomes full exit %, median minutes first reduce to flat, clips, window, style (nuclear, scaler, trimmer, mixed).
3. Exit pressure on the user's coin: Smart Money holders on the same side vs how many reduced in the last hour (smart-money/perp-trades + tgm/perp-positions). Alerts lead with consensus.
4. Protection rule replaces blind mirror: "if wallet X reduces, cut my position Y%" via Nansen perp close (paper by default). Serves "don't blindly copy" and Nansen's "hand it your strategy".
5. Shareable Exit DNA card (Open Graph image per wallet) for X distribution.
6. Demo: one flow. Paste address, your position, Smart Money in it, how they exit, alarm fires.
7. Hook: "You copied the whale's entry. Congratulations. You became the exit liquidity."
8. Traction target: 20 wallets armed before judging, from replies under Hyperliquid traders' position posts (user posts, not automated).

Cut: leaderboard from home; feed kept small as a way to find wallets; sibling graph stays backend-only (feeds the alarm).

Not taken: "who got trapped following this whale" (needs follower attribution Nansen does not expose cheaply); Nansen Agent narration per alert (cost per call).
