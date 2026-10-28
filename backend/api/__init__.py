"""Local-only, synchronous HTTP facade for deterministic sandbox simulations.

No recovery operation in this module contacts an external service. Results and
approval receipts live in process memory and disappear when the server stops.
AI-coordinated runs call the configured Gemini model from a background thread;
every decision, probe and fallback is recorded in the event stream.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import re
import threading
import traceback
import time
from collections import deque
from urllib.parse import parse_qs, urlsplit
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import MappingProxyType
from uuid import uuid4

from backend.actions import ACTION_AGENTS
from backend.ai import AIPlanner, GeminiClient
from backend.ai.policy import POLICY_VERSION
from backend.replay import replay_candidate
from backend.coordinator import default_coordinator
from backend.simulator import (DEFAULT_CONFIG, SCENARIOS, ObservableState,
                               scenario_overlay, simulate)


_runs: dict[str, dict] = {}
_plans: dict[str, dict] = {}
_approval_keys: set[tuple[str, str]] = set()
_lock = threading.RLock()
_changed = threading.Condition(_lock)
LIVE_TICK_SECONDS = max(0.05, min(5.0, float(os.environ.get("CASCADE_LIVE_TICK_SECONDS", "1"))))
MAX_RUNS = 100
MAX_ACTIVE_RUNS = 8
MAX_RUNS_PER_MINUTE = 60
_run_starts: deque[float] = deque()
_run_path = re.compile(r"/v1/runs/([^/]+)(?:/(events|plans))?")
_approval_path = re.compile(r"/v1/plans/([^/]+)/approval")
_backtest_path = re.compile(r"/v1/plans/([^/]+)/backtest")
_event_fields = frozenset({"event_id", "run_id", "tick", "kind", "simulated",
                           "payload", "timestamp", "trace_id"})


DATA_DIR = Path(os.environ.get("CASCADE_DATA_DIR", str(Path(__file__).resolve().parent.parent / "data" / "runs")))


def _persist_run_to_disk(run_id: str, stored: dict) -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        filename = DATA_DIR / f"{run_id}.json"
        data = {
            "run": stored["run"],
            "events_count": len(stored["events"]),
            "plans_count": len(stored["plans"]),
            "events": stored["events"],
            "plans": stored["plans"],
        }
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Warning: could not persist run {run_id} to disk: {e}")


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
            and 0 <= body["seed"] <= 2**53 - 1
            and isinstance(body.get("scenario"), str) and body["scenario"] in SCENARIOS
            and body.get("policy") in ("none", "independent", "guardrails",
                                       "coordinated", "ai_coordinated")
            and type(body.get("live", False)) is bool
            and body.get("purpose", "policy_comparison") in
            ("policy_comparison", "operator_review"))


def _evaluation_request(body: object) -> tuple[dict, list[dict]] | None:
    """Validate the external-agent boundary before any scoring is attempted."""
    if not isinstance(body, dict) or set(body) != {"scenario", "state", "proposals"}:
        return None
    if (not isinstance(body["scenario"], str) or body["scenario"] not in SCENARIOS
            or not isinstance(body["state"], dict)):
        return None
    state = body["state"]
    allowed_state = {"tick", "error_rate", "latency", "queue_depth", "db_load",
                     "service_queues", "telemetry_age_ticks", "telemetry_dropped"}
    required_state = {"error_rate", "latency", "queue_depth", "db_load"}
    if not required_state <= set(state) or not set(state) <= allowed_state:
        return None
    if ("tick" in state and (type(state["tick"]) is not int or not 0 <= state["tick"] <= 1_000_000)
            or "telemetry_age_ticks" in state and
            (type(state["telemetry_age_ticks"]) is not int or not 0 <= state["telemetry_age_ticks"] <= 100)
            or "telemetry_dropped" in state and type(state["telemetry_dropped"]) is not bool):
        return None
    for key, upper in (("error_rate", 1), ("db_load", 1), ("latency", 1_000_000)):
        value = state[key]
        if (type(value) not in (int, float) or not 0 <= value <= upper
                or not math.isfinite(value)):
            return None
    if type(state["queue_depth"]) is not int or not 0 <= state["queue_depth"] <= 1_000_000:
        return None
    queues = state.get("service_queues", {})
    if (not isinstance(queues, dict) or set(queues) - set(DEFAULT_CONFIG["topology"])
            or any(type(value) is not int or not 0 <= value <= 1_000_000
                   for value in queues.values())):
        return None

    proposals = body["proposals"]
    proposal_fields = {"agent_id", "action", "target", "expected_effect", "cost", "confidence", "ttl"}
    if not isinstance(proposals, list) or len(proposals) > 3:
        return None
    overlay = scenario_overlay(body["scenario"])
    restart_target = overlay.get("actions", {}).get("restart_target", DEFAULT_CONFIG["actions"]["restart_target"])
    targets = {"increase_retries": {"database"}, "add_replicas": {"orders"},
               "restart_service": {restart_target}}
    seen = set()
    for proposal in proposals:
        if not isinstance(proposal, dict) or set(proposal) != proposal_fields:
            return None
        action = proposal["action"]
        if (not isinstance(action, str) or action not in ACTION_AGENTS
                or not isinstance(proposal["agent_id"], str)
                or proposal["agent_id"] != ACTION_AGENTS[action]
                or not isinstance(proposal["target"], str)
                or proposal["target"] not in targets[action] or action in seen
                or not isinstance(proposal["expected_effect"], str)
                or not 1 <= len(proposal["expected_effect"]) <= 160
                or not isinstance(proposal["cost"], str) or not 1 <= len(proposal["cost"]) <= 120
                or type(proposal["confidence"]) not in (int, float)
                or not 0 <= proposal["confidence"] <= 1
                or not math.isfinite(proposal["confidence"])
                or type(proposal["ttl"]) is not int or not 1 <= proposal["ttl"] <= 120):
            return None
        seen.add(action)
    return state, proposals


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


    with _lock:
        stores = [(dict(stored["run"]), list(stored["events"])) for stored in _runs.values()]
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
        "backend": {"state": "ok", "runs_stored": len(runs),
                    "runs_persisted": sum(1 for _ in DATA_DIR.glob("*.json"))},
        "runs": {
            "total": len(runs),
            "by_state": dict(Counter(run["state"] for run in runs)),
            "by_policy": dict(Counter(run["policy"] for run in runs)),
            "newest_run_id": newest["id"] if newest else None,
        },
        "transactions": totals,
        "ai_engine": {
            "policy_version": POLICY_VERSION,
            "role": "incident_recovery_advisor",
            "model": GeminiClient().model,
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
        def publish(original):
            with _changed:
                index = len(stored['events'])
                event = {key: value for key, value in original.items() if key in _event_fields}
                event.update(event_id=f"{run['id']}:{index:06d}", run_id=run['id'])
                stored['events'].append(event)
                if request['policy'] in ('coordinated', 'ai_coordinated') and event['kind'] == 'decision':
                    decision = event['payload']
                    candidate = {
                        'id': f"{run['id']}:plan:{index:06d}", 'run_id': run['id'],
                        'actions': decision['actions'], 'predicted_risk': decision['predicted_risk'],
                        'reasons': decision['reasons'], 'status': 'candidate',
                        'simulated': True, 'measured': False, 'decision_tick': event['tick'],
                        'purpose': request.get('purpose', 'policy_comparison'),
                    }
                    if 'combinations' in decision:
                        candidate['combinations'] = decision['combinations']
                    if 'ai' in decision:
                        candidate['ai'] = decision['ai']
                    if any(p['status'] in ('approved', 'executed') for p in stored['plans']):
                        candidate['status'] = 'superseded'
                    stored['plans'].append(candidate)
                    _plans[candidate['id']] = (stored, candidate, index)
                _changed.notify_all()
            # Pace only explicitly requested interactive runs, outside the lock.
            # Batch comparisons and backtests retain their deterministic fast path.
            if request.get('live') and event['kind'] == 'metric':
                time.sleep(LIVE_TICK_SECONDS)

        result = simulate(request['seed'], request['policy'], overlay, plan=plan,
                          apply_actions=request.get('purpose') != 'operator_review',
                          on_event=publish)
        with _lock:
            run['metrics'] = {key: value for key, value in result['metrics'].items()
                              if isinstance(value, (int, float)) and not isinstance(value, bool)}
            run['runtime'] = result['runtime']
            run['trace_hash'] = result['trace_hash']
            run["state"] = "completed"

            # Only report diagnoses actually produced by the planner.
            diagnosis = next((event["payload"].get("ai", {}).get("diagnosis")
                              for event in reversed(stored["events"])
                              if event["kind"] == "decision"
                              and event["payload"].get("ai", {}).get("diagnosis")), None)
            if diagnosis:
                run["diagnosis"] = diagnosis
            _persist_run_to_disk(run["id"], stored)
    except Exception:
        # A failed simulation remains inspectable rather than escaping as an
        # HTTP 500 and leaving an indefinitely running record. Detailed errors go
        # to stderr; the run exposes a generic failure to the operator.
        traceback.print_exc()
        with _lock:
            run["state"] = "failed"
            run["failed_reason"] = "Simulation failed; inspect the backend log for details."
    finally:
        with _changed:
            _changed.notify_all()


def _record_operator_decision(stored: dict, plan: dict, approved: bool, reason: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    plan.update(operator_reason=reason, decided_at=now, operator='authenticated-operator')
    run_id = stored['run']['id']
    stored['events'].append({
        'event_id': f"{run_id}:{len(stored['events']):06d}", 'run_id': run_id,
        'tick': plan['decision_tick'], 'kind': 'verification', 'simulated': True,
        'timestamp': now, 'trace_id': run_id,
        'payload': {'plan_id': plan['id'], 'approved': approved, 'reason': reason,
                    'actor': 'authenticated-operator', 'decided_at': now,
                    'execution': plan.get('execution'), 'measured': False},
    })
    receipt = stored['events'][-1]
    # Sign the exact operator receipt and a digest of the preceding trace.
    receipt['payload']['trace_sha256'] = hashlib.sha256(
        json.dumps(stored['events'][:-1], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    key = os.environ.get('CASCADE_RECEIPT_KEY') or os.environ.get('CASCADE_APPROVAL_TOKEN')
    if key:
        canonical = json.dumps(receipt, sort_keys=True, separators=(',', ':')).encode()
        receipt['payload']['signature'] = hmac.new(key.encode(), canonical, hashlib.sha256).hexdigest()
        receipt['payload']['signature_algorithm'] = 'HMAC-SHA256'
    _changed.notify_all()
    _persist_run_to_disk(run_id, stored)


class Handler(BaseHTTPRequestHandler):
    """Request handler; use ``ThreadingHTTPServer(('127.0.0.1', 0), Handler)``."""

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

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

    def _access_required(self) -> bool:
        return (os.environ.get("CASCADE_REQUIRE_AUTH") == "true"
                or self.server.server_address[0] not in ("127.0.0.1", "::1", "localhost"))

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path != "/v1/health" and self._access_required() and not self._authorize():
            return self._send(403, {"error": "forbidden"})
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
        query = parse_qs(urlsplit(self.path).query)
        last = self.headers.get("Last-Event-ID") or query.get("after", [None])[0]
        try:
            # Event ids have the form <run_id>:<zero-based index>. Numeric
            # offsets are also accepted for clients without an event id.
            offset = -1 if last is None else int(last.removeprefix(run_id + ":"))
            if offset < -1:
                raise ValueError
        except ValueError:
            return self._send(400, {"error": "invalid Last-Event-ID"})
        if query.get('stream') == ['1']:
            return self._stream_events(stored, offset)
        data = b"".join(b"data: " + json.dumps(event, allow_nan=False).encode("utf-8") + b"\n\n"
                        for event in events[offset + 1:])
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _stream_events(self, stored: dict, offset: int) -> None:
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()
        deadline = time.monotonic() + 300
        try:
            while time.monotonic() < deadline:
                with _changed:
                    tail = list(stored['events'][offset + 1:])
                    done = stored['run']['state'] not in ('running', 'created')
                    if not tail and not done:
                        _changed.wait(timeout=10)
                        tail = list(stored['events'][offset + 1:])
                        done = stored['run']['state'] not in ('running', 'created')
                if not tail and not done:
                    self.wfile.write(b': heartbeat\n\n')
                for event in tail:
                    frame = f"id: {event['event_id']}\ndata: {json.dumps(event)}\n\n"
                    self.wfile.write(frame.encode())
                    offset += 1
                if done:
                    self.wfile.write(b'event: done\ndata: {}\n\n')
                self.wfile.flush()
                if done:
                    return
        except (BrokenPipeError, ConnectionResetError):
            return

    def do_POST(self) -> None:
        if self._access_required() and not self._authorize():
            return self._send(403, {"error": "forbidden"})
        path = self.path.split("?", 1)[0]
        if path == "/v1/runs":
            return self._create_run()
        if path == "/v1/ai/check":
            if not self._authorize():
                return self._send(403, {"error": "forbidden"})
            client = GeminiClient(timeout=15)
            try:
                _, model = client.generate_json('Return exactly {"ok": true}.', {
                    "type": "object", "properties": {"ok": {"type": "boolean", "enum": [True]}},
                    "required": ["ok"], "additionalProperties": False})
                return self._send(200, {"ok": True, "model": model})
            except Exception as exc:
                reason = getattr(exc, "reason", None) or ("no_client_configured" if not client.api_key else exc.__class__.__name__)
                return self._send(503, {"ok": False, "model": client.model, "reason": reason})
        if path == "/v1/evaluate":
            return self._evaluate_proposals()
        match = _approval_path.fullmatch(path)
        if match:
            return self._approve(match.group(1))
        match = _backtest_path.fullmatch(path)
        if match:
            return self._backtest(match.group(1))
        return self._send(404, {"error": "not found"})

    def _evaluate_proposals(self) -> None:
        """Return an allowlisted action subset without executing any action."""
        if not self._authorize():
            return self._send(403, {"error": "forbidden"})
        try:
            body = self._body()
        except (ValueError, UnicodeDecodeError):
            return self._send(400, {"error": "invalid JSON body"})
        parsed = _evaluation_request(body)
        if parsed is None:
            return self._send(400, {"error": "invalid evaluation request"})
        data, proposals = parsed
        age = data.get("telemetry_age_ticks", 0)
        dropped = data.get("telemetry_dropped", False)
        if age > 0 or dropped:
            return self._send(200, {
                "decision": "hold", "allowed_actions": [],
                "blocked_actions": [{"action": proposal["action"],
                                     "reason": "Telemetry is stale or incomplete; refresh it before evaluating recovery actions."}
                                    for proposal in proposals],
                "predicted_risk": None,
                "reasons": ["No action is eligible while telemetry is stale or incomplete."],
                "simulated": True, "measured": False, "external_execution": False,
            })

        scenario = body["scenario"]
        overlay = scenario_overlay(scenario)
        disabled = set(overlay.get("actions", {}).get("disabled_actions", []))
        eligible = [proposal for proposal in proposals if proposal["action"] not in disabled]
        faulted_actions = [proposal for proposal in proposals if proposal["action"] in disabled]
        tick = data.get("tick", 0)
        error_rate, queue_depth, db_load = data["error_rate"], data["queue_depth"], data["db_load"]
        state = ObservableState(
            tick=tick, error_rate=error_rate, latency=data["latency"],
            queue_depth=queue_depth, db_load=db_load,
            topology=MappingProxyType({"services": tuple(DEFAULT_CONFIG["topology"])}),
            incident_flags=tuple(flag for flag, present in (
                ("elevated_errors", error_rate > 0.05),
                ("high_queue", queue_depth > 25),
                ("db_busy", db_load > 0.8)) if present),
            action_history=(),
            service_queues=MappingProxyType(data.get("service_queues", {})),
        )
        decision = default_coordinator().plan(state, eligible)
        reason_by_action = {}
        for reason in decision.reasons:
            for proposal in eligible:
                if proposal["action"] in decision.selected_actions and reason.startswith("Selected " + proposal["action"] + ":"):
                    reason_by_action[proposal["action"]] = reason
                elif reason.startswith("Excluded " + proposal["action"] + ":"):
                    reason_by_action[proposal["action"]] = reason
        blocked = [{"action": proposal["action"],
                    "reason": "This action is unavailable in the selected scenario."}
                   for proposal in faulted_actions]
        blocked.extend({"action": proposal["action"],
                        "reason": reason_by_action.get(proposal["action"], "Excluded by the coordinator risk policy.")}
                       for proposal in eligible
                       if proposal["action"] not in decision.selected_actions)
        return self._send(200, {
            "decision": "allow" if decision.selected_actions else "hold",
            "allowed_actions": decision.selected_actions,
            "blocked_actions": blocked,
            "predicted_risk": decision.predicted_risk,
            "reasons": decision.reasons,
            "simulated": True, "measured": False, "external_execution": False,
        })

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
               "purpose": request.get("purpose", "policy_comparison"),
               "measured": False,
               "created_at": datetime.now(timezone.utc).isoformat(timespec="microseconds")}
        if request.get("live"):
            run["tick_interval_ms"] = int(LIVE_TICK_SECONDS * 1000)
        overlay = scenario_overlay(request["scenario"])
        stored = {"run": run, "events": [], "plans": [], "overlay": overlay}
        with _lock:
            now = time.monotonic()
            while _run_starts and now - _run_starts[0] > 60:
                _run_starts.popleft()
            active = sum(s['run']['state'] in ('created', 'running') for s in _runs.values())
            if active >= MAX_ACTIVE_RUNS or len(_run_starts) >= MAX_RUNS_PER_MINUTE:
                return self._send(429, {'error': 'Run capacity reached; try again shortly'})
            while len(_runs) >= MAX_RUNS:
                oldest = next((key for key, value in _runs.items()
                               if value['run']['state'] not in ('created', 'running')
                               and not any(p['status'] == 'delayed' for p in value['plans'])), None)
                if oldest is None:
                    return self._send(429, {'error': 'Run storage is busy; try again shortly'})
                removed = _runs.pop(oldest)
                for candidate in removed['plans']:
                    _plans.pop(candidate['id'], None)
                _approval_keys.difference_update({key for key in _approval_keys if key[0].startswith(oldest + ':')})
            _run_starts.append(now)
            run['state'] = 'running'
            _runs[run_id] = stored
        if request["policy"] == "ai_coordinated" or request.get("live"):
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
            (self.headers.get("Authorization") or "").encode("utf-8"), f"Bearer {token}".encode("utf-8"))

    def _approve(self, plan_id: str) -> None:
        if not self._authorize():
            return self._send(403)
        key = self.headers.get("Idempotency-Key")
        if not key or len(key) > 128:
            return self._send(400, {"error": "Idempotency-Key required (maximum 128 characters)"})
        try:
            body = self._body()
        except (ValueError, UnicodeDecodeError):
            return self._send(400, {"error": "invalid JSON body"})
        if not isinstance(body, dict) or type(body.get("approved")) is not bool or (
                "reason" in body and (not isinstance(body["reason"], str) or len(body["reason"]) > 1000)):
            return self._send(400, {"error": "approved must be a boolean"})
        with _lock:
            entry = _plans.get(plan_id)
            if (plan_id, key) in _approval_keys or entry is None:
                return self._send(409)
            stored, plan, index = entry
            latest_tick = max((p["decision_tick"] for p in stored["plans"] if p["actions"]), default=None)
            if not plan["actions"] or plan["decision_tick"] != latest_tick:
                return self._send(409, {"error": "Only the latest recovery recommendation can be approved or rejected; use what-if simulation for older ticks"})
            if any(other["status"] in ("approved", "delayed", "executed")
                   for other in stored["plans"]):
                return self._send(409, {"error": "This run already has a decision in progress or approved"})
            if plan["status"] != "candidate":
                return self._send(409)
            if body["approved"] is False:
                plan["status"] = "rejected"
                _record_operator_decision(stored, plan, False, body.get("reason", ""))
                _approval_keys.add((plan_id, key))
                return self._send(202)
            # Claim the plan so concurrent decisions cannot replay it twice;
            # a verification or replay failure below releases the claim.
            plan["status"] = "delayed"
            seed = stored["run"]["seed"]
            overlay = stored.get("overlay") or None

        def release_claim() -> None:
            with _lock:
                if plan["status"] == "delayed":
                    plan["status"] = "candidate"

        with _lock:
            events = list(stored["events"])
        event = events[index] if 0 <= index < len(events) else None
        payload = (event or {}).get("payload") or {}
        verified = (event is not None and event["kind"] == "decision"
                    and payload.get("actions") == plan["actions"]
                    and payload.get("predicted_risk") == plan["predicted_risk"]
                    and payload.get("reasons") == plan["reasons"])
        if not verified:
            release_claim()
            return self._send(409)

        # All runs in this build are synthetic. Approval records a local replay
        # and never invokes a webhook or touches an external service.
        approval_result = None
        try:
            approval_result = replay_candidate(seed, overlay or {}, plan["actions"], plan["decision_tick"], events)
        except (ValueError, NotImplementedError):
            release_claim()
            return self._send(409, {"error": "sandbox replay could not be completed"})

        with _lock:
            entry = _plans.get(plan_id)
            if entry is None or entry[1] is not plan or plan["status"] != "delayed":
                return self._send(409)
            plan["status"] = "approved"
            plan["execution"] = {"status": "dry-run", "simulated": True,
                                  "measured": False, "replayed": True,
                                  "error": None, "outcome": approval_result}
            for other in stored["plans"]:
                if other is not plan and other["status"] == "candidate":
                    other["status"] = "superseded"
            _record_operator_decision(stored, plan, True, body.get("reason", ""))
            _approval_keys.add((plan_id, key))
        return self._send(202)




    def _backtest(self, plan_id: str) -> None:
        """Replay a candidate plan locally against the recorded seed.

        Nothing live is touched: the same deterministic simulator that produced
        the incident replays it with the plan's actions applied, plus a no-action
        baseline and each action alone, and reports simulated outcomes.
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
            events = list(stored["events"])
            tick = plan["decision_tick"]
        baseline = replay_candidate(seed, overlay, [], tick, events)
        arms = [baseline, replay_candidate(seed, overlay, actions, tick, events)]
        if len(actions) > 1:
            arms.extend(replay_candidate(seed, overlay, [action], tick, events)
                        for action in actions)
        delta = arms[1]["unique_failed"] - baseline["unique_failed"]
        result = {"plan_id": plan_id, "run_id": stored["run"]["id"], "seed": seed,
                  "actions": actions, "arms": arms, "decision_tick": tick, "replay_mode": "single_decision",
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

def _seed_demo_runs_if_empty() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with _lock:
        if _runs:
            return
        # 1. Load any existing runs from backend/data/runs
        for json_path in sorted(DATA_DIR.glob("*.json")):
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                run = data.get("run")
                if run and "id" in run:
                    overlay = scenario_overlay(run.get("scenario", "db_slowdown"))
                    stored = {
                        "run": run,
                        "events": data.get("events", []),
                        "plans": data.get("plans", []),
                        "overlay": overlay,
                    }
                    _runs[run["id"]] = stored
                    for plan in stored["plans"]:
                        index = next((i for i, event in enumerate(stored["events"])
                                      if event["kind"] == "decision" and event["tick"] == plan.get("decision_tick")
                                      and event["payload"].get("actions") == plan["actions"]), -1)
                        _plans[plan["id"]] = (stored, plan, index)
            except Exception as e:
                print(f"Warning: could not load run from {json_path}: {e}")



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
    if host not in ("127.0.0.1", "localhost", "::1") and not os.environ.get("CASCADE_APPROVAL_TOKEN"):
        raise ValueError("Public API requires CASCADE_APPROVAL_TOKEN")
    _seed_demo_runs_if_empty()
    with ThreadingHTTPServer((host, port), Handler) as server:
        server.serve_forever()
