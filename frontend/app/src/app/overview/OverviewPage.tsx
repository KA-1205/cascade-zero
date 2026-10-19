'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { MetricCard, SeverityBadge, SectionHeading, LoadingSkeleton, EmptyState } from '@/components/ui/primitives';
import { ServiceGraph } from '@/components/topology/ServiceGraph';
import { mockRun, mockTopology, mockMetricsByTick, mockIncident, mockProposals } from '@/lib/fixtures';

// ── Custom tooltip for recharts ────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: number }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 6 }}>Tick {label}</div>
      {payload.map((entry) => (
        <div key={entry.name} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: entry.color, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: 'var(--text-secondary)' }}>{entry.name}:</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>{entry.value}%</span>
        </div>
      ))}
    </div>
  );
}

export function OverviewPage() {
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const run = mockRun;
  const metrics = run.metrics!;

  const selectedNode = selectedService
    ? mockTopology.nodes.find((n) => n.id === selectedService)
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1600 }}>
      {/* ── Page heading ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Infrastructure Overview
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Scenario: <span style={{ color: 'var(--accent)', fontWeight: 500 }}>db_slowdown</span>
            {' · '}Seed: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{run.seed}</span>
            {' · '}Policy: <span style={{ color: 'var(--accent)', fontWeight: 500 }}>coordinated</span>
          </p>
        </div>
        {/* Global health pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            backgroundColor: 'var(--warning-muted)',
            border: '1px solid var(--warning)',
            borderRadius: 999,
            fontSize: 13,
            color: 'var(--warning)',
            fontWeight: 600,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--warning)', display: 'inline-block' }} />
          Degraded
        </div>
      </div>

      {/* ── KPI cards ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        <MetricCard
          label="Error Rate"
          value={metrics.error_rate_pct ?? 0}
          unit="%"
          status="danger"
          trend="up"
          trendValue="+26pp"
          description="Percentage of requests returning 5xx errors"
        />
        <MetricCard
          label="DB Pressure"
          value={metrics.db_pressure_pct ?? 0}
          unit="%"
          status="danger"
          trend="up"
          trendValue="+45pp"
          description="Database connection pool utilisation"
        />
        <MetricCard
          label="Throughput"
          value={metrics.throughput_rps ?? 0}
          unit="rps"
          status="warning"
          trend="down"
          trendValue="-110"
          description="Requests per second served"
        />
        <MetricCard
          label="p95 Latency"
          value={((metrics.latency_p95_ms ?? 0) / 1000).toFixed(1)}
          unit="s"
          status="danger"
          trend="up"
          trendValue="+2.05s"
          description="95th percentile request latency"
        />
        <MetricCard
          label="Failed Txns"
          value={metrics.unique_failed_txns ?? 0}
          unit="unique"
          status="danger"
          description="Unique user transactions that failed"
        />
        <MetricCard
          label="Services"
          value={mockTopology.nodes.length}
          status="muted"
          description="Total monitored services"
          simulated={false}
        />
      </div>

      {/* ── Main grid: topology + chart ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minHeight: 400 }}>
        {/* Service topology */}
        <div className="surface" style={{ padding: 16, display: 'flex', flexDirection: 'column' }}>
          <SectionHeading
            title="Service Dependency Graph"
            subtitle="Click a service node to inspect its health"
          />
          <div style={{ flex: 1, minHeight: 320 }}>
            <ServiceGraph
              topology={mockTopology}
              selectedId={selectedService}
              onSelect={setSelectedService}
            />
          </div>
        </div>

        {/* Selected service detail OR metric chart */}
        <div className="surface" style={{ padding: 16, display: 'flex', flexDirection: 'column' }}>
          {selectedNode ? (
            <>
              <SectionHeading
                title={selectedNode.label ?? selectedNode.id}
                subtitle={`${selectedNode.type} · capacity: ${selectedNode.capacity} connections`}
                actions={
                  <button
                    onClick={() => setSelectedService(null)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
                    aria-label="Close service detail"
                  >
                    ✕ Close
                  </button>
                }
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <MetricCard
                    label="Load"
                    value={selectedNode.current_load ?? '-'}
                    unit="/ 100"
                    status={
                      (selectedNode.current_load ?? 0) > 90 ? 'danger' :
                      (selectedNode.current_load ?? 0) > 70 ? 'warning' : 'healthy'
                    }
                  />
                  <MetricCard
                    label="Capacity"
                    value={selectedNode.capacity}
                    status="muted"
                  />
                </div>
                <div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Connections</p>
                  <div style={{ height: 8, backgroundColor: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(((selectedNode.current_load ?? 0) / selectedNode.capacity) * 100, 100)}%`,
                        backgroundColor:
                          (selectedNode.current_load ?? 0) / selectedNode.capacity > 0.9 ? 'var(--danger)' :
                          (selectedNode.current_load ?? 0) / selectedNode.capacity > 0.7 ? 'var(--warning)' : 'var(--success)',
                        borderRadius: 4,
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {selectedNode.current_load} / {selectedNode.capacity} ({Math.round(((selectedNode.current_load ?? 0) / selectedNode.capacity) * 100)}%)
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Health status</p>
                  <SeverityBadge severity={
                    selectedNode.health === 'critical' ? 'critical' :
                    selectedNode.health === 'degraded' ? 'high' : 'low'
                  } />
                </div>
                <div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Outbound connections</p>
                  {mockTopology.edges
                    .filter((e) => e.from === selectedNode.id)
                    .map((edge) => (
                      <div
                        key={edge.to}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          backgroundColor: 'var(--bg-elevated)',
                          borderRadius: 6,
                          marginBottom: 4,
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: 'var(--text-secondary)' }}>→ {edge.to}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', color: edge.latency_ms && edge.latency_ms > 500 ? 'var(--danger)' : 'var(--text-muted)' }}>
                          {edge.latency_ms}ms · {edge.throughput} rps
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <SectionHeading
                title="Error Rate & DB Pressure"
                subtitle="Simulation ticks (1 tick ≈ 1 sim second)"
              />
              <div className="chart-container" style={{ flex: 1, minHeight: 280 }}>
                <span className="chart-simulated-label">[SIMULATED]</span>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mockMetricsByTick} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="tick"
                      stroke="var(--text-muted)"
                      fontSize={11}
                      tickLine={false}
                      label={{ value: 'Simulation tick', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 10 }}
                    />
                    <YAxis
                      stroke="var(--text-muted)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${v}%`}
                      domain={[0, 110]}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine y={100} stroke="var(--danger)" strokeDasharray="4 4" label={{ value: 'Capacity limit', fill: 'var(--danger)', fontSize: 10, position: 'right' }} />
                    <Line type="monotone" dataKey="error_rate_pct" name="Error Rate" stroke="var(--danger)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'var(--danger)' }} />
                    <Line type="monotone" dataKey="db_pressure_pct" name="DB Pressure" stroke="var(--warning)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'var(--warning)' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Active incidents ──────────────────────────────────────────────────── */}
      <div className="surface" style={{ padding: 16 }}>
        <SectionHeading
          title="Active Incidents"
          actions={
            <Link href="/incidents" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
              View all →
            </Link>
          }
        />
        <Link
          href={`/incidents/${mockIncident.id}`}
          style={{ textDecoration: 'none' }}
          aria-label={`Incident: ${mockIncident.title}`}
        >
          <div
            className="card-hover"
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto auto',
              gap: 16,
              alignItems: 'center',
              padding: '14px 16px',
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: 10,
              border: '1px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            {/* Severity indicator */}
            <div style={{ width: 4, height: 40, backgroundColor: 'var(--danger)', borderRadius: 2 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                {mockIncident.title}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                  {mockIncident.id}
                </span>
                <span style={{ color: 'var(--border)' }}>·</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Started {formatRelative(mockIncident.started_at!)}
                </span>
                <span style={{ color: 'var(--border)' }}>·</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {mockIncident.affected_services!.join(', ')}
                </span>
              </div>
            </div>
            <SeverityBadge severity={mockIncident.severity!} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--danger)', fontSize: 12 }}>
              <span className="live-dot" />
              <span>Active</span>
            </div>
          </div>
        </Link>
      </div>

      {/* ── Agent activity & recent decisions ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Agent proposals */}
        <div className="surface" style={{ padding: 16 }}>
          <SectionHeading title="Agent Proposals" subtitle="Recovery actions submitted this run" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mockProposals.slice(0, 4).map((p) => (
              <div
                key={p.proposal_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  backgroundColor: 'var(--bg-elevated)',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                }}
              >
                {/* Agent avatar */}
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    backgroundColor: 'var(--bg-hover)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: 14,
                  }}
                >
                  {agentEmoji(p.agent)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.action_label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.agent} → {p.target_service}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                  <StatusBadge status={p.status ?? 'pending'} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, textAlign: 'right' }}>
            <Link href={`/plans/${mockIncident.run_id}`} style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
              View recovery plans →
            </Link>
          </div>
        </div>

        {/* Recent decisions */}
        <div className="surface" style={{ padding: 16 }}>
          <SectionHeading title="Recovery Decisions" subtitle="Most recent coordinator outputs" />
          {mockIncident.timeline
            ?.filter((e) => e.kind === 'decision' || e.kind === 'execution' || e.kind === 'verification')
            .slice(0, 5)
            .map((evt) => (
              <div
                key={evt.event_id}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border-subtle)',
                  alignItems: 'flex-start',
                }}
              >
                <EventKindIcon kind={evt.kind} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    <EventDescription event={evt} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                    tick:{evt.tick}
                  </div>
                </div>
              </div>
            ))}
          <div style={{ marginTop: 10, textAlign: 'right' }}>
            <Link href="/audit" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
              Full audit trail →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function agentEmoji(agent: string) {
  if (agent.includes('retry') || agent.includes('throttle')) return '🔁';
  if (agent.includes('scal')) return '📈';
  if (agent.includes('restart')) return '🔄';
  return '🤖';
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; bg: string; label: string }> = {
    approved: { color: 'var(--success)', bg: 'var(--success-muted)', label: 'Approved' },
    rejected: { color: 'var(--danger)', bg: 'var(--danger-muted)', label: 'Rejected' },
    pending: { color: 'var(--text-muted)', bg: 'var(--bg-hover)', label: 'Pending' },
    expired: { color: 'var(--text-muted)', bg: 'var(--bg-hover)', label: 'Expired' },
  };
  const c = config[status] ?? config.pending;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color: c.color, backgroundColor: c.bg, padding: '2px 6px', borderRadius: 4 }}>
      {c.label}
    </span>
  );
}

import type { CascadeEvent } from '@/types/api';

function EventKindIcon({ kind }: { kind: string }) {
  const icons: Record<string, { icon: string; color: string }> = {
    metric: { icon: '📊', color: 'var(--accent)' },
    incident: { icon: '🚨', color: 'var(--danger)' },
    proposal: { icon: '💡', color: 'var(--warning)' },
    decision: { icon: '⚖️', color: 'var(--accent)' },
    execution: { icon: '▶️', color: 'var(--success)' },
    verification: { icon: '✅', color: 'var(--success)' },
  };
  const c = icons[kind] ?? icons.metric;
  return <span style={{ fontSize: 14, lineHeight: 1 }}>{c.icon}</span>;
}

function EventDescription({ event }: { event: CascadeEvent }) {
  if (event.kind === 'decision') {
    const p = event.payload as { plan_id: string; decision: string };
    return <span>Plan <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{p.plan_id}</code> {p.decision}</span>;
  }
  if (event.kind === 'execution') {
    const p = event.payload as { action: string; step_status: string };
    return <span>Action <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{p.action}</code> → {p.step_status}</span>;
  }
  if (event.kind === 'verification') {
    const p = event.payload as { outcome: string; delta_failed_txns: number };
    return <span>Verification: {p.outcome} (Δ failed txns: {p.delta_failed_txns})</span>;
  }
  return <span>{event.kind} event</span>;
}

function formatRelative(iso?: string) {
  if (!iso) return 'unknown';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}
