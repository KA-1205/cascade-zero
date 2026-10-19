'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  SectionHeading, PredictedLabel, RiskIndicator, EmptyState,
} from '@/components/ui/primitives';
import {
  mockPlans, mockProposals, mockIncident, mockExecutionSteps, MOCK_RUN_ID,
} from '@/lib/fixtures';
import type { Plan, ExecutionStep } from '@/types/api';

// ── Types ───────────────────────────────────────────────────────────────────────

interface PlansPageProps {
  runId: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function RiskScore({ value, predicted }: { value: number; predicted?: boolean }) {
  const color =
    value > 0.7 ? 'var(--danger)' : value > 0.4 ? 'var(--warning)' : 'var(--success)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 8, backgroundColor: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${value * 100}%`,
            backgroundColor: color,
            borderRadius: 4,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color, flexShrink: 0 }}>
        {Math.round(value * 100)}%
      </span>
      {predicted && <PredictedLabel />}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    candidate: ['var(--accent)', 'var(--accent-muted)'],
    approved: ['var(--success)', 'var(--success-muted)'],
    rejected: ['var(--danger)', 'var(--danger-muted)'],
    delayed: ['var(--warning)', 'var(--warning-muted)'],
    executed: ['var(--success)', 'var(--success-muted)'],
  };
  const [color, bg] = map[status] ?? ['var(--text-muted)', 'var(--bg-elevated)'];
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color, backgroundColor: bg, border: `1px solid ${color}`,
      padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      {status}
    </span>
  );
}

function TrajectoryTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: number }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Tick {label}</div>
      {payload.map((e) => (
        <div key={e.name} style={{ display: 'flex', gap: 8, color: 'var(--text-secondary)', marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: e.color, display: 'inline-block', marginTop: 3, flexShrink: 0 }} />
          {e.name}: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{e.value}{e.name.includes('%') ? '' : ''}</span>
        </div>
      ))}
    </div>
  );
}

// ── Execution Step Component ────────────────────────────────────────────────────

function ExecutionStepRow({ step, isLast }: { step: ExecutionStep; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig: Record<string, { color: string; icon: string; label: string }> = {
    completed: { color: 'var(--success)', icon: '✓', label: 'Completed' },
    running: { color: 'var(--accent)', icon: '▶', label: 'Running' },
    pending: { color: 'var(--text-muted)', icon: '○', label: 'Pending' },
    failed: { color: 'var(--danger)', icon: '✕', label: 'Failed' },
  };
  const cfg = statusConfig[step.status] ?? statusConfig.pending;

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      {/* Spine */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 32 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          backgroundColor: step.status === 'completed' ? 'var(--success-muted)' :
            step.status === 'running' ? 'var(--accent-muted)' : 'var(--bg-elevated)',
          border: `2px solid ${cfg.color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: cfg.color, flexShrink: 0,
          animation: step.status === 'running' ? 'pulse-ring 1.8s ease-out infinite' : undefined,
        }}>
          {cfg.icon}
        </div>
        {!isLast && (
          <div style={{
            width: 2, flex: 1, marginTop: 4,
            backgroundColor: step.status === 'completed' ? 'var(--success)' : 'var(--border)',
          }} />
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {step.action}
          </span>
          <StatusPill status={step.status} />
          {step.checkpoint_passed === true && (
            <span style={{ fontSize: 10, color: 'var(--success)', backgroundColor: 'var(--success-muted)', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
              ✓ Checkpoint
            </span>
          )}
        </div>

        {step.started_at && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
            {step.started_at ? `Started: ${formatTime(step.started_at)}` : ''}
            {step.completed_at ? ` · Completed: ${formatTime(step.completed_at)}` : ''}
          </div>
        )}

        {step.log_lines.length > 0 && (
          <div>
            <button
              onClick={() => setExpanded((v) => !v)}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 6 }}
            >
              {expanded ? '▾' : '▸'} {step.log_lines.length} log line{step.log_lines.length !== 1 ? 's' : ''}
            </button>
            {expanded && (
              <div style={{ backgroundColor: 'var(--bg-base)', borderRadius: 8, padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                {step.log_lines.map((line, i) => (
                  <div key={i} className={`log-line ${line.includes('error') || line.includes('failed') ? 'log-error' : line.includes('Applied') || line.includes('completed') ? 'log-success' : ''}`}>
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Approval Dialog ─────────────────────────────────────────────────────────────

function ApprovalDialog({
  plan,
  onClose,
  onConfirm,
}: {
  plan: Plan;
  onClose: () => void;
  onConfirm: (approved: boolean, reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (approved: boolean) => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    onConfirm(approved, reason);
    setLoading(false);
  };

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label="Plan approval">
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 28,
          maxWidth: 480,
          width: '90%',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
            Review Recovery Plan
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Plan <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{plan.id}</span>
            {' '}· Predicted risk: <span style={{ fontFamily: 'var(--font-mono)', color: plan.predicted_risk > 0.5 ? 'var(--danger)' : 'var(--success)' }}>{Math.round(plan.predicted_risk * 100)}%</span>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Actions in this plan
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {plan.actions.map((a) => (
              <span key={a} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 4, color: 'var(--text-secondary)' }}>
                {a}
              </span>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            Optional review note (mock mode — not persisted)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Add context for this decision..."
            style={{
              width: '100%', minHeight: 72, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)', fontSize: 13,
              fontFamily: 'var(--font-sans)', resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', backgroundColor: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}
          >
            Cancel
          </button>
          <button
            onClick={() => handleSubmit(false)}
            disabled={loading}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--danger)', backgroundColor: 'var(--danger-muted)', color: 'var(--danger)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            {loading ? 'Processing…' : 'Reject'}
          </button>
          <button
            onClick={() => handleSubmit(true)}
            disabled={loading || plan.status === 'rejected'}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--accent)', color: '#fff', cursor: plan.status === 'rejected' ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: plan.status === 'rejected' ? 0.5 : 1 }}
          >
            {loading ? 'Processing…' : 'Approve (Mock)'}
          </button>
        </div>

        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 14, textAlign: 'center' }}>
          ⚠ Mock mode — actions are logged to console only. No real execution occurs.
        </p>
      </div>
    </div>
  );
}

// ── Plan Card ───────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  isSelected,
  onSelect,
  onReview,
}: {
  plan: Plan;
  isSelected: boolean;
  onSelect: () => void;
  onReview: () => void;
}) {
  const isRejected = plan.status === 'rejected';
  const borderColor = isRejected
    ? 'var(--danger)'
    : isSelected
    ? 'var(--accent)'
    : plan.status === 'candidate'
    ? 'var(--success)'
    : 'var(--border)';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      aria-pressed={isSelected}
      style={{
        backgroundColor: 'var(--bg-elevated)',
        border: `2px solid ${borderColor}`,
        borderRadius: 12,
        padding: 20,
        cursor: 'pointer',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        boxShadow: isSelected ? `0 0 0 3px ${borderColor}22` : undefined,
        position: 'relative',
      }}
    >
      {/* Status tag */}
      {isRejected && (
        <div style={{
          position: 'absolute', top: -1, right: 16,
          backgroundColor: 'var(--danger)', color: '#fff',
          fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
          padding: '2px 8px', borderRadius: '0 0 6px 6px',
          textTransform: 'uppercase',
        }}>
          Rejected by Coordinator
        </div>
      )}
      {plan.status === 'candidate' && (
        <div style={{
          position: 'absolute', top: -1, right: 16,
          backgroundColor: 'var(--success)', color: '#fff',
          fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
          padding: '2px 8px', borderRadius: '0 0 6px 6px',
          textTransform: 'uppercase',
        }}>
          Selected Plan
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, marginTop: 8 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>
            {plan.id.toUpperCase()}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {plan.actions.length} action{plan.actions.length !== 1 ? 's' : ''}
          </div>
        </div>
        <StatusPill status={plan.status} />
      </div>

      {/* Actions list */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>
          Actions
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {plan.actions.map((action) => {
            const proposal = mockProposals.find((p) => p.action === action);
            return (
              <div key={action} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', backgroundColor: 'var(--bg-surface)', borderRadius: 6,
                border: `1px solid ${isRejected ? 'var(--danger-muted)' : 'var(--border)'}`,
              }}>
                <span style={{ fontSize: 12 }}>{agentEmoji(proposal?.agent ?? '')}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                    {action}
                  </div>
                  {proposal && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {proposal.agent}
                    </div>
                  )}
                </div>
                {proposal && (
                  <RiskIndicator risk={proposal.risk} showLabel={false} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Predicted risk */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            Predicted Risk
          </span>
          <PredictedLabel />
        </div>
        <RiskScore value={plan.predicted_risk} />
      </div>

      {/* Constraint violations */}
      {plan.constraint_violations && plan.constraint_violations.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 6 }}>
            ⚠ {plan.constraint_violations.length} Constraint Violation{plan.constraint_violations.length !== 1 ? 's' : ''}
          </div>
          {plan.constraint_violations.map((v, i) => (
            <div key={i} style={{
              padding: '8px 10px', backgroundColor: 'var(--danger-muted)',
              border: '1px solid var(--danger)', borderRadius: 6, marginBottom: 4,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                {v.resource}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Peak: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--danger)' }}>{v.predicted_peak}%</span> / Limit: <span style={{ fontFamily: 'var(--font-mono)' }}>{v.limit}%</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{v.description}</div>
            </div>
          ))}
        </div>
      )}

      {/* Reasons */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 6 }}>
          Coordinator Rationale
        </div>
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {plan.reasons.map((r, i) => (
            <li key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: isRejected ? 'var(--text-secondary)' : 'var(--success)' }}>
              <span style={{ flexShrink: 0 }}>{isRejected ? '✕' : '✓'}</span>
              {r}
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onReview(); }}
        style={{
          width: '100%', padding: '8px 16px', borderRadius: 8,
          border: `1px solid ${isRejected ? 'var(--danger)' : 'var(--accent)'}`,
          backgroundColor: 'transparent',
          color: isRejected ? 'var(--danger)' : 'var(--accent)',
          cursor: 'pointer', fontSize: 13, fontWeight: 600,
          transition: 'background-color 0.15s ease',
        }}
      >
        Review &amp; Override
      </button>
    </div>
  );
}

// ── Independent vs Coordinated Comparison ───────────────────────────────────────

function ConflictComparisonPanel() {
  const rejectedPlan = mockPlans.find((p) => p.status === 'rejected')!;
  const candidatePlan = mockPlans.find((p) => p.status === 'candidate')!;

  // Merge trajectories for comparison chart
  const comparisonData = (() => {
    const ticks = new Set([
      ...(rejectedPlan.resource_trajectory ?? []).map((p) => p.tick),
      ...(candidatePlan.resource_trajectory ?? []).map((p) => p.tick),
    ]);
    return Array.from(ticks).sort((a, b) => a - b).map((tick) => {
      const r = rejectedPlan.resource_trajectory?.find((p) => p.tick === tick);
      const c = candidatePlan.resource_trajectory?.find((p) => p.tick === tick);
      return {
        tick,
        independent: r?.db_connections_pct,
        coordinated: c?.db_connections_pct,
        independentTxns: r?.estimated_failed_txns,
        coordinatedTxns: c?.estimated_failed_txns,
      };
    });
  })();

  return (
    <div className="surface" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            Independent Agents vs Cascade Zero
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Why individually reasonable actions can cascade into a larger outage
          </p>
        </div>
        <PredictedLabel />
      </div>

      {/* Side-by-side action table */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 0, marginBottom: 24 }}>
        {/* Independent column */}
        <div style={{ backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: '12px 0 0 12px', padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            ✕ Independent Agents
          </div>
          {rejectedPlan.actions.map((a) => {
            const p = mockProposals.find((x) => x.action === a);
            return (
              <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '6px 10px', backgroundColor: '#f0717815', borderRadius: 6 }}>
                <span style={{ fontSize: 11 }}>{agentEmoji(p?.agent ?? '')}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>{a}</div>
                  {p && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.agent}</div>}
                </div>
                {p && <RiskIndicator risk={p.risk} showLabel={false} />}
              </div>
            );
          })}
          <div style={{ marginTop: 12, padding: '6px 10px', backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 700 }}>DB peak: 143% of capacity</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>↑ +96 failed transactions at peak</div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', zIndex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700 }}>
              ⇒
            </div>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
              Cascade Zero
            </span>
          </div>
        </div>

        {/* Coordinated column */}
        <div style={{ backgroundColor: 'var(--success-muted)', border: '1px solid var(--success)', borderRadius: '0 12px 12px 0', padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            ✓ Coordinated Plan
          </div>
          {candidatePlan.actions.map((a) => {
            const p = mockProposals.find((x) => x.action === a);
            return (
              <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '6px 10px', backgroundColor: '#3bbe8b15', borderRadius: 6 }}>
                <span style={{ fontSize: 11 }}>{agentEmoji(p?.agent ?? '')}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>{a}</div>
                  {p && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.agent}</div>}
                </div>
                {p && <RiskIndicator risk={p.risk} showLabel={false} />}
              </div>
            );
          })}
          <div style={{ marginTop: 12, padding: '6px 10px', backgroundColor: 'var(--success-muted)', border: '1px solid var(--success)', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--success)', fontWeight: 700 }}>DB stays within capacity</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>↓ −42 failed transactions at tick 5</div>
          </div>
        </div>
      </div>

      {/* Trajectory Chart */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
            DB Connection Pressure — Predicted Trajectory
          </span>
          <PredictedLabel />
        </div>
        <div className="chart-container" style={{ height: 220 }}>
          <span className="chart-simulated-label">[PREDICTED]</span>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={comparisonData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="dangerGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--danger)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--danger)" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--success)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--success)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="tick" stroke="var(--text-muted)" fontSize={11} tickLine={false}
                label={{ value: 'Simulation tick', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 10 }} />
              <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false}
                tickFormatter={(v) => `${v}%`} domain={[0, 160]} />
              <Tooltip content={<TrajectoryTooltip />} />
              <ReferenceLine y={100} stroke="var(--danger)" strokeDasharray="4 4"
                label={{ value: 'Capacity limit (100%)', fill: 'var(--danger)', fontSize: 10, position: 'right' }} />
              <Area type="monotone" dataKey="independent" name="Independent %" stroke="var(--danger)" strokeWidth={2}
                fill="url(#dangerGrad)" dot={false} />
              <Area type="monotone" dataKey="coordinated" name="Coordinated %" stroke="var(--success)" strokeWidth={2}
                fill="url(#successGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────────

export function PlansPage({ runId }: PlansPageProps) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(mockPlans[1]?.id ?? null);
  const [reviewingPlan, setReviewingPlan] = useState<Plan | null>(null);
  const [activeTab, setActiveTab] = useState<'comparison' | 'execution'>('comparison');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const plans = mockPlans;
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;
  const steps = mockExecutionSteps;

  const handleConfirmReview = (approved: boolean, reason: string) => {
    setToastMessage(
      approved
        ? `[MOCK] Plan ${reviewingPlan?.id} approved${reason ? ` — "${reason}"` : ''}`
        : `[MOCK] Plan ${reviewingPlan?.id} rejected${reason ? ` — "${reason}"` : ''}`,
    );
    setReviewingPlan(null);
    setTimeout(() => setToastMessage(null), 5000);
  };

  const tabs = [
    { key: 'comparison', label: 'Plan Comparison' },
    { key: 'execution', label: 'Execution Status' },
  ] as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1600 }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
        <Link href="/overview" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Overview</Link>
        <span>›</span>
        <Link href={`/incidents/${mockIncident.id}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          {mockIncident.id}
        </Link>
        <span>›</span>
        <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
          Recovery Plans · {runId}
        </span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 6 }}>
            Recovery Planning
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Incident: <span style={{ color: 'var(--text-secondary)' }}>{mockIncident.title}</span>
            {' · '}<span style={{ fontFamily: 'var(--font-mono)' }}>{plans.length}</span> candidate plans evaluated
          </p>
        </div>

        {/* Safety summary pill */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
          backgroundColor: 'var(--success-muted)', border: '1px solid var(--success)',
          borderRadius: 10, flexShrink: 0,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--success)' }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)' }}>Coordinator Active</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {plans.filter((p) => p.status === 'rejected').length} plan{plans.filter((p) => p.status === 'rejected').length !== 1 ? 's' : ''} rejected · 0 constraint violations approved
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }} role="tablist" aria-label="Plans sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px', fontSize: 13,
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: `2px solid ${activeTab === tab.key ? 'var(--accent)' : 'transparent'}`,
              background: 'none', border: 'none',
              cursor: 'pointer', transition: 'color 0.15s ease', marginBottom: -1,
            }}
          >
            {tab.label}
            {tab.key === 'execution' && (
              <span style={{ marginLeft: 8, fontSize: 10, backgroundColor: 'var(--accent-muted)', color: 'var(--accent)', padding: '1px 5px', borderRadius: 4 }}>
                {steps.filter((s) => s.status === 'running').length > 0 ? 'RUNNING' : 'ACTIVE'}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── PLAN COMPARISON TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'comparison' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Conflict comparison */}
          <ConflictComparisonPanel />

          {/* Plans grid */}
          <div>
            <SectionHeading
              title="Candidate Plans"
              subtitle={`${plans.length} plans generated — ${plans.filter((p) => p.status === 'candidate').length} selected, ${plans.filter((p) => p.status === 'rejected').length} rejected`}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
              {plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  isSelected={selectedPlanId === plan.id}
                  onSelect={() => setSelectedPlanId(plan.id === selectedPlanId ? null : plan.id)}
                  onReview={() => setReviewingPlan(plan)}
                />
              ))}
            </div>
          </div>

          {/* Selected plan trajectory */}
          {selectedPlan && selectedPlan.resource_trajectory && (
            <div className="surface" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <SectionHeading
                  title={`Predicted trajectory — ${selectedPlan.id.toUpperCase()}`}
                  subtitle="DB connection pressure and estimated failed transactions over simulation horizon"
                />
                <PredictedLabel />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="chart-container" style={{ height: 200 }}>
                  <span className="chart-simulated-label">[PREDICTED]</span>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={selectedPlan.resource_trajectory} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="trajGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={selectedPlan.status === 'rejected' ? 'var(--danger)' : 'var(--success)'} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={selectedPlan.status === 'rejected' ? 'var(--danger)' : 'var(--success)'} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="tick" stroke="var(--text-muted)" fontSize={10} tickLine={false} />
                      <YAxis stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                      <Tooltip content={<TrajectoryTooltip />} />
                      <ReferenceLine y={100} stroke="var(--danger)" strokeDasharray="4 4" />
                      <Area type="monotone" dataKey="db_connections_pct" name="DB connections %"
                        stroke={selectedPlan.status === 'rejected' ? 'var(--danger)' : 'var(--success)'}
                        strokeWidth={2} fill="url(#trajGrad)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="chart-container" style={{ height: 200 }}>
                  <span className="chart-simulated-label">[PREDICTED]</span>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={selectedPlan.resource_trajectory} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="tick" stroke="var(--text-muted)" fontSize={10} tickLine={false} />
                      <YAxis stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip content={<TrajectoryTooltip />} />
                      <Line type="monotone" dataKey="estimated_failed_txns" name="Est. failed txns"
                        stroke="var(--warning)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── EXECUTION TAB ───────────────────────────────────────────────────────── */}
      {activeTab === 'execution' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Current status banner */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
            backgroundColor: 'var(--accent-muted)', border: '1px solid var(--accent)', borderRadius: 12,
          }}>
            <span className="live-dot" style={{ backgroundColor: 'var(--accent)' }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 2 }}>
                Executing plan-b — Step 2 of 3
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Waiting for DB pressure to drop below 70% before executing delay_scale
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid var(--warning)',
                backgroundColor: 'var(--warning-muted)', color: 'var(--warning)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>
                ⏸ Pause (Mock)
              </button>
              <button style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid var(--danger)',
                backgroundColor: 'var(--danger-muted)', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>
                ⏹ Stop (Mock)
              </button>
            </div>
          </div>

          {/* Step-by-step stepper */}
          <div className="surface" style={{ padding: 20 }}>
            <SectionHeading
              title="Execution Steps"
              subtitle="Real-time progress of approved recovery actions"
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {steps.map((step, i) => (
                <ExecutionStepRow key={step.step_index} step={step} isLast={i === steps.length - 1} />
              ))}
            </div>
          </div>

          {/* Safety checkpoints */}
          <div className="surface" style={{ padding: 20 }}>
            <SectionHeading
              title="Safety Checkpoints"
              subtitle="Automated health verifications before and after each step"
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Pre-execution: DB pressure below 100%', passed: true, tick: 6 },
                { label: 'Post-limit_retries: Retry rate measured', passed: true, tick: 7 },
                { label: 'Backoff stability: No retry amplification detected', passed: true, tick: 8 },
                { label: 'Scale gate: DB pressure < 70% (pending)', passed: undefined, tick: null },
              ].map((cp, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                  backgroundColor: cp.passed === true ? 'var(--success-muted)' : cp.passed === false ? 'var(--danger-muted)' : 'var(--bg-elevated)',
                  border: `1px solid ${cp.passed === true ? 'var(--success)' : cp.passed === false ? 'var(--danger)' : 'var(--border)'}`,
                  borderRadius: 8,
                }}>
                  <span style={{ fontSize: 14, color: cp.passed === true ? 'var(--success)' : cp.passed === false ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {cp.passed === true ? '✓' : cp.passed === false ? '✕' : '○'}
                  </span>
                  <span style={{ fontSize: 13, color: cp.passed !== undefined ? 'var(--text-primary)' : 'var(--text-muted)', flex: 1 }}>
                    {cp.label}
                  </span>
                  {cp.tick !== null && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                      tick:{cp.tick}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Approval dialog */}
      {reviewingPlan && (
        <ApprovalDialog
          plan={reviewingPlan}
          onClose={() => setReviewingPlan(null)}
          onConfirm={handleConfirmReview}
        />
      )}

      {/* Toast notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '12px 20px', maxWidth: 420,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 100,
          fontSize: 13, color: 'var(--text-secondary)',
          animation: 'fadeIn 0.2s ease',
        }}>
          <span style={{ color: 'var(--accent)', marginRight: 8 }}>ℹ</span>
          {toastMessage}
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function agentEmoji(agent: string) {
  if (agent.includes('retry') || agent.includes('throttle')) return '🔁';
  if (agent.includes('scal')) return '📈';
  if (agent.includes('restart')) return '🔄';
  return '🤖';
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
