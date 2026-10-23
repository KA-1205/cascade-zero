# Cascade Zero Design System

The visual language of the operator console. The tokens live in
`frontend/app/src/app/globals.css` under `:root` — this file is the guide to
using them; the CSS is the source of truth for values.

## Foundations

- **Theme**: cosmic latte desktop canvas with restrained mocha cream light,
  deep burgundy for the sandbox banner, primary actions, and active navigation.
  No dark-mode variant yet; new visual rules should use semantic CSS tokens.
- **Type**: `--font-sans` uses a system UI stack; `--font-mono` uses a system
  monospace stack for ids, seeds, numbers, and code. The interface does not
  depend on a remote font request. Numbers in dashboards use
  `font-variant-numeric: tabular-nums`.
- **Spacing**: `--space` is the 8px base. Card padding is 20–22px; section gap
  in page grids is 22px.
- **Radius**: `--radius-card` 10px (cards), `--radius-badge` 6px,
  `--radius-button` 8px.
- **Palette**: cosmic latte `#B7A89A` background, mocha cream `#E8DCC6`
  highlights, and deep burgundy `#722F37`. Use the darker `--accent-ink` for
  text links on the background and burgundy fills with cream text for primary
  actions. Reserve gradients for the page canvas and small brand marks.

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
