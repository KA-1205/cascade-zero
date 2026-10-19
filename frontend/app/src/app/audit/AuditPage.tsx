'use client';

import React, { useState, useMemo } from 'react';
import { SectionHeading, EmptyState, LoadingSkeleton } from '@/components/ui/primitives';
import { mockAuditRecords, MOCK_RUN_ID } from '@/lib/fixtures';
import type { AuditRecord, EventKind } from '@/types/api';

// ── Helpers ─────────────────────────────────────────────────────────────────────

const KIND_CONFIG: Record<EventKind, { color: string; label: string; icon: string; bg: string }> = {
  metric: { color: 'var(--accent)', label: 'Metric', icon: '📊', bg: 'var(--accent-muted)' },
  incident: { color: 'var(--danger)', label: 'Incident', icon: '🚨', bg: 'var(--danger-muted)' },
  proposal: { color: 'var(--warning)', label: 'Proposal', icon: '💡', bg: 'var(--warning-muted)' },
  decision: { color: 'var(--accent)', label: 'Decision', icon: '⚖️', bg: 'var(--accent-muted)' },
  execution: { color: 'var(--success)', label: 'Execution', icon: '▶', bg: 'var(--success-muted)' },
  verification: { color: 'var(--success)', label: 'Verified', icon: '✓', bg: 'var(--success-muted)' },
};

function formatDateTime(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function buildSummary(record: AuditRecord): string {
  const p = record.payload as unknown as Record<string, unknown>;
  switch (record.kind) {
    case 'metric':
      return `Service: ${p.service_id ?? '?'} — DB pressure: ${p.db_pressure_pct}%, Error rate: ${p.error_rate_pct}%, Throughput: ${p.throughput_rps} rps`;
    case 'incident':
      return `Incident "${p.title}" (${p.severity}) — affected: ${(p.affected_services as string[] | undefined)?.join(', ') ?? '?'}`;
    case 'proposal':
      return `Agent "${p.agent}" proposed "${p.action}" on ${p.target_service} — risk: ${p.risk}, confidence: ${Math.round(((p.confidence as number) ?? 0) * 100)}%`;
    case 'decision':
      return `Plan ${p.plan_id} → ${p.decision}. ${(p.reasons as string[])?.[0] ?? ''}`;
    case 'execution':
      return `Plan ${p.plan_id}: action "${p.action}" step ${p.step_index} → ${p.step_status}. ${p.log_line ?? ''}`;
    case 'verification':
      return `Plan ${p.plan_id}: outcome ${p.outcome}. Δ failed txns: ${p.delta_failed_txns}. Actual DB: ${p.actual_db_pressure_pct}%`;
    default:
      return JSON.stringify(p).slice(0, 120);
  }
}

// ── Detail drawer ───────────────────────────────────────────────────────────────

function RecordDrawer({ record, onClose }: { record: AuditRecord; onClose: () => void }) {
  const cfg = KIND_CONFIG[record.kind] ?? KIND_CONFIG.metric;
  const payload = record.payload as unknown as Record<string, unknown>;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, display: 'flex', justifyContent: 'flex-end', zIndex: 50,
      }}
      onClick={onClose}
      aria-label="Close detail panel"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440, height: '100%', overflowY: 'auto',
          backgroundColor: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border)',
          padding: 24, boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: cfg.bg, border: `1px solid ${cfg.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
              {cfg.icon}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {cfg.label}
              </div>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                tick:{record.tick}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Metadata table */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Metadata
          </div>
          {[
            { label: 'Event ID', value: record.event_id },
            { label: 'Run ID', value: record.run_id },
            { label: 'Tick', value: String(record.tick) },
            { label: 'Timestamp', value: formatDateTime(record.timestamp) },
            { label: 'Trace ID', value: record.trace_id ?? '—' },
            record.agent ? { label: 'Agent', value: record.agent } : null,
            record.action ? { label: 'Action', value: record.action } : null,
            record.decision ? { label: 'Decision', value: record.decision } : null,
          ].filter(Boolean).map((item) => (
            <div key={item!.label} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 100, flexShrink: 0 }}>{item!.label}</span>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{item!.value}</span>
            </div>
          ))}
        </div>

        {/* Payload */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Payload
          </div>
          <pre style={{
            backgroundColor: 'var(--bg-base)', borderRadius: 8, padding: '12px 14px',
            fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
            overflowX: 'auto', lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── Filter bar ─────────────────────────────────────────────────────────────────

interface Filters {
  kind: EventKind | 'all';
  search: string;
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const kinds: (EventKind | 'all')[] = ['all', 'metric', 'incident', 'proposal', 'decision', 'execution', 'verification'];

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <input
        type="text"
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        placeholder="Search events…"
        aria-label="Search audit records"
        style={{
          padding: '7px 14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 8, fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
          minWidth: 200,
        }}
      />
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {kinds.map((k) => {
          const cfg = k === 'all' ? null : KIND_CONFIG[k];
          const isActive = filters.kind === k;
          return (
            <button
              key={k}
              onClick={() => onChange({ ...filters, kind: k })}
              style={{
                padding: '5px 12px', borderRadius: 6, border: `1px solid ${isActive && cfg ? cfg.color : 'var(--border)'}`,
                backgroundColor: isActive && cfg ? cfg.bg : isActive ? 'var(--bg-elevated)' : 'transparent',
                color: isActive && cfg ? cfg.color : isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: 11, fontWeight: isActive ? 700 : 400,
                transition: 'all 0.1s ease',
              }}
            >
              {cfg ? `${cfg.icon} ${k}` : 'All'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Table row ───────────────────────────────────────────────────────────────────

function AuditRow({ record, onClick }: { record: AuditRecord; onClick: () => void }) {
  const cfg = KIND_CONFIG[record.kind] ?? KIND_CONFIG.metric;

  return (
    <tr
      onClick={onClick}
      className="card-hover"
      style={{ cursor: 'pointer', transition: 'background-color 0.1s ease' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'transparent'; }}
    >
      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          {record.tick}
        </span>
      </td>
      <td style={{ padding: '10px 14px' }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: cfg.color, backgroundColor: cfg.bg,
          padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
        }}>
          {cfg.icon} {cfg.label}
        </span>
      </td>
      <td style={{ padding: '10px 14px' }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, display: 'block', maxWidth: 500 }}>
          {buildSummary(record)}
        </span>
      </td>
      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
        {record.agent && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>
            {record.agent}
          </span>
        )}
      </td>
      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          {record.trace_id ?? '—'}
        </span>
      </td>
      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {formatDateTime(record.timestamp)}
        </span>
      </td>
    </tr>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────────

export function AuditPage() {
  const [filters, setFilters] = useState<Filters>({ kind: 'all', search: '' });
  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | null>(null);

  const records = mockAuditRecords;

  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (filters.kind !== 'all' && r.kind !== filters.kind) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const summary = buildSummary(r).toLowerCase();
        if (
          !summary.includes(q) &&
          !r.event_id.toLowerCase().includes(q) &&
          !(r.agent?.toLowerCase().includes(q)) &&
          !(r.trace_id?.toLowerCase().includes(q))
        ) return false;
      }
      return true;
    });
  }, [records, filters]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1600 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 6 }}>
            Audit Trail
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Immutable, chronological record of all coordinator decisions and execution events.
            {' '}<span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>Run: {MOCK_RUN_ID}</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{
            padding: '6px 12px', backgroundColor: 'var(--warning-muted)',
            border: '1px solid var(--warning)', borderRadius: 6,
            fontSize: 11, fontWeight: 700, color: 'var(--warning)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Simulated / Mock Data
          </div>
          <button
            style={{
              padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}
          >
            Export (Mock) ↓
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {Object.entries(KIND_CONFIG).map(([kind, cfg]) => {
          const count = records.filter((r) => r.kind === kind).length;
          return (
            <button
              key={kind}
              onClick={() => setFilters({ ...filters, kind: kind as EventKind })}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                backgroundColor: filters.kind === kind ? cfg.bg : 'var(--bg-surface)',
                border: `1px solid ${filters.kind === kind ? cfg.color : 'var(--border)'}`,
                borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s ease',
              }}
            >
              <span style={{ fontSize: 13 }}>{cfg.icon}</span>
              <span style={{ fontSize: 12, color: filters.kind === kind ? cfg.color : 'var(--text-secondary)' }}>{cfg.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: filters.kind === kind ? cfg.color : 'var(--text-muted)' }}>
                {count}
              </span>
            </button>
          );
        })}
        <button
          onClick={() => setFilters({ ...filters, kind: 'all' })}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            backgroundColor: filters.kind === 'all' ? 'var(--bg-elevated)' : 'var(--bg-surface)',
            border: `1px solid ${filters.kind === 'all' ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 8, cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 12, color: filters.kind === 'all' ? 'var(--accent)' : 'var(--text-secondary)' }}>All</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: filters.kind === 'all' ? 'var(--accent)' : 'var(--text-muted)' }}>
            {records.length}
          </span>
        </button>
      </div>

      {/* Filters */}
      <div className="surface" style={{ padding: 16 }}>
        <FilterBar filters={filters} onChange={setFilters} />
      </div>

      {/* Results info */}
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Showing <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{filtered.length}</span> of{' '}
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{records.length}</span> events
        {filters.search && (
          <span> matching <em>&ldquo;{filters.search}&rdquo;</em></span>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<span style={{ fontSize: 40 }}>🔍</span>}
          title="No events match your filter"
          description="Try adjusting the search or kind filter to see more results."
          action={
            <button
              onClick={() => setFilters({ kind: 'all', search: '' })}
              style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid var(--accent)', backgroundColor: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 13 }}
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <div className="surface" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }} aria-label="Audit trail events">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Tick', 'Kind', 'Summary', 'Agent', 'Trace ID', 'Timestamp'].map((h) => (
                    <th key={h} style={{
                      padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                      color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em',
                      whiteSpace: 'nowrap', backgroundColor: 'var(--bg-elevated)',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <AuditRow
                    key={record.event_id}
                    record={record}
                    onClick={() => setSelectedRecord(record)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selectedRecord && (
        <RecordDrawer
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
        />
      )}
    </div>
  );
}
