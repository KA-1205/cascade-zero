'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { POLICIES, POLICY_LABEL, SCENARIO_LABEL } from '@/lib/labels';
import type { Plan, Run, BacktestResult } from '@/types/api';
import { BacktestVerdict } from './PlansConsole';

export function ExperimentLab({ runs, run, plans, planId, select, refresh }: {
  runs: Run[]; run: Run; plans: Plan[]; planId?: string; select: (id: string) => void; refresh: () => void;
}) {
  const [search, setSearch] = useState('');
  const visibleRuns = runs.filter(item => `${SCENARIO_LABEL[item.scenario]} ${item.seed} ${POLICY_LABEL[item.policy]}`.toLowerCase().includes(search.toLowerCase()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BacktestResult | null>(null);
  const matched = runs.filter(r => r.seed === run.seed && r.scenario === run.scenario && r.purpose === 'policy_comparison');
  const baseline = matched.find(r => r.policy === 'none');
  const candidate = planId ? plans.find(p => p.id === planId) : plans.find(p => p.actions.length && p.status === 'candidate');
  const replay = result?.run_id === run.id ? result : candidate?.backtest;
  async function compare() {
    setBusy(true); setError('');
    try {
      await Promise.all(POLICIES.map(async policy => {
        let current = await api.createRun({ seed: run.seed, scenario: run.scenario, policy, purpose: 'policy_comparison' });
        const deadline = Date.now() + 120000;
        while (current.state === 'running') {
          if (Date.now() > deadline) throw new Error('Comparison is still running. Refresh history to check progress.');
          await new Promise(resolve => setTimeout(resolve, 1500));
          current = await api.getRun(current.id);
        }
        if (current.state === 'failed') throw new Error(current.failed_reason ?? 'Comparison failed');
      }));
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Comparison failed'); }
    finally { setBusy(false); }
  }
  async function backtest() {
    if (!candidate) return;
    setBusy(true); setError('');
    try { setResult(await api.backtestPlan(candidate.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Replay failed'); }
    finally { setBusy(false); }
  }
  const fmt = (value?: number) => value === undefined ? '—' : value.toLocaleString();
  return <div className="master-detail">
    <section className="panel master-pane"><header className="panel-heading"><h2>Experiment history</h2><span>{runs.length} runs</span></header>
      <input className="history-search" aria-label="Filter experiment history" placeholder="Search scenario, seed or policy" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="pane-scroll">{visibleRuns.map(item => <button className={`master-row ${item.id === run.id ? 'is-selected' : ''}`} key={item.id} aria-pressed={item.id === run.id} onClick={() => select(item.id)}>
        <strong>{SCENARIO_LABEL[item.scenario]}</strong><span>Seed {item.seed} · {POLICY_LABEL[item.policy]}</span><small>{item.state} · {item.purpose?.replaceAll('_', ' ') ?? 'Purpose unavailable'}</small>
      </button>)}</div>
    </section>
    <section className="panel detail-pane"><header className="panel-heading"><h2>Policy outcomes</h2><span>Seed {run.seed} · {SCENARIO_LABEL[run.scenario]}</span></header>
      <div className="pane-scroll detail-content">
        <p>Latest backend result per policy for this seed and scenario. Recovery is measured in simulator ticks; unavailable measurements stay blank.</p>
        {error && <p role="alert">{error}</p>}
        <table className="data-table" aria-label="Policy comparison"><thead><tr><th>Policy</th><th>Recovery / ticks</th><th>Blast radius</th><th>Error Δ / pp</th><th>Success</th></tr></thead>
          <tbody>{POLICIES.map(policy => {
            const item = matched.find(r => r.policy === policy);
            const m = item?.metrics;
            const failed = m?.unique_failed, baseFailed = baseline?.metrics?.unique_failed;
            const success = m?.unique_succeeded, offered = m?.unique_offered;
            return <tr key={policy}><td>{POLICY_LABEL[policy]}<small>{item?.state ?? 'Not run'}</small></td>
              <td>{m?.sustained_recovery_time === -1 ? 'Not reached' : fmt(m?.sustained_recovery_time)}</td>
              <td>{fmt(m?.blast_radius)}</td><td>{failed !== undefined && baseFailed !== undefined ? (m?.unique_offered && baseline?.metrics?.unique_offered ? ((failed / m.unique_offered - baseFailed / baseline.metrics.unique_offered) * 100).toFixed(2) : '—') : '—'}</td>
              <td>{success !== undefined && offered ? `${(success / offered * 100).toFixed(1)}%` : '—'}</td></tr>;
          })}</tbody></table>
        <p className="muted">Error Δ is the failed-transaction rate difference from no intervention, in percentage points. Recovery is duration from fault onset, not wall-clock MTTR. Blast radius is unavailable unless reported by the backend. One seed is not a holdout evaluation.</p>
        <h3>Candidate backtest</h3>
        <p>{candidate ? `Decision tick ${candidate.decision_tick} · ${candidate.reasons.join('; ')}` : 'No candidate selected in this run.'}</p>
        {replay && <BacktestVerdict result={replay} />}
      </div>
      <footer className="panel-actions"><button onClick={compare} disabled={busy}>{busy ? 'Running…' : 'Compare policies'}</button><button onClick={backtest} disabled={busy || !candidate}>Replay candidate</button></footer>
    </section>
  </div>;
}
