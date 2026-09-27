# DESIGN.md: Exit Window (v2, Nansen-native)

Binding design system. Exit Window is used by the same traders who live in Nansen's app, and it is judged by
Nansen. It speaks Nansen's visual language: a dark app shell, left sidebar, top search, dense screener tables with
token icons, pill tabs, green accent, mono figures. The one signature element that is ours: the exit dial.

Components use the token names below (Tailwind theme: `bg-paper`, `bg-dial`, `bg-bezel`, `border-rule`, `text-ink`,
`text-ink-2`, `text-ink-3`, `text-lume`, `text-late`, `bg-accent`), never raw hex.

## Colour

| Token | Hex | Use | Contrast on paper |
|---|---|---|---|
| `--color-paper` | `#0B1015` | app background | |
| `--color-dial` | `#11181F` | panels, sidebar, table body, dial face | |
| `--color-bezel` | `#17212A` | table header, hover rows, raised chips, dial bezel | |
| `--color-rule` | `#222D38` | 1px borders and dividers | |
| `--color-ink` | `#E7ECF0` | primary text, dial hands | 16.1:1 |
| `--color-ink-2` | `#A3ADB6` | secondary text | 8.3:1 |
| `--color-ink-3` | `#7C8892` | labels, captions (>= 12px) | 5.1:1 |
| `--color-accent` | `#3FD49A` | primary buttons, active nav, active tab, links | 10.2:1 |
| `--color-accent-ink` | `#05231A` | text on accent buttons | |
| `--color-lume` | `#3FD49A` | gains, long, out in time | 10.2:1 |
| `--color-lume-wash` | `#3FD49A1A` | green chip background | |
| `--color-late` | `#F0616D` | losses, short, reduce, window closed, you were late | 5.6:1 |
| `--color-late-wash` | `#F0616D1A` | red chip background | |
| `--color-window` | `#3FD49A29` | the open exit window band on dials and strips | |
| `--color-focus` | `#3FD49A` | 2px focus ring | |

No gradients except the flow bar fill. No purple.

## Type

- UI: Geist 400/500/600 (`--font-body`, and `--font-display` for page titles and big numbers).
- Figures: Geist Mono with tabular numerals (`.fig`) for every price, size, USD value, percent, time and address.
- Scale: 12 label, 13 table, 14 body, 16 lead, 20 panel title, 28 page title, 44 big figure.
- Labels: 12px, ink-3, sentence case (no uppercase eyebrows except table headers, which are 12px ink-3).

## Layout: app shell

- Left sidebar 240px (collapses to a top bar under 1024px): wordmark, nav (Exiting now, Your trades, Wallets,
  Alarms, Nansen calls), footer links (Telegram bot, GitHub, "Data: Nansen API").
- Top bar 64px: page title, address search ("Paste a Hyperliquid address"), live UTC clock, green "Connect Telegram".
- Content: panels on `--color-dial` with 1px `--color-rule` border, 12px radius, 20px padding. Page max width 1440px.

## Components

- Token icon: 20px circle from `https://app.hyperliquid.xyz/coins/<COIN>.svg`, monogram fallback on error.
- Screener table: 13px rows 44px tall, header on bezel with 12px ink-3 labels, numbers right-aligned in `.fig`,
  row hover bezel, first column token icon + symbol.
- Chips: 12px, 6px radius, wash background with coloured text (Long/Reduce/Close/Smart Money/Whale).
- Pill tabs and timeframe pills: bezel group, active pill has rule border and accent text.
- Flow bar: 96px x 4px track in rule colour, fill in lume or late.
- Exit dial (signature): the log-scale chronograph (10 s to 24 h), dark face, green window band, red close tick,
  delay markers green if in time, red if late.
- Buttons: primary accent fill with accent-ink text, 8px radius, 36px tall; secondary 1px rule border.

## Motion

Only transform and opacity; 150ms colour transitions list their properties; dial hand sweeps via rAF and steps once a
second under reduced motion.

## Copy

Plain trader language. No em dashes. Every number comes from Nansen or Hyperliquid.
