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
  'db_slowdown', 'payments_degradation', 'traffic_surge', 'telemetry_faults',
];

export const SCENARIO_LABEL: Record<RunScenario, string> = {
  db_slowdown: 'Database slowdown',
  payments_degradation: 'Payments degradation',
  traffic_surge: 'Traffic surge',
  telemetry_faults: 'Noisy / delayed telemetry',
};

export const SCENARIO_BLURB: Record<RunScenario, string> = {
  db_slowdown: 'The shared database slows down; every service that touches it starts timing out and retrying.',
  payments_degradation: 'The payments service itself degrades; its backlog grows while orders stays calm.',
  traffic_surge: 'A sustained wave of traffic overwhelms the gateway and services before any fault exists.',
  telemetry_faults: 'The simulator generates delayed, noisy, and occasionally dropped readings while actual transaction outcomes remain separate.',
};

const ACTION_LABEL: Record<string, string> = {
  increase_retries: 'Increase retries',
  add_replicas: 'Add replicas',
  restart_service: 'Restart service',
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action]
    ?? action.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function actionListLabel(actions: string[]): string {
  return actions.length ? actions.map(actionLabel).join(' + ') : 'Hold action';
}
