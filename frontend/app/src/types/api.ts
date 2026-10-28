// ─────────────────────────────────────────────────────────────────────────────
// Cascade Zero — API type definitions (mirrors contracts/openapi.yaml)
// Backend must not break these shapes without a contract version bump and
// frontend sign-off.
// ─────────────────────────────────────────────────────────────────────────────

export type RunState = 'created' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RunPolicy = 'none' | 'independent' | 'guardrails' | 'coordinated' | 'ai_coordinated';
export type RunScenario = 'db_slowdown' | 'payments_degradation' | 'traffic_surge' | 'telemetry_faults';
export type PlanStatus = 'candidate' | 'rejected' | 'approved' | 'delayed' | 'executed' | 'superseded';
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'active' | 'investigating' | 'resolved' | 'closed';

// ── Core domain models ───────────────────────────────────────────────────────

export interface HealthResponse {
  status: string;
}

export interface TopologyNode {
  id: string;
  capacity: number;
}

export interface TopologyEdge {
  from: string;
  to: string;
}

export interface Topology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

/** Simulator metrics bag; numeric fields exactly as the backend reports them. */
export interface RunMetrics {
  [key: string]: number | undefined;
}

export interface Run {
  tick_interval_ms?: number;
  id: string;
  seed: number;
  scenario: RunScenario;
  policy: RunPolicy;
  state: RunState;
  simulated: boolean;
  purpose?: 'policy_comparison' | 'operator_review';
  metrics?: RunMetrics;
  runtime?: {
    decision_latency_p50_ms: number;
    decision_latency_p95_ms: number;
    decision_latency_samples: number;
    source: 'local_process_wall_clock';
  };
  diagnosis?: {
    cause: string;
    rationale: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    affected: string[];
    mitigation_plan?: string;
  };
  /** ISO 8601 wall-clock start */
  created_at?: string;
  /** Present when the simulation crashed: exception type and message. */
  failed_reason?: string;
  /** Present on direct GET /v1/runs/{id}; omitted from the history list. */
  trace_hash?: string;
  event_count?: number;
  plan_count?: number;
}

export interface RunRequest {
  live?: boolean;
  seed: number;
  scenario: RunScenario;
  policy: RunPolicy;
  purpose?: 'policy_comparison' | 'operator_review';
}

/** Provenance of an operator-approved synthetic replay. */
export interface PlanExecution {
  status: 'sent' | 'unknown' | 'dry-run';
  simulated: boolean;
  measured: boolean;
  replayed: boolean;
  error: string | null;
  outcome?: Partial<BacktestArm>;
}

export interface Plan {
  combinations?: { actions: string[]; predicted_risk: number; safe: boolean; selected: boolean; reasons: string[] }[];
  id: string;
  run_id: string;
  actions: string[];
  predicted_risk: number;
  status: PlanStatus;
  simulated: boolean;
  purpose?: 'policy_comparison' | 'operator_review';
  reasons: string[];
  decision_tick?: number;
  operator_reason?: string;
  decided_at?: string;
  /** AI-loop provenance on ai_coordinated plans. */
  ai?: AIDecisionInfo;
  /** Present after an operator approves a local sandbox replay. */
  execution?: PlanExecution;
  backtest?: BacktestResult;
}

// ── SSE Events — discriminated by kind so payloads narrow without casts ──────

export interface MetricPayload {
  error_rate: number;
  latency: number;
  queue_depth: number;
  db_load: number;
  arrivals: number;
  unique_completed: number;
  unique_failed: number;
  attempts_total: number;
  dropped: number;
  service_queues: Record<string, number>;
  sensor_age_ticks?: number;
  sensor_dropped?: boolean;
  sensor_noise_applied?: boolean;
  measured?: boolean;
}

export interface IncidentPayload {
  phase: string;
  measured?: boolean;
}

/** Not emitted by the simulator today; kept for contract completeness. */
export interface ProposalPayload {
  [key: string]: unknown;
  measured?: boolean;
}

export interface DecisionPayload {
  combinations?: Plan["combinations"];
  actions: string[];
  predicted_risk: number;
  reasons: string[];
  simulated?: boolean;
  measured?: boolean;
  /** AI-loop provenance on ai_coordinated decisions. */
  ai?: AIDecisionInfo;
}

export interface ExecutionPayload {
  agent_id: string;
  action: string;
  target: string;
  expected_effect: string;
  cost: string;
  confidence: number;
  ttl: number;
  sandbox_only?: boolean;
  measured?: boolean;
}

/** Not emitted by the simulator today; kept for contract completeness. */
export interface VerificationPayload {
  [key: string]: unknown;
  measured?: boolean;
}

interface EventEnvelope {
  event_id: string;
  run_id: string;
  tick: number;
  simulated: boolean;
  timestamp?: string;
  trace_id?: string;
}

export type CascadeEvent = EventEnvelope & (
  | { kind: 'metric'; payload: MetricPayload }
  | { kind: 'incident'; payload: IncidentPayload }
  | { kind: 'proposal'; payload: ProposalPayload }
  | { kind: 'decision'; payload: DecisionPayload }
  | { kind: 'execution'; payload: ExecutionPayload }
  | { kind: 'verification'; payload: VerificationPayload }
);

export type MetricEvent = CascadeEvent & { kind: 'metric' };
export type DecisionEvent = CascadeEvent & { kind: 'decision' };
export type ExecutionEvent = CascadeEvent & { kind: 'execution' };
export type IncidentEvent = CascadeEvent & { kind: 'incident' };

/**
 * Connection lifecycle of the SSE event stream, reported by
 * subscribeToEvents' optional onStatus callback.
 */
export type SseStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

// ── AI-loop provenance ───────────────────────────────────────────────────────

/** AI-loop provenance merged into decision events and plans (ai_coordinated). */
export interface AIDecisionInfo {
  first_failure_reason?: string | null;
  circuit_open?: boolean;
  live: boolean;
  model: string | null;
  fallback_reason: string | null;
  latency_ms?: number;
  prompt_sha256?: string;
  calls?: number;
  live_decisions?: number;
  fallbacks?: number;
  model_selected_actions?: string[];
  model_risk?: number;
  safety_reasons?: string[];
  diagnosis?: {
    cause: string;
    affected: string[];
    severity: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    rationale: string;
    checks: string[];
  };
  probes?: AIProbeOutcome[];
  checks?: AICheckResult[];
  checks_evaluated?: AICheckResult[];
}

export interface AIProbeOutcome {
  actions: string[];
  unique_failed: number;
  unique_succeeded: number;
  peak_db_connections: number;
  actions_executed: number;
  horizon_ticks: number;
}

export interface AICheckResult {
  description: string;
  metric: string;
  comparator: string;
  threshold: number;
  within_ticks: number;
  decided_tick: number;
  status: 'pending' | 'pass' | 'fail';
  observed: number | null;
  evaluated_tick: number | null;
}

// ── Aggregates ───────────────────────────────────────────────────────────────

/** Aggregate project status from GET /v1/admin/status. */
export interface AdminStatus {
  backend: { state: string; runs_stored: number; runs_persisted?: number };
  runs: {
    total: number;
    by_state: Record<string, number>;
    by_policy: Record<string, number>;
    newest_run_id: string | null;
  };
  transactions: {
    offered: number; failed: number; succeeded: number; actions: number;
  };
  ai_engine: {
    model: string;
    provider_configured: boolean;
    live_decisions: number;
    fallback_decisions: number;
    top_fallback_reasons: Record<string, number>;
  };
  scenarios: Record<string, { actions_available: string[] }>;
}

/** Local what-if replay of a candidate plan against the recorded seed. */
export interface BacktestResult {
  decision_tick: number;
  replay_mode: 'single_decision';
  plan_id: string;
  run_id: string;
  seed: number;
  actions: string[];
  arms: BacktestArm[];
  baseline_failed: number;
  plan_failed: number;
  delta_failed: number;
  verdict: 'better' | 'worse' | 'equal';
  simulated: boolean;
  measured: boolean;
}

export interface BacktestArm {
  actions: string[];
  unique_failed: number;
  unique_succeeded: number;
  peak_db_connections: number;
  max_queue_depth: number;
  sustained_recovery_time: number;
  actions_executed: number;
  horizon_ticks: number;
}

/**
 * Incident record derived from a run. The contract has no /v1/incidents
 * resource: the UI routes by `incidents/{id}` with the route param used as
 * the run id, so only id/run_id/title are known up front; the optional
 * header fields are filled in by the first streamed `incident` SSE event.
 */
export interface Incident {
  id: string;
  run_id: string;
  title: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  started_at?: string;
  affected_services?: string[];
}
