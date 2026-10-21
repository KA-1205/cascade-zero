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
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 2,
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
          color: 'var(--accent)', letterSpacing: '0.08em',
        }}>{index}</span>
        <h2 style={{ fontSize: 18, margin: 0, color: 'var(--text-primary)' }}>{title}</h2>
      </div>
      {subtitle && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>{subtitle}</p>
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
    <div className="surface" style={{ padding: '16px 20px', minWidth: 0 }}>
      <div style={{
        fontSize: 11, color: 'var(--text-muted)', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8,
      }}>{label}</div>
      <div style={{
        fontSize: 30, fontWeight: 700, color: toneColor,
        fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
      }}>{value}</div>
      {context && (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>{context}</div>
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
