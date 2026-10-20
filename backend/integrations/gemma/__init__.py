"""Structured, simulation-only incident hypotheses.

The adapter tries an explicitly wired live client (anything with
``GeminiClient.generate_json``'s shape) only when an API key is present; every
failure falls back to the deterministic MockTransport with the shared
client's machine-readable reason. MockTransport is zero-RNG; its model_id is
None.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, replace
from typing import Any, Protocol

import jsonschema

from backend.ai.client import AIUnavailable


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
    source: str  # "mock" | "live"
    simulated: bool
    measured: bool
    fallback_reason: str | None
    model_id: str | None


def validate_hypothesis(payload: Any) -> dict[str, Any]:
    """Reject any model output outside the declared cause/confidence/rationale schema."""
    jsonschema.validate(payload, HYPOTHESIS_SCHEMA)
    return payload


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


class HypothesisClient(Protocol):
    """The live seam: any client with GeminiClient's generate_json shape."""

    def generate_json(self, prompt: str, schema: dict[str, Any]) -> tuple[dict, str]: ...


def _prompt(metrics: dict[str, Any], context: dict[str, Any] | None) -> str:
    return ("Reason only about simulated incident data. Return ONLY one JSON object "
            "conforming to this JSON schema: " + json.dumps(HYPOTHESIS_SCHEMA, sort_keys=True)
            + "\nInput: " + json.dumps({"metrics": metrics, "context": context or {}},
                                       sort_keys=True))


class HypothesisAdapter:
    """Try the wired live client only when an API key is present."""

    def __init__(self, client: HypothesisClient | None = None) -> None:
        self.client = client
        self.mock = MockTransport()

    def hypothesize(self, metrics: dict, context: dict[str, Any] | None = None) -> Hypothesis:
        if not isinstance(metrics, dict) or not isinstance(context, (dict, type(None))):
            raise ValueError("metrics must be a dict and context must be a dict or None")
        for name, _, _ in MockTransport._SIGNALS:
            value = metrics.get(name, 0)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError(f"{name} must be a finite nonnegative number")
        if self.client is None or not os.environ.get("GEMINI_API_KEY"):
            return self.mock.hypothesize(metrics)
        try:
            payload, model_id = self.client.generate_json(_prompt(metrics, context),
                                                          HYPOTHESIS_SCHEMA)
        except AIUnavailable:
            # A key vanished between wiring and the call; stay honest and mock.
            return self.mock.hypothesize(metrics)
        except Exception as exc:  # noqa: BLE001 - the client's labeled reason is the taxonomy
            reason = getattr(exc, "reason", None) or exc.__class__.__name__
            return replace(self.mock.hypothesize(metrics), fallback_reason=reason)
        return Hypothesis(payload["cause"], payload["confidence"], payload["rationale"],
                          "live", True, False, None, model_id)


__all__ = ["Hypothesis", "HypothesisAdapter", "MockTransport", "HYPOTHESIS_SCHEMA",
           "validate_hypothesis"]
