'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  POLICIES, POLICY_LABEL, SCENARIOS, SCENARIO_LABEL, SCENARIO_BLURB,
} from '@/lib/labels';
import type { Run, RunPolicy, RunScenario } from '@/types/api';

/**
 * Incident history: every run this backend has executed, newest first, plus a
 * quick way to start the next one. Runs live in the backend's memory and
 * disappear when it restarts.
 */
export function LiveIncidentsEntry() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000));
  const [scenario, setScenario] = useState<RunScenario>('db_slowdown');
  const [policy, setPolicy] = useState<RunPolicy>('ai_coordinated');

  const load = useCallback(async () => {
    try {
      setRuns(await api.listRuns());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load run history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial load in a timer callback so no setState runs synchronously in
    // the effect body (same pattern as Header's clock).
    const initial = setTimeout(load, 0);
    const onRunChanged = () => load();
    window.addEventListener('cascade-run-changed', onRunChanged);
    return () => {
      clearTimeout(initial);
      window.removeEventListener('cascade-run-changed', onRunChanged);
    };
  }, [load]);

  async function startRun() {
    setBusy(true); setError(null);
    try {
      const created = await api.createRun({ seed, scenario, policy, purpose: 'operator_review' });
      localStorage.setItem('cascade-demo-run-id', created.id);
      router.push(`/incidents/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create run');
      setBusy(false);
    }
  }

  const input: React.CSSProperties = { padding: 8, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)' };
  const button: React.CSSProperties = { border: 0, borderRadius: 8, background: 'var(--accent)', color: 'var(--bg-elevated)', padding: '10px 14px', cursor: 'pointer', fontWeight: 600 };
  const muted: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 13 };
  const stateColor: Record<string, string> = {
    completed: 'var(--success)', running: 'var(--warning)',
    failed: 'var(--danger)', created: 'var(--text-muted)',
  };

  return (
    <main className="console-page console-page--incidents">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">CASCADE ZERO <span aria-hidden="true">/</span> INCIDENT WORKSPACE</p>
          <h1>Simulate an incident</h1>
          <p style={muted}>Choose a fault and policy. The telemetry is generated and repeatable; the operator controls every proposed recovery action.</p>
        </div>
        <span className="page-mode-tag"><span aria-hidden="true" /> No production connection</span>
      </div>
      <section className="incident-setup-panel" style={{ padding: 22, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <strong>Configure the scenario</strong>
          <div style={muted}>Adjust the seed to replay the same conditions or generate a new telemetry pattern.</div>
        </div>
        <label style={muted}>Seed
          <input type="number" min="0" value={seed}
                 onChange={(e) => setSeed(Math.max(0, Number(e.target.value) || 0))}
                 style={{ ...input, width: 100, marginLeft: 8 }} />
        </label>
        <label style={muted}>Scenario
          <select value={scenario} onChange={(e) => setScenario(e.target.value as RunScenario)} style={{ ...input, marginLeft: 8 }}>
            {SCENARIOS.map((name) => <option key={name} value={name} title={SCENARIO_BLURB[name]}>{SCENARIO_LABEL[name]}</option>)}
          </select>
        </label>
        <label style={muted}>Policy
          <select value={policy} onChange={(e) => setPolicy(e.target.value as RunPolicy)} style={{ ...input, marginLeft: 8 }}>
            {POLICIES.map((name) => <option key={name} value={name}>{POLICY_LABEL[name]}</option>)}
          </select>
        </label>
        <button type="button" onClick={startRun} disabled={busy} style={button}>
          {busy ? 'Generating telemetry…' : 'Generate incident'}
        </button>
      </section>

      {error && (
        <div role="alert" className="surface" style={{ padding: 16, border: '1px solid var(--danger)', color: 'var(--danger)' }}>
          {error}. Start the backend with <code>python -m backend.api</code> and reload.
        </div>
      )}

      <section className="surface run-history-panel" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
          <h2 style={{ fontSize: 18 }}>Run history</h2>
          <span style={muted}>every run this backend has executed; use Open run to inspect one</span>
        </div>
        {loading ? <p style={muted}>Loading…</p> : runs.length === 0 ? (
          <p style={muted}>No runs yet. Start one above.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '8px 12px 8px 0' }}>Started</th>
                  <th style={{ padding: 8 }}>Scenario</th>
                  <th style={{ padding: 8 }}>Policy</th>
                  <th style={{ padding: 8 }}>Seed</th>
                  <th style={{ padding: 8 }}>State</th>
                  <th style={{ padding: 8 }}>Failed</th>
                  <th style={{ padding: 8 }}>Actions</th>
                  <th style={{ padding: 8 }}>Open</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}
                      style={{ borderTop: '1px solid var(--border)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {run.created_at ? new Date(run.created_at).toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: 8 }}>{SCENARIO_LABEL[run.scenario] ?? run.scenario}</td>
                    <td style={{ padding: 8 }}>{POLICY_LABEL[run.policy] ?? run.policy}</td>
                    <td style={{ padding: 8, fontFamily: 'var(--font-mono)' }}>{run.seed}</td>
                    <td style={{ padding: 8, color: stateColor[run.state] ?? 'var(--text-secondary)', fontWeight: 600 }}>{run.state}</td>
                    <td style={{ padding: 8 }}>
                      {run.metrics?.unique_failed !== undefined
                        ? run.metrics.unique_failed.toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: 8 }}>
                      {run.metrics?.actions_executed !== undefined
                        ? run.metrics.actions_executed.toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: 8 }}>
                      <Link href={`/incidents/${run.id}`}
                            aria-label={`Open run ${SCENARIO_LABEL[run.scenario] ?? run.scenario}, ${POLICY_LABEL[run.policy] ?? run.policy}`}
                            style={{ color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        Open run
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
