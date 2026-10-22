"""Local-only, synchronous HTTP facade for deterministic sandbox simulations.

No recovery operation in this module contacts an external service. Results and
approval receipts live in process memory and disappear when the server stops.
AI-coordinated runs call the configured Gemini model from a background thread;
every decision, probe and fallback is recorded in the event stream.
"""

from __future__ import annotations

import hmac
import json
import os
import re
import threading
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4

from backend.ai import AIPlanner, GeminiClient
from backend.ai.planner import counterfactual
from backend.coordinator import default_coordinator
from backend.integrations.n8n import executor_from_env
from backend.simulator import DEFAULT_CONFIG, SCENARIOS, scenario_overlay, simulate


_runs: dict[str, dict] = {}
_plans: dict[str, dict] = {}
_approval_keys: set[tuple[str, str]] = set()
_lock = threading.RLock()
_run_path = re.compile(r"/v1/runs/([^/]+)(?:/(events|plans))?")
_approval_path = re.compile(r"/v1/plans/([^/]+)/approval")
_backtest_path = re.compile(r"/v1/plans/([^/]+)/backtest")
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
            and body["seed"] >= 0 and body.get("scenario") in SCENARIOS
            and body.get("policy") in ("none", "independent", "guardrails",
                                       "coordinated", "ai_coordinated"))


def load_dotenv() -> None:
    """Populate missing environment variables from a repo-root .env file."""
    path = Path(__file__).resolve().parents[2] / ".env"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and value and key not in os.environ:
            os.environ[key] = value


def _admin_status() -> dict:
    """Aggregate project status: run counts, AI engine health, scenario menus."""
    from collections import Counter

    from backend.ai.client import DEFAULT_MODEL

    with _lock:
        stores = [(stored["run"], list(stored["events"])) for stored in _runs.values()]
    runs = [run for run, _ in stores]
    totals = {"offered": 0, "failed": 0, "succeeded": 0, "actions": 0}
    ai_live = ai_fallback = 0
    fallback_reasons: Counter = Counter()
    for run, events in stores:
        metrics = run.get("metrics", {})
        totals["offered"] += metrics.get("unique_offered", 0)
        totals["failed"] += metrics.get("unique_failed", 0)
        totals["succeeded"] += metrics.get("unique_succeeded", 0)
        totals["actions"] += metrics.get("actions_executed", 0)
        for event in events:
            if event["kind"] != "decision":
                continue
            info = event["payload"].get("ai")
            if not isinstance(info, dict):
                continue
            if info.get("live"):
                ai_live += 1
            elif info.get("fallback_reason"):
                ai_fallback += 1
                fallback_reasons[info["fallback_reason"]] += 1
    scenarios = {}
    for name, overlay in SCENARIOS.items():
        disabled = set(overlay.get("actions", {}).get("disabled_actions", []))
        scenarios[name] = {
            "actions_available": [action for action in
                                  ("increase_retries", "add_replicas", "restart_service")
                                  if action not in disabled],
        }
    newest = max(runs, key=lambda run: run.get("created_at", ""), default=None)
    return {
        "backend": {"state": "ok", "runs_stored": len(runs)},
        "runs": {
            "total": len(runs),
            "by_state": dict(Counter(run["state"] for run in runs)),
            "by_policy": dict(Counter(run["policy"] for run in runs)),
            "newest_run_id": newest["id"] if newest else None,
        },
        "transactions": totals,
        "ai_engine": {
            "model": DEFAULT_MODEL,
            "provider_configured": bool(os.environ.get("GEMINI_API_KEY")),
            "live_decisions": ai_live,
            "fallback_decisions": ai_fallback,
            "top_fallback_reasons": dict(fallback_reasons.most_common(3)),
        },
        "scenarios": scenarios,
    }


def _plan_callable(policy: str, seed: int, overlay: dict):
    if policy == "coordinated":
        return default_coordinator().plan
    if policy == "ai_coordinated":
        client = GeminiClient() if os.environ.get("GEMINI_API_KEY") else None
        return AIPlanner(client, seed, overlay).plan
    return None


def _execute_run(stored: dict, run: dict, request: dict, overlay: dict) -> None:
    try:
        plan = _plan_callable(request["policy"], request["seed"], overlay)
        result = simulate(request["seed"], request["policy"], overlay, plan=plan)
        run["metrics"] = {key: value for key, value in result["metrics"].items()
                          if isinstance(value, (int, float)) and not isinstance(value, bool)}
        run["trace_hash"] = result["trace_hash"]
        for index, original in enumerate(result["events"]):
            event = {key: value for key, value in original.items() if key in _event_fields}
            event.update(event_id=f"{run['id']}:{index:06d}", run_id=run["id"])
            plan_record = None
            if request["policy"] in ("coordinated", "ai_coordinated") and event["kind"] == "decision":
                decision = event["payload"]
                plan_record = {"id": f"{run['id']}:plan:{index:06d}", "run_id": run["id"],
                               "actions": decision["actions"], "predicted_risk": decision["predicted_risk"],
                               "reasons": decision["reasons"], "status": "candidate",
                               "simulated": True, "measured": False}
                if "ai" in decision:
                    plan_record["ai"] = decision["ai"]
            with _lock:
                stored["events"].append(event)
                if plan_record is not None:
                    stored["plans"].append(plan_record)
                    _plans[plan_record["id"]] = (stored, plan_record, index)
        run["state"] = "completed"
    except Exception as exc:
        # A failed simulation remains inspectable rather than escaping as an
        # HTTP 500 and leaving an indefinitely running record. The stack goes
        # to stderr and the cause lands on the run record for the operator.
        traceback.print_exc()
        run["state"] = "failed"
        run["failed_reason"] = f"{type(exc).__name__}: {exc}"


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
        if path == "/v1/admin/status":
            return self._send(200, _admin_status())
        if path == "/v1/runs":
            with _lock:
                runs = sorted(_runs.values(),
                              key=lambda stored: stored["run"].get("created_at", ""),
                              reverse=True)
                return self._send(200, [
                    {key: value for key, value in stored["run"].items()
                     if key != "trace_hash"} | {
                        "event_count": len(stored["events"]),
                        "plan_count": len(stored["plans"])}
                    for stored in runs])
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
            # Snapshot under the lock: the AI worker appends without the
            # reader holding it, and iterating a live list is a data race.
            events = list(stored["events"])
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
        self.send_header("Cache-Control", "no-store")
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
        match = _backtest_path.fullmatch(path)
        if match:
            return self._backtest(match.group(1))
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
               "measured": False,
               "created_at": datetime.now(timezone.utc).isoformat(timespec="microseconds")}
        overlay = scenario_overlay(request["scenario"])
        stored = {"run": run, "events": [], "plans": [], "overlay": overlay}
        with _lock:
            _runs[run_id] = stored
        run["state"] = "running"
        if request["policy"] == "ai_coordinated":
            # Live model calls take seconds each: execute in the background so
            # the response returns immediately and events stream as they land.
            worker = threading.Thread(target=_execute_run,
                                      args=(stored, run, request, overlay),
                                      daemon=True)
            worker.start()
        else:
            _execute_run(stored, run, request, overlay)
        return self._send(201, dict(run))

    def _authorize(self) -> bool:
        token = os.environ.get("CASCADE_APPROVAL_TOKEN")
        return bool(token) and hmac.compare_digest(
            self.headers.get("Authorization") or "", f"Bearer {token}")

    def _approve(self, plan_id: str) -> None:
        if not self._authorize():
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
            # Claim the plan so a concurrent approval cannot also verify and
            # execute; any verification failure below releases the claim.
            plan["status"] = "delayed"
            policy = stored["run"]["policy"]
            seed = stored["run"]["seed"]
            overlay = stored.get("overlay") or None

        def release_claim() -> None:
            with _lock:
                if plan["status"] == "delayed":
                    plan["status"] = "candidate"

        try:
            if policy == "ai_coordinated":
                # A live model is not reproducible, so verify the plan
                # against the recorded decision event instead of replaying.
                with _lock:
                    events = list(stored["events"])
                event = events[index] if 0 <= index < len(events) else None
                payload = (event or {}).get("payload") or {}
                verified = (event is not None and event["kind"] == "decision"
                            and payload.get("actions") == plan["actions"]
                            and payload.get("predicted_risk") == plan["predicted_risk"]
                            and payload.get("reasons") == plan["reasons"])
            else:
                # The replay runs OUTSIDE the lock: re-verifying one plan must
                # not block SSE reads and run creation for a whole simulation.
                result = simulate(seed, "coordinated", overlay,
                                  plan=default_coordinator().plan)
                decision = next((event for event in result["events"]
                                 if event["event_id"].endswith(f":{index:06d}")), None)
                payload = (decision or {}).get("payload") or {}
                verified = (decision is not None and decision["kind"] == "decision"
                            and payload.get("actions") == plan["actions"]
                            and payload.get("predicted_risk") == plan["predicted_risk"]
                            and payload.get("reasons") == plan["reasons"])
        except (ValueError, NotImplementedError, StopIteration, IndexError):
            release_claim()
            return self._send(409)
        if not verified:
            release_claim()
            return self._send(409)

        # Execution is opt-in and runs outside the lock. In the default
        # sandbox nothing is sent: the actions already executed inside the
        # deterministic simulation, so approval is recorded honestly as
        # "approved". With a gated n8n webhook configured, it executes now.
        record = None
        if plan["actions"]:
            try:
                record = executor_from_env().execute(plan_id, key, plan["actions"])
            except ValueError:
                release_claim()
                return self._send(409, {"error": "actions are not executable"})

        with _lock:
            entry = _plans.get(plan_id)
            if entry is None or entry[1] is not plan or plan["status"] != "delayed":
                return self._send(409)
            if record is None or record.status == "dry-run":
                plan["status"] = "approved"
            elif record.status == "sent":
                plan["status"] = "executed"
                plan["execution"] = {"status": record.status,
                                     "simulated": record.simulated,
                                     "measured": record.measured,
                                     "replayed": record.replayed,
                                     "error": record.error}
            else:
                # 'unknown': the webhook may have received the POST; the plan
                # stays 'delayed' for operator review and is never auto-retried.
                plan["status"] = "delayed"
                plan["execution"] = {"status": record.status,
                                     "simulated": record.simulated,
                                     "measured": record.measured,
                                     "replayed": record.replayed,
                                     "error": record.error}
            _approval_keys.add((plan_id, key))
        return self._send(202)




    def _backtest(self, plan_id: str) -> None:
        """Replay a candidate plan locally against the recorded seed.

        Nothing live is touched: the same deterministic simulator that produced
        the incident replays it with the plan's actions applied, plus a no-action
        baseline and each action alone, and reports the measured outcome.
        """
        if not self._authorize():
            return self._send(403)
        with _lock:
            entry = _plans.get(plan_id)
            if entry is None:
                return self._send(404, {"error": "plan not found"})
            stored, plan, _index = entry
            if "backtest" in plan:
                return self._send(200, plan["backtest"])
            overlay = stored.get("overlay") or {}
            seed = stored["run"]["seed"]
            actions = list(plan["actions"])
        baseline = counterfactual(seed, overlay, [], 70)
        arms = [baseline, counterfactual(seed, overlay, actions, 70)]
        if len(actions) > 1:
            arms.extend(counterfactual(seed, overlay, [action], 70)
                        for action in actions)
        delta = arms[1]["unique_failed"] - baseline["unique_failed"]
        result = {"plan_id": plan_id, "run_id": stored["run"]["id"], "seed": seed,
                  "actions": actions, "arms": arms,
                  "baseline_failed": baseline["unique_failed"],
                  "plan_failed": arms[1]["unique_failed"],
                  "delta_failed": delta,
                  "verdict": "better" if delta < 0 else
                             "worse" if delta > 0 else "equal",
                  "simulated": True, "measured": False}
        with _lock:
            entry = _plans.get(plan_id)
            if entry is not None:
                entry[1]["backtest"] = result
        return self._send(200, result)

def serve(host: str | None = None, port: int | None = None) -> None:
    """Start the sandbox HTTP server on the loopback interface by default.

    Host and port fall back to the CASCADE_HOST / PORT environment variables
    (container hosts such as Render inject PORT). Binding off-loopback requires
    CASCADE_ALLOW_PUBLIC_BIND=true so the sandbox stays loopback-only unless
    exposing it is a deliberate deployment decision.
    """
    load_dotenv()
    host = host or os.environ.get("CASCADE_HOST") or "127.0.0.1"
    if port is None:
        port = int(os.environ.get("PORT") or 8000)
    if host not in ("127.0.0.1", "localhost", "::1") and (
            os.environ.get("CASCADE_ALLOW_PUBLIC_BIND") != "true"):
        raise ValueError(
            "API may bind only to loopback; set CASCADE_ALLOW_PUBLIC_BIND=true "
            "to allow a public bind")
    with ThreadingHTTPServer((host, port), Handler) as server:
        server.serve_forever()
