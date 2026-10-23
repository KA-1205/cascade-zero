# Cascade Zero Design System

The visual language of the operator console. The tokens live in
`frontend/app/src/app/globals.css` under `:root` — this file is the guide to
using them; the CSS is the source of truth for values.

## Foundations

- **Theme**: cosmic latte background with mocha cream gradient highlights,
  deep burgundy for primary actions and active navigation, warm dark-brown text.
  No dark-mode variant yet; every color must come from a CSS variable so one
  can be added later without touching components.
- **Type**: `--font-sans` is Plus Jakarta Sans (UI text); `--font-mono` is
  JetBrains Mono (ids, seeds, numbers, code). Numbers in dashboards use
  `font-variant-numeric: tabular-nums`.
- **Spacing**: `--space` is the 8px base. Card padding is 20px; section gap
  in page grids is 18px.
- **Radius**: `--radius-card` 12px (cards), `--radius-badge` 6px,
  `--radius-button` 8px.
- **Palette**: cosmic latte `#B7A89A` background, mocha cream `#E8DCC6`
  highlights, and deep burgundy `#722F37`. Use burgundy for links, primary buttons, and active
  navigation; use the restrained burgundy-to-latte gradient for brand marks.

## Status colors

`--success` / `--warning` / `--danger` / `--unknown`, each with a `-muted`
background variant for badges. Never encode status by color alone — always
pair with a label or icon.

## Surfaces and components

| Class | Use |
| --- | --- |
| `.surface` | Standard card background + border + radius |
| `.surface-elevated` | Higher-emphasis panels |
| `.badge` (+ `-success`/`-warning`/`-danger`/`-accent`/`-muted`) | Small status chips |
| `.metric-value` | Large KPI numerals |
| `.skeleton` | Loading placeholder (shimmer animation) |
| `.live-dot` | Pulsing connection indicator; turn it red and unanimated when the probe fails (see `Header.tsx`) |
| `.risk-bar` / `.risk-bar-fill` | Horizontal risk gauge |

Shared components live in `frontend/app/src/components/ui/kit.tsx`
(`SectionHeader`, `KpiCard`, `LabeledRow`). Prefer them over re-styling divs;
prefer CSS variables and these classes over inline color literals.

## Copy tone

Operator console, not marketing: short sentences, label what is simulated vs
measured, and never claim liveness or success the data does not support
("API offline" beats a permanent green dot).
