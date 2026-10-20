"""Coordinator selection, policy isolation, and seeded trace regressions."""

import dataclasses
import json

import pytest

from backend.agents import default_agents
from backend.coordinator import Coordinator, default_coordinator
from backend.simulator import ObservableState, simulate


def state(error=0.0, queue=0, db=0.0):
    return ObservableState(1, error, 0.0, queue, db, {}, (), ())


def proposals(observation):
    return [action.to_proposal_dict() for agent in default_agents()
            if (action := agent.decide(observation)) is not None]


def test_all_actions_safe_and_accounted_for():
    observation = state(0.2, 30, 0.1)
    offered = proposals(observation)
    result = default_coordinator(threshold=1).plan(observation, offered)
    assert result.selected_actions == sorted(p["action"] for p in offered)
    assert result.predicted_risk <= 1
    assert all(any(name in reason and "Selected" in reason for reason in result.reasons)
               for name in result.selected_actions)
    assert result.simulated is True and result.measured is False


def test_saturated_joint_plan_rejected_with_interaction_reason():
    observation = state(0.95, 100, 0.99)
    offered = proposals(observation)
    result = default_coordinator().plan(observation, offered)
    assert len(result.selected_actions) < len(offered)
    assert result.predicted_risk <= 0.5
    assert all(any(name in reason for reason in result.reasons)
               for name in (p["action"] for p in offered))
    assert any("Excluded" in reason and "threshold" in reason and " x " in reason
               for reason in result.reasons)


def test_empty_and_threshold():
    observation = state()
    empty = default_coordinator().plan(observation, [])
    assert empty.selected_actions == [] and empty.predicted_risk == 0
    assert empty.reasons
    offered = proposals(state(0.2, 30, 0.3))
    assert default_coordinator(0).plan(observation, offered).selected_actions == []
    assert len(default_coordinator(1).plan(observation, offered).selected_actions) == 3
    with pytest.raises(ValueError, match="at most three"):
        default_coordinator().plan(observation, offered + offered[:1])


def test_pure_order_independent_and_frozen():
    observation = state(0.5, 60, 0.8)
    offered = proposals(observation)
    planner = default_coordinator()
    first = planner.plan(observation, offered)
    assert first == planner.plan(observation, offered)
    assert first == planner.plan(observation, [dict(reversed(list(p.items()))) for p in reversed(offered)])
    with pytest.raises(dataclasses.FrozenInstanceError):
        first.predicted_risk = 1
    with pytest.raises(ValueError, match="duplicate"):
        planner.plan(observation, offered[:1] * 2)
    with pytest.raises(ValueError, match="allowlisted"):
        planner.plan(observation, [{"agent_id": "other", "action": "shell"}])


def test_coordinated_reproducible_observable_only_and_common_traffic():
    observed = []
    planner = default_coordinator()

    def record(observation, offered):
        assert isinstance(observation, ObservableState)
        assert set(vars(observation)) == {
            "tick", "error_rate", "latency", "queue_depth", "db_load", "topology",
            "incident_flags", "action_history", "service_queues",
        }
        observed.append((observation.tick, [p["action"] for p in offered]))
        return planner.plan(observation, offered)

    config = {"ticks": 55}
    first = simulate(42, "coordinated", config, plan=record)
    assert len(observed) == 55
    observed.clear()
    again = simulate(42, "coordinated", config, plan=record)
    assert json.dumps(first["events"], sort_keys=True) == json.dumps(again["events"], sort_keys=True)
    assert first["trace_hash"] == again["trace_hash"]
    decisions = [event for event in first["events"] if event["kind"] == "decision"]
    assert len(decisions) == 55
    assert all(event["simulated"] is True and event["payload"]["simulated"] is True
               and event["payload"]["measured"] is False and event["payload"]["reasons"]
               for event in decisions)
    baseline = simulate(42, "none", config)
    arrivals = lambda run: [event["payload"]["arrivals"] for event in run["events"]
                       if event["kind"] == "metric"]
    assert arrivals(first) == arrivals(baseline)


@pytest.mark.parametrize("policy,expected", [
    # Hashes refreshed when fault.service_name joined the default config; the
    # run-id digest hashes the whole config, so event ids and the trace hash
    # move even though database-fault behaviour is unchanged.
    # Hashes refreshed when metric events gained per-service queue depths.
    ("none", "293c79ce84e2d5ba24df50f6f80c7f4fbf126b2c741c854aa20bd2f0a9abeef5"),
    ("independent", "792336365665428c355e2553bc01bddcf00cb5ac08f4658a33671791495d762b"),
    ("guardrails", "93a53e99bb92e9e46f3ee3d7db21314a88866403f7a34d67a17590677c8751a3"),
])
def test_existing_seed_42_trace_hashes(policy, expected):
    assert simulate(42, policy)["trace_hash"] == expected


def test_coordinated_requires_callback():
    with pytest.raises(NotImplementedError, match="requires a plan callable"):
        simulate(42, "coordinated")
    with pytest.raises(NotImplementedError, match="requires a plan callable"):
        simulate(42, "ai_coordinated")
    with pytest.raises(ValueError, match="outside the proposed set"):
        simulate(42, "coordinated", {"ticks": 1}, plan=lambda *_: type("Plan", (), {
            "selected_actions": ["shell"], "predicted_risk": 0.0, "reasons": []})())
