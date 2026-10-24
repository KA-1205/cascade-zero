"""Regressions from the operator workflow audit."""
import json
import threading
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import pytest
import backend.api as api_module
from backend.api import Handler


@pytest.fixture()
def api(monkeypatch):
    monkeypatch.setenv('CASCADE_APPROVAL_TOKEN', 'test-token')
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    api_module._runs.clear()
    api_module._plans.clear()
    api_module._approval_keys.clear()
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{server.server_port}'
    server.shutdown()
    thread.join()
    server.server_close()


def call(api, path, body=None, authenticated=True):
    headers = {'Content-Type': 'application/json', 'Idempotency-Key': 'regression'}
    if authenticated:
        headers['Authorization'] = 'Bearer test-token'
    req = Request(api + path, data=json.dumps(body).encode() if body is not None else None,
                  headers=headers)
    try:
        response = urlopen(req, timeout=30)
    except HTTPError as exc:
        response = exc
    with response:
        raw = response.read()
        return response.status, json.loads(raw) if raw else None


@pytest.mark.parametrize('scenario', [[], {}, 1, None])
def test_wrong_scenario_types_are_validation_errors(api, scenario):
    assert call(api, '/v1/runs', {'seed': 1, 'scenario': scenario, 'policy': 'none'})[0] == 400


def test_explicitly_protected_api_rejects_unauthenticated_work(api, monkeypatch):
    monkeypatch.setenv('CASCADE_REQUIRE_AUTH', 'true')
    body = {'seed': 137, 'scenario': 'db_slowdown', 'policy': 'coordinated', 'purpose': 'operator_review'}
    assert call(api, '/v1/runs', body, authenticated=False)[0] == 403
    assert call(api, '/v1/runs', body)[0] == 201


def test_approval_has_one_shot_replay_and_audit_receipt(api):
    _, run = call(api, '/v1/runs', {'seed': 137, 'scenario': 'db_slowdown',
                                  'policy': 'coordinated', 'purpose': 'operator_review'})
    _, plans = call(api, f"/v1/runs/{run['id']}/plans")
    plan = next(p for p in plans if p['actions'])
    assert call(api, f"/v1/plans/{plan['id']}/approval", {'approved': True, 'reason': 'reviewed'})[0] == 202
    _, plans = call(api, f"/v1/runs/{run['id']}/plans")
    approved = next(p for p in plans if p['id'] == plan['id'])
    assert approved['execution']['outcome']['actions_executed'] == len(plan['actions'])
    assert approved['operator_reason'] == 'reviewed'
    assert approved['decided_at']
    assert approved['decision_tick'] >= 0
    with urlopen(api + f"/v1/runs/{run['id']}/events") as response:
        events = [json.loads(frame[6:]) for frame in response.read().decode().split('\n\n') if frame]
    receipt = next(e for e in events if e['kind'] == 'verification')
    assert receipt['payload']['plan_id'] == plan['id']
    assert receipt['payload']['approved'] is True


def test_retention_evicts_completed_runs_and_their_plans(api, monkeypatch):
    monkeypatch.setattr(api_module, 'MAX_RUNS', 2)
    ids = []
    for seed in range(3):
        _, run = call(api, '/v1/runs', {'seed': seed, 'scenario': 'db_slowdown', 'policy': 'coordinated'})
        ids.append(run['id'])
    _, runs = call(api, '/v1/runs')
    assert len(runs) == 2
    assert ids[0] not in {r['id'] for r in runs}
    assert all(not key.startswith(ids[0]) for key in api_module._plans)


def test_events_arrive_before_simulation_finishes(api, monkeypatch):
    from backend.coordinator import default_coordinator
    entered, release = threading.Event(), threading.Event()
    def paused(state, proposals):
        if state.tick == 2:
            entered.set()
            assert release.wait(5)
        return default_coordinator().plan(state, proposals)
    monkeypatch.setattr(api_module, '_plan_callable', lambda *args: paused)
    try:
        _, run = call(api, '/v1/runs', {'seed': 137, 'scenario': 'db_slowdown', 'policy': 'ai_coordinated'})
        assert entered.wait(5)
        _, current = call(api, f"/v1/runs/{run['id']}")
        assert current['state'] == 'running'
        with urlopen(api + f"/v1/runs/{run['id']}/events") as response:
            assert response.read(), 'events must be published before the run finishes'
    finally:
        release.set()
