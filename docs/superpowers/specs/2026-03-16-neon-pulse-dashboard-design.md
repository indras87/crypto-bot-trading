# Neon Pulse UI/UX Redesign (OLED, Data-Dense)

Date: 2026-03-16

## Summary
Redesign the entire web UI of the crypto trading bot to a **Neon Pulse** OLED dark, ultra–data-dense dashboard aesthetic. The UI will emphasize scan speed and operational clarity using precise neon glows, tight spacing, and an editorial typographic system. A global design system and reskin will be applied across all EJS pages with a left sidebar layout and mixed-panel dashboard hierarchy.

## Goals
- Establish a cohesive OLED dark design system with neon accents and high-density layout.
- Increase data scanning speed through tighter spacing, table treatment, and numeric alignment.
- Unify visual language across dashboard, trades, orders, signals, backtest, logs, and settings.
- Preserve functionality while reflowing layouts to a modular, dashboard-like structure.

## Non-Goals
- No backend changes, API changes, or data model changes.
- No functional changes to trading logic or dashboard data.
- No new features beyond UI/UX presentation and structure.

## Visual Direction
**Theme:** Neon Pulse Ledger
- Mood: operational command center, live instrumentation.
- Background: OLED black base with subtle grid/noise texture.
- Glow: thin, precise glow on many UI elements (panels, nav, buttons, table hovers), not heavy blur.
- Density: ultra-dense spacing with disciplined grid alignment to prevent clutter.

## Palette
- Base OLED: `#0A0E27`
- Deep base: `#05070F`
- Panel fill: `#0E132E`
- Border: `#14214D` / `#0F1B3A`
- Accent blue: `#0080FF`
- Neon green: `#39FF14`
- Crimson sell: `#FF3B3B`
- Text primary: `#E6F0FF`
- Text muted: `#9BB7FF`

## Typography
- Headings: **Fraunces** (editorial serif)
- Body/UI: **Alegreya Sans** (dense, readable)
- Numeric alignment: `font-variant-numeric: tabular-nums` globally

## Layout & Structure
- **Left sidebar navigation** replaces top-heavy nav; dense icons + labels.
- **Dashboard hierarchy**:
  - KPI row (PnL, equity, drawdown, risk)
  - Primary visualization panel + signals stream
  - Dense TA table as main content anchor
- **Mixed panels**: metrics + charts + table all visible without excessive scrolling.

## Component System
### Panels/Cards
- 1px border in `#14214D`, radius 8px
- Inner glow (blue) and optional outer glow for active modules
- Header label (uppercase) + large value

### Tables (Data-Dense)
- Sticky header
- Row height 28–32px
- Zebra rows: `#0E132E` / `#0A0E27`
- Hover: subtle blue glow
- Chips/badges for signals

### Badges/Signals
- BUY: `#39FF14` with glow
- SELL: `#FF3B3B` with glow
- NEUTRAL: `#0080FF`

### Inputs/Selects
- Dark fields with blue border
- Neon focus ring
- Slim Select fully restyled to match dark theme

## Motion & Interaction
- Page load: staggered panel reveal (200–400ms), opacity + small translate
- Live pulse: subtle glow breathing for active status indicators
- Table hover: inner glow highlight
- Signal badges: slow pulse (2.5–3s)

## Global CSS Strategy
- Define CSS variables for colors, glow, spacing, and typography.
- Add reusable utility classes for neon borders, glow, dense tables, and chips.
- Apply classes consistently across all EJS templates.

## Pages in Scope
- `views/layout.ejs` (global layout)
- Dashboard, trades, orders, signals, candles, ccxt, backtest (all variants), logs, settings, desk pages

## Acceptance Criteria
- All pages render in OLED dark with consistent Neon Pulse styling.
- Sidebar nav replaces topbar where applicable.
- Tables and dense data views reflect new theme without readability loss.
- Consistent typography and colors across pages.
- No regression in functionality or routing.

## Open Questions (Resolved)
- Glow usage: **many elements** (approved)
- Density: **ultra-dense** (approved)
- Sell color: **crimson accent** (approved)
- Font source: **Google Fonts** (approved)

