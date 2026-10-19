/**
 * Global design tokens for Cascade Zero.
 * Source of truth: frontend/DESIGN_SYSTEM.md
 * These are injected as CSS custom properties in globals.css.
 */
export const tokens = {
  color: {
    bgBase: '#0B1220',
    bgSurface: '#111D2E',
    bgElevated: '#192337',
    bgHover: '#1E2B40',
    border: '#26344A',
    borderSubtle: '#1C2A3D',
    
    textPrimary: '#EAF1FA',
    textSecondary: '#91A3BB',
    textMuted: '#5A7090',
    textInverse: '#0B1220',

    accent: '#52B8DB',
    accentHover: '#6BC8E8',
    accentMuted: '#52B8DB22',

    success: '#3BBE8B',
    successMuted: '#3BBE8B22',
    warning: '#E7AD53',
    warningMuted: '#E7AD5322',
    danger: '#F07178',
    dangerMuted: '#F0717822',
    unknown: '#8B9CB0',
    unknownMuted: '#8B9CB022',

    /** Capacity danger threshold line on charts */
    capacityLimit: '#F07178',
  },
  font: {
    sans: 'Inter, ui-sans-serif, system-ui, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, "Cascadia Code", monospace',
  },
  radius: {
    card: '12px',
    badge: '6px',
    button: '8px',
    full: '9999px',
  },
  spacing: {
    unit: '8px',
  },
  shadow: {
    card: '0 1px 3px 0 rgba(0,0,0,0.4)',
    elevated: '0 4px 12px 0 rgba(0,0,0,0.5)',
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
  none: '#91A3BB',
  independent: '#F07178',
  guardrails: '#E7AD53',
  coordinated: '#52B8DB',
} as const;

export const policyDash = {
  none: '8 4',
  independent: '4 4',
  guardrails: '6 3',
  coordinated: undefined, // solid
} as const;
