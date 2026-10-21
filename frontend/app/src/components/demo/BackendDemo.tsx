'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  POLICIES, POLICY_LABEL, POLICY_BLURB, SCENARIOS, SCENARIO_LABEL, SCENARIO_BLURB,
} from '@/lib/labels';
import { IncidentTelemetryChart } from './IncidentTelemetryChart';
import { KpiCard, SectionHeader } from '@/components/ui/kit';
import type {
  AIProbeOutcome, BacktestResult, CascadeEvent, DecisionEvent,
  ExecutionEvent, MetricEvent, Plan, Run, RunPolicy, RunScenario, Topology,
} from '@/types/api';

type View = 'overview' | 'incident' | 'plans' | 'experiments' | 'audit';
const KEY = 'cascade-demo-run-id';
const SEED = 42;
const card: React.CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 };
const muted: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 };
const action: React.CSSProperties = { border: 0, borderRadius: 8, background: 'var(--accent)', color: '#fff', padding: '10px 14px', cursor: 'pointer', fontWeight: 600 };
const ghost: React.CSSProperties = { ...action, background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)' };
const chip: React.CSSProperties = { display: 'inline-block', borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' };
const input: React.CSSProperties = { padding: 8, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' };

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

export function BackendDemo({ view, runId }: { view: View; runId?: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [events, setEvents] = useState<CascadeEvent[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [comparison, setComparison] = useState<Run[]>([]);
  const [seed, setSeed] = useState(SEED);
  const [policy, setPolicy] = useState<RunPolicy>('ai_coordinated');
  const [scenario, setScenario] = useState<RunScenario>('db_slowdown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [noRun, setNoRun] = useState(false);
  const [backtests, setBacktests] = useState<Record<string, BacktestResult>>({});
  const [backtesting, setBacktesting] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastEventIdRef = useRef<string | undefined>(undefined);

  const refresh = useCallback(async (id: string, mode: 'full' | 'tail' = 'full') => {
    // A tail fetch uses the backend's Last-Event-ID resume so a running run
    // never re-downloads its whole event history on every poll tick.
    const after = mode === 'tail' ? lastEventIdRef.current : undefined;
    const [current, trace, candidates] = await Promise.all([
      api.getRun(id), api.getEvents(id, after), api.listPlans(id),
    ]);
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
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const current = await refresh(id, 'tail');
        if (current.state !== 'running') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          // Final full refresh picks up anything the tail window missed.
          await refresh(id);
          window.dispatchEvent(new Event('cascade-run-changed'));
        }
      } catch {
        /* transient poll failure; the next tick retries */
      }
    }, 2000);
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
        if (runId) current = await api.getRun(runId).catch(() => undefined);
        if (!current) current = history[0];
        if (!current) {
          if (!cancelled) { setNoRun(true); setError(''); }
          return;
        }
        setNoRun(false);
        localStorage.setItem(KEY, current.id);
        const id = current.id;
        setPolicy(current.policy); setScenario(current.scenario);
        await refresh(id);
        if (!cancelled) {
          setTopology(await api.getTopology());
          setError('');
          if (current.state === 'running') pollWhileRunning(id);
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load the sandbox run');
      }
    }
    load();
    const onRunChanged = () => { if (!runId) load(); };
    window.addEventListener('cascade-run-changed', onRunChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('cascade-run-changed', onRunChanged);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [runId, refresh, pollWhileRunning]);

  const decisions = events.filter((event): event is DecisionEvent => event.kind === 'decision');
  const executions = events.filter((event): event is ExecutionEvent => event.kind === 'execution');
  const visiblePlans = plans.filter((plan) => plan.actions.length).slice(0, 12);
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
    plans: 'The AI records candidate actions with its diagnosis and predicted risk. Approval verifies the plan against the recorded trace.',
    experiments: 'Run all five policies against the same seed and compare unique failed transactions.',
    audit: 'The event log exposes telemetry, AI decisions with provenance, and action records.',
  }[view];

  async function restart() {
    setBusy(true); setError('');
    try {
      const created = await api.createRun({ seed, scenario, policy });
      localStorage.setItem(KEY, created.id);
      window.dispatchEvent(new Event('cascade-run-changed'));
      // Keep run-scoped URLs in sync without navigating anywhere.
      if (runId && (view === 'incident' || view === 'plans')) {
        window.history.replaceState(null, '', `/${view === 'incident' ? 'incidents' : 'plans'}/${created.id}`);
      }
      await refresh(created.id);
      if (created.state === 'running') pollWhileRunning(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create run');
    } finally { setBusy(false); }
  }

  async function approve(plan: Plan) {
    setBusy(true); setError('');
    try {
      await api.approvePlan(plan.id, true);
      setPlans(await api.listPlans(plan.run_id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Approval failed');
    } finally { setBusy(false); }
  }

  async function backtest(plan: Plan) {
    setBacktesting(plan.id); setError('');
    try {
      const result = await api.backtestPlan(plan.id);
      setBacktests((prior) => ({ ...prior, [plan.id]: result }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Backtest failed');
    } finally { setBacktesting(null); }
  }

  async function compare() {
    setBusy(true); setError('');
    try {
      // All five arms run concurrently against the threaded sandbox server;
      // each AI arm still waits for its own background run to finish.
      const results = await Promise.all(POLICIES.map(async (arm) => {
        const created = await api.createRun({ seed, scenario, policy: arm });
        return created.state === 'running' ? await waitUntilDone(created.id) : created;
      }));
      setComparison(results);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Comparison failed');
    } finally { setBusy(false); }
  }

  const metrics = events.filter((event): event is MetricEvent => event.kind === 'metric');
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
    <main style={{ maxWidth: 1300, display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 26, color: 'var(--text-primary)', marginBottom: 4 }}>{title}</h1>
        <p style={muted}>{explanation}</p>
      </div>
      {error && <div role="alert" style={{ ...card, borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}. Start the backend with <code>python -m backend.api</code> and reload.</div>}
      {!run && !error && !noRun && <div style={card}>Loading a backend run…</div>}
      {!run && !error && noRun && (
        <section style={{ ...card, display: 'grid', gap: 14, justifyItems: 'center', padding: '48px 24px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 22, margin: 0, color: 'var(--text-primary)' }}>Nothing has run yet</h2>
          <p style={{ ...muted, maxWidth: 520 }}>
            Start a run from the Incidents tab: pick a scenario (what breaks), a policy (who
            decides how to fix it) and a seed. The pages here fill in as soon as a run exists.
          </p>
          <Link href="/incidents" style={{ ...action, textDecoration: 'none', display: 'inline-block' }}>Start an incident →</Link>
        </section>
      )}
      {run && (
        <>
          {view !== 'overview' && (
          <section style={{ ...card, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
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
          <section style={{ ...card, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <strong>Run {run.id.slice(0, 8)} · {POLICY_LABEL[run.policy]}</strong>
              <div style={muted}>
                Seed {run.seed} · {SCENARIO_LABEL[run.scenario] ?? run.scenario} · {run.state}
                {run.created_at ? ` · started ${new Date(run.created_at).toLocaleTimeString()}` : ''}
                {run.state === 'running' && '. The AI is evaluating; events stream in as they happen'}
              </div>
            </div>
            <Link href="/incidents" style={{ color: 'var(--accent)', fontWeight: 600 }}>Start a new run in Incidents →</Link>
          </section>
          {view === 'overview' && (
            <section style={card}>
              <SectionHeader index="01" title="How this dashboard works" />
              <ol style={{ ...muted, paddingLeft: 20, display: 'grid', gap: 6 }}>
                <li><strong style={{ color: 'var(--text-primary)' }}>Start a run</strong> from the <Link href="/incidents">Incidents tab</Link>. Pick <em>what breaks</em> (scenario), <em>who decides how to fix it</em> (policy) and a seed. The same seed replays the same incident; a random seed gives you a fresh one.</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>The incident unfolds.</strong> Services degrade, telemetry moves, recovery agents propose actions from what they can see. This page always shows the newest run.</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>The policy decides.</strong> {POLICY_BLURB[policy]}</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Judge it by outcomes.</strong> Every number below is computed by the backend for this run. Open <Link href={'/incidents/' + run.id}>the incident</Link> for the telemetry chart, or <Link href={'/plans/' + run.id}>Recovery Plans</Link> to backtest a plan before approving it.</li>
              </ol>
            </section>
          )}
          {(view === 'overview' || view === 'incident') && (
            <>
              {view === 'incident' && <SectionHeader index={numbering.metrics} title="Outcome metrics" />}
              <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
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
                <section style={card}>
                  <SectionHeader index={numbering.telemetry} title="Incident telemetry" subtitle="Backlog (blue) and error rate (red) per tick; orange verticals mark executed recovery actions. The fault starts at tick 10 and eases around tick 35." />
                  <IncidentTelemetryChart events={events} />
                </section>
              )}
              {aiDecisions.length > 0 && (
                <section style={card}>
                  <SectionHeader index={numbering.ai} title="AI evaluations" subtitle="Each card says whether the live model made the call or the rule fallback did." />
                  {aiDecisions.slice(0, 4).reverse().map((event) => {
                    const info = event.payload.ai!;
                    return (
                      <div key={event.event_id} style={{ borderTop: '1px solid var(--border)', padding: '14px 0' }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                          <strong style={{ ...chip, background: info.live ? 'var(--accent)' : 'var(--text-muted)', color: '#fff' }}>
                            {info.live ? `LIVE AI · ${info.model}` : 'RULE FALLBACK'}
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
                          Decision: <strong>{event.payload.actions.join(' + ') || 'no action'}</strong>
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
                  const faultText = run.scenario === 'traffic_surge'
                    ? 'traffic surged past capacity from tick 10'
                    : run.scenario === 'payments_degradation'
                      ? 'the payments service degraded from tick 10 to 35'
                      : 'the shared database degraded from tick 10 to 35';
                  const decider = run.policy === 'ai_coordinated'
                    ? (liveOnes > 0
                        ? `Gemma diagnosed and decided at ${liveOnes} point${liveOnes === 1 ? '' : 's'} (${aiEntries.length - liveOnes} fell back to rules)`
                        : `the model was unreachable, so the rule fallback decided all ${aiEntries.length || 0} time${aiEntries.length === 1 ? '' : 's'}`)
                    : `${POLICY_LABEL[run.policy]} decided with deterministic rules`;
                  return `Seed ${run.seed}: ${faultText}. Recovery agents proposed actions from observable telemetry; ${decider}. ` +
                    (actions > 0
                      ? `${actions} action${actions === 1 ? '' : 's'} executed; the decisions list below has them all.`
                      : 'No recovery action was executed in this run; the incident resolved on its own schedule.');
                })()}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <Link href={'/plans/' + run.id}>Review candidate plans</Link>
                  <Link href="/experiments">Compare five policies</Link>
                  <Link href="/audit">Inspect event log</Link>
                </div>
              </section>
              <section style={card}>
                <SectionHeader index={numbering.topo} title="Service topology" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
                  {topology?.nodes.map((node) => {
                    const stats = servicePeaks[node.id];
                    const faulted = faultedService[run.scenario] === node.id;
                    const hot = stats ? stats.peak >= 150 : false;
                    const warm = stats ? stats.peak >= 50 && !hot : false;
                    return <div key={node.id} style={{
                      padding: 12, borderRadius: 8,
                      border: `1px solid ${faulted ? 'var(--warning)' : 'var(--border)'}`,
                      background: faulted ? 'rgba(245, 165, 36, 0.07)' : undefined,
                    }}>
                      <strong>{node.id}</strong>
                      {faulted && <span style={{ ...muted, marginLeft: 6, color: 'var(--warning)' }}>· faulted here</span>}
                      <div style={muted}>capacity {node.capacity}/tick</div>
                      <div style={{ ...muted, color: hot ? 'var(--danger)' : warm ? 'var(--warning)' : undefined }}>
                        {stats ? `peak backlog ${stats.peak.toLocaleString()} · final ${stats.last.toLocaleString()}` : 'backlog —'}
                      </div>
                    </div>;
                  })}
                </div>
                <p style={{ ...muted, marginTop: 10 }}>Backlog numbers are this run&apos;s actual per-service queue depths. Dependencies: {topology?.edges.map((edge) => edge.from + ' → ' + edge.to).join(' · ')}</p>
              </section>
              <section style={card}>
                <SectionHeader index={numbering.dec} title="Decisions" subtitle="Every action this policy took, tick by tick." />
                {decisionRows.length ? decisionRows.map((event) => <div key={event.event_id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
                  {event.kind === 'execution'
                    ? <>Tick {event.tick}: {event.payload.action} <span style={muted}>· by {event.payload.agent_id}</span></>
                    : <>Tick {event.tick}: {event.payload.actions.join(', ')} <span style={muted}>· risk {event.payload.predicted_risk}</span></>}
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
          {view === 'plans' && <section style={card}>
            <SectionHeader index="01" title="Candidate plans" subtitle="Approve a plan directly, or backtest it first: the backend replays the incident locally with the plan applied and tells you whether it helped. Nothing live is touched." />
            <p style={muted}>Every plan below came out of this run. <strong>Backtest</strong> shows the measured effect before you commit; <strong>Approve directly</strong> skips straight to execution.</p>
            {visiblePlans.map((plan) => {
              const info = plan.ai;
              const result = backtests[plan.id];
              return <div key={plan.id} style={{ borderTop: '1px solid var(--border)', padding: '14px 0' }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <strong>{plan.actions.join(' + ')}</strong>
                    {info?.diagnosis && <div style={muted}>diagnosis: {info.diagnosis.cause} ({info.diagnosis.severity})</div>}
                    <div style={muted}>Risk estimate {plan.predicted_risk} · {plan.reasons.join('; ')} · {plan.status}</div>
                  </div>
                  {plan.status === 'candidate' && <>
                    <button type="button" disabled={busy || backtesting === plan.id} onClick={() => backtest(plan)} style={ghost}>
                      {backtesting === plan.id ? 'Backtesting…' : result ? 'Backtest again' : 'Backtest'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => approve(plan)} style={action}>Approve directly</button>
                  </>}
                </div>
                {result && <BacktestVerdict result={result} />}
              </div>;
            })}
            {!visiblePlans.length && <p style={muted}>No candidate with an action was generated. Start an AI or coordinator run first.</p>}
          </section>}
          {view === 'experiments' && <section style={card}>
            <SectionHeader index="01" title="The Experiment Lab" subtitle="Check a plan here before it counts." />
                    <ul style={{ ...muted, paddingLeft: 20, display: 'grid', gap: 6, marginBottom: 16 }}>
              <li><strong style={{ color: 'var(--text-primary)' }}>Backtest one plan.</strong> On any candidate plan (<Link href={'/plans/' + run.id}>Recovery Plans</Link>) press <em>Backtest</em>: the incident replays locally with that plan applied, and you see whether it helps or hurts, and by how much.</li>
              <li><strong style={{ color: 'var(--text-primary)' }}>Compare policies.</strong> Run the same incident under all five policies and see which fails fewest transactions. Lower is better.</li>
            </ul>
            <button type="button" disabled={busy} onClick={compare} style={action}>{busy ? 'Running…' : 'Run comparison on this seed'}</button>
            {comparison.length > 0 && <div style={{ overflowX: 'auto', marginTop: 18 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead><tr><th>Policy</th><th>Unique failed</th><th>Actions</th><th>Sustained recovery tick</th></tr></thead>
                <tbody>{comparison.map((arm) => <tr key={arm.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: 10 }}>{POLICY_LABEL[arm.policy]}</td><td>{number(arm.metrics?.unique_failed)}</td><td>{number(arm.metrics?.actions_executed)}</td>
                  <td>{arm.metrics?.sustained_recovery_time === -1 ? 'Not reached' : number(arm.metrics?.sustained_recovery_time)}</td>
                </tr>)}</tbody>
              </table>
              <p style={muted}>One seed is a demonstration, not a statistical result.</p>
            </div>}
          </section>}
          {view === 'audit' && <section style={card}>
            <SectionHeader index="01" title={`Backend events (${events.length})`} subtitle="First 80 events; each has a tick and full provenance." />
            <div style={{ maxHeight: 650, overflowY: 'auto' }}>{events.slice(0, 80).map((event) =>
              <details key={event.event_id} style={{ padding: '9px 0', borderTop: '1px solid var(--border)' }}>
                <summary style={{ cursor: 'pointer' }}>Tick {event.tick} · {event.kind} · {event.event_id}</summary>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 11 }}>{JSON.stringify(event.payload, null, 2)}</pre>
              </details>)}</div>
          </section>}
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
          BACKTEST: {result.verdict.toUpperCase()}
        </strong>
        <span style={{ color, fontWeight: 700 }}>
          {delta === 0 ? 'no measurable change' : `${delta > 0 ? '+' : ''}${delta.toLocaleString()} failed transactions vs doing nothing`}
        </span>
        <span style={muted}>
          {result.plan_failed.toLocaleString()} failed with the plan vs {result.baseline_failed.toLocaleString()} with no action · seed {result.seed} · {result.arms[0].horizon_ticks} ticks
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
              <td style={{ padding: 4 }}>{arm.actions.join(' + ') || 'no action (baseline)'}</td>
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
          <th style={{ padding: '4px 14px 4px 0' }}>Probe</th><th style={{ padding: '4px 14px 4px 0' }}>Unique failed</th>
          <th style={{ padding: '4px 14px 4px 0' }}>Succeeded</th><th style={{ padding: '4px 14px 4px 0' }}>Actions</th>
        </tr></thead>
        <tbody>{probes.map((probe, index) => (
          <tr key={index} style={{ borderTop: '1px solid var(--border)' }}>
            <td style={{ padding: 4 }}>{probe.actions.join(' + ') || 'no action'}</td>
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
