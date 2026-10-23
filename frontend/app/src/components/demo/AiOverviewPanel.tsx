import Link from 'next/link';
import { actionListLabel } from '@/lib/labels';
import type { DecisionEvent, Run } from '@/types/api';

export function AiOverviewPanel({ event, run }: { event: DecisionEvent; run: Run }) {
  const info = event.payload.ai;
  if (!info) return null;

  const diagnosis = info.diagnosis;
  const actions = event.payload.actions;
  const source = info.live
    ? `Live model · ${info.model ?? 'configured provider'}`
    : 'Deterministic rule fallback';

  return (
    <section className="ai-overview-panel" aria-labelledby="ai-overview-title">
      <div className="ai-overview-head">
        <div>
          <p className="ai-overview-eyebrow">AI DECISION BRIEF · TICK {event.tick}</p>
          <h2 id="ai-overview-title">What the planner sees</h2>
        </div>
        <span className={`ai-provenance ${info.live ? 'is-live' : 'is-fallback'}`}>
          <span aria-hidden="true" />{source}
        </span>
      </div>

      <div className="ai-overview-grid">
        <div className="ai-diagnosis-copy">
          <p className="ai-overview-label">Likely cause</p>
          <h3>{diagnosis?.cause ?? 'No separate diagnosis returned'}</h3>
          <p>{diagnosis?.rationale ?? info.fallback_reason ?? 'The planner held recovery actions for this decision.'}</p>
          {diagnosis && (
            <div className="ai-diagnosis-facts">
              <span>{diagnosis.severity} severity</span>
              <span>{Math.round(diagnosis.confidence * 100)}% confidence</span>
              {diagnosis.affected.length > 0 && <span>Affects {diagnosis.affected.join(', ')}</span>}
            </div>
          )}
        </div>

        <div className="ai-response-summary">
          <p className="ai-overview-label">Proposed response</p>
          <h3>{actionListLabel(actions)}</h3>
          <p>Joint risk estimate <strong>{event.payload.predicted_risk}</strong></p>
          <Link className="ai-response-link" href={`/incidents/${run.id}`}>Open telemetry and decision trace <span aria-hidden="true">→</span></Link>
        </div>
      </div>

      <p className="ai-simulation-note">
        Generated telemetry · no service changed · operator review remains in control
      </p>
    </section>
  );
}
