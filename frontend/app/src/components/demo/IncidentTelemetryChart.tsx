'use client';

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
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.25)" />
          <XAxis dataKey="tick" tick={{ fontSize: 11 }} stroke="rgba(128,128,128,0.6)"
                 label={{ value: 'tick', position: 'insideBottomRight', fontSize: 10, offset: -2 }} />
          <YAxis yAxisId="backlog" tick={{ fontSize: 11 }} stroke="rgba(128,128,128,0.6)"
                 label={{ value: 'backlog', angle: -90, position: 'insideLeft', fontSize: 10 }} />
          <YAxis yAxisId="error" orientation="right" tick={{ fontSize: 11 }}
                 stroke="rgba(128,128,128,0.6)" unit="%"
                 label={{ value: 'errors', angle: 90, position: 'insideRight', fontSize: 10 }} />
          <Tooltip contentStyle={{ fontSize: 12, background: 'var(--bg-surface, #1c1c22)' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {actionTicks.map((tick) => (
            <ReferenceLine key={tick} x={tick} yAxisId="error"
                           stroke="#f5a524" strokeOpacity={0.45} />
          ))}
          <Line yAxisId="backlog" dataKey="queue" name="Backlog (queued requests)"
                stroke="#2a9fc0" dot={false} strokeWidth={2} />
          <Line yAxisId="error" dataKey="error" name="Error rate (%)"
                stroke="#e5484d" dot={false} strokeWidth={2} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
