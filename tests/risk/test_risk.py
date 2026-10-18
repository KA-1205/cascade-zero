"""Contract and joint-effect tests for the analytic risk estimator."""

from dataclasses import FrozenInstanceError, replace

import pytest

from backend.agents import RecoveryAction
from backend.risk import RiskAssessment, evaluate
from backend.simulator import ObservableState


def state(error=0.3, queue=150, db=0.95):
    # Construct only the public observable; no private simulator run or probes.
    return ObservableState(12, error, 9.0, queue, db, {}, (), ())


REPLICAS = {"action": "add_replicas"}
RETRIES = {"action": "increase_retries"}
RESTART = {"action": "restart_service"}


def test_shared_db_slots_dominate_joint_risk(capsys):
    saturated = state()
    replicas = evaluate([REPLICAS], saturated).predicted_risk
    retries = evaluate([RETRIES], saturated).predicted_risk
    joint = evaluate([REPLICAS, RETRIES], saturated)
    assert joint.predicted_risk > replicas
    assert joint.predicted_risk > retries
    assert any("shared-DB-slot contention" in reason for reason in joint.reasons)
    # Report the actual scored values rather than a hardcoded expected metric.
    print(f"saturated risk: no-action=0.0 replicas={replicas} retries={retries} joint={joint.predicted_risk}")


def test_no_action_is_strictly_lowest():
    empty = evaluate([], state())
    assert empty.predicted_risk == 0.0
    assert "no actions" in empty.reasons[0].lower()
    assert all(evaluate([proposal], state()).predicted_risk > empty.predicted_risk
               for proposal in (REPLICAS, RETRIES, RESTART))


@pytest.mark.parametrize("observed", [state(0, 0, 0), state(), state(1, 500, 1),
                                             state(3, -1, 2)])
@pytest.mark.parametrize("actions", [[], [REPLICAS], [RETRIES], [RESTART],
                                             [REPLICAS, RETRIES], [REPLICAS, RESTART],
                                             [RETRIES, RESTART], [REPLICAS, RETRIES, RESTART]])
def test_bounded_quantised_and_explained(observed, actions):
    result = evaluate(actions, observed)
    assert 0 <= result.predicted_risk <= 1
    assert result.predicted_risk == round(result.predicted_risk, 2)
    if actions:
        assert result.reasons
        assert all(any(action["action"] in reason for action in actions)
                   for reason in result.reasons)


def test_order_independence_and_repeatability():
    proposals = [RESTART, RETRIES, REPLICAS, RETRIES]
    first = evaluate(proposals, state())
    assert all(evaluate(order, state()) == first
               for order in (proposals, list(reversed(proposals)), sorted(proposals, key=lambda p: p["action"])))
    assert all(evaluate(proposals, state()) == first for _ in range(20))
    assert len(first.reasons) == 4 + 5  # four bases, five cross-action pairs


def test_recovery_action_normalization():
    action = RecoveryAction("scale-agent", "orders", "more workers", "db slots", 0.5, 1)
    assert evaluate([action, RETRIES], state()) == evaluate([action.to_proposal_dict(), RETRIES], state())


def test_only_three_observable_pressures_are_read():
    observed = state()
    changed = replace(observed, tick=999, latency=9999, topology={"secret": 1},
                      incident_flags=("anything",), action_history=(("restart_service", 999),))
    assert evaluate([REPLICAS, RETRIES], changed) == evaluate([REPLICAS, RETRIES], observed)


def test_assessment_frozen():
    assessment = evaluate([RESTART], state())
    assert isinstance(assessment, RiskAssessment)
    assert assessment.simulated is True and assessment.measured is False
    with pytest.raises(FrozenInstanceError):
        assessment.predicted_risk = 0.0


def test_unknown_action_and_nonfinite_telemetry_rejected():
    with pytest.raises(ValueError, match="unknown action"):
        evaluate([{"action": "delete_database"}], state())
    with pytest.raises(ValueError, match="finite"):
        evaluate([REPLICAS], state(db=float("nan")))
