'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EventAudit } from './EventAudit';
import { Pagination } from './Pagination';
import { ServiceTopology } from './ServiceTopology';
import { api } from '@/lib/api';
import {
  POLICIES, POLICY_LABEL, POLICY_BLURB, SCENARIOS, SCENARIO_LABEL, SCENARIO_BLURB,
  actionLabel, actionListLabel,
} from '@/lib/labels';
import { IncidentTelemetryChart } from './IncidentTelemetryChart';
import { AiOverviewPanel } from './AiOverviewPanel';
import { KpiCard, SectionHeader } from '@/components/ui/kit';
import type {
  AIProbeOutcome, BacktestResult, CascadeEvent, DecisionEvent,
  ExecutionEvent, MetricEvent, Plan, Run, RunPolicy, RunScenario, Topology,
} from '@/types/api';

type View = 'overview' | 'incident' | 'plans' | 'experiments' | 'audit';
const KEY = 'cascade-demo-run-id';
const SEED = 42;
const card: React.CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 };
const muted: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 };
const action: React.CSSProperties = { border: 0, borderRadius: 8, background: 'var(--accent)', color: 'var(--bg-elevated)', padding: '10px 14px', cursor: 'pointer', fontWeight: 600 };
const ghost: React.CSSProperties = { ...action, background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)' };
const chip: React.CSSProperties = { display: 'inline-block', borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' };
const input: React.CSSProperties = { padding: 8, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)' };

function number(value: number | undefined | null) {
  return typeof value === 'number' ? value.toLocaleString() : '—';
}
const SEVERITY_COLOR: Record<string, string> = {
  low: 'var(--success)', medium: 'var(--warning)',
  high: 'var(--warning)', critical: 'var(--danger)',
};

function mergeEvents(prior: CascadeEvent[], tail: CascadeEvent[]): CascadeEvent[] {
  const seen = new Set(prior.map((event) => event.event_id));
  const merged = prior.slice();
  for (const event of tail) {
    if (!seen.has(event.event_id)) {
      seen.add(event.event_id);
      merged.push(event);
    }
  }
  return merged;
}

export function BackendDemo({ view, runId, planId }: { view: View; runId?: string; planId?: string }) {
  const router = useRouter();
  const [loadVersion, setLoadVersion] = useState(0);
  const [planPage, setPlanPage] = useState(0);
  const [comparisonContext, setComparisonContext] = useState('');
  const [loadedRun, setRun] = useState<Run | null>(null);
  const run = !runId || loadedRun?.id === runId ? loadedRun : null;
  const [topology, setTopology] = useState<Topology | null>(null);
  const [events, setEvents] = useState<CascadeEvent[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [comparison, setComparison] = useState<(Run & { provenance?: string })[]>([]);
  const [seed, setSeed] = useState(SEED);
  const [policy, setPolicy] = useState<RunPolicy>('ai_coordinated');
  const [scenario, setScenario] = useState<RunScenario>('db_slowdown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [noRun, setNoRun] = useState(false);
  const [backtests, setBacktests] = useState<Record<string, BacktestResult>>({});
  const [backtesting, setBacktesting] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollGeneration = useRef(0);
  const refreshVersion = useRef(0);
  const lastEventIdRef = useRef<string | undefined>(undefined);

  const refresh = useCallback(async (id: string, mode: 'full' | 'tail' = 'full') => {
    // A tail fetch uses the backend's Last-Event-ID resume so a running run
    // never re-downloads its whole event history on every poll tick.
    const version = ++refreshVersion.current;
    const after = mode === 'tail' ? lastEventIdRef.current : undefined;
    const [current, trace, candidates] = await Promise.all([
      api.getRun(id), api.getEvents(id, after), api.listPlans(id),
    ]);
    if (version !== refreshVersion.current) return current;
    if (mode === 'full') {
      lastEventIdRef.current = trace.at(-1)?.event_id;
      setEvents(trace);
    } else if (trace.length) {
      lastEventIdRef.current = trace.at(-1)?.event_id;
      setEvents((prior) => mergeEvents(prior, trace));
    }
    setRun(current); setPlans(candidates);
    return current;
  }, []);

  const pollWhileRunning = useCallback((id: string) => {
    const generation = ++pollGeneration.current;
    if (pollRef.current) clearTimeout(pollRef.current);
    let failures = 0;
    const poll = async () => {
      if (generation !== pollGeneration.current) return;
      try {
        const current = await refresh(id, 'tail');
        failures = 0;
        if (current.state !== 'running') {
          await refresh(id);
          return;
        }
      } catch (reason) {
        if (++failures >= 3) {
          setError(reason instanceof Error ? reason.message : 'Connection lost. Retry to resume this run.');
          return;
        }
      }
      if (generation === pollGeneration.current) pollRef.current = setTimeout(poll, 2000);
    };
    pollRef.current = setTimeout(poll, 2000);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const health = await api.getHealth();
        if (health.status !== 'ok') throw new Error('Sandbox API is not healthy');
        // Never invent a run: pages show the newest real run, or an honest
        // empty state pointing at Incidents where runs are started.
        const history = await api.listRuns();
        let current: Run | undefined;
        if (runId) current = await api.getRun(runId);
        else current = history[0];
        if (cancelled) return;
        if (!current) {
          if (!cancelled) { setRun(null); setEvents([]); setPlans([]); setNoRun(true); setError(''); localStorage.removeItem(KEY); window.dispatchEvent(new Event('cascade-selection-changed')); }
          return;
        }
        setNoRun(false);
        localStorage.setItem(KEY, current.id);
        const id = current.id;
        setSeed(current.seed); setPolicy(current.policy); setScenario(current.scenario);
        setPlanPage(0);
        window.dispatchEvent(new Event('cascade-selection-changed'));
        await refresh(id);
        if (!cancelled) {
          setTopology(await api.getTopology());
          setError('');
          if (current.state === 'running') pollWhileRunning(id);
        }
      } catch (reason) {
        if (!cancelled) { setRun(null); localStorage.removeItem(KEY); window.dispatchEvent(new Event('cascade-selection-changed')); setError(reason instanceof Error ? reason.message : 'Could not load the sandbox run'); }
      }
    }
    load();
    const onRunChanged = () => { if (!runId) load(); };
    window.addEventListener('cascade-run-changed', onRunChanged);
    return () => {
      cancelled = true;
      refreshVersion.current += 1;
      window.removeEventListener('cascade-run-changed', onRunChanged);
      pollGeneration.current += 1;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [runId, refresh, pollWhileRunning, loadVersion]);

  const decisions = events.filter((event): event is DecisionEvent => event.kind === 'decision');
  const executions = events.filter((event): event is ExecutionEvent => event.kind === 'execution');
  const candidatePlans = plans.filter((plan) => plan.actions.length);
  const currentPlanPage = Math.min(planPage, Math.max(0, Math.ceil(candidatePlans.length / 12) - 1));
  const visiblePlans = candidatePlans.slice(currentPlanPage * 12, (currentPlanPage + 1) * 12);
  const aiDecisions = useMemo(() =>
    decisions.filter((event) => {
      const info = event.payload.ai;
      if (!info) return false;
      // Show decisions that carry substance: a diagnosis (even "hold"), an
      // executed action, or a labeled fallback — not empty holding ticks.
      return Boolean(info.diagnosis)
        || event.payload.actions.length > 0
        || Boolean(info.fallback_reason);
    }), [decisions]);
  const latestAiDecision = aiDecisions.at(-1);
  const latestChecks = (() => {
    for (let index = decisions.length - 1; index >= 0; index -= 1) {
      const info = decisions[index].payload.ai;
      const checks = info?.checks ?? info?.checks_evaluated;
      if (checks?.length) return { tick: decisions[index].tick, checks };
    }
    return null;
  })();
  const title = { overview: 'Operations Overview', incident: 'Incident Replay', plans: 'Recovery Plans', experiments: 'Policy Comparison', audit: 'Event Audit' }[view];
  const explanation = {
    overview: 'The newest run from the backend. Every number on this page was computed for that incident.',
    incident: 'The backend replays the incident. Every row below comes from its event stream.',
    plans: 'Synthetic telemetry feeds the diagnosis. Every plan waits for your decision: approve a sandbox replay, test it in the Experiment Lab, or reject it.',
    experiments: 'Run all five policies against the same seed and compare unique failed transactions.',
    audit: 'The event log exposes telemetry, AI decisions with provenance, and action records.',
  }[view];

  async function restart() {
    setBusy(true); setError('');
    try {
      const created = await api.createRun({ seed, scenario, policy, purpose: 'operator_review' });
      localStorage.setItem(KEY, created.id);
      window.dispatchEvent(new Event('cascade-selection-changed'));
      if (runId) {
        router.push(`/incidents/${created.id}`);
        return;
      }
      setPlanPage(0);
      await refresh(created.id);
      if (created.state === 'running') pollWhileRunning(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create run');
    } finally { setBusy(false); }
  }

  async function approve(plan: Plan) {
    setBusy(true); setError('');
    try {
      await api.decidePlan(plan.id, true, 'Operator approved synthetic sandbox replay');
      await refresh(plan.run_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Approval failed');
    } finally { setBusy(false); }
  }

  async function reject(plan: Plan) {
    setBusy(true); setError('');
    try {
      await api.decidePlan(plan.id, false, 'Operator rejected plan');
      await refresh(plan.run_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reject plan');
    } finally { setBusy(false); }
  }

  async function backtest(plan: Plan) {
    setBacktesting(plan.id); setError('');
    try {
      const result = await api.backtestPlan(plan.id);
      setBacktests((prior) => ({ ...prior, [plan.id]: result }));
      await refresh(plan.run_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Backtest failed');
    } finally { setBacktesting(null); }
  }

  async function compare() {
    setBusy(true); setError(''); setComparison([]);
    setComparisonContext(`Seed ${seed} · ${SCENARIO_LABEL[scenario]} · 110 ticks · policy comparison`);
    try {
      // All five arms run concurrently against the threaded sandbox server;
      // each AI arm still waits for its own background run to finish.
      const results = await Promise.all(POLICIES.map(async (arm) => {
        const created = await api.createRun({ seed, scenario, policy: arm, purpose: 'policy_comparison' });
        const completed = created.state === 'running' ? await waitUntilDone(created.id) : created;
        if (completed.state === 'failed') throw new Error(completed.failed_reason || 'Comparison run failed');
        const plans = await api.listPlans(completed.id);
        const provenance = arm === 'ai_coordinated'
          ? (plans.some(p => p.ai?.live) ? 'Model (may include fallback)' : plans.some(p => p.ai?.fallback_reason) ? 'Rule fallback' : 'No model calls; actions held') : 'Deterministic';
        return { ...completed, provenance };
      }));
      setComparison(results);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Comparison failed');
    } finally { setBusy(false); }
  }

  const metrics = events.filter((event): event is MetricEvent => event.kind === 'metric');
  const latestSensor = metrics.at(-1)?.payload;
  const peakError = metrics.length
    ? Math.round(Math.max(...metrics.map((event) => event.payload.error_rate * 100)) * 10) / 10
    : null;
  const servicePeaks: Record<string, { peak: number; last: number }> = {};
  for (const event of metrics) {
    for (const [name, depth] of Object.entries(event.payload.service_queues ?? {})) {
      servicePeaks[name] = servicePeaks[name] ?? { peak: 0, last: 0 };
      servicePeaks[name].peak = Math.max(servicePeaks[name].peak, depth);
      servicePeaks[name].last = depth;
    }
  }
  const faultedService: Record<string, string> = {
    db_slowdown: 'database', payments_degradation: 'payments', traffic_surge: 'gateway',
    telemetry_faults: 'telemetry sensors',
  };
  const failedRatio = run && run.metrics && run.metrics.unique_offered
    ? (run.metrics.unique_failed ?? 0) / run.metrics.unique_offered : 0;
  const failedTone = !run?.metrics ? 'default' as const
    : (run.metrics.unique_failed ?? 0) === 0 ? 'good' as const
    : failedRatio < 0.05 ? 'warn' as const : 'bad' as const;

  const hasTests = Boolean(latestChecks);
  const numbering: Record<string, string> = view === 'overview'
    ? { ai: '02', tests: '03', what: hasTests ? '04' : '03',
        topo: hasTests ? '05' : '04', dec: hasTests ? '06' : '05' }
    : { metrics: '01', telemetry: '02', ai: '03', tests: '04',
        what: hasTests ? '05' : '04', topo: hasTests ? '06' : '05',
        dec: hasTests ? '07' : '06' };

  // Coordinator/AI policies emit decision events; the simpler policies act
  // straight from proposals and only leave execution events. Show whichever
  // this run actually produced.
  const decisionRows = useMemo(() => {
    const decided = decisions.filter((event) => event.payload.actions.length > 0);
    if (decided.length) return decided.slice(0, 12);
    return executions.slice(0, 12);
  }, [decisions, executions]);

  return (
    <main className={`console-page console-page--${view}`}>
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">CASCADE ZERO <span aria-hidden="true">/</span> {view.toUpperCase()}</p>
          <h1>{title}</h1>
          <p style={muted}>{explanation}</p>
        </div>
        <span className="page-mode-tag"><span aria-hidden="true" /> Simulated environment</span>
      </div>
      {error && <div role="alert" style={{ ...card, borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error} <button type="button" onClick={() => { setError(''); setLoadVersion(v => v + 1); }}>Retry loading</button></div>}
      {!run && !error && !noRun && <div style={card}>Loading a backend run…</div>}
      {!run && !error && noRun && (
        <section className="empty-state" aria-labelledby="empty-state-title">
          <div className="empty-state-copy">
            <p className="page-eyebrow">OPERATOR CONTROL · SIMULATION ONLY</p>
            <h2 id="empty-state-title">Diagnose the incident before recovery begins.</h2>
            <p>
              Cascade Zero reads generated telemetry, explains the likely cause, and proposes
              guarded recovery actions. You choose whether to approve a local replay, compare it
              in the Experiment Lab, or reject it. No production system is connected.
            </p>
          </div>
          <ol className="workflow-steps" aria-label="Operator workflow">
            <li><span>01</span><strong>Generate telemetry</strong><small>Choose a scenario and repeatable seed.</small></li>
            <li><span>02</span><strong>Review the diagnosis</strong><small>See evidence, confidence, and risk.</small></li>
            <li><span>03</span><strong>Choose the outcome</strong><small>Approve, experiment, or reject.</small></li>
          </ol>
          <Link href="/incidents" className="primary-action">Set up a simulated incident <span aria-hidden="true">→</span></Link>
        </section>
      )}
      {run && (
        <>
          {view !== 'overview' && (
          <section className="run-context" style={{ ...card, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="run-context-identity">Run {run.id.slice(0, 8)} · Seed {run.seed} · {SCENARIO_LABEL[run.scenario]} · {run.state}</div>
            <label style={muted}>Seed
              <input type="number" min="0" value={seed} onChange={(e) => setSeed(Math.max(0, Number(e.target.value) || 0))} style={{ ...input, width: 90, marginLeft: 8 }} />
              <button type="button" onClick={() => setSeed(Math.floor(Math.random() * 100000))} style={{ ...ghost, padding: '6px 10px', marginLeft: 6, fontSize: 12 }}>Random</button>
            </label>
            <label style={muted}>Scenario
              <select value={scenario} onChange={(e) => setScenario(e.target.value as RunScenario)} style={{ ...input, marginLeft: 8 }} title={SCENARIO_BLURB[scenario]}>
                {SCENARIOS.map((name) => <option key={name} value={name} title={SCENARIO_BLURB[name]}>{SCENARIO_LABEL[name]}</option>)}
              </select>
            </label>
            <label style={muted}>Policy
              <select value={policy} onChange={(e) => setPolicy(e.target.value as RunPolicy)} style={{ ...input, marginLeft: 8 }} title={POLICY_BLURB[policy]}>
                {POLICIES.map((name) => <option key={name} value={name} title={POLICY_BLURB[name]}>{POLICY_LABEL[name]}</option>)}
              </select>
            </label>
            <button type="button" onClick={restart} disabled={busy} style={action}>Start run</button>
          </section>
          )}
          {view === 'overview' && <section style={{ ...card, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <strong>Run {run.id.slice(0, 8)} · {POLICY_LABEL[run.policy]}</strong>
              <div style={muted}>
                Seed {run.seed} · {SCENARIO_LABEL[run.scenario] ?? run.scenario} · {run.state}
                {run.created_at ? ` · started ${new Date(run.created_at).toLocaleTimeString()}` : ''}
                {run.state === 'running' && '. The AI is evaluating; events stream in as they happen'}
              </div>
            </div>
            <Link href="/incidents" style={{ color: 'var(--accent)', fontWeight: 600 }}>Start a new run in Incidents →</Link>
          </section>}
          {(view === 'overview' || view === 'incident') && latestAiDecision && <AiOverviewPanel event={latestAiDecision} run={run} />}
          {view === 'overview' && !latestAiDecision && (
            <section className="ai-discovery-panel">
              <div>
                <p className="ai-overview-eyebrow">AI PLANNER</p>
                <h2>This run has no AI diagnosis</h2>
                <p>The selected policy does not emit AI decision provenance. Start an AI planner run to inspect diagnosis, confidence, fallback source, and proposed actions.</p>
              </div>
              <Link href="/incidents" className="secondary-action">Choose a policy and scenario <span aria-hidden="true">→</span></Link>
            </section>
          )}
          {view === 'overview' && (
            <section className="workflow-strip" aria-label="Operator workflow">
              <SectionHeader index="01" title="Operator workflow" subtitle="Follow the evidence, then choose the recovery path." />
              <ol className="workflow-strip-steps">
                <li><span>01</span><strong>Generate</strong><Link href="/incidents">Choose a scenario and seed</Link></li>
                <li><span>02</span><strong>Diagnose</strong><small>Review telemetry, cause, and risk</small></li>
                <li><span>03</span><strong>Decide</strong><Link href={`/plans/${run.id}`}>Approve, test, or reject</Link></li>
                <li><span>04</span><strong>Compare</strong><Link href="/experiments">Measure the alternatives</Link></li>
              </ol>
            </section>
          )}
          {(view === 'overview' || view === 'incident') && (
            <>
              {view === 'incident' && <SectionHeader index={numbering.metrics} title="Outcome metrics" />}
              <section className="kpi-grid">
                <KpiCard label="Transactions offered" value={number(run.metrics?.unique_offered)}
                         context="simulated user requests during the run" />
                <KpiCard label="Transactions failed" value={number(run.metrics?.unique_failed)}
                         context={failedRatio > 0 ? `${Math.round(failedRatio * 1000) / 10}% of offered, lower is better` : 'none failed in this run'}
                         tone={failedTone} />
                <KpiCard label="Transactions succeeded" value={number(run.metrics?.unique_succeeded)}
                         context="completed within their deadline" tone="good" />
                <KpiCard label="Peak error rate" value={peakError !== null ? `${peakError}%` : '—'}
                         context="worst tick during the incident" tone={peakError !== null && peakError > 5 ? 'bad' : 'default'} />
                <KpiCard label="Peak DB connections" value={number(run.metrics?.peak_db_connections)}
                         context="the shared pool is the bottleneck" />
                <KpiCard label="Actions executed" value={number(run.metrics?.actions_executed)}
                         context="recovery actions the policy took" />
              </section>
              {view === 'incident' && (
                <section className="dashboard-panel telemetry-panel" style={card}>
                  <SectionHeader index={numbering.telemetry} title="Incident telemetry" subtitle={run.scenario === 'telemetry_faults' ? 'The chart shows generated sensor readings; telemetry can be noisy, delayed, or dropped. Transaction outcomes remain simulator ground truth.' : 'Backlog (blue) and error rate (red) per tick; orange verticals mark executed recovery actions.'} />
                  {run.scenario === 'telemetry_faults' && latestSensor && <p style={{ ...muted, margin: '0 0 10px' }}>
                    Latest sensor report: {latestSensor.sensor_age_ticks ?? 0} tick(s) old · {latestSensor.sensor_dropped ? 'reading dropped; previous value repeated' : 'reading received'} · {latestSensor.sensor_noise_applied ? 'noise applied' : 'no noise on this reading'}.
                  </p>}
                  <IncidentTelemetryChart events={events} />
                </section>
              )}
              {view === 'incident' && aiDecisions.length > 0 && (
                <section className="dashboard-panel ai-evaluations-panel" style={card}>
                  <SectionHeader index={numbering.ai} title="AI evaluations" subtitle="Each card shows whether a configured model or the deterministic fallback made the recommendation." />
                  {aiDecisions.slice(0, 4).reverse().map((event) => {
                    const info = event.payload.ai!;
                    return (
                      <div key={event.event_id} style={{ borderTop: '1px solid var(--border)', padding: '14px 0' }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                          <strong style={{ ...chip, background: info.live ? 'var(--accent)' : 'var(--text-muted)', color: 'var(--bg-elevated)' }}>
                            {info.live ? `MODEL · ${info.model}` : 'RULE FALLBACK'}
                          </strong>
                          {info.diagnosis && (
                            <span style={{ ...chip, color: SEVERITY_COLOR[info.diagnosis.severity] ?? 'var(--text-secondary)', border: `1px solid ${SEVERITY_COLOR[info.diagnosis.severity] ?? 'var(--border)'}` }}>
                              {info.diagnosis.severity.toUpperCase()} · {Math.round(info.diagnosis.confidence * 100)}% confidence
                            </span>
                          )}
                          {info.fallback_reason && <span style={muted}>fallback: {info.fallback_reason}</span>}
                          <span style={muted}>tick {event.tick}{info.latency_ms ? ` · ${info.latency_ms} ms` : ''}</span>
                        </div>
                        {info.diagnosis && (
                          <div style={{ marginBottom: 6 }}>
                            <strong>{info.diagnosis.cause}</strong>
                            {info.diagnosis.affected.length > 0 && <span style={muted}> · affected: {info.diagnosis.affected.join(', ')}</span>}
                            <div style={muted}>{info.diagnosis.rationale}</div>
                          </div>
                        )}
                        <div style={muted}>
                          Decision: <strong>{actionListLabel(event.payload.actions)}</strong>
                          {` · risk ${event.payload.predicted_risk}`}
                        </div>
                        {info.probes?.length ? <ProbeTable probes={info.probes} /> : null}
                      </div>
                    );
                  })}
                </section>
              )}
              {latestChecks && (
                <section style={card}>
                  <SectionHeader index={numbering.tests} title="AI test cases" subtitle={`Decided at tick ${latestChecks.tick}; the sandbox scores each one.`} />
                  {latestChecks.checks.map((check, index) => (
                    <div key={index} style={{ display: 'flex', gap: 10, alignItems: 'baseline', borderTop: '1px solid var(--border)', padding: '8px 0' }}>
                      <span style={{ ...chip, color: check.status === 'pass' ? 'var(--success)' : check.status === 'fail' ? 'var(--danger)' : 'var(--text-muted)', border: '1px solid var(--border)' }}>
                        {check.status.toUpperCase()}
                      </span>
                      <span>{check.description}</span>
                      <span style={muted}>{check.metric} {check.comparator} {check.threshold} within {check.within_ticks} ticks{check.observed !== null ? ` · observed ${check.observed}` : ''}</span>
                    </div>
                  ))}
                </section>
              )}
              <section style={{ ...card, display: 'grid', gap: 12 }}>
                <SectionHeader index={numbering.what} title="What happened in this run" />
                <p style={muted}>{(() => {
                  const actions = executions.length;
                  const aiEntries = decisions.filter((event) => {
                    const info = event.payload.ai;
                    return info && (info.live || info.fallback_reason);
                  });
                  const liveOnes = aiEntries.filter((event) => event.payload.ai?.live).length;
                  const faultText = run.scenario === 'telemetry_faults'
                    ? 'telemetry sensors returned delayed, noisy, and occasional missing readings while the service fault remained unchanged'
                    : run.scenario === 'traffic_surge'
                    ? 'traffic surged past capacity from tick 10'
                    : run.scenario === 'payments_degradation'
                      ? 'the payments service degraded from tick 10 to 35'
                      : 'the shared database degraded from tick 10 to 35';
                  const decider = run.policy === 'ai_coordinated'
                    ? (liveOnes > 0
                        ? `AI planner used the model at ${liveOnes} point${liveOnes === 1 ? '' : 's'} (${aiEntries.length - liveOnes} used the fallback)`
                        : `the model was unreachable, so the rule fallback decided all ${aiEntries.length || 0} time${aiEntries.length === 1 ? '' : 's'}`)
                    : `${POLICY_LABEL[run.policy]} decided with deterministic rules`;
                  if (run.purpose === 'operator_review') {
                    return `Seed ${run.seed}: ${faultText}. The policy evaluated generated telemetry; ${decider}. No action was applied during operator review.`;
                  }
                  if (run.scenario === 'telemetry_faults' && actions === 0) {
                    return `Seed ${run.seed}: ${faultText}. The policy held recovery actions because the readings were stale or incomplete; the underlying incident remained synthetic and continued independently.`;
                  }
                  return `Seed ${run.seed}: ${faultText}. Recovery agents proposed actions from observable telemetry; ${decider}. ` +
                    (actions > 0
                      ? `${actions} action${actions === 1 ? '' : 's'} executed; the decisions list below has them all.`
                      : 'No recovery action was executed in this run; the incident resolved on its own schedule.');
                })()}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <Link href={'/plans/' + run.id}>Review candidate plans</Link>
                  <Link href="/experiments">Compare five policies</Link>
                  <Link href={`/audit?run=${run.id}`}>Inspect event log</Link>
                </div>
              </section>
              <section style={card}>
                <SectionHeader index={numbering.topo} title="Service topology" />
                <ServiceTopology topology={topology} fault={faultedService[run.scenario]} queues={servicePeaks} />
              </section>
              <section style={card}>
                <SectionHeader index={numbering.dec} title="Decisions" subtitle="Proposed actions by tick. Execution is recorded separately." />
                {decisionRows.length ? decisionRows.map((event) => <div key={event.event_id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
                  {event.kind === 'execution'
                    ? <>Tick {event.tick}: {actionLabel(event.payload.action)} <span style={muted}>· by {event.payload.agent_id}</span></>
                    : <>Tick {event.tick}: {actionListLabel(event.payload.actions)} <span style={muted}>· risk {event.payload.predicted_risk}</span></>}
                </div>) : (
                  <p style={muted}>
                    The policy executed <strong>no recovery action</strong> in this run. Every
                    proposal was evaluated and held. The AI evaluations above show what was
                    diagnosed and why nothing was worth doing.
                  </p>
                )}
                <p style={muted}>{executions.length} action records in the simulator trace. Proposals are evaluated internally but are not emitted as separate events by this API.</p>
              </section>
            </>
          )}
          {view === 'plans' && <section className="operator-review-panel" style={card}>
            <SectionHeader index="01" title="Operator review" subtitle="The run used synthetic telemetry to diagnose the incident and propose recovery actions. No action has been applied." />
            <div className="operator-choice" style={{ ...card, margin: '12px 0 18px', background: 'var(--accent-gradient-soft)' }}>
              <strong>Choose the next step</strong>
              <p style={{ ...muted, marginTop: 4 }}>Approve a plan for a local replay, send it to the Experiment Lab for a what-if comparison, or reject it. Every outcome is labeled simulated; there is no live server connection.</p>
            </div>
            <Pagination name="Plans" page={currentPlanPage} count={candidatePlans.length} size={12} onPage={setPlanPage} />
            {visiblePlans.map((plan) => {
              const info = plan.ai;
              const result = backtests[plan.id] ?? plan.backtest;
              return <div key={plan.id} className="plan-option" style={{ borderTop: '1px solid var(--border)', padding: '14px 0' }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <strong>{actionListLabel(plan.actions)}</strong>
                    <div style={muted}>Tick {plan.decision_tick ?? '—'} · {plan.ai ? (plan.ai.live ? `Model: ${plan.ai.model}` : 'Rule fallback') : 'Rule coordinator'}</div>
                    {info?.diagnosis && <div style={muted}>diagnosis: {info.diagnosis.cause} ({info.diagnosis.severity})</div>}
                    <div style={muted}>Enforced risk {plan.predicted_risk}</div>
                    <details><summary>Decision evidence</summary><p style={muted}>{plan.reasons.join('; ')}</p>{plan.ai?.safety_reasons && <p style={muted}>{plan.ai.safety_reasons.join('; ')}</p>}<small>{plan.id}</small></details>
                    <span style={{ ...chip, color: plan.status === 'rejected' ? 'var(--danger)' : plan.status === 'approved' ? 'var(--success)' : 'var(--warning)', border: '1px solid currentColor', marginTop: 8 }}>{plan.status.toUpperCase()}</span>
                  </div>
                  {plan.status === 'candidate' && <>
                    <Link href={`/experiments?run=${encodeURIComponent(run.id)}&plan=${encodeURIComponent(plan.id)}`} style={{ ...ghost, textDecoration: 'none' }}>Send to Experiment Lab</Link>
                    <button type="button" disabled={busy} onClick={() => approve(plan)} style={action}>Approve plan</button>
                    <button type="button" disabled={busy} onClick={() => reject(plan)} style={{ ...ghost, color: 'var(--danger)', borderColor: 'var(--danger)' }}>Reject</button>
                  </>}
                </div>
                {result && <><BacktestVerdict result={result} /><p style={{ ...muted, marginTop: 8 }}>Synthetic replay only. It does not predict production with certainty.</p></>}
                {plan.execution?.outcome && <p style={{ ...muted, marginTop: 8 }}>Approved sandbox replay: {number(plan.execution.outcome.unique_failed)} failed · {number(plan.execution.outcome.unique_succeeded)} succeeded · synthetic result.</p>}
              </div>;
            })}
            {!visiblePlans.length && <p style={muted}>No action plan was generated for this run. Choose an AI-coordinated or coordinated policy to generate operator review candidates.</p>}
          </section>}
          {view === 'experiments' && <section className="experiment-panel" style={card}>
            <SectionHeader index="01" title="The Experiment Lab" subtitle="Replay one candidate against the same synthetic incident before deciding whether to approve it." />
            {(() => {
              const labPlan = planId ? candidatePlans.find((candidate) => candidate.id === planId) : candidatePlans[0];
              if (!labPlan) return <p role={planId ? 'alert' : undefined} style={muted}>{planId ? 'Requested plan not found in this run. Return to operator review to select a plan.' : 'No candidate actions in this run. Start an AI planner or coordinator incident first.'}</p>;
              const result = backtests[labPlan.id] ?? labPlan.backtest;
              return <div style={{ ...card, margin: '12px 0 18px', borderColor: 'var(--accent)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                <strong>{actionListLabel(labPlan.actions)}</strong>
                    <p style={muted}>Run {run.id.slice(0, 8)} · tick {labPlan.decision_tick} · predicted risk {labPlan.predicted_risk} · {labPlan.reasons.join('; ')}</p>
                  </div>
                  <button type="button" disabled={busy || backtesting === labPlan.id} onClick={() => backtest(labPlan)} style={action}>
                    {backtesting === labPlan.id ? 'Running replay…' : result ? 'Replay again' : 'Run synthetic replay'}
                  </button>
                  <Link href={`/plans/${run.id}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>Return to operator review →</Link>
                </div>
                {result && <><BacktestVerdict result={result} /><p style={{ ...muted, marginTop: 8 }}>This deterministic replay uses generated telemetry. Treat it as an experiment result, not a production guarantee.</p></>}
              </div>;
            })()}
            <ul style={{ ...muted, paddingLeft: 20, display: 'grid', gap: 6, marginBottom: 16 }}>
              <li><strong style={{ color: 'var(--text-primary)' }}>Plan replay.</strong> The recorded prefix is replayed identically; the candidate is applied once at its recorded tick and compared with holding at that tick, including failures, successes, queues, database connections, and recovery timing.</li>
              <li><strong style={{ color: 'var(--text-primary)' }}>Compare policies.</strong> Run the same incident under all five policies and compare outcomes. One seed is a demonstration, not a statistical result.</li>
            </ul>
            <button type="button" disabled={busy} onClick={compare} style={action}>{busy ? 'Running…' : 'Run comparison on this seed'}</button>
            {comparison.length > 0 && <div style={{ overflowX: 'auto', marginTop: 18 }}>
              <p data-testid="comparison-context" style={muted}>{comparisonContext}</p>
              <table aria-label="Policy comparison" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead><tr><th>Policy / source</th><th>Unique failed</th><th>Actions</th><th>Recovery tick</th><th>Decision p50 ms</th><th>Decision p95 ms</th></tr></thead>
                <tbody>{comparison.map((arm) => <tr key={arm.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: 10 }}>{POLICY_LABEL[arm.policy]}<br /><small>{arm.provenance}</small></td><td>{number(arm.metrics?.unique_failed)}</td><td>{number(arm.metrics?.actions_executed)}</td>
                  <td>{arm.metrics?.sustained_recovery_time === -1 ? 'Not reached' : number(arm.metrics?.sustained_recovery_time)}</td>
                  <td>{arm.runtime?.decision_latency_p50_ms ?? '—'}</td><td>{arm.runtime?.decision_latency_p95_ms ?? '—'}</td>
                </tr>)}</tbody>
              </table>
              <p style={muted}>Decision latency is local process wall-clock time for the per-tick policy block. A live AI planner may include its model call. It is reported separately from synthetic service outcomes.</p>
              <p style={muted}>One seed is a demonstration, not a statistical result.</p>
            </div>}
          </section>}
          {view === 'audit' && <EventAudit key={run.id} events={events} />}
        </>
      )}
    </main>
  );
}

function BacktestVerdict({ result }: { result: BacktestResult }) {
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

function ProbeTable({ probes }: { probes: AIProbeOutcome[] }) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 10 }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
        <thead><tr style={{ color: 'var(--text-muted)' }}>
          <th style={{ padding: '4px 14px 4px 0' }}>Repeated-subset probe</th><th style={{ padding: '4px 14px 4px 0' }}>Unique failed</th>
          <th style={{ padding: '4px 14px 4px 0' }}>Succeeded</th><th style={{ padding: '4px 14px 4px 0' }}>Actions</th>
        </tr></thead>
        <tbody>{probes.map((probe, index) => (
          <tr key={index} style={{ borderTop: '1px solid var(--border)' }}>
            <td style={{ padding: 4 }}>{probe.actions.length ? actionListLabel(probe.actions) : 'No action'}</td>
            <td style={{ padding: 4 }}>{probe.unique_failed.toLocaleString()}</td>
            <td style={{ padding: 4 }}>{probe.unique_succeeded.toLocaleString()}</td>
            <td style={{ padding: 4 }}>{probe.actions_executed}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

async function waitUntilDone(runId: string, timeoutMs = 120000): Promise<Run> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await api.getRun(runId);
    if (run.state !== 'running') return run;
    if (Date.now() > deadline) throw new Error(`Run ${runId} did not finish in time`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
