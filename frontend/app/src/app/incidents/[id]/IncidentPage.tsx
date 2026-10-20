'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { SeverityBadge, SectionHeading, LoadingSkeleton, ErrorState } from '@/components/ui/primitives';
import { api, isMockMode } from '@/lib/api';
// [SIM] display seeds, used in mock mode only. In live mode both series are
// built from the streamed SSE events (see the subscription below), so the
// page's runtime data flows exclusively through the unified `api` transport.
import { mockMetricsByTick, mockProposals } from '@/lib/fixtures';
import type {
  AgentProposal,
  CascadeEvent,
  Incident,
  IncidentPayload,
  MetricPayload,
  Plan,
  ProposalPayload,
  SseStatus,
  TickMetric,
} from '@/types/api';

// ─────────────────────────────────────────────────────────────────────────────
// Route param → runId alias (documented per decision D-0032)
//
// The contract has no /v1/incidents endpoint — the only incident-like data the
// real API exposes is GET /v1/runs/{run_id}/events (SSE) plus the streamed
// `incident` event itself. So `incidents/{id}` treats the route param as an
// ALIAS FOR THE RUN ID: it is passed straight to `api.getIncident(id)` (live
// transport: GET /v1/runs/{id}, mock transport: keyed fixtures) and to
// `api.subscribeToEvents(id, …)` (live transport: GET /v1/runs/{id}/events,
// mock transport: fixture replay). Header fields that only an incident event
// can supply (severity, status, affected services) stay blank until the first
// `incident` event arrives on the stream.
// ─────────────────────────────────────────────────────────────────────────────

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

// ── SSE connection indicator ─────────────────────────────────────────────────

const SSE_STATUS_META: Record<SseStatus, { label: string; color: string; bg: string; border: string; pulse: boolean }> = {
  connecting:   { label: 'Stream connecting…',               color: 'var(--text-muted)',  bg: 'var(--bg-hover)',       border: 'var(--border)',  pulse: false },
  connected:    { label: 'Connected',                         color: 'var(--success)',     bg: 'var(--success-muted)',  border: 'var(--success)', pulse: true },
  reconnecting: { label: 'Reconnecting (3s intervals)…',      color: 'var(--warning)',     bg: 'var(--warning-muted)',  border: 'var(--warning)', pulse: true },
  failed:       { label: 'Stream lost after 5 attempts',      color: 'var(--danger)',      bg: 'var(--danger-muted)',   border: 'var(--danger)',  pulse: false },
  closed:       { label: 'Stream closed',                     color: 'var(--text-muted)',  bg: 'var(--bg-hover)',       border: 'var(--border)',  pulse: false },
};

function ConnectionStatus({ status }: { status: SseStatus }) {
  const meta = SSE_STATUS_META[status];
  return (
    <span
      title={`SSE connection status: ${status}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
        color: meta.color, backgroundColor: meta.bg, border: `1px solid ${meta.border}`,
        borderRadius: 6, padding: '2px 8px',
      }}
    >
      {meta.pulse ? (
        <span className="live-dot" style={{ width: 6, height: 6 }} />
      ) : (
        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: meta.color, flexShrink: 0 }} />
      )}
      {meta.label}
    </span>
  );
}

// ── Event → view-model shapers ───────────────────────────────────────────────

/**
 * Unseen metric event → chart point. Dedup happens before this is called.
 *
 * The chart axis is percent, and the two payload families disagree on units:
 * fixture payloads carry percents directly (error_rate_pct, db_pressure_pct);
 * contract payloads carry fractions (error_rate, db_load) plus an arrivals
 * count. Contract fractions are scaled ×100 into the same axis.
 */
function metricPointFromEvent(event: CascadeEvent): TickMetric {
  const p = event.payload as MetricPayload & { error_rate?: number; db_load?: number; arrivals?: number };
  return {
    tick: event.tick,
    error_rate_pct: p.error_rate_pct ?? (p.error_rate != null ? p.error_rate * 100 : 0),
    db_pressure_pct: p.db_pressure_pct ?? (p.db_load != null ? p.db_load * 100 : 0),
    throughput_rps: p.throughput_rps ?? p.arrivals ?? 0,
  };
}

/** Unseen proposal event → agent proposal card (presentation model). */
function proposalFromEvent(event: CascadeEvent): AgentProposal {
  const p = event.payload as ProposalPayload;
  return { ...p, action_label: p.action, status: 'pending' };
}

/**
 * Unseen `incident` event → header update. The record's identity (id) and
 * started_at come from what the adapter already returned; content fields the
 * route/adapter cannot know (severity, status, affected services) come from
 * the stream.
 *
 * Contract incident payloads carry only `{phase}` — fields the payload does
 * not supply must keep their current values, never become undefined (decision
 * D-0039 follow-up: the first live incident event used to blank the header).
 */
function incidentHeaderFromEvent(current: Incident | null, event: CascadeEvent): Incident {
  const p = event.payload as Partial<IncidentPayload>;
  return {
    id: current?.id ?? event.run_id,
    run_id: event.run_id,
    title: p.title ?? current?.title ?? 'Untitled incident',
    severity: p.severity ?? current?.severity,
    status: p.status ?? current?.status,
    started_at: current?.started_at ?? event.timestamp,
    affected_services: p.affected_services ?? current?.affected_services,
    hypotheses: current?.hypotheses,
    timeline: current?.timeline,
  };
}

interface IncidentPageProps {
  id: string;
}

/**
 * Live mode turns a bare transport 404 into an actionable message: the route
 * param must be a real run id from POST /v1/runs — fixture ids like
 * INC-DEMO-001 exist only in mock mode. Non-404 errors pass through as-is.
 */
function liveRunMissingHint(runId: string, raw: string): string {
  if (!raw.includes('404')) return raw;
  return `Run "${runId}" was not found on the backend (404). In live mode the ` +
    'route param must be a real run id created via POST /v1/runs — fixture ' +
    'ids like INC-DEMO-001 exist only in mock mode. Use the "Create demo run" ' +
    'button on /incidents to start one.';
}

export function IncidentPage({ id }: IncidentPageProps) {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [events, setEvents] = useState<CascadeEvent[]>([]);
  const [metricSeries, setMetricSeries] = useState<TickMetric[]>(() =>
    isMockMode ? mockMetricsByTick : [],
  );
  const [proposals, setProposals] = useState<AgentProposal[]>(() =>
    isMockMode ? mockProposals : [],
  );
  const [sseStatus, setSseStatus] = useState<SseStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  // Real coordinator plans from GET /v1/runs/{run_id}/plans. In live mode these
  // carry the server-minted plan ids the approval endpoint knows about — the
  // SSE-derived proposals above are presentation records without plan ids.
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  // Dedup guard: mock mode replays exactly the fetched timeline (same event
  // ids), and in live mode the server may re-emit events across a reconnect —
  // either way an already-known event id must not be appended twice.
  const seenEventIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let disposed = false;

    const handleEvent = (event: CascadeEvent) => {
      if (seenEventIds.current.has(event.event_id)) return;
      seenEventIds.current.add(event.event_id);
      setEvents((prev) => [...prev, event]);
      if (event.kind === 'incident') {
        setIncident((current) => incidentHeaderFromEvent(current, event));
      } else if (event.kind === 'metric') {
        setMetricSeries((prev) => [...prev, metricPointFromEvent(event)]);
      } else if (event.kind === 'proposal') {
        setProposals((prev) => [...prev, proposalFromEvent(event)]);
      }
    };

    const handleError = (err: Error) => {
      if (!disposed) setError(err.message);
    };

    const handleStatus = (status: SseStatus) => {
      if (!disposed) setSseStatus(status);
    };

    async function load() {
      try {
        const data = await api.getIncident(id);
        if (disposed) return;
        setIncident(data);
        const seeded = data.timeline ?? [];
        setEvents(seeded);
        seenEventIds.current = new Set(seeded.map((evt) => evt.event_id));
        setError(null);
      } catch (err) {
        if (!disposed) {
          const raw = err instanceof Error ? err.message : 'Failed to load incident';
          setError(isMockMode ? raw : liveRunMissingHint(id, raw));
        }
      }
      // Plans load separately and non-fatally: a plans failure (e.g. run has
      // no plans yet) must not take down the whole incident view — the section
      // renders its own inline error instead.
      try {
        const planData = await api.listPlans(id);
        if (!disposed) {
          setPlans(planData);
          setPlansError(null);
        }
      } catch (err) {
        if (!disposed) {
          setPlansError(err instanceof Error ? err.message : 'Failed to load plans');
        }
      }
    }

    load();

    const unsubscribe = api.subscribeToEvents(id, handleEvent, handleError, handleStatus);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [id, retryNonce]);

  // Approve the plan via the fail-closed backend endpoint (decision D-0039).
  // The backend accepts only approved=true; a rejection is a 400 by contract,
  // so the UI offers Approve only. On success the plan list is refetched so the
  // card reflects the server's executed status rather than an optimistic guess.
  async function handleApprove(planId: string) {
    setApprovingId(planId);
    setPlansError(null);
    try {
      await api.approvePlan(planId, true);
      const refreshed = await api.listPlans(id);
      setPlans(refreshed);
    } catch (err) {
      setPlansError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setApprovingId(null);
    }
  }

  // Plans-error retry: re-fetches plans (not the whole page) so the section
  // recovers without tearing down the SSE subscription.
  async function handleRetryPlans() {
    try {
      const planData = await api.listPlans(id);
      setPlans(planData);
      setPlansError(null);
    } catch (err) {
      setPlansError(err instanceof Error ? err.message : 'Failed to load plans');
    }
  }

  if (!incident && !error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1400 }}>
        <LoadingSkeleton height={96} />
        <LoadingSkeleton height={400} />
      </div>
    );
  }

  if (!incident) {
    return (
      <div style={{ maxWidth: 1400 }}>
        <ErrorState message={error ?? undefined} onRetry={() => setRetryNonce((n) => n + 1)} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1400 }}>
      <PageBody
        incident={incident}
        events={events}
        metricSeries={metricSeries}
        proposals={proposals}
        plans={plans}
        plansError={plansError}
        approvingId={approvingId}
        onApprove={handleApprove}
        onRetryPlans={handleRetryPlans}
        sseStatus={sseStatus}
        error={error}
        onRetry={() => setRetryNonce((n) => n + 1)}
      />
    </div>
  );
}

// ── Page body (pure presentation once data/stream state exists) ──────────────

interface PageBodyProps {
  incident: Incident;
  events: CascadeEvent[];
  metricSeries: TickMetric[];
  proposals: AgentProposal[];
  plans: Plan[];
  plansError: string | null;
  approvingId: string | null;
  onApprove: (planId: string) => void;
  onRetryPlans: () => void;
  sseStatus: SseStatus;
  error: string | null;
  onRetry: () => void;
}

function PageBody({
  incident, events, metricSeries, proposals, plans, plansError, approvingId, onApprove,
  onRetryPlans, sseStatus, error, onRetry,
}: PageBodyProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'timeline'>('overview');

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'agents', label: 'Agent Proposals' },
    { key: 'timeline', label: 'Timeline' },
  ] as const;

  return (
    <>
      {error && (
        <ErrorState
          message={`Event stream: ${error}`}
          onRetry={sseStatus === 'failed' || sseStatus === 'closed' || sseStatus === 'reconnecting' ? onRetry : undefined}
        />
      )}

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
              {incident.severity ? (
                <SeverityBadge severity={incident.severity} />
              ) : (
                <span
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
                    color: 'var(--text-muted)', backgroundColor: 'var(--bg-hover)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '2px 8px',
                  }}
                >
                  Severity awaiting first incident event
                </span>
              )}
              <ConnectionStatus status={sseStatus} />
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
              {incident.started_at && (
                <span>Started: <span style={{ color: 'var(--text-secondary)' }}>{formatDateTime(incident.started_at)}</span></span>
              )}
              <span>Run: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{incident.run_id}</span></span>
              {incident.affected_services && (
                <span>
                  Affected:{' '}
                  {incident.affected_services.map((s) => (
                    <span key={s} style={{ marginRight: 4, padding: '1px 6px', backgroundColor: 'var(--bg-elevated)', borderRadius: 4, color: 'var(--accent)', fontSize: 12 }}>
                      {s}
                    </span>
                  ))}
                </span>
              )}
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
              <SectionHeading title="Error Rate" subtitle={isMockMode ? 'Simulation ticks' : 'Live stream ticks'} />
              <div className="chart-container" style={{ height: 200 }}>
                {isMockMode && <span className="chart-simulated-label">[SIM]</span>}
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={metricSeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
              <SectionHeading title="DB Pressure" subtitle={isMockMode ? 'Connection pool utilisation' : 'Connection pool utilisation (live)'} />
              <div className="chart-container" style={{ height: 200 }}>
                {isMockMode && <span className="chart-simulated-label">[SIM]</span>}
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={metricSeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
              subtitle={`${proposals.length} proposals received · ${proposals.filter(p => p.status === 'approved').length} approved by coordinator`}
            />
            {proposals.length === 0 ? (
              <EmptyStateInline />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
                {proposals.map((p) => (
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
            )}
          </div>

          {/* Real coordinator plans (GET /v1/runs/{run_id}/plans) with the
              fail-closed approval action (D-0039). Only `candidate` plans can
              be approved — the backend rejects everything else by contract. */}
          <div className="surface" style={{ padding: 16 }}>
            <SectionHeading
              title="Recovery Plans"
              subtitle="Coordinator plans eligible for approval · POST /v1/plans/{id}/approval (Bearer auth)"
            />
            {plansError && (
              <ErrorState message={`Plan approval: ${plansError}`} onRetry={onRetryPlans} />
            )}
            {plans.length === 0 && !plansError ? (
              <EmptyStateInline />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
                {plans.map((plan) => (
                  <div
                    key={plan.id}
                    style={{
                      padding: 16, backgroundColor: 'var(--bg-elevated)', borderRadius: 10,
                      border: `1px solid ${plan.status === 'executed' ? 'var(--success)' : plan.status === 'rejected' ? 'var(--danger)' : 'var(--border)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{plan.id}</span>
                      <StatusPill status={plan.status} />
                    </div>
                    <ul style={{ margin: '0 0 10px', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {plan.actions.map((action) => (
                        <li key={action} style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{action}</li>
                      ))}
                    </ul>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                      Predicted risk: <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{plan.predicted_risk.toFixed(2)}</span>
                    </p>
                    {plan.status === 'candidate' && (
                      <button
                        type="button"
                        onClick={() => onApprove(plan.id)}
                        disabled={approvingId !== null}
                        style={{
                          width: '100%', padding: '8px 12px', borderRadius: 6, border: 'none',
                          backgroundColor: approvingId === plan.id ? 'var(--bg-hover)' : 'var(--success)',
                          color: approvingId === plan.id ? 'var(--text-muted)' : '#fff',
                          fontSize: 13, fontWeight: 600, cursor: approvingId === plan.id ? 'wait' : 'pointer',
                        }}
                      >
                        {approvingId === plan.id ? 'Approving…' : 'Approve Plan'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'timeline' && (
        <div className="surface" style={{ padding: 16 }}>
          <SectionHeading title="Event Timeline" subtitle="Chronological event stream (tick-ordered)" />
          {events.length === 0 ? (
            <EmptyStateInline />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {events.map((evt, i) => (
                <TimelineEvent key={evt.event_id} event={evt} isLast={i === events.length - 1} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function EmptyStateInline() {
  return (
    <div style={{ padding: '24px 0', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
      Nothing received on the stream yet.
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

/**
 * Timeline row text. Composed from whichever fields are actually present:
 * fixture payloads (mock mode) and contract payloads (live mode) name their
 * fields differently, and a missing field must degrade the text, never throw —
 * an unguarded `.join` on a contract `incident` payload ({phase} only) used to
 * take down the whole timeline tab.
 */
function buildSummary(event: CascadeEvent): string {
  const p = event.payload as unknown as Record<string, unknown>;
  switch (event.kind) {
    case 'metric': {
      const parts: string[] = [];
      // Fixture payloads carry percents; contract payloads carry fractions.
      if (p.db_pressure_pct != null) parts.push(`DB pressure: ${p.db_pressure_pct}%`);
      else if (p.db_load != null) parts.push(`DB load: ${Math.round((p.db_load as number) * 100)}%`);
      if (p.error_rate_pct != null) parts.push(`Error rate: ${p.error_rate_pct}%`);
      else if (p.error_rate != null) parts.push(`Error rate: ${Math.round((p.error_rate as number) * 100)}%`);
      if (p.throughput_rps != null) parts.push(`Throughput: ${p.throughput_rps} rps`);
      else if (p.arrivals != null) parts.push(`Arrivals: ${p.arrivals}/tick`);
      if (p.latency != null) parts.push(`Latency: ${p.latency}ms`);
      if (p.queue_depth != null) parts.push(`Queue: ${p.queue_depth}`);
      return parts.length ? parts.join(' · ') : JSON.stringify(p).slice(0, 120);
    }
    case 'incident': {
      // Fixture payloads carry the full header; contract payloads only phase.
      const parts: string[] = [];
      if (p.phase != null) parts.push(`Phase: ${p.phase}`);
      if (p.title != null) {
        const services = Array.isArray(p.affected_services)
          ? (p.affected_services as string[]).join(', ')
          : null;
        parts.push(`"${p.title}"${p.severity ? ` (${p.severity})` : ''}${services ? ` · services: ${services}` : ''}`);
      }
      return parts.length ? parts.join(' · ') : JSON.stringify(p).slice(0, 120);
    }
    case 'proposal': {
      if (p.agent == null || p.action == null) return JSON.stringify(p).slice(0, 120);
      const confidence = p.confidence != null ? ` · confidence: ${Math.round((p.confidence as number) * 100)}%` : '';
      return `${p.agent} proposed "${p.action}" on ${p.target_service} · risk: ${p.risk}${confidence}`;
    }
    case 'decision': {
      // Fixture payloads name the plan; contract payloads carry the action list.
      if (p.plan_id != null) {
        return `Plan ${p.plan_id} was ${p.decision}. ${(p.reasons as string[])?.[0] ?? ''}`;
      }
      const actions = Array.isArray(p.actions) && (p.actions as string[]).length
        ? (p.actions as string[]).join(', ')
        : 'no actions';
      const risk = p.predicted_risk != null ? ` · predicted risk ${p.predicted_risk}` : '';
      const reason = (p.reasons as string[])?.[0];
      return `Proposed: ${actions}${risk}${reason ? ` — ${reason}` : ''}`;
    }
    case 'execution': {
      const target = p.target ?? p.target_service;
      const head = `Action "${p.action ?? 'unknown'}"${target != null ? ` on ${target}` : ''}`;
      const status = p.step_status != null ? ` → ${p.step_status}` : '';
      const tail = [p.log_line, p.agent_id != null ? `agent: ${p.agent_id}` : null]
        .filter(Boolean).join(' · ');
      return `${head}${status}${tail ? ` — ${tail}` : ''}`;
    }
    case 'verification':
      return `Outcome: ${p.outcome} · Δ failed txns: ${p.delta_failed_txns} · Actual DB pressure: ${p.actual_db_pressure_pct}%`;
    default:
      return JSON.stringify(p).slice(0, 120);
  }
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    approved: ['var(--success)', 'var(--success-muted)'],
    executed: ['var(--success)', 'var(--success-muted)'],
    rejected: ['var(--danger)',  'var(--danger-muted)'],
    candidate: ['var(--warning)', 'var(--warning-muted)'],
    delayed:  ['var(--warning)', 'var(--warning-muted)'],
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
