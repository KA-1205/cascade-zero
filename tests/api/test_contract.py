"""Mechanical OpenAPI response and event-schema checks for the loopback API."""

import json
import importlib
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import jsonschema
import pytest
import yaml

from backend.api import Handler


ROOT = Path(__file__).resolve().parents[2]
OPENAPI = yaml.safe_load((ROOT / "contracts/openapi.yaml").read_text())
EVENT_SCHEMA = json.loads((ROOT / "contracts/events.schema.json").read_text())


def validate_response(path, method, status, body, mime="application/json"):
    """Use the response schema in the frozen spec, resolving component refs locally."""
    response = OPENAPI["paths"][path][method]["responses"][str(status)]
    schema = response["content"][mime]["schema"]
    jsonschema.Draft202012Validator({"allOf": [schema],
                                    "components": OPENAPI["components"]}).validate(body)


def validate_empty_response(path, method, status, raw):
    response = OPENAPI["paths"][path][method]["responses"][str(status)]
    assert "content" not in response and raw == b""


@pytest.fixture(scope="module")
def api():
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


def request(api, path, method="GET", body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = Request(api + path, data=data, method=method,
                  headers={"Content-Type": "application/json", **(headers or {})})
    try:
        response = urlopen(req, timeout=30)
    except HTTPError as error:
        response = error
    with response:
        content = response.read()
        return response.status, response.headers, content


def create(api, seed=7, policy="coordinated"):
    status, _, data = request(api, "/v1/runs", "POST", {
        "seed": seed, "scenario": "db_slowdown", "policy": policy})
    assert status == 201
    run = json.loads(data)
    validate_response("/v1/runs", "post", status, run)
    assert run["simulated"] is True and run["measured"] is False
    assert run["state"] == "completed"
    assert len(run["trace_hash"]) == 64
    return run


def test_health_and_topology_contract(api):
    for path in ("/v1/health", "/v1/topology"):
        status, _, raw = request(api, path)
        assert status == 200
        validate_response(path, "get", status, json.loads(raw))
    status, _, raw = request(api, "/v1/topology")
    topology = json.loads(raw)
    assert {node["id"] for node in topology["nodes"]} == {
        "gateway", "orders", "payments", "database"}
    assert len(topology["edges"]) == 4


@pytest.mark.parametrize("policy", ["none", "independent", "guardrails", "coordinated"])
def test_run_and_plans_contract(api, policy):
    run = create(api, policy=policy)
    status, _, raw = request(api, f"/v1/runs/{run['id']}")
    assert status == 200
    fetched = json.loads(raw)
    validate_response("/v1/runs/{run_id}", "get", status, fetched)
    assert fetched == run
    assert all(type(number) in (int, float) for number in run["metrics"].values())
    status, _, raw = request(api, f"/v1/runs/{run['id']}/plans")
    assert status == 200
    plans = json.loads(raw)
    validate_response("/v1/runs/{run_id}/plans", "get", status, plans)
    if policy == "coordinated":
        assert len(plans) == 110
        assert all(p["run_id"] == run["id"] and p["simulated"] is True
                   and p["measured"] is False and p["status"] == "candidate" for p in plans)
    else:
        assert plans == []


def test_sse_contract_and_resume(api):
    run = create(api)
    path = f"/v1/runs/{run['id']}/events"
    status, headers, raw = request(api, path)
    assert status == 200 and headers.get_content_type() == "text/event-stream"
    validate_response("/v1/runs/{run_id}/events", "get", status, raw.decode(), "text/event-stream")
    frames = raw.decode().split("\n\n")
    assert frames.pop() == ""
    events = []
    for frame in frames:
        assert frame.startswith("data: ")
        event = json.loads(frame.removeprefix("data: "))
        jsonschema.Draft202012Validator(EVENT_SCHEMA).validate(event)
        assert event["simulated"] is True and event["payload"]["measured"] is False
        assert event["run_id"] == run["id"]
        events.append(event)
    assert len(events) > 110
    status, _, resumed = request(api, path, headers={"Last-Event-ID": events[1]["event_id"]})
    assert status == 200
    assert resumed.decode().startswith("data: " + json.dumps(events[2]))
    status, _, resumed_numeric = request(api, path, headers={"Last-Event-ID": "1"})
    assert status == 200 and resumed_numeric == resumed


def test_coordinated_decision_plans_and_approval(api, monkeypatch):
    run = create(api, seed=13)
    _, _, raw = request(api, f"/v1/runs/{run['id']}/plans")
    plans = json.loads(raw)
    _, _, raw = request(api, f"/v1/runs/{run['id']}/events")
    decisions = [json.loads(frame[6:])["payload"] for frame in raw.decode().split("\n\n")
                 if frame and json.loads(frame[6:])["kind"] == "decision"]
    assert len(plans) == len(decisions)
    for plan, decision in zip(plans, decisions):
        assert (plan["actions"], plan["predicted_risk"], plan["reasons"]) == (
            decision["actions"], decision["predicted_risk"], decision["reasons"])
    plan = next(p for p in plans if p["actions"])
    path = f"/v1/plans/{plan['id']}/approval"
    monkeypatch.delenv("CASCADE_APPROVAL_TOKEN", raising=False)
    body = {"approved": True, "reason": "sandbox test"}
    headers = {"Authorization": "Bearer local-token", "Idempotency-Key": "first"}
    status, _, raw = request(api, path, "POST", body, headers)
    validate_empty_response("/v1/plans/{plan_id}/approval", "post", status, raw)
    assert status == 403
    monkeypatch.setenv("CASCADE_APPROVAL_TOKEN", "")
    assert request(api, path, "POST", body, headers)[0] == 403
    monkeypatch.setenv("CASCADE_APPROVAL_TOKEN", "local-token")
    assert request(api, path, "POST", body, {"Idempotency-Key": "first"})[0] == 403
    status, _, raw = request(api, path, "POST", body, headers)
    assert status == 202
    validate_empty_response("/v1/plans/{plan_id}/approval", "post", status, raw)
    status, _, raw = request(api, path, "POST", body, headers)
    assert status == 409
    validate_empty_response("/v1/plans/{plan_id}/approval", "post", status, raw)
    assert request(api, path, "POST", body, {**headers, "Idempotency-Key": "second"})[0] == 409
    _, _, raw = request(api, f"/v1/runs/{run['id']}/plans")
    updated = json.loads(raw)
    validate_response("/v1/runs/{run_id}/plans", "get", 200, updated)
    approved = next(p for p in updated if p["id"] == plan["id"])
    assert approved["status"] == "approved"
    assert approved["execution"]["status"] == "dry-run"
    assert approved["execution"]["simulated"] is True
    assert approved["execution"]["measured"] is False
    assert approved["execution"]["replayed"] is True
    assert approved["execution"]["outcome"]["actions"] == plan["actions"]


def test_approval_with_gated_executor_records_execution(api, monkeypatch):
    """Approval records a local counterfactual replay with execution outcome."""
    monkeypatch.setenv("CASCADE_APPROVAL_TOKEN", "local-token")
    run = create(api, seed=17)
    _, _, raw = request(api, f"/v1/runs/{run['id']}/plans")
    plan = next(p for p in json.loads(raw) if p["actions"])
    status, _, _ = request(api, f"/v1/plans/{plan['id']}/approval", "POST",
                           {"approved": True},
                           {"Authorization": "Bearer local-token",
                            "Idempotency-Key": "exec-1"})
    assert status == 202
    _, _, raw = request(api, f"/v1/runs/{run['id']}/plans")
    approved = next(p for p in json.loads(raw) if p["id"] == plan["id"])
    assert approved["status"] == "approved"
    assert approved["execution"]["status"] == "dry-run"
    assert approved["execution"]["simulated"] is True
    assert approved["execution"]["measured"] is False
    assert approved["execution"]["replayed"] is True
    assert "outcome" in approved["execution"]


def test_unknown_resources_and_invalid_requests(api):
    for path in ("/v1/runs/missing", "/v1/runs/missing/events",
                 "/v1/runs/missing/plans"):
        assert request(api, path)[0] == 404
    for body in ({"seed": -1, "scenario": "db_slowdown", "policy": "none"},
                 {"seed": True, "scenario": "db_slowdown", "policy": "none"},
                 {"seed": 0, "scenario": "production", "policy": "none"},
                 {"seed": 0, "scenario": "db_slowdown", "policy": "other"}, {}):
        assert request(api, "/v1/runs", "POST", body)[0] == 400
    first = create(api, seed=21)
    second = create(api, seed=21)
    assert first["trace_hash"] == second["trace_hash"]


def test_simulator_failure_is_persisted(api, monkeypatch):
    module = importlib.import_module("backend.api")

    def fail(*args, **kwargs):
        raise ValueError("sandbox failure")

    monkeypatch.setattr(module, "simulate", fail)
    status, _, raw = request(api, "/v1/runs", "POST", {
        "seed": 1, "scenario": "db_slowdown", "policy": "none"})
    assert status == 201
    run = json.loads(raw)
    validate_response("/v1/runs", "post", status, run)
    assert run["state"] == "failed" and run["simulated"] is True
    status, _, raw = request(api, f"/v1/runs/{run['id']}")
    assert status == 200 and json.loads(raw) == run
    validate_response("/v1/runs/{run_id}", "get", status, json.loads(raw))
