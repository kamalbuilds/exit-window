# DESIGN.md: Exit Window

Binding design system. Every colour, font, radius, spacing and motion value in the UI comes from here.
Components reference tokens (`var(--color-ink)`), never raw hex.

## Concept: Chronograph

An exit window is a length of time, so the product is drawn as a watch. t = 0 is the moment a wallet
first reduces a position. A sweeping arc on a porcelain dial runs until price has moved 1% against anyone
still holding: that arc is the window. Copier delays (1m, 5m, 15m, 1h) are engraved on the bezel. A delay
that lands inside the arc is lume green (out in time); one that lands past it is vermilion (you were the
exit liquidity).

The dial is logarithmic, 10 s at 12 o'clock to 24 h at 11 o'clock over a 330 degree sweep, so seconds,
minutes and hours all get real space. Every time axis in the product (dials and strips) uses the same
log scale: `pos = ln(t / 10s) / ln(86400s / 10s)`, clamped to [0, 1].

## Macrostructure: Chronograph bench

- Masthead strip: wordmark, live UTC clock, data source line, live Nansen call count from `/api/ledger`.
- Home: 12-column split. Left 7 columns: the large live dial for the most recent Smart Money reduce
  (second hand sweeping since that reduce). Right 5 columns: headline, one sentence, address input,
  "Exiting now" lap list. Below: the timing tower of top wallets, two dense columns.
- Report: identity band with the verdict as a sentence and the median window as the largest numeral on the
  page. Left: dial of the median window with the four delay markers. Right: latency ladder. Then the exit
  log (one log-scale strip per exit), open positions, and a Follow rail.
- No hero + three cards. No card inside a card. Sections are divided by 1px rules and bezel bands, not
  floating boxes.

## Colour

| Token | Hex | Use | Contrast on paper |
|---|---|---|---|
| `--color-paper` | `#F2EEE5` | page ground (porcelain) | |
| `--color-dial` | `#FBF9F4` | dial faces, input fields | |
| `--color-bezel` | `#E6E0D2` | bezel bands, table header, raised strips | |
| `--color-rule` | `#D2CBBB` | 1px rules, minor ticks | |
| `--color-ink` | `#16181C` | text, hands, major ticks, open-window arc stroke | 16.3:1 |
| `--color-ink-2` | `#474A51` | secondary text | 8.2:1 |
| `--color-ink-3` | `#686B72` | labels, captions (>= 12px) | 4.9:1 |
| `--color-window` | `#16181C1F` | open-window arc fill (ink at 12%) | |
| `--color-late` | `#C23A1E` | window closed, late delay, exit liquidity, losses | 4.8:1 |
| `--color-late-wash` | `#C23A1E14` | late row wash | |
| `--color-lume` | `#1E7349` | out in time, gains | 5.4:1 |
| `--color-lume-wash` | `#1E734914` | in-time wash | |
| `--color-focus` | `#16181C` | 2px focus ring, offset 2px | |

One accent family only (vermilion). Green is a status colour, never decoration. No gradients.

## Type

| Token | Family | Use |
|---|---|---|
| `--font-display` | Bricolage Grotesque (variable, opsz), 600 | headlines, verdict, the big window numeral |
| `--font-body` | Schibsted Grotesk 400 / 500 | UI text, labels, paragraphs |
| `--font-figure` | Martian Mono 400 / 500, `font-variant-numeric: tabular-nums` | every number, time, address, coin |

Scale (px): 12 label, 14 body-s, 16 body, 20 lead, 28 h3, 40 h2, 64 display, 112 dial numeral.
Line height: 1.1 display, 1.45 body. Labels are 12px Schibsted 500, letter-spacing 0.06em, uppercase.
Headings are roman only, never italic. Max text measure 62ch.

## Space, radius, lines

- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 72, 112.
- Radius: `--radius-control: 2px` for inputs, buttons, chips. Dials are circles. Nothing else is rounded.
- Rules: 1px `--color-rule`. Major separators: 1px `--color-ink` at 100% (bezel edge).
- Page max width 1320px, 32px gutters (16px under 640px).

## Components

- Dial (`Chronograph`): SVG, log-scale. Minor ticks at 30 s, 2 m, 10 m, 30 m, 2 h, 6 h, 12 h; major engraved
  ticks with labels at 1m, 5m, 15m, 1h, 24h. Window arc: ink stroke 2px over `--color-window` fill band.
  Delay markers: 10px circles on the bezel ring, lume if inside the window, late if past. Hand: 1.5px ink,
  sweeps with real elapsed time. Centre readout: `--font-figure` elapsed, `--font-display` window length.
- Exit strip: horizontal log axis, same scale as the dial, window band, 4 delay markers, adverse-move label.
- Latency ladder: five rungs (0s, 1m, 5m, 15m, 1h), each rung shows copier return, tax and late share.
  When the backtest has no eligible episodes it says why in one sentence; it never draws zeros.
- Lap list: time since reduce, coin, wallet label, notional. Newest first. Rows link to the report.
- Timing tower: rank, address, Nansen label, 30d PnL, ROI, in two dense columns on desktop.
- Buttons: ink fill, paper text, 2px radius, 44px tall. Secondary: 1px ink outline.
- Inputs: dial-white fill, 1px ink-3 border, 2px radius, Martian Mono text.
- States: every fetch has loading (bezel shimmer off under reduced motion), empty and error states written as
  sentences.

## Motion

- Dial hand: continuous sweep via requestAnimationFrame; under `prefers-reduced-motion` it steps once per second.
- Arc draw on first paint: 700ms, `cubic-bezier(0.2, 0, 0, 1)`, disabled under reduced motion.
- Hover: colour and underline only; no scale, no shadow lifts. Transitions list their properties explicitly.

## Copy

Plain sentences, trader vocabulary. No em dashes. No invented numbers: every figure comes from the API.
