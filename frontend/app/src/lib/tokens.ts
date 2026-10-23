/**
 * Global design tokens for Cascade Zero.
 * Source of truth: frontend/DESIGN_SYSTEM.md
 * These are injected as CSS custom properties in globals.css.
 */
export const tokens = {
  color: {
    bgBase: '#B7A89A',
    bgSurface: '#F7F0E5',
    bgElevated: '#FFFAF2',
    bgHover: '#E4D5C0',
    border: '#D3C1AA',
    borderSubtle: '#E4D8C7',
    
    textPrimary: '#302427',
    textSecondary: '#403438',
    textMuted: '#3B3133',
    textInverse: '#FFFAF2',

    accent: '#722F37',
    accentInk: '#4B252C',
    accentHover: '#5D252D',
    accentMuted: '#722F3718',

    success: '#247A57',
    successMuted: '#247A5718',
    warning: '#88570F',
    warningMuted: '#88570F18',
    danger: '#A43B43',
    dangerMuted: '#A43B4318',
    unknown: '#3B3133',
    unknownMuted: '#3B313318',

    /** Capacity danger threshold line on charts */
    capacityLimit: '#A43B43',
  },
  font: {
    sans: 'Inter, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
    mono: '"Cascadia Code", "SFMono-Regular", ui-monospace, monospace',
  },
  radius: {
    card: '10px',
    badge: '6px',
    button: '8px',
    full: '9999px',
  },
  spacing: {
    unit: '8px',
  },
  shadow: {
    card: '0 1px 3px 0 rgba(53,39,41,0.06)',
    elevated: '0 4px 12px 0 rgba(53,39,41,0.1)',
  },
} as const;

/** Severity → color mapping */
export const severityColor = {
  low: tokens.color.success,
  medium: tokens.color.warning,
  high: tokens.color.danger,
  critical: tokens.color.danger,
} as const;

/** Risk → color mapping */
export const riskColor = {
  low: tokens.color.success,
  medium: tokens.color.warning,
  high: tokens.color.danger,
  unknown: tokens.color.unknown,
} as const;

/** Policy display names */
export const policyLabel = {
  none: 'N0 — No Recovery',
  independent: 'N1 — Independent Agents',
  guardrails: 'N2 — Guardrail Policy',
  coordinated: 'N3 — Cascade Zero',
} as const;

/** Policy colors for multi-line charts (also uses dash pattern — not color alone) */
export const policyColor = {
  none: '#3B3133',
  independent: '#A43B43',
  guardrails: '#88570F',
  coordinated: '#722F37',
} as const;

export const policyDash = {
  none: '8 4',
  independent: '4 4',
  guardrails: '6 3',
  coordinated: undefined, // solid
} as const;
