import {
  type Topology,
  type Run,
  type Plan,
  type Incident,
  type AuditRecord,
  type ExecutionStep,
  type ExperimentSummary,
  type AgentProposal,
  type GemmaHypothesis,
  type TickMetric,
} from '@/types/api';

// ─────────────────────────────────────────────────────────────────────────────
// Cascade Zero — Expanded mock fixtures
// Sourced from frontend/mock-data.json and extended for UI completeness.
// ALL values here are SIMULATED. None represent measured production data.
// ─────────────────────────────────────────────────────────────────────────────

export const MOCK_RUN_ID = 'demo-001';
export const MOCK_INCIDENT_ID = 'INC-DEMO-001';
export const MOCK_SEED = 42;
export const MOCK_SCENARIO = 'db_slowdown' as const;

// ── Topology ─────────────────────────────────────────────────────────────────

export const mockTopology: Topology = {
  nodes: [
    {
      id: 'gateway',
      capacity: 120,
      label: 'API Gateway',
      type: 'gateway',
      current_load: 85,
      health: 'degraded',
    },
    {
      id: 'orders',
      capacity: 80,
      label: 'Orders Service',
      type: 'service',
      current_load: 72,
      health: 'degraded',
    },
    {
      id: 'payments',
      capacity: 80,
      label: 'Payments Service',
      type: 'service',
      current_load: 68,
      health: 'degraded',
    },
    {
      id: 'inventory',
      capacity: 60,
      label: 'Inventory Service',
      type: 'service',
      current_load: 22,
      health: 'healthy',
    },
    {
      id: 'database',
      capacity: 100,
      label: 'Primary Database',
      type: 'database',
      current_load: 93,
      health: 'critical',
    },
  ],
  edges: [
    { from: 'gateway', to: 'orders', throughput: 340, latency_ms: 180 },
    { from: 'gateway', to: 'payments', throughput: 290, latency_ms: 210 },
    { from: 'gateway', to: 'inventory', throughput: 90, latency_ms: 45 },
    { from: 'orders', to: 'database', throughput: 320, latency_ms: 890 },
    { from: 'payments', to: 'database', throughput: 280, latency_ms: 940 },
    { from: 'inventory', to: 'database', throughput: 60, latency_ms: 110 },
  ],
};

// ── Active run ────────────────────────────────────────────────────────────────

export const mockRun: Run = {
  id: MOCK_RUN_ID,
  seed: MOCK_SEED,
  scenario: MOCK_SCENARIO,
  policy: 'coordinated',
  state: 'running',
  simulated: true,
  started_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  metrics: {
    error_rate_pct: 28,
    db_pressure_pct: 93,
    throughput_rps: 310,
    latency_p95_ms: 2140,
    unique_failed_txns: 47,
    unique_success_txns: 283,
  },
};

// ── Timeseries metrics (tick-based) ───────────────────────────────────────────

export const mockMetricsByTick: TickMetric[] = [
  { tick: 0, error_rate_pct: 2, db_pressure_pct: 48, throughput_rps: 420 },
  { tick: 1, error_rate_pct: 3, db_pressure_pct: 51, throughput_rps: 415 },
  { tick: 2, error_rate_pct: 5, db_pressure_pct: 58, throughput_rps: 408 },
  { tick: 3, error_rate_pct: 9, db_pressure_pct: 67, throughput_rps: 390 },
  { tick: 4, error_rate_pct: 14, db_pressure_pct: 75, throughput_rps: 372 },
  { tick: 5, error_rate_pct: 22, db_pressure_pct: 83, throughput_rps: 350 },
  { tick: 6, error_rate_pct: 30, db_pressure_pct: 89, throughput_rps: 325 },
  { tick: 7, error_rate_pct: 35, db_pressure_pct: 93, throughput_rps: 310 },
  { tick: 8, error_rate_pct: 38, db_pressure_pct: 95, throughput_rps: 295 },
  { tick: 9, error_rate_pct: 36, db_pressure_pct: 94, throughput_rps: 300 },
  { tick: 10, error_rate_pct: 33, db_pressure_pct: 91, throughput_rps: 308 },
  { tick: 11, error_rate_pct: 29, db_pressure_pct: 88, throughput_rps: 318 },
  { tick: 12, error_rate_pct: 26, db_pressure_pct: 85, throughput_rps: 328 },
  { tick: 13, error_rate_pct: 22, db_pressure_pct: 81, throughput_rps: 340 },
  { tick: 14, error_rate_pct: 18, db_pressure_pct: 76, throughput_rps: 355 },
  { tick: 15, error_rate_pct: 14, db_pressure_pct: 70, throughput_rps: 368 },
  { tick: 16, error_rate_pct: 10, db_pressure_pct: 63, throughput_rps: 382 },
  { tick: 17, error_rate_pct: 7, db_pressure_pct: 57, throughput_rps: 396 },
  { tick: 18, error_rate_pct: 5, db_pressure_pct: 52, throughput_rps: 408 },
  { tick: 19, error_rate_pct: 3, db_pressure_pct: 49, throughput_rps: 418 },
  { tick: 20, error_rate_pct: 2, db_pressure_pct: 47, throughput_rps: 422 },
];

// ── Agent proposals ───────────────────────────────────────────────────────────

export const mockProposals: AgentProposal[] = [
  {
    proposal_id: 'prop-001',
    agent: 'retry-agent',
    action: 'increase_retries',
    action_label: 'Increase retry limit (3→10)',
    target_service: 'orders',
    expected_effect: 'Reduce timeout errors by retrying failed requests',
    risk: 'high',
    confidence: 0.71,
    ttl_ticks: 5,
    status: 'rejected',
  },
  {
    proposal_id: 'prop-002',
    agent: 'scaling-agent',
    action: 'add_replicas',
    action_label: 'Scale orders to 4 replicas',
    target_service: 'orders',
    expected_effect: 'Distribute load across more instances',
    risk: 'unknown',
    confidence: 0.52,
    ttl_ticks: 8,
    status: 'rejected',
  },
  {
    proposal_id: 'prop-003',
    agent: 'restart-agent',
    action: 'restart_payment',
    action_label: 'Restart payments service',
    target_service: 'payments',
    expected_effect: 'Clear stuck connections and reset service state',
    risk: 'medium',
    confidence: 0.63,
    ttl_ticks: 3,
    status: 'rejected',
  },
  {
    proposal_id: 'prop-004',
    agent: 'throttle-agent',
    action: 'limit_retries',
    action_label: 'Cap retry rate (backoff)',
    target_service: 'orders',
    expected_effect: 'Reduce DB connection pressure from retry storm',
    risk: 'low',
    confidence: 0.84,
    ttl_ticks: 6,
    status: 'approved',
  },
  {
    proposal_id: 'prop-005',
    agent: 'scaling-agent',
    action: 'delay_scale',
    action_label: 'Delay scale-out by 60s',
    target_service: 'orders',
    expected_effect: 'Avoid startup spike during DB saturation',
    risk: 'low',
    confidence: 0.78,
    ttl_ticks: 10,
    status: 'approved',
  },
];

// ── Recovery plans ────────────────────────────────────────────────────────────

export const mockPlans: Plan[] = [
  {
    id: 'plan-a',
    run_id: MOCK_RUN_ID,
    actions: ['increase_retries', 'add_replicas', 'restart_payment'],
    predicted_risk: 0.91,
    status: 'rejected',
    simulated: true,
    reasons: [
      'Predicted DB connections reach 143% of capacity at tick +2',
      'Simultaneous restart during retry storm creates connection spike',
      'Scaling adds new connections before existing ones are released',
    ],
    constraint_violations: [
      {
        resource: 'database.connections',
        limit: 100,
        predicted_peak: 143,
        description:
          'Retry amplification + new replica connections exceed pool limit',
      },
      {
        resource: 'max_concurrent_restarts',
        limit: 1,
        predicted_peak: 2,
        description:
          'Restart-agent and scaling start-up both cause transient disruption simultaneously',
      },
    ],
    resource_trajectory: [
      { tick: 0, db_connections_pct: 93, estimated_failed_txns: 47 },
      { tick: 1, db_connections_pct: 118, estimated_failed_txns: 89 },
      { tick: 2, db_connections_pct: 143, estimated_failed_txns: 156 },
      { tick: 3, db_connections_pct: 138, estimated_failed_txns: 140 },
      { tick: 4, db_connections_pct: 124, estimated_failed_txns: 112 },
      { tick: 5, db_connections_pct: 109, estimated_failed_txns: 88 },
    ],
  },
  {
    id: 'plan-b',
    run_id: MOCK_RUN_ID,
    actions: ['limit_retries', 'delay_scale'],
    predicted_risk: 0.24,
    status: 'candidate',
    simulated: true,
    reasons: [
      'Retry cap reduces DB connection pressure within modeled bounds',
      'Delayed scale-out avoids startup spike until DB pressure normalises',
      'All resource projections within capacity limits across horizon H=10',
    ],
    constraint_violations: [],
    resource_trajectory: [
      { tick: 0, db_connections_pct: 93, estimated_failed_txns: 47 },
      { tick: 1, db_connections_pct: 87, estimated_failed_txns: 38 },
      { tick: 2, db_connections_pct: 79, estimated_failed_txns: 28 },
      { tick: 3, db_connections_pct: 71, estimated_failed_txns: 19 },
      { tick: 4, db_connections_pct: 63, estimated_failed_txns: 11 },
      { tick: 5, db_connections_pct: 55, estimated_failed_txns: 5 },
    ],
  },
];

// ── Active incident ────────────────────────────────────────────────────────────

export const mockGemmaHypothesis: GemmaHypothesis = {
  hypothesis_id: 'hyp-001',
  statement:
    'The database connection pool is saturated due to a retry storm originating from the orders service. ' +
    'Elevated retry rates caused by initial latency spikes are holding connections open, ' +
    'preventing new requests from obtaining connections.',
  evidence: [
    'DB pressure climbed from 48% to 93% over 8 simulation ticks',
    'Orders service error rate correlates with DB pressure (r≈0.94)',
    'Timeout errors increased 16× before saturation plateau',
    'No schema migration or DDL event in recent tick window',
  ],
  confidence: 0.72,
  source: 'gemma',
  is_verified: false,
};

export const mockIncident: Incident = {
  id: MOCK_INCIDENT_ID,
  run_id: MOCK_RUN_ID,
  title: 'Database connection pool saturation',
  severity: 'high',
  status: 'active',
  started_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  affected_services: ['orders', 'payments', 'gateway'],
  hypotheses: [mockGemmaHypothesis],
  timeline: [
    {
      event_id: 'evt-001',
      run_id: MOCK_RUN_ID,
      tick: 0,
      kind: 'metric',
      simulated: true,
      payload: { service_id: 'database', error_rate_pct: 2, db_pressure_pct: 48, throughput_rps: 420, latency_p95_ms: 95 },
      timestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    },
    {
      event_id: 'evt-002',
      run_id: MOCK_RUN_ID,
      tick: 3,
      kind: 'incident',
      simulated: true,
      payload: {
        incident_id: MOCK_INCIDENT_ID,
        title: 'Database connection pool saturation',
        severity: 'high',
        status: 'active',
        affected_services: ['orders', 'payments'],
      },
      timestamp: new Date(Date.now() - 7 * 60 * 1000).toISOString(),
    },
    {
      event_id: 'evt-003',
      run_id: MOCK_RUN_ID,
      tick: 4,
      kind: 'proposal',
      simulated: true,
      payload: {
        proposal_id: 'prop-001',
        agent: 'retry-agent',
        action: 'increase_retries',
        target_service: 'orders',
        expected_effect: 'Reduce timeout errors by retrying failed requests',
        risk: 'high',
        confidence: 0.71,
        ttl_ticks: 5,
      },
      timestamp: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    },
    {
      event_id: 'evt-004',
      run_id: MOCK_RUN_ID,
      tick: 4,
      kind: 'proposal',
      simulated: true,
      payload: {
        proposal_id: 'prop-002',
        agent: 'scaling-agent',
        action: 'add_replicas',
        target_service: 'orders',
        expected_effect: 'Distribute load across more instances',
        risk: 'unknown',
        confidence: 0.52,
        ttl_ticks: 8,
      },
      timestamp: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    },
    {
      event_id: 'evt-005',
      run_id: MOCK_RUN_ID,
      tick: 5,
      kind: 'proposal',
      simulated: true,
      payload: {
        proposal_id: 'prop-003',
        agent: 'restart-agent',
        action: 'restart_payment',
        target_service: 'payments',
        expected_effect: 'Clear stuck connections and reset service state',
        risk: 'medium',
        confidence: 0.63,
        ttl_ticks: 3,
      },
      timestamp: new Date(Date.now() - 5.5 * 60 * 1000).toISOString(),
    },
    {
      event_id: 'evt-006',
      run_id: MOCK_RUN_ID,
      tick: 6,
      kind: 'decision',
      simulated: true,
      payload: {
        plan_id: 'plan-a',
        decision: 'rejected',
        reasons: ['Predicted DB connections reach 143% of capacity at tick +2'],
        selected_plan_id: 'plan-b',
      },
      timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    },
    {
      event_id: 'evt-007',
      run_id: MOCK_RUN_ID,
      tick: 7,
      kind: 'execution',
      simulated: true,
      payload: {
        plan_id: 'plan-b',
        action: 'limit_retries',
        step_index: 0,
        step_status: 'completed',
        log_line: '[tick:7] limit_retries applied: orders backoff=exponential max_attempts=3',
      },
      timestamp: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    },
    {
      event_id: 'evt-008',
      run_id: MOCK_RUN_ID,
      tick: 9,
      kind: 'execution',
      simulated: true,
      payload: {
        plan_id: 'plan-b',
        action: 'delay_scale',
        step_index: 1,
        step_status: 'running',
        log_line: '[tick:9] delay_scale: scale-out deferred 60s, waiting for DB pressure < 70%',
      },
      timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    },
    {
      event_id: 'evt-009',
      run_id: MOCK_RUN_ID,
      tick: 11,
      kind: 'verification',
      simulated: true,
      payload: {
        plan_id: 'plan-b',
        predicted_risk: 0.24,
        actual_error_rate_pct: 28,
        actual_db_pressure_pct: 81,
        outcome: 'improved',
        delta_failed_txns: -19,
      },
      timestamp: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  ],
};

// ── Execution steps ───────────────────────────────────────────────────────────

export const mockExecutionSteps: ExecutionStep[] = [
  {
    step_index: 0,
    action: 'limit_retries',
    status: 'completed',
    started_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 2.5 * 60 * 1000).toISOString(),
    log_lines: [
      '[tick:7] Applying limit_retries to orders service',
      '[tick:7] Setting max_attempts=3, backoff=exponential, base_delay=500ms',
      '[tick:7] Applied successfully — retry rate dropped from 8.2/s to 2.1/s',
    ],
    checkpoint_passed: true,
  },
  {
    step_index: 1,
    action: 'delay_scale',
    status: 'running',
    started_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    log_lines: [
      '[tick:9] Deferring scale-out for orders service',
      '[tick:9] Condition: DB pressure must drop below 70% before scaling',
      '[tick:11] DB pressure at 81% — waiting...',
    ],
    checkpoint_passed: undefined,
  },
  {
    step_index: 2,
    action: 'verify_health',
    status: 'pending',
    log_lines: [],
  },
];

// ── Experiment Lab — 4-policy comparison ─────────────────────────────────────

export const mockExperiment: ExperimentSummary = {
  experiment_id: 'exp-demo-001',
  seed: MOCK_SEED,
  scenario: MOCK_SCENARIO,
  arms: [
    {
      policy: 'none',
      run_id: 'run-n0',
      state: 'completed',
      unique_failed_txns: 189,
      unique_success_txns: 141,
      latency_p95_ms: 4820,
      recovery_time_ticks: 38,
      peak_db_pressure_pct: 97,
      actions_executed: 0,
      safety_violations: 0,
      simulated: true,
      ci_lower: 172,
      ci_upper: 206,
      metrics_by_tick: [
        { tick: 0, error_rate_pct: 2, db_pressure_pct: 48, throughput_rps: 420 },
        { tick: 4, error_rate_pct: 14, db_pressure_pct: 75, throughput_rps: 372 },
        { tick: 8, error_rate_pct: 42, db_pressure_pct: 97, throughput_rps: 248 },
        { tick: 12, error_rate_pct: 51, db_pressure_pct: 96, throughput_rps: 208 },
        { tick: 16, error_rate_pct: 48, db_pressure_pct: 94, throughput_rps: 220 },
        { tick: 20, error_rate_pct: 44, db_pressure_pct: 91, throughput_rps: 235 },
        { tick: 24, error_rate_pct: 39, db_pressure_pct: 87, throughput_rps: 258 },
        { tick: 28, error_rate_pct: 31, db_pressure_pct: 79, throughput_rps: 290 },
        { tick: 32, error_rate_pct: 20, db_pressure_pct: 67, throughput_rps: 340 },
        { tick: 36, error_rate_pct: 10, db_pressure_pct: 54, throughput_rps: 390 },
        { tick: 38, error_rate_pct: 4, db_pressure_pct: 48, throughput_rps: 415 },
      ],
    },
    {
      policy: 'independent',
      run_id: 'run-n1',
      state: 'completed',
      unique_failed_txns: 241,
      unique_success_txns: 89,
      latency_p95_ms: 6340,
      recovery_time_ticks: 52,
      peak_db_pressure_pct: 143,
      actions_executed: 3,
      safety_violations: 2,
      simulated: true,
      ci_lower: 219,
      ci_upper: 263,
      metrics_by_tick: [
        { tick: 0, error_rate_pct: 2, db_pressure_pct: 48, throughput_rps: 420 },
        { tick: 4, error_rate_pct: 14, db_pressure_pct: 75, throughput_rps: 372 },
        { tick: 6, error_rate_pct: 31, db_pressure_pct: 102, throughput_rps: 298 },
        { tick: 8, error_rate_pct: 58, db_pressure_pct: 143, throughput_rps: 178 },
        { tick: 12, error_rate_pct: 65, db_pressure_pct: 138, throughput_rps: 148 },
        { tick: 16, error_rate_pct: 61, db_pressure_pct: 128, throughput_rps: 162 },
        { tick: 20, error_rate_pct: 54, db_pressure_pct: 115, throughput_rps: 190 },
        { tick: 24, error_rate_pct: 43, db_pressure_pct: 98, throughput_rps: 235 },
        { tick: 28, error_rate_pct: 32, db_pressure_pct: 82, throughput_rps: 285 },
        { tick: 36, error_rate_pct: 18, db_pressure_pct: 65, throughput_rps: 358 },
        { tick: 52, error_rate_pct: 3, db_pressure_pct: 49, throughput_rps: 416 },
      ],
    },
    {
      policy: 'guardrails',
      run_id: 'run-n2',
      state: 'completed',
      unique_failed_txns: 143,
      unique_success_txns: 187,
      latency_p95_ms: 3190,
      recovery_time_ticks: 28,
      peak_db_pressure_pct: 96,
      actions_executed: 2,
      safety_violations: 0,
      simulated: true,
      ci_lower: 131,
      ci_upper: 155,
      metrics_by_tick: [
        { tick: 0, error_rate_pct: 2, db_pressure_pct: 48, throughput_rps: 420 },
        { tick: 4, error_rate_pct: 14, db_pressure_pct: 75, throughput_rps: 372 },
        { tick: 6, error_rate_pct: 27, db_pressure_pct: 91, throughput_rps: 308 },
        { tick: 8, error_rate_pct: 34, db_pressure_pct: 96, throughput_rps: 278 },
        { tick: 12, error_rate_pct: 29, db_pressure_pct: 88, throughput_rps: 308 },
        { tick: 16, error_rate_pct: 21, db_pressure_pct: 76, throughput_rps: 348 },
        { tick: 20, error_rate_pct: 13, db_pressure_pct: 63, throughput_rps: 385 },
        { tick: 24, error_rate_pct: 7, db_pressure_pct: 54, throughput_rps: 408 },
        { tick: 28, error_rate_pct: 3, db_pressure_pct: 49, throughput_rps: 418 },
      ],
    },
    {
      policy: 'coordinated',
      run_id: MOCK_RUN_ID,
      state: 'running',
      unique_failed_txns: 84,
      unique_success_txns: 246,
      latency_p95_ms: 2140,
      recovery_time_ticks: 19,
      peak_db_pressure_pct: 95,
      actions_executed: 2,
      safety_violations: 0,
      simulated: true,
      ci_lower: 74,
      ci_upper: 94,
      metrics_by_tick: mockMetricsByTick,
    },
  ],
};

// ── Audit records ─────────────────────────────────────────────────────────────

export const mockAuditRecords: AuditRecord[] = mockIncident.timeline!.map((evt) => ({
  event_id: evt.event_id,
  run_id: evt.run_id,
  tick: evt.tick,
  kind: evt.kind,
  timestamp: evt.timestamp,
  trace_id: `trace-${evt.event_id}`,
  payload: evt.payload,
  agent:
    evt.kind === 'proposal'
      ? (evt.payload as { agent: string }).agent
      : undefined,
  action:
    evt.kind === 'execution'
      ? (evt.payload as { action: string }).action
      : undefined,
  decision:
    evt.kind === 'decision'
      ? (evt.payload as { decision: string }).decision
      : undefined,
}));
