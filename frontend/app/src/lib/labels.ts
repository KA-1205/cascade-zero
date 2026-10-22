import type { RunPolicy, RunScenario } from '@/types/api';

export const POLICIES: RunPolicy[] = [
  'none', 'independent', 'guardrails', 'coordinated', 'ai_coordinated',
];

export const POLICY_LABEL: Record<RunPolicy, string> = {
  none: 'No recovery',
  independent: 'Independent agents',
  guardrails: 'Rule guardrails',
  coordinated: 'Rule coordinator',
  ai_coordinated: 'AI planner',
};

export const POLICY_BLURB: Record<RunPolicy, string> = {
  none: 'Nothing acts; the incident plays out alone. Always the baseline to beat.',
  independent: 'Each recovery agent fires on its own trigger, no coordination.',
  guardrails: 'Agents act, but simple caps and cooldowns limit the damage.',
  coordinated: 'A deterministic risk engine picks the safest action subset.',
  ai_coordinated: 'The AI planner diagnoses synthetic telemetry and selects from guarded actions. A deterministic fallback is used if the model is unavailable.',
};

export const SCENARIOS: RunScenario[] = [
  'db_slowdown', 'payments_degradation', 'traffic_surge',
];

export const SCENARIO_LABEL: Record<RunScenario, string> = {
  db_slowdown: 'Database slowdown',
  payments_degradation: 'Payments degradation',
  traffic_surge: 'Traffic surge',
};

export const SCENARIO_BLURB: Record<RunScenario, string> = {
  db_slowdown: 'The shared database slows down; every service that touches it starts timing out and retrying.',
  payments_degradation: 'The payments service itself degrades; its backlog grows while orders stays calm.',
  traffic_surge: 'A sustained wave of traffic overwhelms the gateway and services before any fault exists.',
};
