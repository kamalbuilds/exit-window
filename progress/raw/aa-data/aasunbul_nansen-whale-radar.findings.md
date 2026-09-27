# aasunbul/nansen-whale-radar — Findings

Repo: https://github.com/aasunbul/nansen-whale-radar
Single squashed commit `c41b54c`, pushed 2026-09-18T15:11:15Z (created same second as pushed — this is a one-shot upload, not iterative dev).

## 1. What it does (one line)

A read-only canvas visualization: on page load it renders a "radar sonar" where every Nansen Star/North/Ice wallet from the points-leaderboard is a positioned blip (size/position from points+rank) and Smart Money token net-flows sit on an outer ring as green (inflow) / red (outflow) marks; a rotating sweep line pings blips and fires inward/outward streaks off flow marks, and hovering any blip/mark shows a tooltip (address, points, rank, tier / token, chain, 24h+7d net flow, trader count). No user input beyond mouse hover — it is a live-loading dashboard, not an interactive tool.

## 2. Nansen endpoints called

Grepped `build_data.py`, `buildathon_meter.py`, `index.html` for `nansen.ai`:

- `GET https://app.nansen.ai/api/points-leaderboard` — public, no key. Called from `build_data.py:11` (snapshot builder) and again as a browser-side fallback in `index.html:93` if no local snapshot JSON is found.
- `POST https://api.nansen.ai/api/v1/smart-money/netflow` — requires `apiKey` header. Called only from `buildathon_meter.py:46` (offline data-prep script). `index.html` never calls this endpoint live; it only reads the pre-baked `data/flows_*.json` the script produced (`index.html:110-112`), with **no live fallback** if that file is missing (flows array stays empty).

**Distinct endpoints: 2.**

## 3. Does Nansen data drive logic, or only display?

Display-only, no scoring/decision/trigger logic. Every use of Nansen data is a direct linear/geometric mapping into pixel position, size, or color — there is no threshold, ranking algorithm, or branch that changes application behavior based on data values beyond that mapping.

- `index.html:71` — `const rr = Math.pow(t,0.62)*R*0.72;` : wallet radial position derived from its rank percentile (t = i/whales.length). This is the only place "rank" changes anything, and it's a cosmetic placement formula, not a decision.
- `index.html:140-142` — `const inflow = m.f.net_24h >= 0; const c = inflow ? "#7ee787" : "#ff8a80"; const size = 1.8 + Math.min(Math.abs(m.f.net_24h)/60000,1)*4.5;` : color and marker size come from the sign/magnitude of `net_24h`. Still purely a rendering choice, no alert, no filter, no ranking output.

There is no scoring model, no "top mover" computation, no alert threshold, nothing that would count as application logic driven by the data beyond "map value to X/Y/color/radius."

## 4. Does it execute anything?

No. Entirely read-only. No trade execution, no onchain transaction, no alert dispatch (email/webhook/push), no order placement anywhere in the three source files. `buildathon_meter.py` only fetches and writes local JSON.

## 5. Does it touch sells/exits of wallets?

No wallet-level exit tracking or alerting exists. The only sell-adjacent signal is the *aggregate token* `net_flow_24h_usd` / `net_flow_7d_usd` sign from `smart-money/netflow` (a token-level net-flow number across all smart-money wallets, not per-wallet), rendered as red "outflow" marks with an outward streak (`index.html:140-158`). There is no per-wallet sell detection, no exit-timing computation, no alert when a specific tracked wallet sells or exits a position. If a whale wallet exits, nothing in this app would surface that as an event — the whale blip's tier/position would only change on the next full leaderboard snapshot rebuild.

## 6. Stack, demo, commits, README

- **Stack**: vanilla JS + HTML5 Canvas, zero frontend dependencies, zero build step. Data prep is two standalone Python 3 scripts (`urllib` stdlib only, no requests/pandas).
- **Live demo URL**: none. `homepageUrl` on the repo is empty. README only documents `python -m http.server` for local hosting.
- **Commit count**: 1 total commit (`c41b54c`), confirmed via `commits?per_page=5` returning a single entry — not truncated, this is genuinely the entire history (single squashed upload).
- **Last push**: 2026-09-18T15:11:15Z, same timestamp as repo creation.
- **README quality**: Well-organized (what-it-does, why-a-radar, run instructions, API table, file table, roadmap). But it has a real gap for the "run in under 10 min" bar:
  - Running `index.html` alone works out of the box off the committed `data/radar_20260918.json` and `data/flows_20260918.json` snapshots — this part is genuinely under 10 minutes.
  - The documented data-pipeline step (`python buildathon_meter.py`) will **fail immediately for any other builder**: it hardcodes a Windows-only absolute path (`buildathon_meter.py:11-12`, `METER_FILE = "C:/Users/aasun/nansen-whale-radar/buildathon_meter.json"`, `OUT_DIR = "C:/Users/aasun/nansen-whale-radar/data"`) with no `os.path.dirname(__file__)`-relative fallback like `build_data.py` uses. On macOS/Linux, or on Windows under a different username, this raises on the `os.makedirs`/open call. The README presents this as a runnable step but it is not portable.
  - **Security note**: `buildathon_meter.py:9` hardcodes a live Nansen API key in plaintext (`API_KEY = "nsn_..."`) committed to a public repo. Not asked about in the rubric, but a judge inspecting the code will see it; noted here without reproducing the key value.

## 7. Score: 6/10

Creativity is genuinely the strongest leg — mapping the entire leaderboard into a radar-sweep visual metaphor is a distinctive, non-generic idea and the canvas rendering (ping rings, directional streaks, golden-angle blip placement) is well executed for a single-file app. But Data Integration is thin (only 2 distinct endpoints, and the paid netflow endpoint is never called live from the app — it's baked into a static JSON at prep time with no live fallback), the data only drives cosmetic position/color/size with no scoring or decision logic, it's purely read-only with no exit-side wallet intelligence, and Functionality/Docs take a real hit from the hardcoded Windows-only path in the documented pipeline script plus a committed plaintext API key.
