'use client';
import './console.css';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { POLICIES, POLICY_LABEL, SCENARIOS, SCENARIO_LABEL, actionListLabel, actionLabel } from '@/lib/labels';
import type { DecisionEvent, MetricEvent, RunPolicy, RunScenario, CascadeEvent } from '@/types/api';
import { useBackendRun } from './useBackendRun';
import { ServiceTopology } from './ServiceTopology';
import { IncidentTelemetryChart } from './IncidentTelemetryChart';
import { AiOverviewPanel } from './AiOverviewPanel';
import { PlansConsole } from './PlansConsole';
import { ExperimentLab } from './ExperimentLab';
import { EventAudit } from './EventAudit';

type View = 'overview' | 'incident' | 'plans' | 'experiments' | 'audit';
const titles: Record<View, string> = { overview: 'Executive overview', incident: 'Incident cockpit', plans: 'Recovery plans', experiments: 'Experiment & holdout lab', audit: 'Audit trail' };
const presets: { scenario: RunScenario; label: string }[] = [
  { scenario: 'db_slowdown', label: '💥 DB Saturation' }, { scenario: 'payments_degradation', label: '💳 Payments' }, { scenario: 'traffic_surge', label: '🌊 Traffic Surge' },
];
const fmt = (value?: number) => value === undefined ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function BackendDemo({ view, runId, planId }: { view: View; runId?: string; planId?: string }) {
  const data = useBackendRun(runId);
  const { run, runs, events, plans, topology, error, loading, select, refresh, live, setLive, streamStatus } = data;
  const [seed, setSeed] = useState(42);
  const [scenario, setScenario] = useState<RunScenario>('db_slowdown');
  const [policy, setPolicy] = useState<RunPolicy>('ai_coordinated');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  async function start(nextScenario = scenario) {
    if (busy) return;
    setBusy(true); setActionError('');
    try {
      const created = await api.createRun({ seed, scenario: nextScenario, policy, purpose: 'operator_review' });
      select(created.id); refresh();
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Run creation failed'); }
    finally { setBusy(false); }
  }
  const metrics = events.filter((event): event is MetricEvent => event.kind === 'metric');
  const decisions = events.filter((event): event is DecisionEvent => event.kind === 'decision');
  const latestDecision = decisions.filter(event => event.payload.ai?.diagnosis || event.payload.ai?.fallback_reason).at(-1) ?? decisions.at(-1);
  const sensor = metrics.at(-1)?.payload;
  const queues: Record<string, { peak: number; last: number }> = {};
  for (const event of metrics) for (const [name, depth] of Object.entries(event.payload.service_queues ?? {})) {
    queues[name] = { peak: Math.max(queues[name]?.peak ?? depth, depth), last: depth };
  }
  const checks = decisions.flatMap(event => event.payload.ai?.checks ?? event.payload.ai?.checks_evaluated ?? []);
  const recentChecks = checks.slice(-6);
  const filteredRuns = runs.filter(item => `${item.seed} ${SCENARIO_LABEL[item.scenario]} ${item.policy}`.toLowerCase().includes(historySearch.toLowerCase()));
  const ribbon = run && <section className="metric-ribbon" aria-label="Run metrics">
    <Metric label="Failed transactions" value={fmt(run.metrics?.unique_failed)} context={`${fmt(run.metrics?.unique_offered)} offered`} />
    <Metric label="Current error rate" value={sensor ? `${fmt(sensor.error_rate * 100)}%` : '—'} context={metrics.length ? `Tick ${metrics.at(-1)?.tick}` : 'No samples'} />
    <Metric label="Queue depth" value={fmt(sensor?.queue_depth)} context={`${fmt(run.metrics?.max_queue_depth)} peak`} />
    <Metric label="Recovery actions" value={fmt(run.metrics?.actions_executed)} context={`${plans.filter(p => p.actions.length).length} candidate plans`} />
  </section>;
  return <main className={`console-page console-page--${view}`}>
    <div className="page-heading"><div><h1>{titles[view]}</h1><p>{run ? `${SCENARIO_LABEL[run.scenario]} · ${POLICY_LABEL[run.policy]} · Seed ${run.seed}` : 'Backend telemetry and recovery evidence'}</p></div>
      <div className="heading-actions"><span className="status-pill">{run?.state ?? (loading ? 'Connecting' : 'No run')}</span><button onClick={refresh} disabled={loading}>Refresh</button></div>
    </div>
    {view === 'incident' && <section className="trigger-bar" aria-label="Incident presets">
      {presets.map(preset => <button key={preset.scenario} disabled={busy} onClick={() => { setScenario(preset.scenario); void start(preset.scenario); }}>{preset.label}</button>)}
      <label>Seed<input aria-label="Simulation seed" type="number" min="0" max="9007199254740991" value={seed} onChange={event => setSeed(Math.max(0, Math.floor(Number(event.target.value))))} /></label>
      <label>Scenario<select aria-label="Scenario" value={scenario} onChange={event => setScenario(event.target.value as RunScenario)}>{SCENARIOS.map(item => <option key={item} value={item}>{SCENARIO_LABEL[item]}</option>)}</select></label>
      <label>Policy<select aria-label="Policy" value={policy} onChange={event => setPolicy(event.target.value as RunPolicy)}>{POLICIES.map(item => <option key={item} value={item}>{POLICY_LABEL[item]}</option>)}</select></label>
      <button onClick={() => start()} disabled={busy}>{busy ? 'Starting…' : 'Generate incident'}</button>
    </section>}
    {(error || actionError) && <div role="alert" className="console-error">{error || actionError}<button onClick={refresh}>Retry</button></div>}
    {loading && <div role="status" className="panel detail-content">Loading backend records…</div>}
    {!run && !loading && !error && <section className="panel detail-content"><h2>No recorded runs</h2><p>Generate an incident to populate the console from the Python backend.</p>{view !== 'incident' && <Link href="/incidents">Open incident cockpit →</Link>}</section>}
    {run && <>
      <div className="model-evidence" role="status" aria-label="Model execution evidence"><strong>{run.policy !== 'ai_coordinated' ? 'Rules policy · no model requested' : decisions.some(e => e.payload.ai?.live) ? 'Model responses verified' : decisions.some(e => e.payload.ai?.fallback_reason) ? 'Rule fallback · no verified model response' : 'Awaiting model evidence'}</strong><span>{run.policy === 'ai_coordinated' ? `${decisions.filter(e => e.payload.ai?.live).length} model decisions · ${decisions.filter(e => e.payload.ai?.fallback_reason).length} fallback decisions` : 'Select AI planner in the incident cockpit to request model decisions.'}</span>{latestDecision?.payload.ai?.fallback_reason && <span>Reason: {latestDecision.payload.ai.fallback_reason}</span>}</div>
      {view !== 'incident' && <div className="context-toolbar"><label>Selected run<select aria-label="Selected run" value={run.id} onChange={event => select(event.target.value)}>{runs.map(item => <option key={item.id} value={item.id}>{SCENARIO_LABEL[item.scenario]} · seed {item.seed} · {item.id.slice(0, 8)}</option>)}</select></label><span className="muted">{run.created_at ? new Date(run.created_at).toLocaleString() : 'Timestamp unavailable'}</span></div>}
      {(view === 'overview' || view === 'incident') && ribbon}
      {view === 'overview' && <div className="overview-grid console-fill">
        <div className="column-stack"><section className="panel topology-panel"><header className="panel-heading"><h2>Service topology</h2><span>Recorded queue pressure</span></header><ServiceTopology topology={topology} fault="" queues={queues} /></section><AiOverviewPanel event={latestDecision} run={run} /><div className="panel-actions"><Link href={`/incidents/${run.id}`}>Inspect incident →</Link><Link href={`/plans/${run.id}`}>Review plans →</Link></div></div>
        <section className="panel detail-pane"><header className="panel-heading"><h2>Incident event stream</h2><span>{events.length} events</span></header><div className="pane-scroll detail-content"><EventTicker events={events.filter(event => event.kind !== 'metric')} />
          </div><details className="overview-rules"><summary>Coordinator rules · {decisions.length} decisions</summary><div className="pane-scroll detail-content">{decisions.slice().reverse().map(event => <details className="rule-accordion" key={event.event_id}><summary>Tick {event.tick} · {actionListLabel(event.payload.actions)} · risk {event.payload.predicted_risk}</summary><ul>{event.payload.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>{!event.payload.reasons.length && <p>No reasons recorded.</p>}</details>)}</div></details></section>
      </div>}
      {view === 'incident' && <div className="incident-grid console-fill">
        <section className="panel master-pane incident-history"><header className="panel-heading"><h2>Incidents</h2><span>{runs.length}</span></header><input className="history-search" aria-label="Filter incident history" placeholder="Search seed or scenario" value={historySearch} onChange={e => setHistorySearch(e.target.value)} /><div className="pane-scroll">{filteredRuns.map(item => <button key={item.id} aria-pressed={item.id === run.id} className={`master-row ${item.id === run.id ? 'is-selected' : ''}`} onClick={() => select(item.id)}><strong>{SCENARIO_LABEL[item.scenario]}</strong><span>Seed {item.seed} · {POLICY_LABEL[item.policy]}</span><small>{item.state} · {fmt(item.metrics?.unique_failed)} failed</small></button>)}</div></section>
        <div className="column-stack incident-telemetry"><section className="panel telemetry-panel detail-content"><h2>Telemetry timeline</h2><IncidentTelemetryChart events={events} /><div className="sparkline-grid"><Sparkline label="Database load" values={metrics.map(e => e.payload.db_load)} /><Sparkline label="Latency / ticks" values={metrics.map(e => e.payload.latency)} /><Sparkline label="Queue depth" values={metrics.map(e => e.payload.queue_depth)} /></div></section><AiOverviewPanel event={latestDecision} run={run} />{recentChecks.length > 0 && <section className="panel detail-content"><h2>Health invariants</h2>{recentChecks.map((check, i) => <p key={i}>{check.status} · {check.description} · observed {check.observed ?? 'pending'}</p>)}</section>}</div>
        <section className="panel detail-pane"><header className="panel-heading"><h2>Event ticker</h2><button aria-pressed={live} onClick={() => setLive(!live)}>{live ? 'Pause live stream' : 'Resume live stream'}</button></header><p className="stream-status" role="status">{live ? `SSE · ${streamStatus === 'closed' ? 'Replay complete' : streamStatus}` : 'Stream paused'}</p><div className="pane-scroll detail-content"><EventTicker events={events} /></div><footer className="panel-actions"><Link href={`/plans/${run.id}`}>Review plans →</Link></footer></section>
      </div>}
      {view === 'plans' && <PlansConsole plans={plans} run={run} refresh={refresh} />}
      {view === 'experiments' && <ExperimentLab runs={runs} run={run} plans={plans} planId={planId} select={select} refresh={refresh} />}
      {view === 'audit' && <EventAudit events={events} run={run} />}
    </>}
  </main>;
}
function Metric({ label, value, context }: { label: string; value: string; context: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{context}</small></div>;
}
function EventTicker({ events }: { events: CascadeEvent[] }) {
  if (!events.length) return <p>No events recorded.</p>;
  return <ol className="event-ticker">{events.slice().reverse().map(event => <li key={event.event_id}><span className="event-tick">{event.tick}</span><div><strong>{event.kind}</strong><p>{event.kind === 'decision' ? actionListLabel(event.payload.actions) : event.kind === 'execution' ? actionLabel(event.payload.action) : event.kind === 'metric' ? `Queue ${fmt(event.payload.queue_depth)} · errors ${fmt(event.payload.error_rate * 100)}%` : event.kind === 'incident' ? event.payload.phase : event.kind === 'verification' ? String(event.payload.reason ?? 'Verification recorded') : 'Proposal recorded'}</p><small>{event.timestamp ?? event.event_id}</small></div></li>)}</ol>;
}
function Sparkline({ label, values }: { label: string; values: number[] }) {
  const valid = values.filter(Number.isFinite);
  const max = Math.max(...valid, 1), min = Math.min(...valid, 0);
  const points = valid.map((value, i) => `${i * 120 / Math.max(valid.length - 1, 1)},${30 - (value - min) / (max - min) * 26}`).join(' ');
  return <div><span>{label}</span><strong>{fmt(valid.at(-1))}</strong><svg viewBox="0 0 120 34" role="img" aria-label={`${label} recorded trend`}><polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.5" /></svg></div>;
}
