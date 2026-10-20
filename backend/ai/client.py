"""Minimal Gemini generateContent client returning schema-validated JSON."""

from __future__ import annotations

import json
import os
import socket
import time
from typing import Any
from urllib import error, parse, request

import jsonschema


# Default to a Gemini flash model: fast and JSON-clean when the provider is
# healthy. Gemma endpoints stay selectable via GEMMA_MODEL, but the public
# gemma-4 endpoints reject any generationConfig with HTTP 500 and emit long
# markdown reasoning; see _post for the adaptive handling.
DEFAULT_MODEL = "gemini-3.8-flash"


class AIUnavailable(RuntimeError):
    """No API key is configured; callers must use their labeled fallback."""


class AITransportError(RuntimeError):
    """The live call failed; ``reason`` is the honest, machine-readable cause."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class _Malformed(ValueError):
    pass


def _extract(wire: Any) -> tuple[str, str]:
    try:
        model_id = wire["modelVersion"]
        text = wire["candidates"][0]["content"]["parts"][0]["text"]
        if not isinstance(model_id, str) or not model_id or not isinstance(text, str):
            raise _Malformed("missing model version or candidate text")
        return model_id, text
    except (KeyError, IndexError, TypeError) as exc:
        raise _Malformed("missing model version or candidate text") from exc


def _json_from_text(text: str) -> dict:
    """Parse the model's JSON out of raw text; fences and prose are tolerated."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.lower().startswith("json"):
            stripped = stripped[4:]
        stripped = stripped.strip()
    start, end = stripped.find("{"), stripped.rfind("}")
    if start == -1 or end <= start:
        raise _Malformed("no JSON object in response text")
    return json.loads(stripped[start:end + 1])


class GeminiClient:
    """One-shot JSON calls to the Gemini REST API; no retries, no caching.

    This Gemma deployment rejects ANY generationConfig with HTTP 500, so JSON
    output is instructed in the prompt and parsed leniently from raw text.
    """

    def __init__(self, api_key: str | None = None, model: str | None = None,
                 timeout: float = 45.0, retries: int = 0):
        self.api_key = api_key if api_key is not None else os.environ.get("GEMINI_API_KEY")
        env_model = os.environ.get("GEMMA_MODEL", "").strip()
        chosen = model if model is not None else env_model
        self.model = chosen if chosen else DEFAULT_MODEL
        self.timeout = timeout
        self.retries = retries

    def _post(self, prompt: str) -> bytes:
        body: dict[str, Any] = {"contents": [{"parts": [{"text": prompt}]}]}
        if not self.model.startswith("gemma"):
            # Gemini models honor JSON mime mode; Gemma deployments 500 on any
            # generationConfig, so for those JSON is instructed in the prompt.
            body["generationConfig"] = {"responseMimeType": "application/json"}
        url = ("https://generativelanguage.googleapis.com/v1beta/models/"
               + parse.quote(self.model, safe="") + ":generateContent")
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            if attempt:
                time.sleep(5)
            req = request.Request(url, data=json.dumps(body).encode("utf-8"),
                                  method="POST", headers={
                "Content-Type": "application/json", "x-goog-api-key": self.api_key,
            })
            try:
                with request.urlopen(req, timeout=self.timeout) as response:
                    return response.read()
            except error.HTTPError as exc:
                last = AITransportError(f"http_status:{exc.code}")
                if exc.code not in (500, 503):
                    raise last from exc
            except (TimeoutError, socket.timeout) as exc:
                last = AITransportError("timeout")
            except error.URLError as exc:
                reason = "timeout" if isinstance(exc.reason, (TimeoutError, socket.timeout)) \
                    else "transport_error"
                last = AITransportError(reason)
                if reason != "timeout":
                    raise last from exc
            except OSError as exc:
                last = AITransportError("transport_error")
                raise last from exc
        assert last is not None
        raise last

    def generate_json(self, prompt: str, schema: dict[str, Any]) -> tuple[dict, str]:
        """Return (validated payload, model id); raises AITransportError/AIUnavailable."""
        if not self.api_key:
            raise AIUnavailable("GEMINI_API_KEY is not configured")
        raw = self._post(prompt)
        try:
            model_id, text = _extract(json.loads(raw))
            payload = _json_from_text(text)
            jsonschema.validate(payload, schema)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise AITransportError("unparseable_json") from exc
        except jsonschema.ValidationError as exc:
            raise AITransportError("schema_validation_failure") from exc
        except _Malformed as exc:
            raise AITransportError("malformed_body") from exc
        return payload, model_id
