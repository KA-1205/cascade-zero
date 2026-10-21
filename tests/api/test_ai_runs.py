"""AI-coordinated runs through the loopback API (offline fallback path)."""

import json
import threading
import time
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

import backend.api as api_module
from backend.api import Handler


@pytest.fixture()
def api(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("CASCADE_APPROVAL_TOKEN", "test-token")
    api_module._runs.clear()
    api_module._plans.clear()
    api_module._approval_keys.clear()

    class QuietHandler(Handler):
        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    thread.join()
    server.server_close()


def call(api, path, method="GET", body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = Request(api + path, data=data, method=method,
                  headers={"Content-Type": "application/json", **(headers or {})})
    with urlopen(req, timeout=30) as response:
        raw = response.read()
    return json.loads(raw) if raw else None


def sse_events(api, run_id):
    with urlopen(f"{api}/v1/runs/{run_id}/events", timeout=30) as response:
        body = response.read().decode()
    events = []
    for block in body.split("\n\n"):
        line = next((l for l in block.split("\n") if l.startswith("data: ")), None)
        if line:
            events.append(json.loads(line[6:]))
    return events


def wait_for_run(api, run_id, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = call(api, f"/v1/runs/{run_id}")
        if run["state"] in ("completed", "failed"):
            return run
        time.sleep(0.2)
    raise AssertionError("ai run did not finish in time")


def test_ai_run_streams_then_completes_with_fallback_decisions(api):
    created = call(api, "/v1/runs", "POST",
                   {"seed": 7, "scenario": "db_slowdown", "policy": "ai_coordinated"})
    assert created["state"] == "running"
    run = wait_for_run(api, created["id"])
    assert run["state"] == "completed"
    assert run["metrics"]["unique_offered"] > 0
    events = sse_events(api, created["id"])
    decisions = [e for e in events if e["kind"] == "decision" and e["payload"]["actions"]]
    assert decisions
    assert all(e["payload"]["ai"]["live"] is False
               and e["payload"]["ai"]["fallback_reason"] == "no_client_configured"
               for e in decisions)


def test_scenario_is_validated_and_applied(api):
    with pytest.raises(HTTPError) as caught:
        call(api, "/v1/runs", "POST",
             {"seed": 1, "scenario": "cosmic_rays", "policy": "none"})
    assert caught.value.code == 400
    created = call(api, "/v1/runs", "POST",
                   {"seed": 3, "scenario": "payments_degradation", "policy": "ai_coordinated"})
    run = wait_for_run(api, created["id"])
    assert run["scenario"] == "payments_degradation"
    plans = call(api, f"/v1/runs/{created['id']}/plans")
    assert all("ai" in plan for plan in plans)


def test_ai_plan_approval_verifies_against_the_recorded_trace(api):
    created = call(api, "/v1/runs", "POST",
                   {"seed": 11, "scenario": "db_slowdown", "policy": "ai_coordinated"})
    wait_for_run(api, created["id"])
    plans = call(api, f"/v1/runs/{created['id']}/plans")
    candidate = next(plan for plan in plans if plan["actions"])
    call(api, f"/v1/plans/{candidate['id']}/approval", "POST",
         {"approved": True, "reason": "operator signed off"},
         headers={"Authorization": "Bearer test-token",
                  "Idempotency-Key": "ai-approval-1"})
    updated = call(api, f"/v1/runs/{created['id']}/plans")
    assert next(p for p in updated if p["id"] == candidate["id"])["status"] == "approved"


def test_admin_status_aggregates_the_project(api):
    created = call(api, "/v1/runs", "POST",
                   {"seed": 41, "scenario": "db_slowdown", "policy": "ai_coordinated"})
    wait_for_run(api, created["id"])
    status = call(api, "/v1/admin/status")
    assert status["backend"]["state"] == "ok"
    assert status["runs"]["total"] >= 1
    assert "ai_coordinated" in status["runs"]["by_policy"]
    assert status["transactions"]["offered"] > 0
    assert status["ai_engine"]["model"]
    assert status["ai_engine"]["provider_configured"] is False  # fixture deletes the key
    assert status["ai_engine"]["fallback_decisions"] >= 1
    assert set(status["scenarios"]["payments_degradation"]["actions_available"]) == {
        "increase_retries", "restart_service"}


def test_run_history_lists_every_run_newest_first(api):
    first = call(api, "/v1/runs", "POST",
                 {"seed": 21, "scenario": "db_slowdown", "policy": "none"})
    second = call(api, "/v1/runs", "POST",
                  {"seed": 22, "scenario": "traffic_surge", "policy": "guardrails"})
    history = call(api, "/v1/runs")
    ids = [run["id"] for run in history]
    assert ids[:2] == [second["id"], first["id"]]
    newest = history[0]
    assert newest["scenario"] == "traffic_surge"
    assert newest["created_at"] and newest["event_count"] > 0
    assert "trace_hash" not in newest


def test_plan_backtest_returns_local_verdict(api):
    created = call(api, "/v1/runs", "POST",
                   {"seed": 31, "scenario": "payments_degradation",
                    "policy": "ai_coordinated"})
    wait_for_run(api, created["id"])
    plans = call(api, f"/v1/runs/{created['id']}/plans")
    candidate = next(plan for plan in plans if plan["actions"])
    result = call(api, f"/v1/plans/{candidate['id']}/backtest", "POST", None,
                  headers={"Authorization": "Bearer test-token"})
    assert result["verdict"] in ("better", "worse", "equal")
    assert len(result["arms"]) >= 2
    labels = [tuple(arm["actions"]) for arm in result["arms"]]
    assert () in labels and tuple(sorted(candidate["actions"])) in labels
    assert result["delta_failed"] == result["plan_failed"] - result["baseline_failed"]
    # idempotent: a repeated backtest returns the stored verdict
    again = call(api, f"/v1/plans/{candidate['id']}/backtest", "POST", None,
                 headers={"Authorization": "Bearer test-token"})
    assert again == result
    # the operator can still approve afterwards
    call(api, f"/v1/plans/{candidate['id']}/approval", "POST",
         {"approved": True}, headers={"Authorization": "Bearer test-token",
                                      "Idempotency-Key": "after-backtest"})
    updated = call(api, f"/v1/runs/{created['id']}/plans")
    assert next(p for p in updated if p["id"] == candidate["id"])["status"] == "approved"
