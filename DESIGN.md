# Exit Window: design

## The noun

An exit is a window that closes. Every visual on this site renders that
literally: a horizontal time axis starting at t=0 (the wallet's first
reduce), an amber band for how long the window stayed open, and latency
ticks at 1m / 5m / 15m / 60m that land inside the band (green, "out in time")
or past its edge (red-orange, "exit liquidity"). Stack the rows for one
wallet and you see how fast its windows close without reading a number.

Reference: a departures board crossed with a stopwatch. Not a SaaS
dashboard. No card grid, no icon row, no gradient blob, no glassmorphism.

## Palette (`src/app/globals.css`)

| Token | Value | Meaning |
|---|---|---|
| `--bg` | `#0b0a08` | warm near-black ground |
| `--fg` | `#f5f1e8` | paper-white type |
| `--amber` | `#f5a623` | window open |
| `--red` | `#ff5a36` | window closed / you were late |
| `--green` | `#5fa66b` | out in time |
| `--fg-dim` / `--fg-faint` | warm grays | secondary and tertiary text |

No purple anywhere. One accent (amber) plus the two verdict colors.

## Type

Geist for headings and prose, Geist Mono for every number (`.num` utility:
`font-variant-numeric: tabular-nums`). The build already loads both fonts
via `next/font/google`; no new dependency.

## Pages

- `/`: headline, address input, one real feed reduce animated as a closing
  window (`HeroClock`), the live Smart Money reduce strip, the 30-day
  leaderboard. `src/app/page.tsx`.
- `/w/[address]`: verdict line, the exit-window stack (`ExitTimeline`), the
  latency tax curve (plain SVG, `LatencyTaxChart`), exit style + realized vs
  paper PnL (`PnlPanel`), open positions, the follow panel with a paper/live
  mirror ledger (`FollowPanel`). `src/app/w/[address]/page.tsx`.

## Data discipline

Every number rendered comes from `WalletReport`, `LeaderRow`,
`OpenPosition`, or the feed response, never a hardcoded sample. Loading,
empty and error states are real components (`src/components/States.tsx`),
not blank divs. The follow panel polls `/api/positions/[address]` at a
20s floor, pauses while the tab is hidden (`document.visibilityState`), and
shows response age (`fetchedAt`/`stale` when the API sends it, else the
client's own fetch time) so a stale read is never mistaken for a fresh one.

## What was skipped

- No chart library: the latency tax curve is plain SVG, per spec.
- No client data-fetching library (SWR/TanStack): one small hook
  (`usePoll`) covers polling, visibility-pause and envelope-unwrapping for
  every panel on the site. Add a library if a second browser tab needs to
  share the cache.
- The hero does not fabricate a per-wallet exit-window band for an
  unmeasured feed wallet; it animates the real elapsed time since a real
  reduce against the fixed 1/5/15/60m methodology marks only. The precise
  band appears once you open that wallet's report.
