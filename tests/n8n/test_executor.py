from concurrent.futures import ThreadPoolExecutor
from dataclasses import FrozenInstanceError

import pytest

from backend.integrations.n8n import (
    ALLOWED_ACTIONS,
    GatedExecutor,
    IdempotencyLedger,
    executor_from_env,
)


class StubTransport:
    def __init__(self, result=202):
        self.calls = []
        self.result = result

    def __call__(self, url, payload, headers):
        self.calls.append((url, payload, headers))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def executor(stub, **kwargs):
    return GatedExecutor(
        stub, allow_sandbox_actions=True, webhook_url="http://localhost:5678/sandbox", **kwargs
    )


def test_allowlist_is_frozen_and_rejected_before_transport_even_on_replay():
    assert ALLOWED_ACTIONS == frozenset(
        {"increase_retries", "add_replicas", "restart_service"}
    )
    stub = StubTransport()
    gated = executor(stub)
    for actions in (["run_shell"], ["add_replicas", "run_shell"], [], "restart_service"):
        with pytest.raises(ValueError):
            gated.execute("p", "key", actions)
    assert stub.calls == []
    assert gated.ledger.get("p", "key") is None
    gated.execute("p", "key", ["add_replicas"])
    with pytest.raises(ValueError):
        gated.execute("p", "key", ["run_shell"])
    assert len(stub.calls) == 1


def test_idempotent_replay_is_same_outcome_without_second_post():
    stub = StubTransport()
    gated = executor(stub)
    first = gated.execute("p", "key", ["add_replicas", "restart_service"])
    second = gated.execute("p", "key", ["add_replicas", "restart_service"])
    assert first.status == second.status == "sent"
    assert second == first.__class__(**{**first.__dict__, "replayed": True})
    assert first.replayed is False and second.replayed is True
    assert len(stub.calls) == 1
    with pytest.raises(FrozenInstanceError):
        first.status = "dry-run"
    # The key is scoped to its plan.
    gated.execute("other", "key", ["add_replicas"])
    assert len(stub.calls) == 2


@pytest.mark.parametrize("flag,url", [(False, "http://localhost/hook"), (1, "http://localhost/hook"), (True, None)])
def test_default_deny_does_not_touch_transport(flag, url):
    stub = StubTransport()
    gated = GatedExecutor(stub, allow_sandbox_actions=flag, webhook_url=url)
    result = gated.execute("p", "key", ["increase_retries"])
    assert (result.status, result.simulated, result.measured) == ("dry-run", True, False)
    assert gated.execute("p", "key", ["increase_retries"]).replayed is True
    assert stub.calls == []


def test_ambiguous_failure_is_unknown_and_never_retried():
    stub = StubTransport(TimeoutError("lost response"))
    gated = executor(stub)
    result = gated.execute("p", "key", ["restart_service"])
    assert (result.status, result.simulated, result.measured) == ("unknown", True, False)
    assert "TimeoutError" in result.error
    assert gated.execute("p", "key", ["restart_service"]).replayed
    assert len(stub.calls) == 1


def test_inflight_claim_is_written_before_transport_call():
    ledger = IdempotencyLedger()
    observed = []

    def inspect(url, payload, headers):
        observed.append(ledger.get(payload["plan_id"], headers["Idempotency-Key"]))
        return 204

    result = executor(inspect, ledger=ledger).execute("p", "key", ["add_replicas"])
    assert observed[0].status == "unknown"
    assert observed[0].simulated and not observed[0].measured
    assert result.status == "sent" and result.measured and not result.simulated


def test_concurrent_replay_cannot_issue_two_posts():
    stub = StubTransport()
    gated = executor(stub)
    with ThreadPoolExecutor(max_workers=8) as pool:
        records = list(pool.map(lambda _: gated.execute("p", "key", ["add_replicas"]), range(8)))
    assert len(stub.calls) == 1
    assert all(record.status in ("unknown", "sent") for record in records)


def test_only_successful_2xx_sets_measured():
    stub = StubTransport(503)
    gated = executor(stub)
    failed = gated.execute("p", "bad", ["increase_retries"])
    assert (failed.status, failed.simulated, failed.measured) == ("unknown", True, False)
    stub.result = 200
    success = gated.execute("p", "good", ["increase_retries"])
    assert (success.status, success.simulated, success.measured) == ("sent", False, True)


@pytest.mark.parametrize("flag,allowed", [(None, False), ("TRUE", False), ("false", False), ("true", True)])
def test_factory_reads_only_explicit_opt_in(monkeypatch, flag, allowed):
    monkeypatch.setenv("N8N_WEBHOOK_URL", "http://localhost:5678/sandbox")
    monkeypatch.setenv("N8N_SHARED_SECRET", "test-secret")
    if flag is None:
        monkeypatch.delenv("ALLOW_SANDBOX_ACTIONS", raising=False)
    else:
        monkeypatch.setenv("ALLOW_SANDBOX_ACTIONS", flag)
    stub = StubTransport()
    gated = executor_from_env(transport=stub)
    result = gated.execute("plan", "key", ["restart_service"])
    assert gated.allow_sandbox_actions is allowed
    assert result.measured is allowed
    if allowed:
        assert stub.calls == [(
            "http://localhost:5678/sandbox",
            {"plan_id": "plan", "actions": ["restart_service"]},
            {"Idempotency-Key": "key", "Content-Type": "application/json", "X-N8N-Shared-Secret": "test-secret"},
        )]
    else:
        assert stub.calls == []


def test_factory_without_url_stays_dry_run(monkeypatch):
    monkeypatch.setenv("ALLOW_SANDBOX_ACTIONS", "true")
    monkeypatch.delenv("N8N_WEBHOOK_URL", raising=False)
    stub = StubTransport()
    result = executor_from_env(transport=stub).execute("p", "k", ["add_replicas"])
    assert result.status == "dry-run" and result.simulated and not result.measured
    assert stub.calls == []
