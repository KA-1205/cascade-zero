"""Offline contract and failure-path checks for simulated hypotheses."""

import json
from dataclasses import FrozenInstanceError, asdict

import jsonschema
import pytest

from backend.ai.client import AIUnavailable, AITransportError
from backend.integrations.gemma import (
    HypothesisAdapter, HYPOTHESIS_SCHEMA, MockTransport, validate_hypothesis,
)


METRICS = {"queue_depth": 42, "error_rate": 0.2, "db_load": 0.5, "latency": 850}


class StubClient:
    """Anything with GeminiClient's generate_json shape; records prompts."""

    def __init__(self, value=None, exc=None):
        self.value, self.exc = value, exc
        self.calls = 0
        self.prompts = []

    def generate_json(self, prompt, schema):
        self.calls += 1
        self.prompts.append(prompt)
        if self.exc:
            raise self.exc
        return self.value, "models/actually-serving-model"


def payload(**overrides):
    base = {"cause": "database contention", "confidence": 0.7,
            "rationale": "DB is saturated"}
    base.update(overrides)
    return base


def test_default_is_mock_and_immutable(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    hypothesis = HypothesisAdapter().hypothesize(METRICS)
    assert hypothesis.source == "mock"
    assert hypothesis.simulated is True and hypothesis.measured is False
    assert hypothesis.model_id is None and hypothesis.fallback_reason is None
    with pytest.raises(FrozenInstanceError):
        hypothesis.source = "live"


def test_byte_reproducible_independent_of_metric_order_and_context():
    adapter = HypothesisAdapter()
    first = adapter.hypothesize(METRICS, {"note": "a"})
    second = adapter.hypothesize(dict(reversed(list(METRICS.items()))), {"note": "b"})
    assert json.dumps(asdict(first), sort_keys=True) == json.dumps(asdict(second), sort_keys=True)


@pytest.mark.parametrize("exc,expected", [
    (AITransportError("timeout"), "timeout"),
    (AITransportError("http_status:500"), "http_status:500"),
    (AITransportError("malformed_body"), "malformed_body"),
    (AITransportError("unparseable_json"), "unparseable_json"),
    (AITransportError("schema_validation_failure"), "schema_validation_failure"),
    (RuntimeError("socket exploded"), "RuntimeError"),
])
def test_failures_fall_back_with_the_clients_reason(monkeypatch, exc, expected):
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    stub = StubClient(exc=exc)
    result = HypothesisAdapter(stub).hypothesize(METRICS)
    assert stub.calls == 1
    assert result.source == "mock" and result.fallback_reason == expected
    assert result.simulated is True and result.measured is False
    assert result.model_id is None


def test_ai_unavailable_is_an_unlabeled_mock(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    stub = StubClient(exc=AIUnavailable("no key"))
    result = HypothesisAdapter(stub).hypothesize(METRICS)
    assert result.source == "mock" and result.fallback_reason is None


def test_no_key_never_uses_wired_live_client(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    stub = StubClient(value=payload())
    assert HypothesisAdapter(stub).hypothesize(METRICS).source == "mock"
    assert stub.calls == 0


def test_live_preserves_simulation_provenance_and_model(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    stub = StubClient(value=payload())
    result = HypothesisAdapter(stub).hypothesize(METRICS)
    assert result.source == "live" and result.model_id == "models/actually-serving-model"
    assert result.simulated is True and result.measured is False
    assert result.fallback_reason is None
    # The prompt carries the schema and the metrics, like the old transport.
    assert "schema" in stub.prompts[0] and json.dumps(METRICS, sort_keys=True) in stub.prompts[0]


def test_schema_validator_rejects_invalid_output():
    for bad in ({"cause": "", "confidence": 0.4, "rationale": "x"},
                {"cause": "x", "confidence": 1.1, "rationale": "x"},
                {"cause": "x", "confidence": 0.5, "rationale": "x", "measured": True}):
        with pytest.raises(jsonschema.ValidationError):
            validate_hypothesis(bad)


def test_mock_transport_is_deterministic():
    assert MockTransport().hypothesize(METRICS) == MockTransport().hypothesize(METRICS)


def test_bad_metrics_are_request_errors():
    with pytest.raises(ValueError):
        HypothesisAdapter().hypothesize({"latency": float("nan")})


def test_hypothesis_schema_is_strict():
    assert HYPOTHESIS_SCHEMA["additionalProperties"] is False
