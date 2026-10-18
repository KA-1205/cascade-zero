"""Local-only, synchronous HTTP facade for deterministic sandbox simulations.

No recovery operation in this module contacts an external service. Results and
approval receipts live in process memory and disappear when the server stops.
"""

from __future__ import annotations

import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4

from backend.coordinator import default_coordinator
from backend.simulator import DEFAULT_CONFIG, simulate


_runs: dict[str, dict] = {}
_plans: dict[str, dict] = {}
_approval_keys: set[tuple[str, str]] = set()
_lock = threading.RLock()
_run_path = re.compile(r"/v1/runs/([^/]+)(?:/(events|plans))?")
_approval_path = re.compile(r"/v1/plans/([^/]+)/approval")
_event_fields = frozenset({"event_id", "run_id", "tick", "kind", "simulated",
                           "payload", "timestamp", "trace_id"})


def _topology() -> dict:
    return {
        "nodes": [{"id": name, "capacity": capacity}
                  for name, capacity in DEFAULT_CONFIG["topology"].items()],
        "edges": [{"from": source, "to": target} for source, target in (
            ("gateway", "orders"), ("gateway", "payments"),
            ("orders", "database"), ("payments", "database"))],
    }


def _valid_run_request(body: object) -> bool:
    return (isinstance(body, dict) and type(body.get("seed")) is int
            and body["seed"] >= 0 and body.get("scenario") == "db_slowdown"
            and body.get("policy") in ("none", "independent", "guardrails", "coordinated"))


class Handler(BaseHTTPRequestHandler):
    """Request handler; use ``ThreadingHTTPServer(('127.0.0.1', 0), Handler)``."""

    def _send(self, status: int, body: object | None = None) -> None:
        data = b"" if body is None else json.dumps(body, allow_nan=False).encode("utf-8")
        self.send_response(status)
        if body is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self) -> object:
        length = int(self.headers.get("Content-Length", "0"))
        if length < 1 or length > 65536:
            raise ValueError("invalid content length")
        return json.loads(self.rfile.read(length))

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/v1/health":
            return self._send(200, {"status": "ok"})
        if path == "/v1/topology":
            return self._send(200, _topology())
        match = _run_path.fullmatch(path)
        if not match:
            return self._send(404, {"error": "not found"})
        run_id, resource = match.groups()
        with _lock:
            stored = _runs.get(run_id)
            if stored is None:
                return self._send(404, {"error": "run not found"})
            if resource == "plans":
                return self._send(200, [dict(plan) for plan in stored["plans"]])
            if resource is None:
                return self._send(200, dict(stored["run"]))
            events = stored["events"]
        last = self.headers.get("Last-Event-ID")
        try:
            # Event ids have the form <run_id>:<zero-based index>. Numeric
            # offsets are also accepted for clients without an event id.
            offset = -1 if last is None else int(last.removeprefix(run_id + ":"))
            if offset < -1:
                raise ValueError
        except ValueError:
            return self._send(400, {"error": "invalid Last-Event-ID"})
        data = b"".join(b"data: " + json.dumps(event, allow_nan=False).encode("utf-8") + b"\n\n"
                        for event in events[offset + 1:])
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/v1/runs":
            return self._create_run()
        match = _approval_path.fullmatch(path)
        if match:
            return self._approve(match.group(1))
        return self._send(404, {"error": "not found"})

    def _create_run(self) -> None:
        try:
            request = self._body()
        except (ValueError, UnicodeDecodeError):
            return self._send(400, {"error": "invalid JSON body"})
        if not _valid_run_request(request):
            return self._send(400, {"error": "invalid run request"})
        run_id = str(uuid4())
        run = {"id": run_id, "seed": request["seed"], "scenario": request["scenario"],
               "policy": request["policy"], "state": "created", "simulated": True,
               "measured": False}
        stored = {"run": run, "events": [], "plans": []}
        with _lock:
            _runs[run_id] = stored
        run["state"] = "running"
        try:
            result = simulate(request["seed"], request["policy"],
                              plan=default_coordinator().plan if request["policy"] == "coordinated" else None)
            run["metrics"] = {key: value for key, value in result["metrics"].items()
                              if isinstance(value, (int, float)) and not isinstance(value, bool)}
            run["trace_hash"] = result["trace_hash"]
            for index, original in enumerate(result["events"]):
                event = {key: value for key, value in original.items() if key in _event_fields}
                event.update(event_id=f"{run_id}:{index:06d}", run_id=run_id)
                stored["events"].append(event)
                if request["policy"] == "coordinated" and event["kind"] == "decision":
                    decision = event["payload"]
                    plan = {"id": f"{run_id}:plan:{index:06d}", "run_id": run_id,
                            "actions": decision["actions"], "predicted_risk": decision["predicted_risk"],
                            "reasons": decision["reasons"], "status": "candidate",
                            "simulated": True, "measured": False}
                    stored["plans"].append(plan)
                    with _lock:
                        _plans[plan["id"]] = (stored, plan, index)
            run["state"] = "completed"
        except Exception:
            # A failed simulation remains inspectable rather than escaping as
            # an HTTP 500 and leaving an indefinitely running record.
            run["state"] = "failed"
        return self._send(201, dict(run))

    def _approve(self, plan_id: str) -> None:
        token = os.environ.get("CASCADE_APPROVAL_TOKEN")
        if not token or self.headers.get("Authorization") != f"Bearer {token}":
            return self._send(403)
        key = self.headers.get("Idempotency-Key")
        if not key:
            return self._send(400, {"error": "Idempotency-Key required"})
        try:
            body = self._body()
        except (ValueError, UnicodeDecodeError):
            return self._send(400, {"error": "invalid JSON body"})
        if not isinstance(body, dict) or body.get("approved") is not True or (
                "reason" in body and not isinstance(body["reason"], str)):
            return self._send(400, {"error": "approved must be true"})
        with _lock:
            entry = _plans.get(plan_id)
            if (plan_id, key) in _approval_keys or entry is None:
                return self._send(409)
            stored, plan, index = entry
            if plan["status"] != "candidate":
                return self._send(409)
            try:
                result = simulate(stored["run"]["seed"], "coordinated",
                                  plan=default_coordinator().plan)
                decision = next(event for event in result["events"]
                                if event["event_id"].endswith(f":{index:06d}"))
                payload = decision["payload"]
                if (decision["kind"] != "decision" or payload["actions"] != plan["actions"]
                        or payload["predicted_risk"] != plan["predicted_risk"]
                        or payload["reasons"] != plan["reasons"]):
                    return self._send(409)
            except (ValueError, NotImplementedError, StopIteration):
                return self._send(409)
            # The original plan is retained verbatim; only its state changes.
            plan["status"] = "executed"
            _approval_keys.add((plan_id, key))
        return self._send(202)


def serve(host: str = "127.0.0.1", port: int = 8000) -> None:
    """Start a sandbox-only HTTP server on the loopback interface by default."""
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("API may bind only to loopback")
    with ThreadingHTTPServer((host, port), Handler) as server:
        server.serve_forever()
