"""Structured, simulation-only incident hypotheses.

The wire format for a transport is a Gemini generateContent response mapping.
MockTransport is zero-RNG; its model_id is None. A failed live attempt yields
an independently generated mock hypothesis with a non-None fallback_reason.
"""

from __future__ import annotations

import json
import math
import os
import socket
from dataclasses import dataclass, replace
from typing import Any, Literal
from urllib import error, parse, request

import jsonschema


DEFAULT_MODEL = "google/gemma-4-31b-it"
HYPOTHESIS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["cause", "confidence", "rationale"],
    "additionalProperties": False,
    "properties": {
        "cause": {"type": "string", "minLength": 1},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "rationale": {"type": "string", "minLength": 1},
    },
}


@dataclass(frozen=True)
class Hypothesis:
    cause: str
    confidence: float
    rationale: str
    source: Literal["mock", "live"]
    simulated: Literal[True]
    measured: Literal[False]
    fallback_reason: str | None
    model_id: str | None


def validate_hypothesis(payload: Any) -> dict[str, Any]:
    """Reject any model output outside the declared cause/confidence/rationale schema."""
    jsonschema.validate(payload, HYPOTHESIS_SCHEMA)
    return payload


class MalformedBodyError(ValueError):
    """The provider's envelope is absent, undecodable or structurally invalid."""


def _extract(wire: Any) -> tuple[str, str]:
    try:
        model_id = wire["modelVersion"]
        text = wire["candidates"][0]["content"]["parts"][0]["text"]
        if not isinstance(model_id, str) or not model_id or not isinstance(text, str):
            raise MalformedBodyError("missing model version or candidate text")
        return model_id, text
    except (KeyError, IndexError, TypeError) as exc:
        raise MalformedBodyError("missing model version or candidate text") from exc


class MockTransport:
    """Deterministic, zero-RNG signal ranking; model_id is always None."""

    _SIGNALS = (
        ("db_load", 1.0, "database saturation"),
        ("error_rate", 0.1, "elevated request errors"),
        ("latency", 1000.0, "request latency pressure"),
        ("queue_depth", 100.0, "backlog pressure"),
    )

    def hypothesize(self, metrics: dict[str, Any]) -> Hypothesis:
        # Fixed ordering gives stable tie-breaking independently of input insertion order.
        ranking = sorted(
            ((metrics.get(name, 0) / scale, name, cause) for name, scale, cause in self._SIGNALS),
            key=lambda item: (-item[0], item[1]),
        )
        pressure, name, cause = ranking[0]
        confidence = round(0.5 + 0.3 * min(1.0, pressure), 4)
        return Hypothesis(
            cause=cause,
            confidence=confidence,
            rationale=f"Highest normalized pressure: {name}={metrics.get(name, 0)}.",
            source="mock", simulated=True, measured=False,
            fallback_reason=None, model_id=None,
        )


class LiveGeminiTransport:
    """Opt-in Gemini REST transport; no environment files and no key in the URL."""

    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        self.api_key = api_key if api_key is not None else os.environ.get("GEMINI_API_KEY")
        self.model = model if model is not None else os.environ.get("GEMMA_MODEL", DEFAULT_MODEL)

    def generate(self, metrics: dict[str, Any], context: dict[str, Any] | None = None) -> Any:
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY is required")
        prompt = (
            "Reason only about simulated incident data. Return ONLY one JSON object "
            "conforming to this JSON schema: " + json.dumps(HYPOTHESIS_SCHEMA, sort_keys=True)
            + "\nInput: " + json.dumps({"metrics": metrics, "context": context or {}}, sort_keys=True)
        )
        body = json.dumps({"contents": [{"parts": [{"text": prompt}]}],
                           "generationConfig": {"responseMimeType": "application/json"}},
                          sort_keys=True).encode("utf-8")
        url = ("https://generativelanguage.googleapis.com/v1beta/models/"
               + parse.quote(self.model, safe="/") + ":generateContent")
        req = request.Request(url, data=body, method="POST", headers={
            "Content-Type": "application/json", "x-goog-api-key": self.api_key,
        })
        with request.urlopen(req, timeout=30) as response:
            if not 200 <= response.status < 300:
                raise error.HTTPError(url, response.status, "non-2xx", {}, None)
            raw = response.read()
        try:
            return json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise MalformedBodyError("invalid provider envelope") from exc


class HypothesisAdapter:
    """Try an explicitly wired live transport only when an API key is present."""

    def __init__(self, transport: LiveGeminiTransport | Any | None = None) -> None:
        self.transport = transport if transport is not None else MockTransport()
        self.mock = MockTransport()

    def hypothesize(self, metrics: dict, context: dict | None = None) -> Hypothesis:
        if not isinstance(metrics, dict) or not isinstance(context, (dict, type(None))):
            raise ValueError("metrics must be a dict and context must be a dict or None")
        for name, _, _ in MockTransport._SIGNALS:
            value = metrics.get(name, 0)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError(f"{name} must be a finite nonnegative number")
        if isinstance(self.transport, MockTransport) or not os.environ.get("GEMINI_API_KEY"):
            return self.mock.hypothesize(metrics)
        try:
            wire = self.transport.generate(metrics, context)
            model_id, text = _extract(wire)
            try:
                payload = json.loads(text)
            except (json.JSONDecodeError, UnicodeDecodeError):
                reason = "unparseable_json"
            else:
                try:
                    validate_hypothesis(payload)
                except jsonschema.ValidationError:
                    reason = "schema_validation_failure"
                else:
                    return Hypothesis(payload["cause"], payload["confidence"], payload["rationale"],
                                      "live", True, False, None, model_id)
        except (TimeoutError, socket.timeout):
            reason = "timeout"
        except error.HTTPError as exc:
            reason = f"http_status:{exc.code}"
        except MalformedBodyError:
            reason = "malformed_body"
        except error.URLError as exc:
            reason = "timeout" if isinstance(exc.reason, (TimeoutError, socket.timeout)) else "transport_error"
        except (OSError, ValueError, TypeError, KeyError, IndexError):
            reason = "transport_error"
        return replace(self.mock.hypothesize(metrics), fallback_reason=reason)


__all__ = ["Hypothesis", "HypothesisAdapter", "MockTransport", "LiveGeminiTransport",
           "HYPOTHESIS_SCHEMA", "DEFAULT_MODEL", "validate_hypothesis", "MalformedBodyError"]
