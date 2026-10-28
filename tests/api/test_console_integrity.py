"""Operator-console guarantees across HTTP, concurrency, and persistence."""
import copy
import hashlib
import hmac
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
import backend.api as backend


@pytest.fixture()
def api(monkeypatch, tmp_path):
    monkeypatch.setenv('CASCADE_APPROVAL_TOKEN', 'console-test-token')
    monkeypatch.setenv('CASCADE_RECEIPT_KEY', 'isolated-receipt-key')
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    monkeypatch.setattr(backend, 'DATA_DIR', tmp_path / 'runs')
    for collection in (backend._runs, backend._plans, backend._approval_keys, backend._run_starts):
        collection.clear()
    server = ThreadingHTTPServer(('127.0.0.1', 0), backend.Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    yield f'http://127.0.0.1:{server.server_port}'
    server.shutdown()
    worker.join()
    server.server_close()


def request(api, path, body=None):
    req = Request(api + path, data=None if body is None else json.dumps(body).encode(), headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer console-test-token',
        'Idempotency-Key': 'console-integrity',
    })
    try:
        response = urlopen(req, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        raw = response.read()
        return response.status, json.loads(raw) if raw else None


def create_candidates(api):
    status, run = request(api, '/v1/runs', {
        'seed': 137, 'scenario': 'db_slowdown', 'policy': 'coordinated', 'purpose': 'operator_review',
    })
    assert status == 201 and run['state'] == 'completed'
    _, plans = request(api, f"/v1/runs/{run['id']}/plans")
    candidates = [p for p in plans if p['actions'] and p['status'] == 'candidate']
    assert len(candidates) >= 2
    return run, sorted(candidates, key=lambda p: p["decision_tick"], reverse=True)


def approve(api, plan):
    return request(api, f"/v1/plans/{plan['id']}/approval", {'approved': True, 'reason': 'Reviewed evidence'})


def test_approval_supersedes_alternatives_and_blocks_second_decision(api):
    run, plans = create_candidates(api)
    assert approve(api, plans[0])[0] == 202
    assert approve(api, plans[1])[0] == 409
    _, current = request(api, f"/v1/runs/{run['id']}/plans")
    assert sum(p['status'] == 'approved' for p in current) == 1
    assert all(p['status'] == 'superseded' for p in current if p['id'] != plans[0]['id'])


def test_concurrent_candidates_cannot_both_claim_the_same_run(api, monkeypatch):
    run, plans = create_candidates(api)
    entered, release = threading.Event(), threading.Event()
    replay = backend.replay_candidate

    def paused_replay(*args, **kwargs):
        entered.set()
        assert release.wait(5), 'test failed to release replay'
        return replay(*args, **kwargs)

    monkeypatch.setattr(backend, 'replay_candidate', paused_replay)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(approve, api, plans[0])
        assert entered.wait(5)
        try:
            # This must return immediately while the first plan holds the claim.
            second = pool.submit(approve, api, plans[1])
            assert second.result(timeout=2)[0] == 409
        finally:
            release.set()
        assert first.result(timeout=5)[0] == 202
    _, current = request(api, f"/v1/runs/{run['id']}/plans")
    assert sum(p['status'] == 'approved' for p in current) == 1


def test_receipt_signature_covers_operator_provenance_and_preceding_trace(api):
    run, plans = create_candidates(api)
    assert approve(api, plans[0])[0] == 202
    with urlopen(api + f"/v1/runs/{run['id']}/events") as response:
        events = [json.loads(frame[6:]) for frame in response.read().decode().split('\n\n') if frame]
    receipt = events[-1]
    assert receipt['kind'] == 'verification'
    payload = receipt['payload']
    assert payload['actor'] == 'authenticated-operator'
    assert payload['decided_at'] == receipt['timestamp']
    assert payload['signature_algorithm'] == 'HMAC-SHA256'
    canonical_trace = json.dumps(events[:-1], sort_keys=True, separators=(',', ':')).encode()
    assert payload['trace_sha256'] == hashlib.sha256(canonical_trace).hexdigest()
    unsigned = copy.deepcopy(receipt)
    signature = unsigned['payload'].pop('signature')
    unsigned['payload'].pop('signature_algorithm')

    def sign(value):
        canonical = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
        return hmac.new(b'isolated-receipt-key', canonical, hashlib.sha256).hexdigest()

    assert hmac.compare_digest(signature, sign(unsigned))
    unsigned['payload']['reason'] = 'tampered reason'
    assert not hmac.compare_digest(signature, sign(unsigned))


def test_persisted_candidate_can_be_approved_after_reload(api):
    run, plans = create_candidates(api)
    backend._runs.clear()
    backend._plans.clear()
    backend._seed_demo_runs_if_empty()
    assert approve(api, plans[0])[0] == 202
    backend._runs.clear()
    backend._plans.clear()
    backend._seed_demo_runs_if_empty()
    _, persisted = request(api, f"/v1/runs/{run['id']}/plans")
    assert next(p for p in persisted if p['id'] == plans[0]['id'])['status'] == 'approved'
    assert approve(api, plans[1])[0] == 409


def test_empty_store_does_not_invent_demo_runs(api):
    backend._seed_demo_runs_if_empty()
    assert request(api, '/v1/runs') == (200, [])
    assert list(backend.DATA_DIR.glob('*.json')) == []


def test_historical_decisions_are_simulation_only(api):
    _, plans = create_candidates(api)
    for approved in (True, False):
        assert request(api, f"/v1/plans/{plans[-1]['id']}/approval", {'approved': approved})[0] == 409
    assert request(api, f"/v1/plans/{plans[-1]['id']}/backtest", {})[0] == 200
    assert request(api, f"/v1/plans/{plans[0]['id']}/approval", {'approved': False})[0] == 202


def test_live_recommendations_can_be_decided_and_future_plans_stay_locked(api, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    original = backend.simulate
    def paused(*args, **kwargs):
        publish = kwargs['on_event']
        def event(e):
            publish(e)
            if e['kind'] == 'decision' and e['payload']['actions'] and not entered.is_set():
                entered.set()
                assert release.wait(10)
        kwargs['on_event'] = event
        return original(*args, **kwargs)
    monkeypatch.setattr(backend, 'simulate', paused)
    monkeypatch.setattr(backend, '_plan_callable', lambda *args: backend.default_coordinator().plan)
    try:
        _, run = request(api, '/v1/runs', {'seed':137, 'scenario':'db_slowdown', 'policy':'ai_coordinated', 'purpose':'operator_review'})
        assert entered.wait(5)
        _, plans = request(api, f"/v1/runs/{run['id']}/plans")
        latest = next(p for p in reversed(plans) if p['actions'])
        assert request(api, f"/v1/runs/{run['id']}")[1]['state'] == 'running'
        assert approve(api, latest)[0] == 202
    finally:
        release.set()
    import time
    deadline = time.monotonic() + 5
    while request(api, f"/v1/runs/{run['id']}")[1]['state'] == 'running':
        assert time.monotonic() < deadline
        time.sleep(.01)
    _, final = request(api, f"/v1/runs/{run['id']}/plans")
    assert all(p['status'] == 'superseded' for p in final if p['id'] != latest['id'])
