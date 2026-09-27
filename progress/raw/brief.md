Context: Nansen Meridian Buildathon (build anything on Nansen API; judged 25% each on Data Integration "Nansen data drives the logic", Creativity "we've seen dashboards", Functionality "live data, no crashes", Docs "another builder runs it in <10 min"). Closes 2026-09-27 23:59 UTC.
Task: for EACH GitHub repo in your list, use the `gh` CLI only (gh repo view, gh api repos/OWNER/REPO/contents, gh api .../git/trees/HEAD?recursive=1, gh api .../commits?per_page=5). No browser. Read README and the core source files (not lockfiles). Determine:
1. What it does in one line (the user action and output).
2. Exact Nansen endpoints called (grep for api.nansen.ai paths / endpoint names). Count distinct endpoints.
3. Does Nansen data drive logic (scoring, decisions, triggers) or only display? Quote the file:line of the core logic.
4. Does it EXECUTE anything (trades, alerts sent, onchain tx, orders) or read-only?
5. Does it touch SELLS / EXITS of wallets (exit timing, when smart money sells, exit alerts)? Say exactly how.
6. Stack, live demo URL if any, commit count, last push, README quality (can someone run in 10 min?).
7. Your 1-10 score vs rubric, one sentence why.
Write full findings to /Users/kamal/Desktop/nansen-meridian/progress/review-<BATCHNAME>.md as a markdown table plus notes. Return to me ONLY a compact table: repo | does | endpoints# | drives-logic y/n | executes y/n | exit-side y/n (how) | score. Report conclusions, not transcripts.
