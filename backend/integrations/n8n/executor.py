"""Allowlisted, idempotent, opt-in n8n sandbox adapter."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, replace
from threading import Lock
from typing import Callable, Iterable, Literal
from urllib.request import Request, urlopen

ALLOWED_ACTIONS = frozenset({"increase_retries", "add_replicas", "restart_service"})


@dataclass(frozen=True)
class ExecutionRecord:
    plan_id: str
    idempotency_key: str
    actions: tuple[str, ...]
    status: Literal["dry-run", "sent", "unknown"]
    simulated: bool
    measured: bool
    replayed: bool = False
    error: str | None = None


class IdempotencyLedger:
    """Process-local ledger; claim is atomic across threads sharing this instance."""

    def __init__(self) -> None:
        self._records: dict[tuple[str, str], ExecutionRecord] = {}
        self._lock = Lock()

    def claim(self, record: ExecutionRecord) -> ExecutionRecord | None:
        """Store the conservative in-flight outcome before any network request."""
        key = (record.plan_id, record.idempotency_key)
        with self._lock:
            existing = self._records.get(key)
            if existing is not None:
                return replace(existing, replayed=True)
            self._records[key] = record
            return None

    def finish(self, record: ExecutionRecord) -> None:
        with self._lock:
            self._records[(record.plan_id, record.idempotency_key)] = record

    def get(self, plan_id: str, idempotency_key: str) -> ExecutionRecord | None:
        with self._lock:
            return self._records.get((plan_id, idempotency_key))


# Transport returns an HTTP status code. Injection keeps all tests offline.
Transport = Callable[[str, dict[str, object], dict[str, str]], int]


class GatedExecutor:
    def __init__(
        self,
        transport: Transport,
        *,
        allow_sandbox_actions: bool = False,
        webhook_url: str | None = None,
        shared_secret: str | None = None,
        ledger: IdempotencyLedger | None = None,
    ) -> None:
        self.transport = transport
        self.allow_sandbox_actions = allow_sandbox_actions
        self.webhook_url = webhook_url
        self.shared_secret = shared_secret
        self.ledger = ledger if ledger is not None else IdempotencyLedger()

    def execute(
        self, plan_id: str, idempotency_key: str, actions: Iterable[str]
    ) -> ExecutionRecord:
        # Validation comes first, even for a replay or a disabled executor.
        if isinstance(actions, str):
            raise ValueError("actions must be a sequence of allowlisted action names")
        requested = tuple(actions)
        if not requested or any(action not in ALLOWED_ACTIONS for action in requested):
            raise ValueError("all actions must be in ALLOWED_ACTIONS")
        if not plan_id or not idempotency_key:
            raise ValueError("plan_id and idempotency_key are required")

        enabled = self.allow_sandbox_actions is True and bool(self.webhook_url)
        # 'unknown' is the durable conservative state while a POST is in flight.
        pending = ExecutionRecord(
            plan_id, idempotency_key, requested,
            "unknown" if enabled else "dry-run", True, False,
            error="request in flight; review before retry" if enabled else None,
        )
        replay = self.ledger.claim(pending)
        if replay is not None:
            return replay
        if not enabled:
            return pending

        headers = {"Idempotency-Key": idempotency_key, "Content-Type": "application/json"}
        if self.shared_secret:
            headers["X-N8N-Shared-Secret"] = self.shared_secret
        try:
            code = self.transport(
                self.webhook_url, {"plan_id": plan_id, "actions": list(requested)}, headers
            )
            if not isinstance(code, int) or isinstance(code, bool) or not 200 <= code < 300:
                raise ValueError(f"webhook did not return HTTP 2xx: {code!r}")
        except Exception as exc:
            # The remote side may have received the POST; never automatically retry.
            result = replace(pending, error=f"{type(exc).__name__}: {exc}")
        else:
            result = replace(pending, status="sent", simulated=False, measured=True, error=None)
        self.ledger.finish(result)
        return result


def _urllib_transport(url: str, payload: dict[str, object], headers: dict[str, str]) -> int:
    request = Request(
        url,
        data=json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urlopen(request, timeout=10) as response:
        return response.status


def _disabled_transport(url: str, payload: dict[str, object], headers: dict[str, str]) -> int:
    raise RuntimeError("webhook transport is disabled")


def executor_from_env(
    *, transport: Transport | None = None, ledger: IdempotencyLedger | None = None
) -> GatedExecutor:
    """Read opt-in configuration exclusively from the process environment."""
    enabled = os.environ.get("ALLOW_SANDBOX_ACTIONS") == "true"
    url = os.environ.get("N8N_WEBHOOK_URL") or None
    return GatedExecutor(
        transport if transport is not None else (_urllib_transport if enabled and url else _disabled_transport),
        allow_sandbox_actions=enabled,
        webhook_url=url,
        shared_secret=os.environ.get("N8N_SHARED_SECRET") or None,
        ledger=ledger,
    )
