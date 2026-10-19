// ─────────────────────────────────────────────────────────────────────────────
// Cascade Zero — API type definitions (mirrors contracts/openapi.yaml)
// Auto-maintained by frontend team; backend must not break these shapes
// without a contract version bump and frontend sign-off.
// ─────────────────────────────────────────────────────────────────────────────

export type RunState = 'created' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RunPolicy = 'none' | 'independent' | 'guardrails' | 'coordinated';
export type RunScenario = 'db_slowdown';
export type PlanStatus = 'candidate' | 'rejected' | 'approved' | 'delayed' | 'executed';
export type EventKind = 'metric' | 'incident' | 'proposal' | 'decision' | 'execution' | 'verification';
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'active' | 'investigating' | 'resolved' | 'closed';
export type ProposalRisk = 'low' | 'medium' | 'high' | 'unknown';

// ── Core domain models ───────────────────────────────────────────────────────

export interface HealthResponse {
  status: string;
}

export interface TopologyNode {
  id: string;
  capacity: number;
  /** Extended: not in MVP contract, used in mock */
  label?: string;
  type?: 'gateway' | 'service' | 'database' | 'queue';
  current_load?: number;
  health?: 'healthy' | 'degraded' | 'critical';
}

export interface TopologyEdge {
  from: string;
  to: string;
  /** Extended: throughput in req/s */
  throughput?: number;
  latency_ms?: number;
}

export interface Topology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface RunMetrics {
  error_rate_pct?: number;
  db_pressure_pct?: number;
  throughput_rps?: number;
  latency_p95_ms?: number;
  unique_failed_txns?: number;
  unique_success_txns?: number;
  [key: string]: number | undefined;
}

export interface Run {
  id: string;
  seed: number;
  scenario: RunScenario;
  policy: RunPolicy;
  state: RunState;
  simulated: boolean;
  metrics?: RunMetrics;
  /** ISO 8601 wall-clock start */
  started_at?: string;
  completed_at?: string;
}

export interface RunRequest {
  seed: number;
  scenario: RunScenario;
  policy: RunPolicy;
}

export interface Plan {
  id: string;
  run_id: string;
  actions: string[];
  predicted_risk: number;
  status: PlanStatus;
  simulated: boolean;
  reasons: string[];
  /** Extended: resource trajectory prediction */
  resource_trajectory?: ResourceTrajectoryPoint[];
  constraint_violations?: ConstraintViolation[];
}

export interface ResourceTrajectoryPoint {
  tick: number;
  db_connections_pct: number;
  estimated_failed_txns: number;
}

export interface ConstraintViolation {
  resource: string;
  limit: number;
  predicted_peak: number;
  description: string;
}

// ── SSE Events ───────────────────────────────────────────────────────────────

/**
 * Extended (frontend-only, not in the contract): connection lifecycle of the
 * SSE event stream, reported by both transports via subscribeToEvents' optional
 * onStatus callback. Used by the incident-detail page's connection indicator.
 */
export type SseStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

/** Shared SSE subscription signature; mock and live transports must match. */
export type SseSubscribe = (
  runId: string,
  onEvent: (event: CascadeEvent) => void,
  onError?: (err: Error) => void,
  onStatus?: (status: SseStatus) => void,
) => () => void;

export interface CascadeEvent {
  event_id: string;
  run_id: string;
  tick: number;
  kind: EventKind;
  simulated: boolean;
  payload: EventPayload;
  timestamp?: string;
  trace_id?: string;
}

export type EventPayload =
  | MetricPayload
  | IncidentPayload
  | ProposalPayload
  | DecisionPayload
  | ExecutionPayload
  | VerificationPayload;

export interface MetricPayload {
  service_id: string;
  error_rate_pct: number;
  db_pressure_pct: number;
  throughput_rps: number;
  latency_p95_ms: number;
}

export interface IncidentPayload {
  incident_id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  affected_services: string[];
}

export interface ProposalPayload {
  proposal_id: string;
  agent: string;
  action: string;
  target_service: string;
  expected_effect: string;
  risk: ProposalRisk;
  confidence: number;
  ttl_ticks: number;
}

export interface DecisionPayload {
  plan_id: string;
  decision: 'approved' | 'rejected' | 'delayed';
  reasons: string[];
  selected_plan_id?: string;
}

export interface ExecutionPayload {
  plan_id: string;
  action: string;
  step_index: number;
  step_status: 'pending' | 'running' | 'completed' | 'failed';
  log_line?: string;
}

export interface VerificationPayload {
  plan_id: string;
  predicted_risk: number;
  actual_error_rate_pct: number;
  actual_db_pressure_pct: number;
  outcome: 'improved' | 'neutral' | 'regressed';
  delta_failed_txns: number;
}

// ── Extended types (gap-filling for frontend, pending backend contract) ───────

/** G-10: Gemma hypothesis — pending backend schema confirmation */
export interface GemmaHypothesis {
  hypothesis_id: string;
  statement: string;
  evidence: string[];
  confidence: number; // 0–1
  source: 'gemma' | 'heuristic';
  /** Must display prominently — not a fact */
  is_verified: false;
}

/**
 * G-01: Incident record — pending GET /v1/runs/{id}/incidents
 *
 * severity/status/started_at/affected_services are optional because the UI
 * routes by `incidents/{id}` and there is no /v1/incidents endpoint in the
 * contract: in live mode the route param is used as the run id and this record
 * is derived from GET /v1/runs/{run_id}. Only the id/run_id/title are known
 * then; the remaining header fields are filled in by the first streamed
 * `incident` SSE event. Mock data always supplies every field.
 */
export interface Incident {
  id: string;
  run_id: string;
  title: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  started_at?: string;
  affected_services?: string[];
  hypotheses?: GemmaHypothesis[];
  timeline?: CascadeEvent[];
}

/** G-04: Audit record — pending GET /v1/audit */
export interface AuditRecord {
  event_id: string;
  run_id: string;
  tick: number;
  kind: EventKind;
  agent?: string;
  action?: string;
  decision?: string;
  trace_id?: string;
  timestamp?: string;
  payload: EventPayload;
}

/** G-06: Execution step — pending GET /v1/runs/{id}/execution */
export interface ExecutionStep {
  step_index: number;
  action: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at?: string;
  completed_at?: string;
  log_lines: string[];
  checkpoint_passed?: boolean;
}

/** G-07: Multi-run experiment summary — pending contract */
export interface ExperimentSummary {
  experiment_id: string;
  seed: number;
  scenario: RunScenario;
  arms: ExperimentArm[];
}

export interface ExperimentArm {
  policy: RunPolicy;
  run_id: string;
  state: RunState;
  unique_failed_txns: number;
  unique_success_txns: number;
  latency_p95_ms: number;
  recovery_time_ticks: number;
  peak_db_pressure_pct: number;
  actions_executed: number;
  safety_violations: number;
  simulated: boolean;
  ci_lower?: number;
  ci_upper?: number;
  metrics_by_tick?: TickMetric[];
}

export interface TickMetric {
  tick: number;
  error_rate_pct: number;
  db_pressure_pct: number;
  throughput_rps: number;
}

/** Agent proposal (UI model, composed from SSE ProposalPayload + display data) */
export interface AgentProposal {
  proposal_id: string;
  agent: string;
  action: string;
  action_label: string;
  target_service: string;
  expected_effect: string;
  risk: ProposalRisk;
  confidence: number;
  ttl_ticks: number;
  status?: 'pending' | 'approved' | 'rejected' | 'expired';
}
