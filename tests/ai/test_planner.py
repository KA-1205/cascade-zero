"""Offline planner behaviour with scripted model transports."""

import json

import pytest

from backend.ai.client import AITransportError
from backend.ai.planner import AIPlanner, DECISION_SCHEMA
from backend.simulator import scenario_overlay, simulate


def payload(**overrides):
    base = {
        "diagnosis": {"cause": "database saturation",
                      "affected": ["orders", "database"],
                      "severity": "high", "confidence": 0.8,
                      "rationale": "db_load high while errors climb",
                      "checks": ["watch connection pool"]},
        "selected_actions": [],
        "risk": 0.2,
        "reasons": ["retry actions amplify load during saturation"],
        "need_probes": False,
        "test_cases": [{"description": "errors keep climbing",
                        "metric": "error_rate", "comparator": "lt",
                        "threshold": 0.9, "within_ticks": 5}],
    }
    base.update(overrides)
    return base


class Script:
    """Returns each queued payload in order, then repeats the last; records prompts."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.prompts = []
        self._last = None

    def generate_json(self, prompt, schema):
        self.prompts.append(prompt)
        if self.responses:
            self._last = self.responses.pop(0)
        elif self._last is None:
            self._last = payload()
        if isinstance(self._last, Exception):
            raise self._last
        return self._last, "scripted-model"


def ai_run(script, ticks=60, seed=42, overlay_name="db_slowdown"):
    planner = AIPlanner(script, seed, scenario_overlay(overlay_name))
    config = {**scenario_overlay(overlay_name), "ticks": ticks}
    result = simulate(seed, "ai_coordinated", config, plan=planner.plan)
    return result, planner


def decision_events(result):
    return [e for e in result["events"] if e["kind"] == "decision"]


def test_live_decision_event_carries_the_ai_loop():
    script = Script(payload(selected_actions=["restart_service"], risk=0.4,
                            reasons=["restart clears the degraded worker"]))
    result, planner = ai_run(script)
    live = [e for e in decision_events(result) if e["payload"].get("ai", {}).get("live")]
    assert live, "expected at least one live AI decision"
    first = live[0]["payload"]
    assert first["actions"] == ["restart_service"]
    assert first["ai"]["model"] == "scripted-model"
    assert first["ai"]["diagnosis"]["cause"] == "database saturation"
    assert first["ai"]["prompt_sha256"]
    assert planner.live_decisions >= 1
    # the simulator's allowlist held: only known actions were ever executed
    executed = {e["payload"]["action"] for e in result["events"]
                if e["kind"] == "execution"}
    assert executed <= {"increase_retries", "add_replicas", "restart_service"}


def test_gating_keeps_model_calls_sparse():
    script = Script()  # always declines everything
    result, planner = ai_run(script, ticks=60)
    assert planner.calls < 16, planner.calls
    assert planner.live_decisions == planner.calls
    assert all(e["payload"]["actions"] == [] for e in decision_events(result)
               if e["payload"].get("ai", {}).get("live"))


def test_test_cases_are_evaluated_against_the_sandbox():
    script = Script(payload(test_cases=[
        {"description": "queue stays bounded", "metric": "queue_depth",
         "comparator": "lt", "threshold": 10000, "within_ticks": 5}]))
    result, _ = ai_run(script)
    checks = [c for e in decision_events(result)
              for c in e["payload"].get("ai", {}).get("checks", [])]
    assert checks and any(c["status"] == "pass" for c in checks)


def test_probe_round_trips_measured_outcomes_back_to_the_model():
    script = Script(payload(need_probes=True, probes=[["restart_service"], []]),
                    payload(selected_actions=[]))
    result, planner = ai_run(script, ticks=55)
    assert len(script.prompts) >= 2
    assert "probe_outcomes" not in script.prompts[0]
    assert "probe_outcomes" in script.prompts[1]
    outcomes = json.loads(script.prompts[1].split("Input: ", 1)[1])["probe_outcomes"]
    assert {tuple(o["actions"]) for o in outcomes} == {(), ("restart_service",)}
    assert all(o["unique_failed"] > 0 for o in outcomes)
    live = [e for e in decision_events(result) if e["payload"].get("ai", {}).get("live")]
    assert live[0]["payload"]["ai"]["probes"]


def test_transport_failure_falls_back_with_reason():
    script = Script(AITransportError("http_status:429"))
    result, planner = ai_run(script)
    assert planner.fallbacks >= 1 and planner.live_decisions == 0
    reasons = [e["payload"]["ai"]["fallback_reason"]
               for e in decision_events(result)
               if e["payload"]["ai"].get("fallback_reason")]
    assert reasons[:3] == ["http_status:429"] * 3
    assert set(reasons[3:]) == {"circuit_open"}
    assert all(not e["payload"]["ai"]["live"]
               for e in decision_events(result))


def test_sandbox_probe_error_is_labeled_and_never_feeds_the_circuit_breaker(monkeypatch):
    script = Script(payload(need_probes=True, probes=[["restart_service"]]))
    planner = AIPlanner(script, 42, scenario_overlay("db_slowdown"))

    def broken_probe(*args, **kwargs):
        raise ValueError("simulator bug")

    monkeypatch.setattr(planner, "_run_probe", broken_probe)
    config = {**scenario_overlay("db_slowdown"), "ticks": 30}
    result = simulate(42, "ai_coordinated", config, plan=planner.plan)
    reasons = [e["payload"]["ai"]["fallback_reason"]
               for e in decision_events(result)
               if e["payload"]["ai"].get("fallback_reason")]
    assert "sandbox_probe_error:ValueError" in reasons
    assert planner.circuit_open is False and planner.consecutive_failures == 0


def test_circuit_breaker_opens_after_three_failures():
    script = Script(AITransportError("timeout"))
    result, planner = ai_run(script)
    assert planner.circuit_open is True
    assert len(script.prompts) == 3, "the model must only be tried three times"
    reasons = [e["payload"]["ai"]["fallback_reason"]
               for e in decision_events(result)
               if e["payload"]["ai"].get("fallback_reason")]
    assert "circuit_open" in reasons


def test_selection_outside_proposals_is_rejected():
    script = Script(payload(selected_actions=["drop_database"]))
    result, planner = ai_run(script)
    assert planner.live_decisions == 0
    assert planner.fallbacks >= 1
    reasons = [e["payload"]["ai"]["fallback_reason"] for e in decision_events(result)
               if e["payload"]["ai"].get("fallback_reason")]
    assert "selection_outside_proposals" in reasons


def test_no_client_runs_deterministic_fallback():
    def run():
        planner = AIPlanner(None, 42, scenario_overlay("db_slowdown"))
        config = {**scenario_overlay("db_slowdown"), "ticks": 45}
        return planner, simulate(42, "ai_coordinated", config, plan=planner.plan)
    planner, first = run()
    again_planner, again = run()
    assert first["trace_hash"] == again["trace_hash"]
    assert planner.fallbacks == again_planner.fallbacks
    assert all(e["payload"]["ai"]["fallback_reason"] == "no_client_configured"
               for e in decision_events(first) if e["payload"]["actions"])


def test_decision_schema_is_strict():
    import jsonschema
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({"diagnosis": "not-an-object"}, DECISION_SCHEMA)


def test_model_cannot_execute_a_self_reported_high_risk_action():
    result, _ = ai_run(Script(payload(selected_actions=['restart_service'], risk=1.0)))
    live = [e for e in decision_events(result) if e['payload'].get('ai', {}).get('live')]
    assert live
    assert all(not e['payload']['actions'] for e in live)
    assert all(e['payload']['ai']['model_risk'] == 1.0 for e in live)


def test_model_selection_is_subject_to_the_deterministic_coordinator():
    from backend.simulator import ObservableState
    from types import MappingProxyType
    from backend.agents import default_agents
    state = ObservableState(tick=20, error_rate=0.9, latency=10, queue_depth=180,
                            db_load=1.0, topology=MappingProxyType({}),
                            incident_flags=('db_busy',), action_history=(),
                            service_queues=MappingProxyType({}))
    proposals = [p.to_proposal_dict() for agent in default_agents() if (p := agent.decide(state))]
    selected = [p['action'] for p in proposals]
    planner = AIPlanner(Script(payload(selected_actions=selected, risk=0.0)), 42)
    decision = planner.plan(state, proposals)
    assert decision.predicted_risk <= planner.fallback.threshold
    assert decision.selected_actions == planner.fallback.plan(state, proposals).selected_actions
    assert decision.extra['ai']['model_selected_actions'] == selected
