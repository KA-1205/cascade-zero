'use client';

import React, { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  SectionHeading, PredictedLabel,
} from '@/components/ui/primitives';
import { mockExperiment } from '@/lib/fixtures';
import type { ExperimentArm, RunPolicy } from '@/types/api';

// ── Policy metadata ─────────────────────────────────────────────────────────────

const POLICY_META: Record<RunPolicy, { label: string; color: string; description: string; icon: string }> = {
  none: {
    label: 'No Recovery',
    color: 'var(--text-muted)',
    description: 'Infrastructure fails without any automated intervention. Baseline.',
    icon: '○',
  },
  independent: {
    label: 'Independent Agents',
    color: 'var(--danger)',
    description: 'Each recovery agent acts independently without coordination. Can amplify failures.',
    icon: '⚡',
  },
  guardrails: {
    label: 'Conventional Guardrails',
    color: 'var(--warning)',
    description: 'Agents operate with per-agent safety thresholds but no joint-action reasoning.',
    icon: '🛡',
  },
  coordinated: {
    label: 'Cascade Zero',
    color: 'var(--accent)',
    description: 'Joint-action evaluation prevents conflicting recovery actions. Best outcome.',
    icon: '✦',
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────────

function SimLabel() {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color: 'var(--warning)',
      backgroundColor: 'var(--warning-muted)', border: '1px solid var(--warning)',
      borderRadius: 4, padding: '1px 6px', letterSpacing: '0.05em',
      textTransform: 'uppercase',
    }}>
      Simulated
    </span>
  );
}

function CINote() {
  return (
    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
      Error bars show 95% confidence interval. All results are simulated — seed {mockExperiment.seed}.
    </p>
  );
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number | number[]; color: string }[];
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Tick {label}</div>
      {payload.map((e) => (
        <div key={e.name} style={{ display: 'flex', gap: 8, color: 'var(--text-secondary)', marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: e.color, display: 'inline-block', marginTop: 3, flexShrink: 0 }} />
          {e.name}: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {Array.isArray(e.value) ? `${e.value[0]}–${e.value[1]}%` : `${e.value}%`}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Arm Summary Card ────────────────────────────────────────────────────────────

function ArmCard({ arm, isHighlighted }: { arm: ExperimentArm; isHighlighted: boolean }) {
  const meta = POLICY_META[arm.policy];
  const isBest = arm.policy === 'coordinated';

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-elevated)',
        border: `2px solid ${isHighlighted ? meta.color : isBest ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 12,
        padding: 20,
        position: 'relative',
        transition: 'border-color 0.15s ease',
      }}
    >
      {isBest && (
        <div style={{
          position: 'absolute', top: -1, right: 16,
          backgroundColor: 'var(--accent)', color: '#fff',
          fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
          padding: '2px 8px', borderRadius: '0 0 6px 6px',
          textTransform: 'uppercase',
        }}>
          ★ Best Outcome
        </div>
      )}

      {/* Policy header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, marginTop: isBest ? 8 : 0 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          backgroundColor: `${meta.color}22`, border: `1.5px solid ${meta.color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, flexShrink: 0,
        }}>
          {meta.icon}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>{meta.label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{meta.description}</div>
        </div>
      </div>

      {/* Key metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <MetricMini
          label="Failed Txns"
          value={arm.unique_failed_txns}
          note={arm.ci_lower != null ? `±${Math.round((arm.ci_upper! - arm.ci_lower) / 2)}` : undefined}
          status={arm.unique_failed_txns < 100 ? 'success' : arm.unique_failed_txns < 150 ? 'warning' : 'danger'}
        />
        <MetricMini
          label="Recovery Time"
          value={`${arm.recovery_time_ticks}t`}
          status={arm.recovery_time_ticks < 25 ? 'success' : arm.recovery_time_ticks < 35 ? 'warning' : 'danger'}
        />
        <MetricMini
          label="Peak DB Pressure"
          value={`${arm.peak_db_pressure_pct}%`}
          status={arm.peak_db_pressure_pct < 100 ? 'success' : 'danger'}
        />
        <MetricMini
          label="Safety Violations"
          value={arm.safety_violations}
          status={arm.safety_violations === 0 ? 'success' : 'danger'}
        />
      </div>

      {/* Additional details */}
      <div style={{ marginTop: 12, padding: '10px 12px', backgroundColor: 'var(--bg-surface)', borderRadius: 8, borderTop: `1px solid ${meta.color}33` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
          <span>Actions executed</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{arm.actions_executed}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
          <span>p95 Latency</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{(arm.latency_p95_ms / 1000).toFixed(2)}s</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
          <span>Successful txns</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--success)' }}>{arm.unique_success_txns}</span>
        </div>
      </div>

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <SimLabel />
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          seed:{mockExperiment.seed} · run:{arm.run_id}
        </span>
      </div>
    </div>
  );
}

function MetricMini({
  label, value, note, status,
}: {
  label: string;
  value: string | number;
  note?: string;
  status: 'success' | 'warning' | 'danger';
}) {
  const color = {
    success: 'var(--success)',
    warning: 'var(--warning)',
    danger: 'var(--danger)',
  }[status];

  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color }}>{value}</span>
        {note && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{note}</span>}
      </div>
    </div>
  );
}

// ── Bar chart for comparison ────────────────────────────────────────────────────

function ComparisonBarChart({ arms }: { arms: ExperimentArm[] }) {
  const data = arms.map((arm) => ({
    name: POLICY_META[arm.policy].label.split(' ')[0],
    failed: arm.unique_failed_txns,
    ci: [arm.ci_lower ?? arm.unique_failed_txns, arm.ci_upper ?? arm.unique_failed_txns],
    fill: POLICY_META[arm.policy].color,
  }));

  const CustomBar = (props: { x?: number; y?: number; width?: number; height?: number; fill?: string }) => {
    const { x = 0, y = 0, width = 0, height = 0, fill } = props;
    return <rect x={x} y={y} width={width} height={height} fill={fill} rx={4} />;
  };

  return (
    <div className="chart-container" style={{ height: 280 }}>
      <span className="chart-simulated-label">[SIMULATED]</span>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} tickLine={false} />
          <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false}
            label={{ value: 'Failed txns (unique)', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 10 }} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as typeof data[0];
              return (
                <div style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{d.name}</div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    Failed txns: <span style={{ fontFamily: 'var(--font-mono)', color: d.fill }}>{d.failed}</span>
                  </div>
                  {d.ci[0] !== d.ci[1] && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                      95% CI: {d.ci[0]}–{d.ci[1]}
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Bar dataKey="failed" shape={<CustomBar />}>
            {data.map((entry, i) => (
              <rect key={i} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Error rate time series comparison ──────────────────────────────────────────

function ErrorRateComparison({ arms }: { arms: ExperimentArm[] }) {
  // Normalise: find max tick across all arms
  const allTicks = new Set<number>();
  arms.forEach((arm) => arm.metrics_by_tick?.forEach((m) => allTicks.add(m.tick)));
  const sortedTicks = Array.from(allTicks).sort((a, b) => a - b);

  const data = sortedTicks.map((tick) => {
    const row: Record<string, number | undefined> = { tick };
    arms.forEach((arm) => {
      const m = arm.metrics_by_tick?.find((x) => x.tick === tick);
      if (m) row[arm.policy] = m.error_rate_pct;
    });
    return row;
  });

  return (
    <div className="chart-container" style={{ height: 280 }}>
      <span className="chart-simulated-label">[SIMULATED]</span>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 80, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="tick" stroke="var(--text-muted)" fontSize={11} tickLine={false}
            label={{ value: 'Simulation tick', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 10 }} />
          <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v) => `${v}%`}
            label={{ value: 'Error rate %', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 10 }} />
          <Tooltip content={<ChartTooltip />} />
          <Legend verticalAlign="top" height={36}
            formatter={(value: string) => <span style={{ fontSize: 11, color: POLICY_META[value as RunPolicy]?.color ?? 'var(--text-muted)' }}>{POLICY_META[value as RunPolicy]?.label ?? value}</span>}
          />
          {arms.map((arm) => (
            <Line
              key={arm.policy}
              type="monotone"
              dataKey={arm.policy}
              name={arm.policy}
              stroke={POLICY_META[arm.policy].color}
              strokeWidth={arm.policy === 'coordinated' ? 2.5 : 1.5}
              dot={false}
              strokeDasharray={arm.policy === 'none' ? '4 2' : undefined}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Scenario Controls ───────────────────────────────────────────────────────────

function ScenarioControls({
  seed, onRunExperiment, running,
}: {
  seed: number;
  onRunExperiment: (seed: number) => void;
  running: boolean;
}) {
  const [localSeed, setLocalSeed] = useState(seed);

  return (
    <div className="surface" style={{ padding: 20 }}>
      <SectionHeading
        title="Experiment Configuration"
        subtitle="Replay the same scenario under all four recovery policies with a fixed random seed"
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            Scenario
          </label>
          <div style={{ padding: '8px 14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
            db_slowdown
          </div>
        </div>
        <div>
          <label htmlFor="seed-input" style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            Random Seed
          </label>
          <input
            id="seed-input"
            type="number"
            value={localSeed}
            onChange={(e) => setLocalSeed(Number(e.target.value))}
            style={{
              padding: '8px 14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
              width: 120,
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            Policies
          </label>
          <div style={{ display: 'flex', gap: 4 }}>
            {Object.entries(POLICY_META).map(([policy, meta]) => (
              <div key={policy} style={{
                padding: '6px 10px', backgroundColor: `${meta.color}15`,
                border: `1px solid ${meta.color}`, borderRadius: 6,
                fontSize: 11, color: meta.color, fontWeight: 600,
              }}>
                {policy}
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={() => onRunExperiment(localSeed)}
          disabled={running}
          style={{
            padding: '9px 20px', borderRadius: 8, border: 'none',
            backgroundColor: running ? 'var(--bg-hover)' : 'var(--accent)',
            color: running ? 'var(--text-muted)' : '#fff',
            cursor: running ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 700,
            transition: 'background-color 0.15s ease',
          }}
        >
          {running ? '⏳ Running… (Mock)' : '▶ Run Experiment (Mock)'}
        </button>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'flex-end', marginBottom: 2 }}>
          In mock mode, results are pre-computed fixtures. No real simulation runs.
        </p>
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────────

export function ExperimentsPage() {
  const [running, setRunning] = useState(false);
  const [highlightedPolicy, setHighlightedPolicy] = useState<RunPolicy | null>(null);

  const experiment = mockExperiment;
  const arms = experiment.arms;

  const handleRun = async (seed: number) => {
    setRunning(true);
    await new Promise((r) => setTimeout(r, 2000));
    setRunning(false);
  };

  // Summary improvement calculation
  const noneArm = arms.find((a) => a.policy === 'none')!;
  const coordArm = arms.find((a) => a.policy === 'coordinated')!;
  const independentArm = arms.find((a) => a.policy === 'independent')!;
  const reduction = Math.round(((independentArm.unique_failed_txns - coordArm.unique_failed_txns) / independentArm.unique_failed_txns) * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1600 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 6 }}>
            Experiment Lab
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Compare four recovery policies under identical fault conditions. Results are simulated — not production measurements.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SimLabel />
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            exp:{experiment.experiment_id} · seed:{experiment.seed}
          </span>
        </div>
      </div>

      {/* Scenario controls */}
      <ScenarioControls seed={experiment.seed} onRunExperiment={handleRun} running={running} />

      {/* Top-level improvement summary */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12,
        padding: 20, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12,
      }}>
        {[
          {
            label: 'Failed Txn Reduction vs. Independent',
            value: `−${reduction}%`,
            sub: `${coordArm.unique_failed_txns} vs ${independentArm.unique_failed_txns}`,
            color: 'var(--success)',
          },
          {
            label: 'Faster Recovery vs. No Recovery',
            value: `${Math.round(((noneArm.recovery_time_ticks - coordArm.recovery_time_ticks) / noneArm.recovery_time_ticks) * 100)}% faster`,
            sub: `${coordArm.recovery_time_ticks}t vs ${noneArm.recovery_time_ticks}t`,
            color: 'var(--accent)',
          },
          {
            label: 'Safety Violations (Cascade Zero)',
            value: `${coordArm.safety_violations}`,
            sub: `vs ${independentArm.safety_violations} in independent mode`,
            color: 'var(--success)',
          },
          {
            label: 'DB Never Exceeded Capacity',
            value: `Peak: ${coordArm.peak_db_pressure_pct}%`,
            sub: 'vs 143% in independent mode',
            color: 'var(--success)',
          },
        ].map((item) => (
          <div key={item.label}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4 }}>
              {item.label}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: item.color, marginBottom: 2 }}>
              {item.value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.sub}</div>
          </div>
        ))}
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', backgroundColor: 'var(--warning-muted)', border: '1px solid var(--warning)', borderRadius: 8 }}>
            <span style={{ fontSize: 12 }}>⚠</span>
            <span style={{ fontSize: 11, color: 'var(--warning)' }}>
              These are simulated results from a controlled experiment, not measured production data. Results may vary under real conditions.
            </span>
            <SimLabel />
          </div>
        </div>
      </div>

      {/* Policy cards */}
      <div>
        <SectionHeading
          title="Policy Comparison — All Arms"
          subtitle={`Scenario: db_slowdown · Seed: ${experiment.seed} · ${arms.length} policies evaluated`}
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {arms.map((arm) => (
            <div
              key={arm.policy}
              onMouseEnter={() => setHighlightedPolicy(arm.policy)}
              onMouseLeave={() => setHighlightedPolicy(null)}
            >
              <ArmCard arm={arm} isHighlighted={highlightedPolicy === arm.policy} />
            </div>
          ))}
        </div>
      </div>

      {/* Error rate time series */}
      <div className="surface" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <SectionHeading
            title="Error Rate Over Time — All Policies"
            subtitle="Error rate (%) across simulation ticks. Lower is better."
          />
          <SimLabel />
        </div>
        <ErrorRateComparison arms={arms} />
        <CINote />
      </div>

      {/* Failed transactions bar chart */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="surface" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <SectionHeading
              title="Unique Failed Transactions"
              subtitle="Total unique user transactions that failed per policy"
            />
            <SimLabel />
          </div>
          <ComparisonBarChart arms={arms} />
          <CINote />
        </div>

        {/* Recovery time comparison */}
        <div className="surface" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <SectionHeading
              title="Recovery Time (Ticks)"
              subtitle="Ticks until error rate returns below 5%"
            />
            <SimLabel />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            {arms.map((arm) => {
              const meta = POLICY_META[arm.policy];
              const maxTime = Math.max(...arms.map((a) => a.recovery_time_ticks));
              return (
                <div key={arm.policy}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>
                      {arm.recovery_time_ticks} ticks
                    </span>
                  </div>
                  <div style={{ height: 10, backgroundColor: 'var(--bg-elevated)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${(arm.recovery_time_ticks / maxTime) * 100}%`,
                      backgroundColor: meta.color,
                      borderRadius: 5,
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
          <CINote />
        </div>
      </div>

      {/* Reproducibility block */}
      <div className="surface" style={{ padding: 20 }}>
        <SectionHeading
          title="Reproducibility"
          subtitle="Re-run this experiment with the exact same parameters"
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {[
            { label: 'Experiment ID', value: experiment.experiment_id },
            { label: 'Scenario', value: experiment.scenario },
            { label: 'Random Seed', value: String(experiment.seed) },
            { label: 'Arms', value: String(arms.length) },
            { label: 'Data type', value: 'SIMULATED — not production' },
          ].map((item) => (
            <div key={item.label}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 4 }}>
                {item.label}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
