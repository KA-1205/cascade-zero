'use client';

import React from 'react';

// ── MetricCard ─────────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
  status?: 'healthy' | 'warning' | 'danger' | 'muted';
  simulated?: boolean;
  description?: string;
}

export function MetricCard({
  label,
  value,
  unit,
  trend,
  trendValue,
  status = 'muted',
  simulated = true,
  description,
}: MetricCardProps) {
  const statusColor = {
    healthy: 'var(--success)',
    warning: 'var(--warning)',
    danger: 'var(--danger)',
    muted: 'var(--text-secondary)',
  }[status];

  const trendColor =
    trend === 'up' ? 'var(--danger)' : trend === 'down' ? 'var(--success)' : 'var(--text-muted)';

  return (
    <div
      className="surface card-hover"
      style={{ padding: '16px 20px', minWidth: 0 }}
      title={description}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </span>
        {simulated && (
          <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7 }}>
            [SIM]
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span className="metric-value" style={{ color: statusColor }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{unit}</span>
        )}
      </div>
      {(trend || trendValue) && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, color: trendColor, fontSize: 12 }}>
          {trend === 'up' && '↑'}
          {trend === 'down' && '↓'}
          {trend === 'stable' && '→'}
          {trendValue && <span style={{ fontFamily: 'var(--font-mono)' }}>{trendValue}</span>}
        </div>
      )}
    </div>
  );
}

// ── SeverityBadge ─────────────────────────────────────────────────────────────

type Severity = 'low' | 'medium' | 'high' | 'critical';

const severityStyle: Record<Severity, { color: string; bg: string; border: string }> = {
  low: { color: 'var(--success)', bg: 'var(--success-muted)', border: 'var(--success)' },
  medium: { color: 'var(--warning)', bg: 'var(--warning-muted)', border: 'var(--warning)' },
  high: { color: 'var(--danger)', bg: 'var(--danger-muted)', border: 'var(--danger)' },
  critical: { color: 'var(--danger)', bg: 'var(--danger-muted)', border: 'var(--danger)' },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = severityStyle[severity];
  return (
    <span
      className="badge"
      style={{ color: s.color, backgroundColor: s.bg, borderColor: s.border }}
    >
      {severity === 'critical' && (
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
          <circle cx="4" cy="4" r="3.5" />
        </svg>
      )}
      {severity}
    </span>
  );
}

// ── RiskIndicator ─────────────────────────────────────────────────────────────

type Risk = 'low' | 'medium' | 'high' | 'unknown';

export function RiskIndicator({ risk, showLabel = true }: { risk: Risk; showLabel?: boolean }) {
  const riskConfig = {
    low: { color: 'var(--success)', fill: 0.25, label: 'Low Risk' },
    medium: { color: 'var(--warning)', fill: 0.55, label: 'Med Risk' },
    high: { color: 'var(--danger)', fill: 0.85, label: 'High Risk' },
    unknown: { color: 'var(--unknown)', fill: 0.5, label: 'Unknown' },
  }[risk];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="risk-bar" style={{ width: 60, flex: 'none' }}>
        <div
          className="risk-bar-fill"
          style={{ width: `${riskConfig.fill * 100}%`, backgroundColor: riskConfig.color }}
        />
      </div>
      {showLabel && (
        <span style={{ fontSize: 11, color: riskConfig.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {riskConfig.label}
        </span>
      )}
    </div>
  );
}

// ── LoadingSkeleton ────────────────────────────────────────────────────────────

export function LoadingSkeleton({ width = '100%', height = 20, style = {} }: { width?: string | number; height?: string | number; style?: React.CSSProperties }) {
  return (
    <div
      className="skeleton"
      style={{ width, height, borderRadius: 6, ...style }}
      aria-hidden="true"
    />
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '48px 24px',
        color: 'var(--text-muted)',
        textAlign: 'center',
      }}
    >
      {icon && (
        <div style={{ opacity: 0.4, marginBottom: 4 }}>{icon}</div>
      )}
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>{title}</div>
      {description && <div style={{ fontSize: 13, maxWidth: 320 }}>{description}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

// ── ErrorState ────────────────────────────────────────────────────────────────

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '32px',
        backgroundColor: 'var(--danger-muted)',
        border: '1px solid var(--danger)',
        borderRadius: 'var(--radius-card)',
        color: 'var(--danger)',
        textAlign: 'center',
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L2 20H22L12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M12 9V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="12" cy="17" r="1" fill="currentColor" />
      </svg>
      <div style={{ fontWeight: 600 }}>{message ?? 'Something went wrong'}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: '6px 16px',
            borderRadius: 6,
            border: '1px solid var(--danger)',
            backgroundColor: 'transparent',
            color: 'var(--danger)',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

// ── Section heading ────────────────────────────────────────────────────────────

export function SectionHeading({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
      <div>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{title}</h2>
        {subtitle && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</p>
        )}
      </div>
      {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{actions}</div>}
    </div>
  );
}

// ── Divider ────────────────────────────────────────────────────────────────────

export function Divider({ style }: { style?: React.CSSProperties }) {
  return (
    <hr
      style={{
        border: 'none',
        borderTop: '1px solid var(--border)',
        margin: '16px 0',
        ...style,
      }}
    />
  );
}

// ── Predicted label ────────────────────────────────────────────────────────────

export function PredictedLabel() {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: 'var(--warning)',
        backgroundColor: 'var(--warning-muted)',
        border: '1px solid var(--warning)',
        borderRadius: 4,
        padding: '1px 5px',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
      }}
      title="This is a model prediction, not a measured result"
    >
      Predicted
    </span>
  );
}
