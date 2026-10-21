'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { KpiCard, LabeledRow, SectionHeader } from '@/components/ui/kit';
import { POLICY_LABEL, SCENARIO_LABEL } from '@/lib/labels';
import type { AdminStatus, Run } from '@/types/api';

/**
 * Project admin: the command-center view over everything Cascade Zero has
 * done — system health, the AI engine's condition, recent activity, and the
 * scenario/policy configuration.
 */
export function AdminDashboard() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [nextStatus, nextRuns] = await Promise.all([
        api.getAdminStatus(), api.listRuns(),
      ]);
      setStatus(nextStatus); setRuns(nextRuns); setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load admin status');
    }
  }, []);

  useEffect(() => {
    // Initial load in a timer callback so no setState runs synchronously in
    // the effect body (same pattern as Header's clock).
    const initial = setTimeout(load, 0);
    window.addEventListener('cascade-run-changed', load);
    return () => {
      clearTimeout(initial);
      window.removeEventListener('cascade-run-changed', load);
    };
  }, [load]);

  if (error) {
    return <div role="alert" className="surface" style={{
      padding: 20, border: '1px solid var(--danger)', color: 'var(--danger)',
    }}>{error}. Start the backend with <code>python -m backend.api</code> and reload.</div>;
  }
  if (!status) return <div className="surface" style={{ padding: 20 }}>Loading project status…</div>;

  const ai = status.ai_engine;
  const aiTotal = ai.live_decisions + ai.fallback_decisions;
  const liveRate = aiTotal ? Math.round((ai.live_decisions / aiTotal) * 100) : null;
  const successRate = status.transactions.offered
    ? Math.round((status.transactions.succeeded / status.transactions.offered) * 100)
    : null;

  return (
    <main style={{ maxWidth: 1300, display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 26, color: 'var(--text-primary)', marginBottom: 4 }}>Project Admin</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Everything the system has done, updated whenever a run finishes.
        </p>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
        <KpiCard label="Runs executed" value={status.runs.total}
                  context={`${status.runs.by_state.completed ?? 0} completed · ${status.runs.by_state.running ?? 0} running`} />
        <KpiCard label="Transactions protected" value={status.transactions.succeeded.toLocaleString()}
                  context={`of ${status.transactions.offered.toLocaleString()} offered · ${successRate !== null ? successRate + '% succeeded' : ''}`}
                  tone={successRate !== null && successRate >= 70 ? 'good' : 'warn'} />
        <KpiCard label="Recovery actions" value={status.transactions.actions.toLocaleString()}
                  context="executed across all runs" />
        <KpiCard label="AI live decisions" value={ai.live_decisions.toLocaleString()}
                  context={liveRate !== null ? `${liveRate}% of ${aiTotal} AI decisions went to the live model` : 'no AI decisions yet'}
                  tone={ai.provider_configured ? (liveRate !== null && liveRate > 0 ? 'good' : 'warn') : 'bad'} />
      </section>

      <section className="surface" style={{ padding: 20 }}>
        <SectionHeader index="01" title="System status" subtitle="Backend and provider health right now." />
        <LabeledRow label="Backend API">
          <span style={{ color: 'var(--success)', fontWeight: 600 }}>● healthy</span>
        </LabeledRow>
        <LabeledRow label="Runs stored in memory">{status.backend.runs_stored} (cleared on restart)</LabeledRow>
        <LabeledRow label="AI provider key (GEMINI_API_KEY)">
          {ai.provider_configured
            ? <span style={{ color: 'var(--success)' }}>configured</span>
            : <span style={{ color: 'var(--danger)' }}>not set, so AI runs fall back to the rule coordinator</span>}
        </LabeledRow>
        <LabeledRow label="Default model">{ai.model}</LabeledRow>
      </section>

      <section className="surface" style={{ padding: 20 }}>
        <SectionHeader index="02" title="AI engine" subtitle="How the decision engine has been performing." />
        <LabeledRow label="Live model decisions">{ai.live_decisions.toLocaleString()}</LabeledRow>
        <LabeledRow label="Labeled fallback decisions">{ai.fallback_decisions.toLocaleString()}</LabeledRow>
        {Object.entries(ai.top_fallback_reasons).map(([reason, count]) => (
          <LabeledRow key={reason} label={`↳ ${reason}`}>{count.toLocaleString()} decisions</LabeledRow>
        ))}
        {Object.keys(ai.top_fallback_reasons).length === 0 && (
          <LabeledRow label="Fallback reasons">none recorded</LabeledRow>
        )}
      </section>

      <section className="surface" style={{ padding: 20 }}>
        <SectionHeader index="03" title="Recent activity" subtitle="The latest runs, newest first." />
        {runs.slice(0, 8).map((run) => (
          <LabeledRow key={run.id} label={
            <span>
              {run.created_at ? new Date(run.created_at).toLocaleTimeString() : ''}
              {' · '}{SCENARIO_LABEL[run.scenario] ?? run.scenario}
            </span>
          }>
            <Link href={`/incidents/${run.id}`} style={{ color: 'var(--accent)' }}>
              {POLICY_LABEL[run.policy] ?? run.policy}
            </Link>
            {' · '}{run.metrics?.unique_failed !== undefined
              ? `${run.metrics.unique_failed.toLocaleString()} failed` : run.state}
          </LabeledRow>
        ))}
        {runs.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No runs yet.</p>}
      </section>

      <section className="surface" style={{ padding: 20 }}>
        <SectionHeader index="04" title="Scenarios & policies" subtitle="What can be simulated, and what each policy means." />
        {Object.entries(status.scenarios).map(([name, config]) => (
          <LabeledRow key={name} label={SCENARIO_LABEL[name as keyof typeof SCENARIO_LABEL] ?? name}>
            actions: {config.actions_available.join(' · ')}
          </LabeledRow>
        ))}
        {Object.keys(status.runs.by_policy).length > 0 && (
          <LabeledRow label="Policies exercised">
            {Object.entries(status.runs.by_policy)
              .map(([policy, count]) => `${POLICY_LABEL[policy as keyof typeof POLICY_LABEL] ?? policy} ×${count}`)
              .join(' · ')}
          </LabeledRow>
        )}
      </section>
    </main>
  );
}
