'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { actionListLabel } from '@/lib/labels';
import type { BacktestResult, Plan, Run } from '@/types/api';
const muted = { color: 'var(--text-muted)', fontSize: 12 };
const card = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 };
const chip = { fontSize: 11, padding: 4 };
export function PlansConsole({ plans, run, refresh }: { plans: Plan[]; run: Run; refresh: () => void }) {
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [operatorNotes, setOperatorNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [backtesting, setBacktesting] = useState<string | null>(null);
  const [backtests, setBacktests] = useState<Record<string, BacktestResult>>({});
  const candidatePlans = plans.filter(p => p.actions.length).sort((a,b) => (b.decision_tick ?? 0) - (a.decision_tick ?? 0));
  const selectedPlan = candidatePlans.find(p => p.id === selectedPlanId) ?? candidatePlans[0];
  const maxPlanTick = candidatePlans[0]?.decision_tick;
  const isLatestSelected = selectedPlan?.decision_tick === maxPlanTick;
  const approvedPlan = plans.find(p => p.status === 'approved' || p.status === 'executed' || p.status === 'delayed');
  async function decide(plan: Plan, approved: boolean) {
    if (busy || approvedPlan || plan.status !== 'candidate' || plan.decision_tick !== maxPlanTick) return;
    setBusy(true); setError('');
    try { await api.decidePlan(plan.id, approved, operatorNotes[plan.id]?.trim() ?? ''); refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Decision failed'); }
    finally { setBusy(false); }
  }
  const approve = (plan: Plan) => decide(plan, true);
  const reject = (plan: Plan) => decide(plan, false);
  async function backtest(plan: Plan) {
    setBacktesting(plan.id); setError('');
    try { const result = await api.backtestPlan(plan.id); setBacktests(prior => ({...prior, [plan.id]: result})); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Replay failed'); }
    finally { setBacktesting(null); }
  }
  return <div className="console-fill">
    {error && <p role="alert">{error}</p>}
<div className="plans-master-detail-layout">
              {/* Left Column: Master List of Plans */}
              <div className="plans-master-list">
                <div className="plans-list-header">
                  <strong>Recovery Plans</strong>
                  <span className="plans-count-badge">{candidatePlans.length} recommendations</span>
                </div>
                <div className="plans-scroll-list">
                  {candidatePlans.map((plan) => {
                    const isSelected = plan.id === selectedPlan?.id;
                    const isLatest = plan.decision_tick === maxPlanTick;
                    const isPlanApproved = plan.status === 'approved';
                    const isSuperseded = plan.status === 'superseded';
                    const displayStatus = isPlanApproved ? 'approved' : isSuperseded ? 'superseded' : plan.status;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => setSelectedPlanId(isLatest ? '' : plan.id)}
                        aria-pressed={isSelected}
                        className={`plan-item-row ${isSelected ? 'is-selected' : ''} ${isLatest ? 'is-latest' : ''}`}
                      >
                        <div className="plan-item-left">
                          <span className={`plan-tick-tag ${isLatest ? 'accent-color' : ''}`}>Tick {plan.decision_tick}</span>
                          <strong className="plan-item-action">{actionListLabel(plan.actions)}</strong>
                          <span className="plan-item-meta">Risk {plan.predicted_risk} · {plan.ai ? (plan.ai.live ? 'AI Model' : 'Coordinator') : 'Rule'}</span>
                        </div>
                        <span className={`plan-status-pill status-${displayStatus}`}>
                          {displayStatus.toUpperCase()}
                        </span>
                      </button>
                    );
                  })}
                  {!candidatePlans.length && <p style={{ ...muted, padding: 14 }}>No candidate plans found for this incident.</p>}
                </div>
              </div>

              {/* Right Column: Plan Evidence & Operator Action Console */}
              <div className="plans-detail-pane">
                {selectedPlan ? (
                  <div className="plan-evidence-card">
                    <div className="plan-detail-header">
                      <div>
                        <span className="plan-tick-badge">TICK {selectedPlan.decision_tick} RECOMMENDATION</span>
                        <h2>{actionListLabel(selectedPlan.actions)}</h2>
                        <p style={{ ...muted, margin: '2px 0 0' }}>
                          Evaluated by {selectedPlan.ai ? (selectedPlan.ai.live ? `Model Proposal (${selectedPlan.ai.model})` : 'Deterministic Safety Coordinator') : 'Deterministic Rule Coordinator'}
                        </p>
                      </div>
                      <span className={`plan-status-pill status-${selectedPlan.status}`}>
                        {(selectedPlan.status).toUpperCase()}
                      </span>
                    </div>

                    <div className="pane-scroll plan-evidence-scroll"><div className="plan-evidence-grid">
                      <div className="evidence-block">
                        <h4>DIAGNOSED TRIGGER</h4>
                        <p>{selectedPlan.ai?.diagnosis?.cause ?? 'No diagnosis recorded for this decision'}</p>
                        <small style={muted}>{selectedPlan.ai?.diagnosis?.rationale ?? 'Review the coordinator reasons below.'}</small>
                      </div>

                      <div className="evidence-block">
                        <h4>SAFETY INVARIANTS</h4>
                        <div className="invariant-score">
                          Joint Risk Score: <strong>{selectedPlan.predicted_risk}</strong>
                        </div>
                        <ul className="evidence-reasons">
                          {selectedPlan.reasons.map((r, i) => <li key={i}>{r}</li>)}
                          {selectedPlan.ai?.safety_reasons?.map((r, i) => <li key={`s-${i}`}>{r}</li>)}
                        </ul>
                      </div>
                    </div>

                    <section className="combination-evidence"><h3>Evaluated action combinations</h3>
                      {selectedPlan.combinations ? <><p className="muted">{selectedPlan.combinations.length} subsets scored at this tick. These are joint-risk estimates, not measured outcomes or action-order permutations.</p>
                      <table className="data-table" aria-label="Evaluated action combinations"><thead><tr><th>Combination</th><th>Joint risk</th><th>Assessment</th></tr></thead><tbody>{selectedPlan.combinations.map((item, index) => <tr key={index}><td>{actionListLabel(item.actions)}<small>{item.reasons.join('; ') || 'No action risk'}</small></td><td>{item.predicted_risk}</td><td>{item.selected ? 'Selected' : item.safe ? 'Eligible' : 'Blocked'}</td></tr>)}</tbody></table></> : <p className="muted">Combination scores were not recorded for this older run. Start a fresh incident to inspect them.</p>}
                    </section>
                    {/* Backtest replay outcome if available */}
                    {(() => {
                      const res = backtests[selectedPlan.id] ?? selectedPlan.backtest;
                      if (!res) return null;
                      return <BacktestVerdict result={res} />;
                    })()}

                    </div>
                    {/* Operator Decision Action Area */}
                    <div className="plan-operator-gate">
                      {selectedPlan.status === 'approved' ? (
                        <div className="approval-receipt-box">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--success)', fontWeight: 700 }}>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="2"/><path d="M5 8.5L7 10.5L11 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                            Plan Approved by Authenticated Operator
                          </div>
                          <p style={{ margin: '4px 0 2px', fontSize: 12 }}>Operator Rationale: <em>{selectedPlan.operator_reason || 'No rationale supplied'}</em></p>
                          <small style={muted}>{selectedPlan.execution?.replayed ? 'Local replay completed' : 'Replay not confirmed'} · {selectedPlan.decided_at ?? 'Timestamp unavailable'}</small>
                        </div>
                      ) : approvedPlan || selectedPlan.status !== 'candidate' ? (
                        <div className="superseded-notice-box">
                          <strong>🔒 Incident Run Decided</strong>
                          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                            {approvedPlan ? `Tick ${approvedPlan.decision_tick} was approved. Alternative candidates are locked.` : `This plan is ${selectedPlan.status}. No further decision is available.`}
                          </p>
                        </div>
                      ) : !isLatestSelected ? <p className="muted">Historical tick · what-if simulation only. Select the latest recommendation to approve or reject.</p> : (
                        <div className="approval-form">
                          <input
                            type="text"
                            aria-label="Operator decision rationale" placeholder="Operator decision rationale (e.g. Verified database connection headroom)..."
                            value={operatorNotes[selectedPlan.id] || ''}
                            onChange={(e) => setOperatorNotes({ ...operatorNotes, [selectedPlan.id]: e.target.value })}
                            className="operator-note-input"
                          />
                          <div className="approval-actions-row">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => approve(selectedPlan)}
                              className="approve-primary-btn"
                            >
                              ✓ Approve Plan Replay
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => reject(selectedPlan)}
                              className="reject-btn"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="approval-actions-row">
                            <button
                              type="button"
                              disabled={busy || backtesting === selectedPlan.id}
                              onClick={() => backtest(selectedPlan)}
                              className="backtest-lab-btn"
                            >
                              {backtesting === selectedPlan.id ? 'Replaying...' : 'Simulate What-If Impact'}
                            </button>
                            <Link href={`/experiments?run=${encodeURIComponent(run.id)}&plan=${encodeURIComponent(selectedPlan.id)}`} className="lab-link">
                              Open in Experiment Lab →
                            </Link>

                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ ...card, padding: 24, textAlign: 'center' }}>
                    <p style={muted}>Select a plan from the list to review decision evidence.</p>
                  </div>
                )}
              </div>
            </div>
</div>;
}
export function BacktestVerdict({ result }: { result: BacktestResult }) {
  const good = result.verdict === 'better';
  const bad = result.verdict === 'worse';
  const color = good ? 'var(--success)' : bad ? 'var(--danger)' : 'var(--text-muted)';
  const delta = result.delta_failed;
  return (
    <div style={{ marginTop: 10, padding: 12, border: `1px solid ${color}`, borderRadius: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ ...chip, color, border: `1px solid ${color}` }}>
          LAB REPLAY: {result.verdict.toUpperCase()}
        </strong>
        <span style={{ color, fontWeight: 700 }}>
          {delta === 0 ? 'same failed transaction count' : `${delta > 0 ? '+' : ''}${delta.toLocaleString()} failed transactions vs doing nothing`}
        </span>
        <span style={muted}>
          {result.plan_failed.toLocaleString()} failed with the plan vs {result.baseline_failed.toLocaleString()} with no action · seed {result.seed} · {result.arms[0].horizon_ticks} ticks · single decision at tick {result.decision_tick}
        </span>
      </div>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, textAlign: 'left', width: '100%' }}>
          <thead><tr style={{ color: 'var(--text-muted)' }}>
            <th style={{ padding: '4px 14px 4px 0' }}>Replay arm</th>
            <th style={{ padding: '4px 14px 4px 0' }}>Failed</th>
            <th style={{ padding: '4px 14px 4px 0' }}>Succeeded</th>
            <th style={{ padding: '4px 14px 4px 0' }}>Peak backlog</th>
            <th style={{ padding: '4px 14px 4px 0' }}>Actions</th>
          </tr></thead>
          <tbody>{result.arms.map((arm, index) => (
            <tr key={index} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: 4 }}>{arm.actions.length ? actionListLabel(arm.actions) : 'No action (baseline)'}</td>
              <td style={{ padding: 4, color: index === 1 ? color : undefined, fontWeight: index === 1 ? 700 : undefined }}>{arm.unique_failed.toLocaleString()}</td>
              <td style={{ padding: 4 }}>{arm.unique_succeeded.toLocaleString()}</td>
              <td style={{ padding: 4 }}>{arm.max_queue_depth.toLocaleString()}</td>
              <td style={{ padding: 4 }}>{arm.actions_executed}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
