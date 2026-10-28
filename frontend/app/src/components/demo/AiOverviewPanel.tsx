import Link from 'next/link';
import { actionListLabel } from '@/lib/labels';
import type { DecisionEvent, Run } from '@/types/api';

export function AiOverviewPanel({ event, run }: { event?: DecisionEvent | null; run: Run }) {
  const info = event?.payload.ai;
  // A saved scenario label is not a diagnosis. Only the decision trace is evidence.
  const diagnosis = info?.diagnosis;
  return <section className="ai-overview-panel">
    <div className="ai-overview-head"><h2>Root cause analysis</h2>
      <span className="status-pill">{info ? info.live ? info.model : 'Rule fallback' : 'No diagnosis recorded'}</span>
    </div>
    <div className="ai-overview-grid">
      <div className="ai-diagnosis-copy">
        <h3>{diagnosis?.cause ?? 'Awaiting diagnostic evidence'}</h3>
        <p>{diagnosis?.rationale ?? 'This run has no planner diagnosis. Inspect the recorded telemetry and coordinator reasons.'}</p>
        {diagnosis && <div className="ai-diagnosis-facts"><span>{diagnosis.severity}</span><span>{Math.round(diagnosis.confidence * 100)}% model confidence</span><span>{diagnosis.affected.join(', ')}</span></div>}
      </div>
      <div className="ai-response-summary"><h3>{event ? actionListLabel(event.payload.actions) : 'No decision recorded'}</h3>
        <p>Joint risk: {event?.payload.predicted_risk ?? 'Unavailable'} · {run.state}</p>
        {info?.fallback_reason && <p>Fallback: {info.fallback_reason}</p>}
        <Link href={`/plans/${run.id}`}>Review recovery evidence →</Link>
      </div>
    </div>
  </section>;
}
