'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { SeverityBadge, SectionHeading, LoadingSkeleton, EmptyState, PredictedLabel } from '@/components/ui/primitives';
import { mockIncident, mockMetricsByTick, mockProposals } from '@/lib/fixtures';
import type { CascadeEvent, ProposalPayload } from '@/types/api';

const RISK_COLOR: Record<string, string> = {
  low: 'var(--success)',
  medium: 'var(--warning)',
  high: 'var(--danger)',
  unknown: 'var(--unknown)',
};

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: number }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Tick {label}</div>
      {payload.map((e) => (
        <div key={e.name} style={{ display: 'flex', gap: 8, color: 'var(--text-secondary)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: e.color, display: 'inline-block', marginTop: 3, flexShrink: 0 }} />
          {e.name}: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{e.value}%</span>
        </div>
      ))}
    </div>
  );
}

interface IncidentPageProps {
  id: string;
}

export function IncidentPage({ id }: IncidentPageProps) {
  const incident = mockIncident; // In live mode: fetched by id
  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'timeline'>('overview');

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'agents', label: 'Agent Proposals' },
    { key: 'timeline', label: 'Timeline' },
  ] as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1400 }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
        <Link href="/overview" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Overview</Link>
        <span>›</span>
        <span style={{ color: 'var(--text-secondary)' }}>Incidents</span>
        <span>›</span>
        <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{incident.id}</span>
      </div>

      {/* Incident header */}
      <div className="surface" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <SeverityBadge severity={incident.severity} />
              <span
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
                  color: 'var(--danger)', backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)',
                  borderRadius: 6, padding: '2px 8px',
                }}
              >
                <span className="live-dot" style={{ width: 6, height: 6 }} />
                Active
              </span>
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 6 }}>
              {incident.title}
            </h1>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-muted)' }}>
              <span>Started: <span style={{ color: 'var(--text-secondary)' }}>{formatDateTime(incident.started_at)}</span></span>
              <span>Run: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{incident.run_id}</span></span>
              <span>
                Affected:{' '}
                {incident.affected_services.map((s) => (
                  <span key={s} style={{ marginRight: 4, padding: '1px 6px', backgroundColor: 'var(--bg-elevated)', borderRadius: 4, color: 'var(--accent)', fontSize: 12 }}>
                    {s}
                  </span>
                ))}
              </span>
            </div>
          </div>
          <Link
            href={`/plans/${incident.run_id}`}
            style={{
              padding: '8px 16px', borderRadius: 8, backgroundColor: 'var(--accent)', color: 'var(--text-inverse)',
              textDecoration: 'none', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            }}
          >
            View Recovery Plans →
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }} role="tablist" aria-label="Incident sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-secondary)',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'none',
              cursor: 'pointer',
              transition: 'color 0.15s ease',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Telemetry charts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="surface" style={{ padding: 16 }}>
              <SectionHeading title="Error Rate" subtitle="Simulation ticks" />
              <div className="chart-container" style={{ height: 200 }}>
                <span className="chart-simulated-label">[SIM]</span>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mockMetricsByTick} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="tick" stroke="var(--text-muted)" fontSize={10} tickLine={false} />
                    <YAxis stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="error_rate_pct" name="Error Rate" stroke="var(--danger)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="surface" style={{ padding: 16 }}>
              <SectionHeading title="DB Pressure" subtitle="Connection pool utilisation" />
              <div className="chart-container" style={{ height: 200 }}>
                <span className="chart-simulated-label">[SIM]</span>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mockMetricsByTick} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="tick" stroke="var(--text-muted)" fontSize={10} tickLine={false} />
                    <YAxis stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} domain={[0, 110]} tickFormatter={(v) => `${v}%`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="db_pressure_pct" name="DB Pressure" stroke="var(--warning)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Gemma hypothesis */}
          {incident.hypotheses?.map((h) => (
            <div key={h.hypothesis_id} className="surface" style={{ padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <SectionHeading title="Incident Analysis" />
                <span className="hypothesis-banner">Gemma Hypothesis — Not Verified</span>
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.7, marginBottom: 16, backgroundColor: 'var(--bg-elevated)', borderLeft: '3px solid var(--warning)', padding: '12px 16px', borderRadius: '0 8px 8px 0' }}>
                {h.statement}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Supporting Evidence
                  </p>
                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {h.evidence.map((ev, i) => (
                      <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                        <span style={{ color: 'var(--warning)', flexShrink: 0 }}>↳</span>
                        {ev}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Confidence
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, height: 8, backgroundColor: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${h.confidence * 100}%`, backgroundColor: 'var(--warning)', borderRadius: 4 }} />
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--warning)' }}>
                      {Math.round(h.confidence * 100)}%
                    </span>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    Source: {h.source === 'gemma' ? 'Gemma 4 language model' : 'Heuristic baseline'}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4, fontWeight: 500 }}>
                    ⚠ This is a model hypothesis, not a confirmed root cause.
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'agents' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="surface" style={{ padding: 16 }}>
            <SectionHeading
              title="Agent Proposals"
              subtitle={`${mockProposals.length} proposals received · ${mockProposals.filter(p => p.status === 'approved').length} approved by coordinator`}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
              {mockProposals.map((p) => (
                <div
                  key={p.proposal_id}
                  style={{
                    padding: 16, backgroundColor: 'var(--bg-elevated)', borderRadius: 10,
                    border: `1px solid ${p.status === 'approved' ? 'var(--success)' : p.status === 'rejected' ? 'var(--danger)' : 'var(--border)'}`,
                  }}
                >
                  {/* Agent + status */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{p.agent}</span>
                    <StatusPill status={p.status ?? 'pending'} />
                  </div>
                  {/* Action */}
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{p.action_label}</p>
                  {/* Target */}
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                    Target: <span style={{ color: 'var(--text-secondary)' }}>{p.target_service}</span>
                  </p>
                  {/* Effect */}
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>{p.expected_effect}</p>
                  {/* Risk + confidence */}
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Risk</p>
                      <span style={{ fontSize: 12, fontWeight: 600, color: RISK_COLOR[p.risk] }}>{p.risk.toUpperCase()}</span>
                    </div>
                    <div style={{ width: 1, height: 28, backgroundColor: 'var(--border)' }} />
                    <div>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Confidence</p>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>{Math.round(p.confidence * 100)}%</span>
                    </div>
                    <div style={{ width: 1, height: 28, backgroundColor: 'var(--border)' }} />
                    <div>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>TTL</p>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)' }}>{p.ttl_ticks} ticks</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'timeline' && (
        <div className="surface" style={{ padding: 16 }}>
          <SectionHeading title="Event Timeline" subtitle="Chronological event stream (tick-ordered)" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {incident.timeline?.map((evt, i) => (
              <TimelineEvent key={evt.event_id} event={evt} isLast={i === (incident.timeline?.length ?? 1) - 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Timeline event row ─────────────────────────────────────────────────────────

function TimelineEvent({ event, isLast }: { event: CascadeEvent; isLast: boolean }) {
  const kindConfig: Record<string, { color: string; label: string; icon: string }> = {
    metric:       { color: 'var(--accent)',   label: 'Metric',     icon: '📊' },
    incident:     { color: 'var(--danger)',   label: 'Incident',   icon: '🚨' },
    proposal:     { color: 'var(--warning)',  label: 'Proposal',   icon: '💡' },
    decision:     { color: 'var(--accent)',   label: 'Decision',   icon: '⚖️' },
    execution:    { color: 'var(--success)',  label: 'Execution',  icon: '▶' },
    verification: { color: 'var(--success)',  label: 'Verified',   icon: '✓'  },
  };
  const cfg = kindConfig[event.kind] ?? kindConfig.metric;

  const summary = buildSummary(event);

  return (
    <div style={{ display: 'flex', gap: 16, paddingBottom: isLast ? 0 : 16 }}>
      {/* Timeline spine */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: `${cfg.color}22`, border: `1.5px solid ${cfg.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>
          {cfg.icon}
        </div>
        {!isLast && <div style={{ width: 1, flex: 1, backgroundColor: 'var(--border)', marginTop: 4 }} />}
      </div>

      {/* Content */}
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 4 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {cfg.label}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>tick:{event.tick}</span>
          {event.timestamp && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatDateTime(event.timestamp)}</span>
          )}
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{summary}</p>
      </div>
    </div>
  );
}

function buildSummary(event: CascadeEvent): string {
  const p = event.payload as unknown as Record<string, unknown>;
  switch (event.kind) {
    case 'metric':
      return `DB pressure: ${p.db_pressure_pct}% · Error rate: ${p.error_rate_pct}% · Throughput: ${p.throughput_rps} rps`;
    case 'incident':
      return `"${p.title}" (${p.severity}) affecting ${(p.affected_services as string[]).join(', ')}`;
    case 'proposal':
      return `${p.agent} proposed "${p.action}" on ${p.target_service} · risk: ${p.risk} · confidence: ${Math.round((p.confidence as number) * 100)}%`;
    case 'decision':
      return `Plan ${p.plan_id} was ${p.decision}. ${(p.reasons as string[])?.[0] ?? ''}`;
    case 'execution':
      return `Action "${p.action}" → ${p.step_status}. ${p.log_line ?? ''}`;
    case 'verification':
      return `Outcome: ${p.outcome} · Δ failed txns: ${p.delta_failed_txns} · Actual DB pressure: ${p.actual_db_pressure_pct}%`;
    default:
      return JSON.stringify(p).slice(0, 120);
  }
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    approved: ['var(--success)', 'var(--success-muted)'],
    rejected: ['var(--danger)',  'var(--danger-muted)'],
    pending:  ['var(--text-muted)', 'var(--bg-hover)'],
    expired:  ['var(--text-muted)', 'var(--bg-hover)'],
  };
  const [color, bg] = map[status] ?? map.pending;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color, backgroundColor: bg, padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {status}
    </span>
  );
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
