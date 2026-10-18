"""Offline contract and failure-path checks for simulated hypotheses."""

import json
from dataclasses import FrozenInstanceError, asdict
from urllib.error import HTTPError

import jsonschema
import pytest

from backend.integrations.gemma import (
    DEFAULT_MODEL, HypothesisAdapter, LiveGeminiTransport, MalformedBodyError,
    validate_hypothesis,
)


METRICS = {"queue_depth": 42, "error_rate": 0.2, "db_load": 0.5, "latency": 850}


class StubTransport:
    def __init__(self, value=None, exc=None):
        self.value, self.exc = value, exc
        self.calls = 0

    def generate(self, metrics, context):
        self.calls += 1
        if self.exc:
            raise self.exc
        return self.value


def wire(payload=None, model="models/actually-serving-model"):
    payload = payload if payload is not None else {
        "cause": "database contention", "confidence": 0.7, "rationale": "DB is saturated"
    }
    return {"modelVersion": model, "candidates": [{"content": {
        "parts": [{"text": json.dumps(payload)}]
    }}]}


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


@pytest.mark.parametrize("stub,expected", [
    (StubTransport(exc=TimeoutError()), "timeout"),
    (StubTransport(exc=HTTPError("https://example.invalid", 500, "fail", {}, None)), "http_status:500"),
    (StubTransport(value={"candidates": []}), "malformed_body"),
    (StubTransport(value={"modelVersion": "m", "candidates": [{"content": {"parts": [{"text": "{"}]}}]}), "unparseable_json"),
    (StubTransport(value=wire({"cause": "x", "confidence": 5, "rationale": "r"})), "schema_validation_failure"),
    (StubTransport(exc=MalformedBodyError("invalid wire JSON")), "malformed_body"),
])
def test_failures_fall_back_with_specific_reason(monkeypatch, stub, expected):
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    result = HypothesisAdapter(stub).hypothesize(METRICS)
    assert stub.calls == 1
    assert result.source == "mock" and result.fallback_reason == expected
    assert result.simulated is True and result.measured is False
    assert result.model_id is None


def test_no_key_never_uses_injected_live_transport(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    stub = StubTransport(value=wire())
    assert HypothesisAdapter(stub).hypothesize(METRICS).source == "mock"
    assert stub.calls == 0


def test_schema_validator_rejects_invalid_output():
    for bad in ({"cause": "", "confidence": 0.4, "rationale": "x"},
                {"cause": "x", "confidence": 1.1, "rationale": "x"},
                {"cause": "x", "confidence": 0.5, "rationale": "x", "measured": True}):
        with pytest.raises(jsonschema.ValidationError):
            validate_hypothesis(bad)


def test_live_preserves_simulation_provenance_and_wire_model(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    result = HypothesisAdapter(StubTransport(value=wire())).hypothesize(METRICS)
    assert result.source == "live" and result.model_id == "models/actually-serving-model"
    assert result.simulated is True and result.measured is False
    assert result.fallback_reason is None


def test_default_model_and_env_override_without_network(monkeypatch):
    monkeypatch.delenv("GEMMA_MODEL", raising=False)
    assert LiveGeminiTransport(api_key="test-only").model == DEFAULT_MODEL == "google/gemma-4-31b-it"
    monkeypatch.setenv("GEMMA_MODEL", "models/custom-test-model")
    assert LiveGeminiTransport(api_key="test-only").model == "models/custom-test-model"


def test_live_transport_request_shape_and_wire_parsing_without_network(monkeypatch):
    monkeypatch.setenv("GEMMA_MODEL", "models/custom-test-model")
    seen = {}

    class FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps(wire()).encode()

    def fake_urlopen(req, timeout):
        seen.update(url=req.full_url, timeout=timeout, headers=dict(req.header_items()),
                    body=json.loads(req.data))
        return FakeResponse()

    monkeypatch.setattr("backend.integrations.gemma.request.urlopen", fake_urlopen)
    assert LiveGeminiTransport(api_key="test-only").generate(METRICS) == wire()
    assert seen["url"].endswith("/models/models/custom-test-model:generateContent")
    assert seen["timeout"] == 30
    assert seen["headers"]["X-goog-api-key"] == "test-only"
    assert "schema" in seen["body"]["contents"][0]["parts"][0]["text"]


def test_bad_metrics_are_request_errors():
    with pytest.raises(ValueError):
        HypothesisAdapter().hypothesize({"latency": float("nan")})
