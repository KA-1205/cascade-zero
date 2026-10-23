"""Named-scenario overlays expose distinct, attributable telemetry signatures."""

import pytest

from backend.coordinator import default_coordinator
from backend.simulator import SCENARIOS, scenario_overlay, simulate


def _states(seed, overlay, ticks=None):
    """Record ObservableStates through the plan hook; delegate to the rules planner."""
    seen = []
    planner = default_coordinator()
    config = dict(overlay)
    if ticks:
        config["ticks"] = ticks
    def record(state, proposals):
        seen.append(state)
        return planner.plan(state, proposals)
    simulate(seed, "ai_coordinated", config, plan=record)
    return seen


def test_scenario_registry_and_unknown_name():
    assert set(SCENARIOS) == {"db_slowdown", "payments_degradation", "traffic_surge", "telemetry_faults"}
    with pytest.raises(ValueError, match="unknown scenario"):
        scenario_overlay("cache_stampede")


def test_observable_state_exposes_per_service_queues():
    states = _states(42, scenario_overlay("db_slowdown"), ticks=40)
    assert all(set(state.service_queues) == {"gateway", "orders", "payments", "database"}
               for state in states)


def test_payments_degradation_isolates_the_payments_queue():
    states = _states(42, scenario_overlay("payments_degradation"))
    payments = max(state.service_queues["payments"] for state in states)
    orders = max(state.service_queues["orders"] for state in states)
    assert payments > 40
    assert orders <= 5


def test_traffic_surge_saturates_gateway_and_orders():
    overlay = scenario_overlay("traffic_surge")
    states = _states(42, overlay)
    assert max(state.service_queues["gateway"] for state in states) > 30
    assert any(state.error_rate > 0.3 for state in states)
    result = simulate(42, "none", overlay)
    assert result["metrics"]["unique_offered"] > 9000
    # With restart off the surge menu, the coordinator's live options are
    # replicas and retries; the rules delegate picks replicas and the orders
    # backlog actually drains instead of piling to the queue limit.
    coordinated = simulate(42, "ai_coordinated", overlay,
                           plan=default_coordinator().plan)
    executed = {event["payload"]["action"] for event in coordinated["events"]
                if event["kind"] == "execution"}
    assert "add_replicas" in executed
    assert "restart_service" not in executed


def test_payments_scenario_supports_targeted_restart():
    overlay = scenario_overlay("payments_degradation")
    result = simulate(42, "independent", overlay)
    executed = {event["payload"]["action"] for event in result["events"]
                if event["kind"] == "execution"}
    assert "restart_service" in executed
    assert all(event["payload"]["target"] == "payments"
               for event in result["events"]
               if event["kind"] == "execution"
               and event["payload"]["action"] == "restart_service")


def test_scenario_action_menus_differ():
    payments = simulate(42, "independent", scenario_overlay("payments_degradation"))
    surge = simulate(42, "independent", scenario_overlay("traffic_surge"))
    baseline = simulate(42, "independent", scenario_overlay("db_slowdown"))

    def executed_actions(result):
        return {event["payload"]["action"] for event in result["events"]
                if event["kind"] == "execution"}

    assert "add_replicas" not in executed_actions(payments), \
        "orders replicas cannot help a payments fault"
    assert "restart_service" not in executed_actions(surge), \
        "restarting under pure overload is off the menu"
    assert executed_actions(baseline) <= {"increase_retries", "add_replicas",
                                          "restart_service"}


def test_restart_restores_faulted_service_capacity():
    # One restart executed mid-fault (fault from tick 0, one-shot cooldown):
    # after its downtime and warm-up the service runs at healthy capacity for
    # the rest of the fault window, so far fewer unique transactions fail.
    overlay = scenario_overlay("payments_degradation")
    overlay["fault"]["start"] = 0
    overlay["actions"]["restart_error_trigger"] = 0.0
    overlay["actions"]["guardrail_cooldown"] = 200
    healed = simulate(42, "guardrails", overlay)
    degraded = simulate(42, "guardrails", dict(overlay, actions={**overlay["actions"],
                                                                "restart_error_trigger": 1.1}))
    restarts = [event for event in healed["events"]
                if event["kind"] == "execution"
                and event["payload"]["action"] == "restart_service"]
    assert restarts and len(restarts) == 1
    assert healed["metrics"]["unique_failed"] < degraded["metrics"]["unique_failed"]
