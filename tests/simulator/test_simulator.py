import json
import random
import subprocess
import sys
from dataclasses import fields, replace
from pathlib import Path

import jsonschema
import pytest

from backend.simulator import (DEFAULT_CONFIG, ObservableState, _Run, _proposals,
                                load_config, observe, simulate)


def test_determinism_and_common_traffic():
    first = simulate(42, "independent")
    again = simulate(42, "independent")
    other = simulate(43, "independent")
    assert first["trace_hash"] == again["trace_hash"]
    assert first["events"] == again["events"]
    assert first["trace_hash"] != other["trace_hash"]
    none = simulate(42, "none")
    assert [e["payload"]["arrivals"] for e in first["events"] if e["kind"] == "metric"] == [
        e["payload"]["arrivals"] for e in none["events"] if e["kind"] == "metric"]


def test_cli_byte_identical_across_processes():
    command = [sys.executable, "-m", "backend.simulator", "--seed", "42", "--policy", "all"]
    root = Path(__file__).resolve().parents[2]
    first = subprocess.run(command, cwd=root, check=True, capture_output=True).stdout
    second = subprocess.run(command, cwd=root, check=True, capture_output=True).stdout
    assert first == second
    # all = none, independent, guardrails and coordinated (via the default
    # constraint coordinator, matching the API wiring).
    assert len(first.splitlines()) == 4


def test_unique_accounting_under_retries():
    config = load_config()
    config["ticks"] = 24
    config["traffic"]["base_retry_probability"] = 1
    config["traffic"]["increased_retry_probability"] = 1
    config["fault"]["start"] = 0
    config["fault"]["end"] = 24
    config["fault"]["recovery_end"] = 24
    config["fault"]["degraded_capacity"] = 1
    result = simulate(42, "none", config)
    metrics = result["metrics"]
    assert metrics["unique_offered"] == metrics["unique_succeeded"] + metrics["unique_failed"]
    assert metrics["total_attempts"] > metrics["unique_offered"]
    assert metrics["unique_failed"] > 0
    assert metrics["peak_db_connections"] <= config["db_connection_limit"]


def test_observation_field_allowlist_and_isolation():
    assert {f.name for f in fields(ObservableState)} == {
        "tick", "error_rate", "latency", "queue_depth", "db_load", "topology",
        "incident_flags", "action_history", "service_queues"}
    run = _Run(42, "none", load_config(), random.Random(42), random.Random(43), "test")
    state = observe(run, 0)
    assert "capacity" not in repr(state)
    assert "fault" not in repr(state)
    assert "true" not in repr(state)
    assert "config" not in repr(state)
    with pytest.raises(TypeError):
        state.topology["mutated"] = True
    with pytest.raises(TypeError):
        state.topology["edges"][0] = ("mutated", "database")
    with pytest.raises(ValueError):
        observe(run, 1)


def test_coordinated_is_not_implemented():
    with pytest.raises(NotImplementedError, match="requires a plan callable"):
        simulate(42, "coordinated")
    with pytest.raises(NotImplementedError, match="requires a plan callable"):
        simulate(42, "ai_coordinated")


def test_guardrails_caps_and_cooldown():
    run = _Run(42, "guardrails", load_config(), random.Random(42), random.Random(43), "test")
    run.telemetry.update(error_rate=0.5, queue_depth=90)
    state = observe(run, 0)
    actions = run.config["actions"]
    initial = _proposals("guardrails", state, actions)
    assert len(initial) == 3
    history = tuple((p["action"], 0) for p in initial)
    assert _proposals("guardrails", replace(state, tick=1, action_history=history), actions) == []
    assert [p["action"] for p in _proposals(
        "guardrails", replace(state, tick=actions["guardrail_cooldown"], action_history=history),
        actions)] == ["add_replicas", "restart_service"]
    assert len(_proposals("independent", replace(state, tick=1, action_history=history), actions)) == 3


def test_guardrail_caps_only_from_observable_history():
    actions = load_config()["actions"]
    state = ObservableState(
        tick=actions["guardrail_cooldown"], error_rate=0.5, latency=0.0,
        queue_depth=90, db_load=0.0, topology={}, incident_flags=(),
        action_history=(("add_replicas", 0), ("add_replicas", 0),
                        ("increase_retries", 0)),
    )
    assert [p["action"] for p in _proposals("guardrails", state, actions)] == ["restart_service"]


@pytest.mark.parametrize("policy", ("none", "independent", "guardrails"))
def test_event_contract_and_order(policy):
    schema = json.loads((Path(__file__).resolve().parents[2] / "contracts/events.schema.json").read_text())
    result = simulate(42, policy)
    assert result["simulated"] is True and result["measured"] is False
    assert [e["tick"] for e in result["events"]] == sorted(e["tick"] for e in result["events"])
    assert len({e["event_id"] for e in result["events"]}) == len(result["events"])
    for event in result["events"]:
        jsonschema.validate(event, schema)
        assert event["simulated"] is True
        assert event["payload"]["measured"] is False
        assert event["kind"] in ("metric", "incident", "execution")


def test_config_overlay_and_no_mutation(tmp_path):
    path = tmp_path / "config.json"
    path.write_text('{"ticks": 3, "fault": {"start": 1}}')
    config = load_config(path)
    assert config["fault"]["start"] == 1
    assert config["ticks"] == 3
    assert DEFAULT_CONFIG["ticks"] != 3
    original = json.dumps(config, sort_keys=True)
    simulate(3, "none", config)
    assert json.dumps(config, sort_keys=True) == original
    partial = simulate(3, "none", {"ticks": 3, "fault": {"start": 1}})
    assert partial["config"] == config
    with pytest.raises(ValueError, match="unknown config key"):
        simulate(3, "none", {"unknown": 1})


def test_negative_seed_rejected():
    with pytest.raises(ValueError, match="seed must be non-negative"):
        simulate(-42)
