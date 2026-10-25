'use client';

import { useState } from 'react';
import {
  CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { CascadeEvent, MetricEvent } from '@/types/api';

/**
 * Incident timeline: backlog and error rate per simulator tick. Orange
 * verticals mark ticks where a recovery action actually executed.
 */
export function IncidentTelemetryChart({ events }: { events: CascadeEvent[] }) {
  const [showBacklog, setShowBacklog] = useState(true);
  const [showError, setShowError] = useState(true);
  const [showActions, setShowActions] = useState(true);

  const points = events
    .filter((event): event is MetricEvent => event.kind === 'metric')
    .map((event) => ({
      tick: event.tick,
      queue: event.payload.queue_depth ?? 0,
      error: Math.round((event.payload.error_rate ?? 0) * 1000) / 10,
    }));
  const actionTicks = [...new Set(events
    .filter((event) => event.kind === 'execution')
    .map((event) => event.tick))].sort((a, b) => a - b);

  if (points.length === 0) return null;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setShowBacklog((v) => !v)}
          style={{
            padding: '3px 9px',
            borderRadius: 'var(--radius-badge)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            border: '1px solid var(--border)',
            background: showBacklog ? 'var(--accent-muted)' : 'var(--bg-elevated)',
            color: showBacklog ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          {showBacklog ? '✓' : '○'} Backlog (Queue)
        </button>
        <button
          type="button"
          onClick={() => setShowError((v) => !v)}
          style={{
            padding: '3px 9px',
            borderRadius: 'var(--radius-badge)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            border: '1px solid var(--border)',
            background: showError ? 'rgba(185, 28, 28, 0.08)' : 'var(--bg-elevated)',
            color: showError ? 'var(--danger)' : 'var(--text-muted)',
          }}
        >
          {showError ? '✓' : '○'} Error Rate (%)
        </button>
        <button
          type="button"
          onClick={() => setShowActions((v) => !v)}
          style={{
            padding: '3px 9px',
            borderRadius: 'var(--radius-badge)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            border: '1px solid var(--border)',
            background: showActions ? 'rgba(154, 103, 0, 0.08)' : 'var(--bg-elevated)',
            color: showActions ? 'var(--warning)' : 'var(--text-muted)',
          }}
        >
          {showActions ? '✓' : '○'} Action Markers ({actionTicks.length})
        </button>
      </div>

      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis dataKey="tick" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} stroke="var(--border)"
                   label={{ value: 'tick', position: 'insideBottomRight', fontSize: 10, offset: -2 }} />
            <YAxis yAxisId="backlog" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} stroke="var(--border)"
                   label={{ value: 'backlog', angle: -90, position: 'insideLeft', fontSize: 10 }} />
            <YAxis yAxisId="error" orientation="right" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                   stroke="var(--border)" unit="%"
                   label={{ value: 'errors', angle: 90, position: 'insideRight', fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 12, background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {showActions && actionTicks.map((tick) => (
              <ReferenceLine key={tick} x={tick} yAxisId="error"
                             stroke="var(--warning)" strokeOpacity={0.7} />
            ))}
            {showBacklog && <Line yAxisId="backlog" dataKey="queue" name="Backlog (queued requests)"
                  stroke="var(--accent)" dot={false} strokeWidth={2} />}
            {showError && <Line yAxisId="error" dataKey="error" name="Error rate (%)"
                  stroke="var(--danger)" dot={false} strokeWidth={2} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
