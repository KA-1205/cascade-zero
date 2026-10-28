'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { SCENARIO_LABEL, POLICY_LABEL } from '@/lib/labels';
import type { AdminStatus, Run, RunScenario } from '@/types/api';
export function AdminDashboard() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scenario, setScenario] = useState<RunScenario>('db_slowdown');
  const load = useCallback(async () => {
    try { const [next, history] = await Promise.all([api.getAdminStatus(), api.listRuns()]); setStatus(next); setRuns(history); setError(''); }
    catch (reason) { setStatus(null); setError(reason instanceof Error ? reason.message : 'Backend unavailable'); }
  }, []);
  useEffect(() => { const initial = setTimeout(load, 0); const timer = setInterval(load, 5000); return () => { clearTimeout(initial); clearInterval(timer); }; }, [load]);
  async function start() {
    setBusy(true); setError('');
    try { await api.createRun({ seed: Math.floor(Math.random() * 100000), scenario, policy: 'ai_coordinated', purpose: 'operator_review' }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Run creation failed'); }
    finally { setBusy(false); }
  }
  return <main className="console-page console-page--admin"><div className="page-heading"><div><h1>System & coordinator</h1><p>Backend status · refreshed every 5 seconds</p></div><button onClick={load}>Refresh status</button></div>
    {error && <div className="console-error" role="alert">{error}</div>}{!status && !error && <p role="status">Loading system status…</p>}
    {status && <><section className="metric-ribbon"><div><span>Backend</span><strong>{status.backend.state}</strong><small>Python API</small></div><div><span>Runs persisted</span><strong>{status.backend.runs_persisted ?? '—'}</strong><small>{status.runs.total} in memory</small></div><div><span>Live model decisions</span><strong>{status.ai_engine.live_decisions}</strong><small>{status.ai_engine.model}</small></div><div><span>Fallback decisions</span><strong>{status.ai_engine.fallback_decisions}</strong><small>Recorded by the coordinator</small></div></section>
    <div className="master-detail admin-grid"><section className="panel detail-pane"><header className="panel-heading"><h2>Engine & scenario inventory</h2><span>{Object.keys(status.scenarios).length} scenarios</span></header><div className="pane-scroll detail-content">
    <dl className="receipt-fields"><dt>Model</dt><dd>{status.ai_engine.model}</dd><dt>Provider credentials</dt><dd>{status.ai_engine.provider_configured ? 'Configured; availability is shown by decision outcomes' : 'Not configured; deterministic fallback'}</dd><dt>Running</dt><dd>{status.runs.by_state.running ?? 0}</dd><dt>Completed</dt><dd>{status.runs.by_state.completed ?? 0}</dd></dl>
    <h3>Fallback reasons</h3>{Object.entries(status.ai_engine.top_fallback_reasons).map(([reason,count]) => <p key={reason}>{reason} <strong>{count}</strong></p>)}{!Object.keys(status.ai_engine.top_fallback_reasons).length && <p>No fallback reasons recorded.</p>}
    <h3>Available scenarios</h3>{Object.entries(status.scenarios).map(([name,config]) => <div className="inventory-row" key={name}><strong>{SCENARIO_LABEL[name as RunScenario] ?? name}</strong><p>{config.actions_available.join(' · ')}</p></div>)}</div>
    <footer className="panel-actions"><label>Scenario<select value={scenario} onChange={e => setScenario(e.target.value as RunScenario)}>{Object.keys(status.scenarios).map(name => <option key={name} value={name}>{SCENARIO_LABEL[name as RunScenario] ?? name}</option>)}</select></label><button onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Start background simulation'}</button></footer></section>
    <section className="panel detail-pane"><header className="panel-heading"><h2>Run activity</h2><span>{runs.length} retained</span></header><div className="pane-scroll detail-content"><table className="data-table"><thead><tr><th>Scenario / seed</th><th>Policy</th><th>State</th><th>Failed</th></tr></thead><tbody>{runs.map(run => <tr key={run.id}><td><Link href={`/incidents/${run.id}`}>{SCENARIO_LABEL[run.scenario]}</Link><small>Seed {run.seed} · {run.created_at}</small></td><td>{POLICY_LABEL[run.policy]}</td><td>{run.state}</td><td>{run.metrics?.unique_failed ?? '—'}</td></tr>)}</tbody></table>{!runs.length && <p>No runs yet.</p>}</div></section></div></>}
  </main>;
}
