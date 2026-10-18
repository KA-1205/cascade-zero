"""Read-only checks for the published sandbox contracts."""

import json
from pathlib import Path

import jsonschema
import pytest
import yaml


CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
EVENT_KINDS = (
    "metric",
    "incident",
    "proposal",
    "decision",
    "execution",
    "verification",
)


@pytest.fixture(scope="module")
def event_schema():
    return json.loads((CONTRACTS / "events.schema.json").read_text(encoding="utf-8"))


def test_event_schema_is_valid_json_schema(event_schema):
    validator_class = jsonschema.validators.validator_for(event_schema)
    validator_class.check_schema(event_schema)


@pytest.mark.parametrize("kind", EVENT_KINDS)
def test_synthetic_sandbox_event_validates(event_schema, kind):
    event = {
        "event_id": f"synthetic-{kind}-0",
        "run_id": "synthetic-run-0",
        "tick": 0,
        "kind": kind,
        "simulated": True,
        "payload": {"measured": False},
    }
    jsonschema.validate(event, event_schema)


def test_openapi_lists_documented_operations():
    api = yaml.safe_load((CONTRACTS / "openapi.yaml").read_text(encoding="utf-8"))
    assert isinstance(api, dict)
    assert api["openapi"] == "3.1.0"
    expected = {
        ("get", "/v1/health"),
        ("get", "/v1/topology"),
        ("post", "/v1/runs"),
        ("get", "/v1/runs/{run_id}"),
        ("get", "/v1/runs/{run_id}/events"),
        ("get", "/v1/runs/{run_id}/plans"),
        ("post", "/v1/plans/{plan_id}/approval"),
    }
    paths = api["paths"]
    for method, path in expected:
        assert method in paths[path], f"Missing {method.upper()} {path}"
