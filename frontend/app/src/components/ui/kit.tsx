'use client';

import React from 'react';

/**
 * Shared visual language: numbered section headers and KPI cards, used across
 * the console for a consistent command-center look.
 */

export function SectionHeader({ index, title, subtitle }: {
  index: string; title: string; subtitle?: string;
}) {
  return (
    <div className="section-heading" style={{ marginBottom: 6 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 1,
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
          color: 'var(--accent)', letterSpacing: '0.06em',
        }}>{index}</span>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{title}</h2>
      </div>
      {subtitle && (
        <p style={{ color: 'var(--text-muted)', fontSize: 11, margin: 0 }}>{subtitle}</p>
      )}
    </div>
  );
}

export function KpiCard({ label, value, context, tone }: {
  label: string; value: React.ReactNode; context?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const toneColor = {
    default: 'var(--text-primary)',
    good: 'var(--success)',
    warn: 'var(--warning)',
    bad: 'var(--danger)',
  }[tone ?? 'default'];
  return (
    <div className="surface kpi-card" title={context} style={{ padding: '8px 12px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{
        fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 700, color: toneColor,
        fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
      }}>{value}</div>
      {context && (
        <div style={{ color: 'var(--text-muted)', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{context}</div>
      )}
    </div>
  );
}

export function LabeledRow({ label, children }: {
  label: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 16,
      padding: '9px 0', borderTop: '1px solid var(--border)',
      fontSize: 13,
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', textAlign: 'right' }}>{children}</span>
    </div>
  );
}
