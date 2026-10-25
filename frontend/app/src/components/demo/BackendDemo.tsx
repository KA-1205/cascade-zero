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
  const [operatorNotes, setOperatorNotes] = useState<Record<string, string>>({});
  const [comparisonContext, setComparisonContext] = useState('');
  const [runsList, setRunsList] = useState<Run[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
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
        setRunsList(history);
        const savedId = typeof window !== 'undefined' ? localStorage.getItem(KEY) : null;
        let current: Run | undefined;
        if (runId) current = await api.getRun(runId);
        else if (savedId && history.some((r) => r.id === savedId)) current = await api.getRun(savedId);
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
    window.addEventListener('cascade-selection-changed', onRunChanged);
    return () => {
      cancelled = true;
      refreshVersion.current += 1;
      window.removeEventListener('cascade-run-changed', onRunChanged);
      window.removeEventListener('cascade-selection-changed', onRunChanged);
      pollGeneration.current += 1;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [runId, refresh, pollWhileRunning, loadVersion]);

  const decisions = events.filter((event): event is DecisionEvent => event.kind === 'decision');
  const executions = events.filter((event): event is ExecutionEvent => event.kind === 'execution');
  const candidatePlans = useMemo(() => {
    return plans
      .filter((plan) => plan.actions.length)
      .slice()
      .sort((a, b) => (b.decision_tick ?? 0) - (a.decision_tick ?? 0));
  }, [plans]);
  const currentPlanPage = Math.min(planPage, Math.max(0, Math.ceil(candidatePlans.length / 12) - 1));
  const visiblePlans = candidatePlans.slice(currentPlanPage * 12, (currentPlanPage + 1) * 12);
  const maxPlanTick = candidatePlans[0]?.decision_tick ?? 0;
  const approvedPlan = candidatePlans.find((p) => p.status === 'approved');
  const selectedPlan = candidatePlans.find((p) => p.id === (selectedPlanId || candidatePlans[0]?.id)) || candidatePlans[0];
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
  const title = {
    overview: 'Infrastructure Overview',
    incident: 'Incident Telemetry & Diagnosis',
    plans: 'Recovery Plans',
    experiments: 'Policy Comparison',
    audit: 'Audit Trail',
  }[view];
  const explanation = {
    overview: 'Global infrastructure telemetry, service topology, active incidents, and automated remediation.',
    incident: 'Deterministic replay and telemetry for the selected incident.',
    plans: 'Synthetic telemetry feeds the diagnosis. Every plan waits for your decision: approve a sandbox replay, test it in the Experiment Lab, or reject it.',
    experiments: 'Run all five policies against the same seed and compare unique failed transactions.',
    audit: 'Cryptographically hashed event trail exposing telemetry, coordinator verdicts, and operator decisions.',
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
      const note = operatorNotes[plan.id]?.trim() || 'Operator approved synthetic sandbox replay';
      await api.decidePlan(plan.id, true, note);
      await refresh(plan.run_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Approval failed');
    } finally { setBusy(false); }
  }

  async function reject(plan: Plan) {
    setBusy(true); setError('');
    try {
      const note = operatorNotes[plan.id]?.trim() || 'Operator rejected plan';
      await api.decidePlan(plan.id, false, note);
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
          {(view === 'overview' || view === 'incident') && runsList.length > 0 && (
            <section className="runs-switcher-bar">
              <span className="runs-switcher-label">INCIDENTS</span>
              <div className="runs-pills-list">
                {runsList.slice(0, 6).map((r) => {
                  const isSelected = r.id === run.id;
                  const failRatio = r.metrics?.unique_offered ? (r.metrics.unique_failed ?? 0) / r.metrics.unique_offered : 0;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={async () => {
                        localStorage.setItem(KEY, r.id);
                        window.dispatchEvent(new Event('cascade-selection-changed'));
                        window.dispatchEvent(new Event('cascade-run-changed'));
                        setRun(r);
                        await refresh(r.id);
                      }}
                      className={`run-pill-btn ${isSelected ? 'is-active' : ''}`}
                    >
                      <span className="run-pill-icon">{r.scenario === 'db_slowdown' ? '💥' : r.scenario === 'payments_degradation' ? '💳' : r.scenario === 'traffic_surge' ? '🌊' : '📡'}</span>
                      <span className="run-pill-name">{SCENARIO_LABEL[r.scenario] ?? r.scenario}</span>
                      <span className="run-pill-tag">Run {r.id.slice(0, 6)}</span>
                      <span className={`run-pill-metric ${failRatio > 0.05 ? 'is-warn' : 'is-good'}`}>
                        {failRatio > 0 ? `${Math.round(failRatio * 100)}% fail` : 'Healthy'}
                      </span>
                    </button>
                  );
                })}
                <Link href="/incidents" className="run-pill-btn run-pill-new">+ New Incident</Link>
              </div>
            </section>
          )}
          {view !== 'overview' && view !== 'incident' && (
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
          {/* OVERVIEW: Clean Executive Hero (Zero Vertical Scroll) */}
          {view === 'overview' && (
            <div className="overview-hero-layout">
              {/* Left Column: Topology & RCA Alert */}
              <div className="overview-left-pane">
                <section style={{ ...card, padding: '10px 14px' }}>
                  <SectionHeader index="01" title="Service Topology" subtitle="Gateway → Orders / Payments → Database" />
                  <ServiceTopology topology={topology} fault={faultedService[run.scenario]} queues={servicePeaks} />
                </section>
                <AiOverviewPanel event={latestAiDecision} run={run} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <Link href={`/incidents/${run.id}`} style={{ ...action, flex: 1, textAlign: 'center', textDecoration: 'none', padding: '8px 12px', fontSize: 12 }}>
                    Open Incident Cockpit & Telemetry →
                  </Link>
                  <Link href={`/plans/${run.id}`} style={{ ...ghost, flex: 1, textAlign: 'center', textDecoration: 'none', padding: '8px 12px', fontSize: 12 }}>
                    Review Recovery Plans ({candidatePlans.length}) →
                  </Link>
                </div>
              </div>

              {/* Right Column: Incident Stream & Rules Master-Detail */}
              <div className="overview-right-pane">
                <section style={{ ...card, padding: '10px 14px', height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <SectionHeader index="02" title="Incident Stream & Invariant Rules" subtitle="Select any rule to inspect verified safety evidence" />
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{decisionRows.length} events</span>
                  </div>

                  <div className="overview-rules-stream">
                    {decisionRows.map((event) => {
                      const isSelected = selectedRuleId === event.event_id;
                      const isDecision = event.kind === 'decision';
                      const decisionPayload = isDecision ? (event as DecisionEvent).payload : null;
                      const executionPayload = !isDecision ? (event as ExecutionEvent).payload : null;
                      const risk = decisionPayload?.predicted_risk;
                      return (
                        <div
                          key={event.event_id}
                          className={`overview-rule-item ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => setSelectedRuleId(isSelected ? null : event.event_id)}
                        >
                          <div className="rule-item-summary">
                            <span className="rule-item-tick">TICK {event.tick}</span>
                            <span className="rule-item-text">
                              {executionPayload
                                ? `Executed: ${actionLabel(executionPayload.action)} · ${executionPayload.agent_id}`
                                : `Evaluated: ${actionListLabel(decisionPayload?.actions || [])}`}
                            </span>
                            <span className={`rule-risk-tag ${risk && risk > 0.25 ? 'risk-warn' : 'risk-ok'}`}>
                              Risk {risk !== undefined ? risk : '0.00'}
                            </span>
                          </div>

                          {isSelected && (
                            <div className="rule-expanded-detail">
                              <p style={{ margin: '4px 0 2px', fontWeight: 600 }}>Decision Context & Safety Provenance:</p>
                              <p style={{ ...muted, margin: 0, fontSize: 11 }}>
                                {decisionPayload?.reasons?.join('; ') || 'Deterministic coordinator evaluated candidate proposals against database pool saturation thresholds.'}
                              </p>
                              {decisionPayload?.ai?.diagnosis && (
                                <p style={{ ...muted, margin: '4px 0 0', fontSize: 11 }}>
                                  Diagnosis: {decisionPayload.ai.diagnosis.cause} ({decisionPayload.ai.diagnosis.severity})
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* INCIDENT: Dedicated Cockpit with Live Telemetry Chart */}
          {view === 'incident' && (
            <div className="cockpit-layout">
              <div className="cockpit-main">
                <AiOverviewPanel event={latestAiDecision} run={run} />
                <section className="dashboard-panel telemetry-panel" style={{ ...card, padding: '10px 14px' }}>
                  <SectionHeader index={numbering.telemetry} title="Incident Telemetry" subtitle={run.scenario === 'telemetry_faults' ? 'Sensor readings; telemetry can be delayed or dropped.' : 'Backlog (blue) and error rate (red) per tick; orange verticals mark executed recovery actions.'} />
                  <IncidentTelemetryChart events={events} />
                </section>
                {latestChecks && (
                  <section style={{ ...card, padding: '8px 12px' }}>
                    <SectionHeader index={numbering.tests} title="Acceptance Probes & Health Invariants" />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 6 }}>
                      {latestChecks.checks.map((check, index) => (
                        <div key={index} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
                          <span style={{ ...chip, padding: '2px 6px', fontSize: 10, color: check.status === 'pass' ? 'var(--success)' : 'var(--danger)', border: '1px solid var(--border)' }}>
                            {check.status.toUpperCase()}
                          </span>
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{check.description}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
              <div className="cockpit-sidebar">
                <section style={{ ...card, padding: '10px 14px' }}>
                  <SectionHeader index={numbering.topo} title="Service Topology" />
                  <ServiceTopology topology={topology} fault={faultedService[run.scenario]} queues={servicePeaks} />
                </section>
                <section style={{ ...card, padding: '10px 14px' }}>
                  <SectionHeader index={numbering.dec} title="Decisions" subtitle="Proposed and executed actions" />
                  <div className="decisions-stream" style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {decisionRows.map((event) => <div key={event.event_id} style={{ borderTop: '1px solid var(--border)', padding: '6px 0', fontSize: 12 }}>
                      {event.kind === 'execution'
                        ? <>Tick {event.tick}: <strong>{actionLabel(event.payload.action)}</strong> <span style={muted}>· {event.payload.agent_id}</span></>
                        : <>Tick {event.tick}: <strong>{actionListLabel(event.payload.actions)}</strong> <span style={muted}>· risk {event.payload.predicted_risk}</span></>}
                    </div>)}
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* PLANS: Master-Detail Layout with Single Decision Gate */}
          {view === 'plans' && (
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
                    const isSuperseded = Boolean(approvedPlan && !isPlanApproved);
                    const displayStatus = isPlanApproved ? 'approved' : isSuperseded ? 'superseded' : plan.status;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => setSelectedPlanId(plan.id)}
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
                      <span className={`plan-status-pill status-${selectedPlan.status === 'approved' ? 'approved' : approvedPlan ? 'superseded' : selectedPlan.status}`}>
                        {(selectedPlan.status === 'approved' ? 'approved' : approvedPlan ? 'superseded' : selectedPlan.status).toUpperCase()}
                      </span>
                    </div>

                    <div className="plan-evidence-grid">
                      <div className="evidence-block">
                        <h4>DIAGNOSED TRIGGER</h4>
                        <p>{run.diagnosis?.cause || 'Database and service queue backpressure condition detected.'}</p>
                        <small style={muted}>{run.diagnosis?.rationale || 'Queue latency exceeds safety threshold.'}</small>
                      </div>

                      <div className="evidence-block">
                        <h4>SAFETY INVARIANTS</h4>
                        <div className="invariant-score">
                          Joint Risk Score: <strong>{selectedPlan.predicted_risk}</strong> <span style={{ color: selectedPlan.predicted_risk < 0.35 ? 'var(--success)' : 'var(--danger)' }}>({selectedPlan.predicted_risk < 0.35 ? 'PASS · Below 0.35 limit' : 'HIGH RISK'})</span>
                        </div>
                        <ul className="evidence-reasons">
                          {selectedPlan.reasons.map((r, i) => <li key={i}>{r}</li>)}
                          {selectedPlan.ai?.safety_reasons?.map((r, i) => <li key={`s-${i}`}>{r}</li>)}
                        </ul>
                      </div>
                    </div>

                    {/* Backtest replay outcome if available */}
                    {(() => {
                      const res = backtests[selectedPlan.id] ?? selectedPlan.backtest;
                      if (!res) return null;
                      return <BacktestVerdict result={res} />;
                    })()}

                    {/* Operator Decision Action Area */}
                    <div className="plan-operator-gate">
                      {selectedPlan.status === 'approved' ? (
                        <div className="approval-receipt-box">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--success)', fontWeight: 700 }}>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="2"/><path d="M5 8.5L7 10.5L11 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                            Plan Approved by Authenticated Operator
                          </div>
                          <p style={{ margin: '4px 0 2px', fontSize: 12 }}>Operator Rationale: <em>{selectedPlan.operator_reason || 'Verified safety headroom and capacity'}</em></p>
                          <small style={muted}>Immutable audit proof recorded · Dry-run sandbox execution completed</small>
                        </div>
                      ) : approvedPlan ? (
                        <div className="superseded-notice-box">
                          <strong>🔒 Incident Run Decided</strong>
                          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                            Recovery plan for <strong>Tick {approvedPlan.decision_tick}</strong> has already been approved. To prevent conflicting operational states, this candidate is superseded and locked.
                          </p>
                        </div>
                      ) : (
                        <div className="approval-form">
                          <input
                            type="text"
                            placeholder="Operator decision rationale (e.g. Verified database connection headroom)..."
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
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ ...card, padding: 24, textAlign: 'center' }}>
                    <p style={muted}>Select a plan from the list to review decision evidence.</p>
                  </div>
                )}
              </div>
            </div>
          )}
          {view === 'experiments' && <section className="experiment-panel" style={card}>
            <SectionHeader index="01" title="The Experiment Lab" subtitle="Replay one candidate against the same synthetic incident before deciding whether to approve it." />
            <div className="experiments-dual-grid">
              <div className="experiment-candidate-pane">
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
              </div>
              <div className="experiment-comparison-pane">
                {comparison.length > 0 && <div style={{ overflowX: 'auto', marginTop: 12 }}>
                  <p data-testid="comparison-context" style={muted}>{comparisonContext}</p>
                  <table aria-label="Policy comparison" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead><tr><th>Policy / source</th><th>Unique failed</th><th>Actions</th><th>Recovery tick</th><th>Decision p50 ms</th><th>Decision p95 ms</th></tr></thead>
                    <tbody>{comparison.map((arm) => <tr key={arm.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 10 }}>{POLICY_LABEL[arm.policy]}<br /><small>{arm.provenance}</small></td><td>{number(arm.metrics?.unique_failed)}</td><td>{number(arm.metrics?.actions_executed)}</td>
                      <td>{arm.metrics?.sustained_recovery_time === -1 ? 'Not reached' : number(arm.metrics?.sustained_recovery_time)}</td>
                      <td>{arm.runtime?.decision_latency_p50_ms ?? '—'}</td><td>{arm.runtime?.decision_latency_p95_ms ?? '—'}</td>
                    </tr>)}</tbody>
                  </table>
                  <p style={{ ...muted, marginTop: 8 }}>Decision latency is local process wall-clock time for the per-tick policy block. A live AI planner may include its model call. It is reported separately from synthetic service outcomes.</p>
                  <p style={muted}>One seed is a demonstration, not a statistical result.</p>
                </div>}
              </div>
            </div>
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
