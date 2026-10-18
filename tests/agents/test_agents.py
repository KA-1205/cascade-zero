"""Contract parity for the independent sandbox action agents."""

from dataclasses import FrozenInstanceError, fields
from types import MappingProxyType

import pytest

from backend.agents import RecoveryAction, RestartAgent, RetryAgent, ScaleAgent, default_agents
from backend.simulator import DEFAULT_CONFIG, ObservableState, _proposals, load_config


def state(*, tick: int = 0, error_rate: float = 0.0, queue_depth: int = 0) -> ObservableState:
    # Construct exclusively from observable fields; private run state is unavailable.
    return ObservableState(tick=tick, error_rate=error_rate, latency=4.0,
                           queue_depth=queue_depth, db_load=0.7,
                           topology=MappingProxyType({"services": ("orders", "database")}),
                           incident_flags=("elevated_errors",),
                           action_history=(("increase_retries", max(0, tick - 1)),))


@pytest.mark.parametrize("config", [None, {"actions": {
    "retry_error_trigger": 0.12,
    "scale_queue_trigger": 40,
    "restart_error_trigger": 0.31,
}}])
def test_independent_proposal_parity(config):
    cfg = load_config(config)
    agents = default_agents(config)
    a = cfg["actions"]
    retry, scale, restart = (a["retry_error_trigger"], a["scale_queue_trigger"],
                             a["restart_error_trigger"])
    assert (agents[0].retry_error_trigger, agents[1].scale_queue_trigger,
            agents[2].restart_error_trigger) == (retry, scale, restart)
    if config is None:
        assert (RetryAgent().retry_error_trigger, ScaleAgent().scale_queue_trigger,
                RestartAgent().restart_error_trigger) == (
                    DEFAULT_CONFIG["actions"]["retry_error_trigger"],
                    DEFAULT_CONFIG["actions"]["scale_queue_trigger"],
                    DEFAULT_CONFIG["actions"]["restart_error_trigger"])

    errors = (0.0, retry - 0.001, retry, retry + 0.001,
              restart - 0.001, restart, restart + 0.001, 1.0)
    queues = (0, scale - 1, scale, scale + 1, 180)
    for tick in (0, 9, 10, 25, 35, 36, 48, 49):
        for error in errors:
            for queue in queues:
                observed = state(tick=tick, error_rate=error, queue_depth=queue)
                expected = {p["agent_id"]: p for p in _proposals("independent", observed, a)}
                actual = {agent.agent_id: (action.to_proposal_dict() if action else None)
                          for agent in agents if (action := agent.decide(observed)) is not None}
                assert actual == expected


@pytest.mark.parametrize("agent,active,inactive", [
    (RetryAgent(), state(error_rate=0.05), state(error_rate=0.049)),
    (ScaleAgent(), state(queue_depth=25), state(queue_depth=24)),
    (RestartAgent(), state(error_rate=0.18), state(error_rate=0.179)),
])
def test_only_observable_state_and_threshold(agent, active, inactive):
    assert agent.decide(active) is not None
    assert agent.decide(inactive) is None


def test_repeat_calls_are_pure_and_agents_have_no_mutable_state():
    agents = default_agents()
    observed = state(tick=15, error_rate=0.2, queue_depth=30)
    equivalent = state(tick=15, error_rate=0.2, queue_depth=30)
    for agent in agents:
        assert agent.decide(observed) == agent.decide(equivalent) == agent.decide(observed)
        assert agent == type(agent)(**{f.name: getattr(agent, f.name) for f in fields(agent)})
        assert all(isinstance(getattr(agent, f.name), (str, int, float)) for f in fields(agent))


def test_recovery_action_is_frozen():
    action = RetryAgent().decide(state(error_rate=0.05))
    assert isinstance(action, RecoveryAction)
    with pytest.raises(FrozenInstanceError):
        action.cost = "changed"
