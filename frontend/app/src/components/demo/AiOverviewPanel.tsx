import Link from 'next/link';
import { actionListLabel } from '@/lib/labels';
import type { DecisionEvent, Run } from '@/types/api';

const SCENARIO_RCA: Record<string, { cause: string; rationale: string; severity: string; confidence: number; affected: string[]; plan: string }> = {
  db_slowdown: {
    cause: 'Database Connection Pool Exhaustion & Worker Starvation',
    rationale: 'Shared DB connections peaked at capacity, causing queue backpressure and request timeouts across orders and payments.',
    severity: 'critical',
    confidence: 0.98,
    affected: ['database', 'orders'],
    plan: 'Dynamic connection pool expansion and non-critical query shedding',
  },
  payments_degradation: {
    cause: 'Payment Processor Downstream Latency Degradation',
    rationale: 'Downstream payment gateway latency escalated, holding worker threads hostage and propagating backpressure.',
    severity: 'high',
    confidence: 0.95,
    affected: ['payments', 'gateway'],
    plan: 'Targeted circuit-breaking, retry backoff damping, and ingress throttling',
  },
  traffic_surge: {
    cause: 'Ingress Traffic Surge (5x Baseline Capacity)',
    rationale: 'Request arrival rate exceeded gateway worker capacity, causing sudden queue backlog accumulation.',
    severity: 'high',
    confidence: 0.97,
    affected: ['gateway', 'orders', 'payments'],
    plan: 'Edge rate-limiting, replica scale-up, and graceful workload shedding',
  },
  telemetry_faults: {
    cause: 'Observability Telemetry Sensor Jitter & Missing Frames',
    rationale: 'Sensor readings arrived delayed or dropped; safety policy gated interventions until telemetry converged.',
    severity: 'medium',
    confidence: 0.91,
    affected: ['telemetry', 'database'],
    plan: 'Hold destructive actions pending multi-sensor consensus validation',
  },
};

export function AiOverviewPanel({ event, run }: { event?: DecisionEvent | null; run: Run }) {
  const info = event?.payload?.ai;
  const fallback = SCENARIO_RCA[run.scenario] || SCENARIO_RCA.db_slowdown;
  const diagnosis = info?.diagnosis || run.diagnosis || fallback;
  const actions = event?.payload?.actions || [];
  const planLabel = actions.length ? actionListLabel(actions) : (run.diagnosis?.mitigation_plan || fallback.plan);
  const source = info?.live
    ? `Model Proposal · ${info.model ?? 'configured provider'}`
    : 'Safety Policy Coordinator';

  return (
    <section className="ai-overview-panel" aria-labelledby="ai-overview-title">
      <div className="ai-overview-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 id="ai-overview-title" style={{ fontSize: 13, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
            Root Cause Analysis (RCA){event ? ` · Tick ${event.tick}` : ''}
          </h2>
        </div>
        <span className={`ai-provenance ${info?.live ? 'is-live' : 'is-fallback'}`}>
          <span aria-hidden="true" />{source}
        </span>
      </div>

      <div className="ai-overview-grid">
        <div className="ai-diagnosis-copy">
          <p className="ai-overview-label">Diagnosed Fault Condition</p>
          <h3>{diagnosis.cause}</h3>
          <p>{diagnosis.rationale}</p>
          <div className="ai-diagnosis-facts">
            <span>{diagnosis.severity.toUpperCase()} SEVERITY</span>
            <span>{Math.round(diagnosis.confidence * 100)}% CONFIDENCE</span>
            {diagnosis.affected?.length > 0 && <span>Affects {diagnosis.affected.join(', ')}</span>}
          </div>
        </div>

        <div className="ai-response-summary">
          <p className="ai-overview-label">Coordinated Mitigation Plan</p>
          <h3>{planLabel}</h3>
          <p>Joint Risk: <strong>{event?.payload?.predicted_risk ?? '0.00 (Guarded)'}</strong> · State: <strong>{run.state.toUpperCase()}</strong></p>
          <Link className="ai-response-link" href={`/incidents/${run.id}`}>Inspect telemetry and decision timeline →</Link>
        </div>
      </div>
    </section>
  );
}
