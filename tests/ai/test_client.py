"""Offline wire and failure-path checks for the shared Gemini client."""

import json
import socket
from urllib import error

import pytest

from backend.ai.client import (
    AIUnavailable, AITransportError, GeminiClient, _json_from_text,
)

SCHEMA = {"type": "object", "required": ["cause"], "additionalProperties": False,
          "properties": {"cause": {"type": "string"}}}


def wire(payload=None, text=None, model="models/serving-model"):
    body = text if text is not None else json.dumps(
        payload if payload is not None else {"cause": "database saturation"})
    return {"modelVersion": model,
            "candidates": [{"content": {"parts": [{"text": body}]}}]}


# ── lenient JSON extraction ───────────────────────────────────────────────────


def test_json_from_text_plain():
    assert _json_from_text('{"cause": "x"}') == {"cause": "x"}


@pytest.mark.parametrize("fence", [
    '```json\n{"cause": "x"}\n```',
    '```\n{"cause": "x"}\n```',
    '```JSON {"cause": "x"}```',
])
def test_json_from_text_strips_code_fences(fence):
    assert _json_from_text(fence) == {"cause": "x"}


def test_json_from_text_tolerates_surrounding_prose():
    assert _json_from_text('Sure! Here is the JSON:\n{"cause": "x"} hope it helps') == {
        "cause": "x"}


def test_json_from_text_without_object_raises():
    with pytest.raises(ValueError):
        _json_from_text("no braces at all")


# ── model selection (no network) ──────────────────────────────────────────────


def test_model_default_and_env_override(monkeypatch):
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.delenv("GEMMA_MODEL", raising=False)
    assert GeminiClient(api_key="k").model == "gemini-3.8-flash"
    monkeypatch.setenv("GEMMA_MODEL", "models/custom")
    assert GeminiClient(api_key="k").model == "custom"
    assert GeminiClient(api_key="k", model="override").model == "override"


# ── request shape (fake urlopen) ──────────────────────────────────────────────


class FakeResponse:
    def __init__(self, body):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self._body


def post_spy(monkeypatch, responses, sleeps):
    seen = []

    def fake_urlopen(req, timeout):
        seen.append({"url": req.full_url, "timeout": timeout,
                     "headers": dict(req.header_items()),
                     "body": json.loads(req.data)})
        outcome = responses.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return FakeResponse(json.dumps(outcome).encode())

    monkeypatch.setattr("backend.ai.client.request.urlopen", fake_urlopen)
    monkeypatch.setattr("backend.ai.client.time.sleep", lambda s: sleeps.append(s))
    return seen


def test_post_request_shape_and_key_header(monkeypatch):
    seen = post_spy(monkeypatch, [wire()], [])
    client = GeminiClient(api_key="test-key")
    payload, model_id = client.generate_json("prompt", SCHEMA)
    assert payload == {"cause": "database saturation"}
    assert model_id == "models/serving-model"
    assert seen[0]["url"].endswith("/models/gemini-3.8-flash:generateContent")
    assert seen[0]["headers"]["X-goog-api-key"] == "test-key"
    assert seen[0]["timeout"] == 45.0
    # Gemini models ask for JSON mime mode...
    assert seen[0]["body"]["generationConfig"] == {"responseMimeType": "application/json", "responseJsonSchema": SCHEMA}


def test_gemma_generation_config_omitted(monkeypatch):
    seen = post_spy(monkeypatch, [wire()], [])
    GeminiClient(api_key="k", model="gemma-4-26b").generate_json("p", SCHEMA)
    assert "generationConfig" not in seen[0]["body"]


# ── retry and error taxonomy ──────────────────────────────────────────────────


def test_http_500_retries_then_succeeds(monkeypatch):
    seen = post_spy(monkeypatch, [error.HTTPError("u", 500, "boom", {}, None), wire()], [])
    payload, _ = GeminiClient(api_key="k", retries=1).generate_json("p", SCHEMA)
    assert payload and len(seen) == 2


def test_http_503_retries_and_exhausts(monkeypatch):
    sleeps = []
    post_spy(monkeypatch, [error.HTTPError("u", 503, "boom", {}, None)] * 2, sleeps)
    with pytest.raises(AITransportError, match="http_status:503"):
        GeminiClient(api_key="k", retries=1).generate_json("p", SCHEMA)
    assert sleeps == [5]


def test_http_429_fails_fast_without_retry(monkeypatch):
    seen = post_spy(monkeypatch, [error.HTTPError("u", 429, "rate", {}, None)], [])
    with pytest.raises(AITransportError, match="http_status:429"):
        GeminiClient(api_key="k", retries=2).generate_json("p", SCHEMA)
    assert len(seen) == 1


def test_timeout_retries_then_raises_timeout(monkeypatch):
    post_spy(monkeypatch, [TimeoutError(), socket.timeout()], [])
    with pytest.raises(AITransportError, match="^timeout$"):
        GeminiClient(api_key="k", retries=1).generate_json("p", SCHEMA)


def test_urlerror_with_timeout_reason_maps_to_timeout(monkeypatch):
    post_spy(monkeypatch, [error.URLError(TimeoutError())], [])
    with pytest.raises(AITransportError, match="^timeout$"):
        GeminiClient(api_key="k").generate_json("p", SCHEMA)


def test_urlerror_other_reason_fails_fast(monkeypatch):
    seen = post_spy(monkeypatch, [error.URLError(OSError("dns"))] * 3, [])
    with pytest.raises(AITransportError, match="^transport_error$"):
        GeminiClient(api_key="k", retries=5).generate_json("p", SCHEMA)
    assert len(seen) == 1


# ── generate_json payload validation ──────────────────────────────────────────


def test_missing_key_raises_ai_unavailable(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(AIUnavailable):
        GeminiClient().generate_json("p", SCHEMA)


def test_malformed_wire_maps_to_malformed_body(monkeypatch):
    post_spy(monkeypatch, [{"candidates": []}], [])
    with pytest.raises(AITransportError, match="^malformed_body$"):
        GeminiClient(api_key="k").generate_json("p", SCHEMA)


def test_schema_violation_maps_to_schema_validation_failure(monkeypatch):
    post_spy(monkeypatch, [wire({"unexpected": "shape"})], [])
    with pytest.raises(AITransportError, match="^schema_validation_failure$"):
        GeminiClient(api_key="k").generate_json("p", SCHEMA)


def test_non_json_text_maps_to_unparseable_json(monkeypatch):
    post_spy(monkeypatch, [wire(text="{not json}")], [])
    with pytest.raises(AITransportError, match="^unparseable_json$"):
        GeminiClient(api_key="k").generate_json("p", SCHEMA)


def test_text_without_braces_maps_to_malformed_body(monkeypatch):
    post_spy(monkeypatch, [wire(text="no braces here")], [])
    with pytest.raises(AITransportError, match="^malformed_body$"):
        GeminiClient(api_key="k").generate_json("p", SCHEMA)


def test_response_schema_is_sent_to_gemini(monkeypatch):
    seen = post_spy(monkeypatch, [wire()], [])
    GeminiClient(api_key='k').generate_json('p', SCHEMA)
    assert seen[0]['body']['generationConfig']['responseJsonSchema'] == SCHEMA


def test_model_resource_prefix_is_not_url_encoded_as_part_of_id(monkeypatch):
    seen = post_spy(monkeypatch, [wire()], [])
    GeminiClient(api_key='k', model='models/gemini-3.8-flash').generate_json('p', SCHEMA)
    assert seen[0]['url'].endswith('/models/gemini-3.8-flash:generateContent')


def test_response_parts_ignore_thoughts_and_join_json_fragments(monkeypatch):
    response = wire()
    response['candidates'][0]['content']['parts'] = [
        {'thought': True, 'text': 'Private reasoning with {braces}'},
        {'text': '{"cause": '}, {'text': '"database saturation"}'},
    ]
    post_spy(monkeypatch, [response], [])
    assert GeminiClient(api_key='k').generate_json('p', SCHEMA)[0]['cause'] == 'database saturation'
