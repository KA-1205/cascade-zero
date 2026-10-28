'use client';
import { useState } from 'react';
import { actionListLabel } from '@/lib/labels';
import type { DecisionEvent, RunPolicy } from '@/types/api';

export function CombinationExplorer({ decisions, policy, currentTick }: {
  decisions: DecisionEvent[]; policy: RunPolicy; currentTick?: number;
}) {
  const [tickId, setTickId] = useState('');
  const recorded = decisions.filter(event => event.payload.combinations);
  const comparisons = recorded.filter(event => event.payload.combinations!.length > 1);
  const latest = comparisons.at(-1) ?? recorded.at(-1);
  const selected = recorded.find(event => event.event_id === tickId) ?? latest;
  const combinations = selected?.payload.combinations;
  const actions = [...new Set(combinations?.flatMap(item => item.actions) ?? [])];
  return <div className="combination-explorer">
    <div className="combination-context">
      <label>Evidence tick<select aria-label="Combination evidence tick" value={tickId} onChange={event => setTickId(event.target.value)}>
        <option value="">Latest proposal tick {latest?.tick ?? '—'}</option>
        {comparisons.slice().reverse().map(event => <option key={event.event_id} value={event.event_id}>Tick {event.tick} · {event.payload.combinations!.length} combinations</option>)}
      </select></label>
      <span>Current stream tick {currentTick ?? '—'}</span>
    </div>
    {combinations ? <>
      <div className="combination-summary"><strong>{combinations.length} combinations · {actions.length} proposed actions</strong><span>Evidence from tick {selected!.tick}</span>
        <p>{actions.length ? actionListLabel(actions) : 'No recovery actions proposed at this tick.'}</p>
        <small>All 2ⁿ action subsets are scored. Execution-order permutations are not evaluated.</small>
      </div>
      <div className="pane-scroll"><table className="data-table combination-table" aria-label="Live action combinations">
        <thead><tr><th>Action combination</th><th>Joint risk</th><th>Result</th></tr></thead>
        <tbody>{combinations.map((item, index) => <tr key={index} className={item.selected ? 'combination-selected' : ''}>
          <td>{actionListLabel(item.actions)}<details><summary>Risk evidence</summary><p>{item.reasons.join('; ') || 'No action risk.'}</p></details></td>
          <td>{item.predicted_risk.toFixed(2)}</td><td>{item.selected ? 'Selected' : item.safe ? 'Eligible' : 'Blocked'}</td>
        </tr>)}</tbody>
      </table></div>
    </> : <p className="detail-content muted">{policy === 'coordinated' || policy === 'ai_coordinated'
      ? decisions.length ? 'This saved run has no recorded combination scores. Generate a fresh incident to inspect them.' : 'Waiting for the first coordinator decision…'
      : 'This policy does not evaluate action subsets. Use Rule coordinator or AI planner for combination scoring.'}</p>}
  </div>;
}
