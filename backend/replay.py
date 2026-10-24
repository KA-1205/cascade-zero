"""Replay a recorded prefix and apply a candidate once at its decision tick."""
from dataclasses import dataclass

from backend.simulator import load_config, simulate


@dataclass
class ReplayDecision:
    selected_actions: list[str]
    predicted_risk: float = 0.0
    reasons: tuple[str, ...] = ()


def replay_candidate(seed: int, overlay: dict, actions: list[str], tick: int,
                     events: list[dict]) -> dict:
    prefix: dict[int, list[str]] = {}
    for event in events:
        if event['tick'] < tick and event['kind'] == 'execution':
            prefix.setdefault(event['tick'], []).append(event['payload']['action'])

    def fixed(state, proposals):
        selected = actions if state.tick == tick else prefix.get(state.tick, [])
        offered = {p['action'] for p in proposals}
        if not set(selected) <= offered:
            raise ValueError('Recorded actions cannot be replayed at this tick')
        return ReplayDecision(list(selected))

    horizon = load_config(overlay)['ticks']
    result = simulate(seed, 'coordinated', overlay, plan=fixed)
    metrics = result['metrics']
    return {'actions': list(actions), **{key: metrics[key] for key in (
        'unique_failed', 'unique_succeeded', 'peak_db_connections',
        'max_queue_depth', 'sustained_recovery_time', 'actions_executed')},
        'horizon_ticks': horizon, 'decision_tick': tick, 'replay_mode': 'single_decision'}
