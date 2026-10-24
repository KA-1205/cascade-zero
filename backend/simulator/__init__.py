"""Seeded F1 sandbox model.

Policies receive only ``ObservableState`` from ``observe``: lagged, aggregate
telemetry, public topology, inferred incident flags, and action history. The
capacity schedule, per-request state, RNG and actual service rates remain
private to the run. This is a discrete-tick approximation, not a production
service or a measured benchmark. No action reaches an external system.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import random
from time import perf_counter
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import MappingProxyType
from typing import Any

from backend.actions import ACTION_AGENTS


DEFAULT_CONFIG: dict[str, Any] = {
    "config_version": "f1-v2",
    "ticks": 110,
    "topology": {"gateway": 120, "orders": 80, "payments": 80, "database": 100},
    "db_connection_limit": 55,
    "db_duration": 1,
    "fault": {"service_name": "database", "start": 10, "end": 35,
              "degraded_capacity": 34,
              "degraded_duration": 3, "recovery_capacity": 72,
              "recovery_end": 48, "recovery_duration": 2},
    "traffic": {"arrival": 55, "noise": 5, "queue_limit": 180,
                "timeout": 6, "transaction_ttl": 18, "max_attempts": 3,
                "retry_delay": 1, "base_retry_probability": 0.45,
                "increased_retry_probability": 0.95},
    "actions": {"retry_error_trigger": 0.05, "scale_queue_trigger": 25,
                "restart_error_trigger": 0.18, "restart_target": "orders",
                "disabled_actions": [],
                "replica_startup": 4,
                "replica_capacity": 28, "replica_db_slots": 8,
                "restart_downtime": 2, "restart_warmup": 3,
                "restart_warmup_fraction": 0.45,
                "restart_spike_ticks": 3, "restart_spike_fraction": 1.4,
                "guardrail_cooldown": 12, "guardrail_max_replicas": 2,
                "guardrail_max_retries": 1},
    "healthy": {"error_rate": 0.05, "queue_depth": 12,
                "latency": 5, "consecutive_ticks": 30},
    "telemetry": {"delay_ticks": 0, "dropout_rate": 0.0,
                   "noise": {"error_rate": 0.0, "latency": 0.0,
                             "queue_depth": 0, "db_load": 0.0,
                             "service_queue": 0}},
}


def load_config(path: str | Path | dict | None = None) -> dict[str, Any]:
    """Overlay a JSON object on a fresh versioned default config."""
    config = copy.deepcopy(DEFAULT_CONFIG)
    if path is not None:
        override = path if isinstance(path, dict) else json.loads(Path(path).read_text(encoding="utf-8"))
        def merge(target: dict, source: dict) -> None:
            for key, value in source.items():
                if key not in target:
                    raise ValueError(f"unknown config key: {key}")
                if isinstance(target[key], dict):
                    if not isinstance(value, dict):
                        raise ValueError(f"expected object for {key}")
                    merge(target[key], value)
                else:
                    target[key] = value
        if not isinstance(override, dict):
            raise ValueError("config must be a JSON object")
        merge(config, override)
    if not config["config_version"] or config["ticks"] < 1:
        raise ValueError("config_version and positive ticks required")
    for section in ("topology", "traffic", "actions", "healthy"):
        if any(isinstance(v, (int, float)) and v < 0 for v in config[section].values()):
            raise ValueError(f"negative parameter in {section}")
    telemetry = config["telemetry"]
    if (type(telemetry["delay_ticks"]) is not int or not 0 <= telemetry["delay_ticks"] <= 20
            or type(telemetry["dropout_rate"]) not in (int, float)
            or not 0 <= telemetry["dropout_rate"] <= 1
            or not math.isfinite(telemetry["dropout_rate"])
            or not isinstance(telemetry["noise"], dict)):
        raise ValueError("invalid telemetry delay, dropout, or noise configuration")
    noise = telemetry["noise"]
    if (set(noise) != {"error_rate", "latency", "queue_depth", "db_load", "service_queue"}
            or any(type(noise[key]) not in (int, float) or noise[key] < 0
                   or noise[key] > (1_000_000 if key in ("latency", "queue_depth", "service_queue") else 1)
                   or not math.isfinite(noise[key])
                   for key in noise)
            or type(noise["queue_depth"]) is not int
            or type(noise["service_queue"]) is not int
            or noise["error_rate"] > 1 or noise["db_load"] > 1):
        raise ValueError("invalid telemetry noise configuration")
    t, f = config["traffic"], config["fault"]
    if f.get("service_name") not in config["topology"]:
        raise ValueError("fault.service_name must name a service in the topology")
    if config["actions"].get("restart_target") not in ("orders", "payments"):
        raise ValueError("actions.restart_target must be orders or payments")
    if not set(config["actions"].get("disabled_actions", [])) <= {
            "increase_retries", "add_replicas", "restart_service"}:
        raise ValueError("actions.disabled_actions must name known actions")
    if (t["max_attempts"] < 1 or t["timeout"] < 1 or t["transaction_ttl"] < 1
            or t["queue_limit"] < 1 or config["db_connection_limit"] < 1
            or config["db_duration"] < 1 or f["degraded_duration"] < 1
            or f["recovery_duration"] < 1 or not 0 <= f["start"] <= f["end"] <= f["recovery_end"]):
        raise ValueError("invalid fault, connection, timeout or queue parameters")
    for key in ("base_retry_probability", "increased_retry_probability"):
        if not 0 <= t[key] <= 1:
            raise ValueError(f"{key} must be in [0, 1]")
    return config


# Named scenario overlays: partial config objects accepted by load_config.
SCENARIOS: dict[str, dict[str, Any]] = {
    # Primary F1 fault: the shared database degrades; both routes suffer.
    "db_slowdown": {},
    # The payments service itself degrades; its queue grows while orders stays
    # calm. Restart targets payments here and surfaces early (TTL failures are
    # the only error signal). Extra orders replicas cannot help a payments
    # fault, so that action is off the menu.
    "payments_degradation": {
        "fault": {"service_name": "payments", "degraded_capacity": 24,
                  "degraded_duration": 2, "recovery_capacity": 60},
        "actions": {"restart_target": "payments", "restart_error_trigger": 0.05,
                    "disabled_actions": ["add_replicas"]},
    },
    # Sustained arrival surge: every upstream queue grows before errors appear.
    # The database fault window is kept as a no-op so phase markers still fire.
    # Restarting a service under pure overload only adds downtime, so restart
    # is off the menu; scaling out and retry policy are the live choices.
    "traffic_surge": {
        "traffic": {"arrival": 95, "noise": 8},
        "fault": {"degraded_capacity": 100, "degraded_duration": 1,
                  "recovery_capacity": 100, "recovery_duration": 1},
        "actions": {"disabled_actions": ["restart_service"]},
    },
    "telemetry_faults": {
        "telemetry": {"delay_ticks": 2, "dropout_rate": 0.08,
                       "noise": {"error_rate": 0.03, "latency": 2,
                                 "queue_depth": 8, "db_load": 0.1,
                                 "service_queue": 6}},
    },
}


def scenario_overlay(name: str) -> dict[str, Any]:
    """Return the config overlay for a named scenario; unknown names raise."""
    if name not in SCENARIOS:
        raise ValueError(f"unknown scenario: {name}")
    return copy.deepcopy(SCENARIOS[name])


@dataclass(frozen=True)
class ObservableState:
    tick: int
    error_rate: float
    latency: float
    queue_depth: int
    db_load: float
    topology: Mapping[str, Any]
    incident_flags: tuple[str, ...]
    action_history: tuple[tuple[str, int], ...]
    service_queues: Mapping[str, int] = field(default_factory=dict)


@dataclass
class _Transaction:
    id: str
    created: int
    route: str
    attempts: int = 0
    status: str = "pending"


@dataclass
class _Attempt:
    tx: _Transaction
    number: int
    started: int
    stage: str = "gateway"


@dataclass
class _Run:
    seed: int
    policy: str
    config: dict[str, Any]
    rng: random.Random
    retry_rng: random.Random
    run_id: str
    sensor_rng: random.Random | None = None
    tick: int = 0
    events: list[dict] = field(default_factory=list)
    on_event: Any = None
    transactions: list[_Transaction] = field(default_factory=list)
    queues: dict[str, deque] = field(default_factory=lambda: {
        name: deque() for name in ("gateway", "orders", "payments", "database")})
    active: list[tuple[int, _Attempt]] = field(default_factory=list)
    retries: list[tuple[int, _Transaction]] = field(default_factory=list)
    action_history: list[tuple[str, int]] = field(default_factory=list)
    replicas: list[int] = field(default_factory=list)
    restarts: list[int] = field(default_factory=list)
    retry_increases: int = 0
    dropped: int = 0
    total_attempts: int = 0
    latencies: list[int] = field(default_factory=list)
    max_queue_depth: int = 0
    peak_db_connections: int = 0
    healthy_streak: int = 0
    recovery_time: int = -1
    telemetry: dict = field(default_factory=lambda: {
        "error_rate": 0.0, "latency": 0.0, "queue_depth": 0,
        "db_load": 0.0})
    service_telemetry: dict[str, int] = field(default_factory=lambda: {
        name: 0 for name in ("gateway", "orders", "payments", "database")})
    telemetry_history: list[dict] = field(default_factory=list)
    sensor_sample_tick: int = 0
    telemetry_age_ticks: int = 0
    telemetry_dropped: bool = False
    telemetry_noise_applied: bool = False
    decision_latency_ms: list[float] = field(default_factory=list)


def observe(run: _Run, tick: int) -> ObservableState:
    """Single common policy interface; only previous completed tick's telemetry."""
    if tick != run.tick:
        raise ValueError("observe must use the current tick")
    m = run.telemetry
    flags = [flag for flag, present in (
        ("elevated_errors", m["error_rate"] > 0.05),
        ("high_queue", m["queue_depth"] > 25),
        ("db_busy", m["db_load"] > 0.8)) if present]
    if run.telemetry_age_ticks > 0 or run.telemetry_dropped:
        flags.append("telemetry_stale")
    return ObservableState(tick, m["error_rate"], m["latency"],
                           m["queue_depth"], m["db_load"],
                            MappingProxyType({"edges": (("gateway", "orders"),
                                                        ("gateway", "payments"),
                                                        ("orders", "database"),
                                                        ("payments", "database")),
                                              "services": ("gateway", "orders", "payments", "database")}),
                           tuple(flags),
                           tuple(run.action_history),
                           MappingProxyType(dict(run.service_telemetry)))


def _sense_telemetry(run: _Run, tick: int, truth: dict,
                     service_queues: dict[str, int]) -> dict:
    """Transform generated truth into a seeded, delayed sensor reading."""
    sensor = run.config["telemetry"]
    run.telemetry_history.append({"tick": tick, **truth,
                                  "service_queues": dict(service_queues)})
    sample_index = max(0, len(run.telemetry_history) - 1 - sensor["delay_ticks"])
    sample = run.telemetry_history[sample_index]
    rng = run.sensor_rng or random.Random(run.seed)
    if rng.random() < sensor["dropout_rate"]:
        run.telemetry_dropped = True
        run.telemetry_age_ticks = tick - run.sensor_sample_tick
        run.telemetry_noise_applied = False
        return {"sensor_age_ticks": run.telemetry_age_ticks,
                "sensor_dropped": True, "sensor_noise_applied": False}

    noise = sensor["noise"]
    sensed = {}
    for key in ("error_rate", "latency", "queue_depth", "db_load"):
        amplitude = noise[key]
        if key == "queue_depth":
            value = sample[key] + rng.randint(-amplitude, amplitude) if amplitude else sample[key]
            sensed[key] = max(0, value)
        else:
            value = sample[key] + rng.uniform(-amplitude, amplitude) if amplitude else sample[key]
            sensed[key] = max(0.0, min(1.0, value)) if key in ("error_rate", "db_load") else max(0.0, value)
    service_noise = noise["service_queue"]
    run.service_telemetry = {
        name: max(0, value + rng.randint(-service_noise, service_noise)) if service_noise else value
        for name, value in sample["service_queues"].items()
    }
    run.telemetry = sensed
    run.sensor_sample_tick = sample["tick"]
    run.telemetry_age_ticks = tick - sample["tick"]
    run.telemetry_dropped = False
    run.telemetry_noise_applied = any(value > 0 for value in noise.values())
    return {"sensor_age_ticks": run.telemetry_age_ticks,
            "sensor_dropped": False,
            "sensor_noise_applied": run.telemetry_noise_applied}


def _emit(run: _Run, kind: str, payload: dict) -> None:
    tick = run.tick
    run.events.append({"event_id": f"{run.run_id}:{len(run.events):06d}",
                       "run_id": run.run_id, "tick": tick, "kind": kind,
                       "simulated": True, "trace_id": run.run_id,
                       "timestamp": (datetime(2026, 1, 1, tzinfo=timezone.utc)
                                     + timedelta(seconds=tick)).isoformat(),
                       "payload": {**payload, "measured": False}})
    if run.on_event is not None:
        run.on_event(run.events[-1])


def _proposals(policy: str, state: ObservableState, action_config: dict) -> list[dict]:
    if policy == "none" or "telemetry_stale" in state.incident_flags:
        return []
    a = action_config
    triggers = (("increase_retries", state.error_rate >= a["retry_error_trigger"]),
                ("add_replicas", state.queue_depth >= a["scale_queue_trigger"]),
                ("restart_service", state.error_rate >= a["restart_error_trigger"]))
    proposals = []
    for name, triggered in triggers:
        if not triggered or name in a.get("disabled_actions", []):
            continue
        if policy == "guardrails":
            last = next((tick for action, tick in reversed(state.action_history)
                          if action == name), -10**9)
            if state.tick - last < a["guardrail_cooldown"]:
                continue
            if name == "add_replicas" and sum(1 for action, _ in state.action_history
                                               if action == name) >= a["guardrail_max_replicas"]:
                continue
            if name == "increase_retries" and sum(1 for action, _ in state.action_history
                                                   if action == name) >= a["guardrail_max_retries"]:
                continue
        proposals.append({"agent_id": ACTION_AGENTS[name],
                          "action": name,
                          "target": {"increase_retries": "database",
                                     "add_replicas": "orders",
                                     "restart_service": a["restart_target"]}[name],
                          "expected_effect": {"increase_retries": "more attempts sharing DB slots",
                                              "add_replicas": "more orders workers sharing DB slots after startup",
                                              "restart_service": f"{a['restart_target']} downtime, warm-up and catch-up spike"}[name],
                          "cost": "shared DB connections", "confidence": 0.5,
                          "ttl": 1})
    return proposals


def _apply(run: _Run, proposal: dict) -> None:
    name = proposal["action"]
    if name == "increase_retries":
        run.retry_increases += 1
    elif name == "add_replicas":
        run.replicas.append(run.tick + run.config["actions"]["replica_startup"])
    else:
        run.restarts.append(run.tick)
    run.action_history.append((name, run.tick))
    _emit(run, "execution", {**proposal, "sandbox_only": True})


def _fail(run: _Run, tx: _Transaction) -> None:
    if tx.status == "pending":
        tx.status = "failed"
        run.latencies.append(run.tick - tx.created + 1)


def _enqueue(run: _Run, attempt: _Attempt, stage: str) -> None:
    attempt.stage = stage
    queue = run.queues[stage]
    if len(queue) >= run.config["traffic"]["queue_limit"]:
        run.dropped += 1
        _retry_or_fail(run, attempt)
    else:
        queue.append(attempt)


def _start(run: _Run, tx: _Transaction) -> None:
    if tx.status != "pending":
        return
    tx.attempts += 1
    run.total_attempts += 1
    _enqueue(run, _Attempt(tx, tx.attempts, run.tick), "gateway")


def _retry_or_fail(run: _Run, attempt: _Attempt) -> None:
    tx = attempt.tx
    if tx.status != "pending":
        return
    t = run.config["traffic"]
    probability = (t["increased_retry_probability"] if run.retry_increases
                   else t["base_retry_probability"])
    if (tx.attempts < t["max_attempts"]
            and run.tick + t["retry_delay"] - tx.created < t["transaction_ttl"]
            and run.retry_rng.random() < probability):
        run.retries.append((run.tick + t["retry_delay"], tx))
    else:
        _fail(run, tx)


def _capacity(run: _Run) -> tuple[int, int]:
    c = run.config
    f = c["fault"]
    if f["service_name"] != "database":
        return c["topology"]["database"], c["db_duration"]
    if f["start"] <= run.tick <= f["end"]:
        return f["degraded_capacity"], f["degraded_duration"]
    if run.tick <= f["recovery_end"] and run.tick > f["end"]:
        return f["recovery_capacity"], f["recovery_duration"]
    return c["topology"]["database"], c["db_duration"]


def _service_capacity(run: _Run, name: str) -> int:
    c = run.config
    a = c["actions"]
    f = c["fault"]
    base = c["topology"][name]
    if name != "orders":
        # A restart of the faulted service supersedes the degradation schedule:
        # it restores healthy capacity through its own downtime/warmup/spike
        # window rather than a fraction of degraded capacity.
        if f["service_name"] == name:
            if f["start"] <= run.tick <= f["end"]:
                base = min(base, f["degraded_capacity"])
            elif f["end"] < run.tick <= f["recovery_end"]:
                base = min(base, f["recovery_capacity"])
        if name != a["restart_target"] or not run.restarts:
            return base
        base = c["topology"][name]
    elif not run.restarts or a["restart_target"] != "orders":
        base += sum(a["replica_capacity"] for ready in run.replicas if ready <= run.tick)
        return base
    else:
        base += sum(a["replica_capacity"] for ready in run.replicas if ready <= run.tick)
    if run.restarts:
        elapsed = run.tick - run.restarts[-1]
        if elapsed < a["restart_downtime"]:
            return 0
        if elapsed < a["restart_downtime"] + a["restart_warmup"]:
            return int(base * a["restart_warmup_fraction"])
        if elapsed < (a["restart_downtime"] + a["restart_warmup"]
                      + a["restart_spike_ticks"]):
            return int(base * a["restart_spike_fraction"])
    return base


def _percentile(values: list[int], fraction: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, int(len(ordered) * fraction + 0.999999) - 1)]


def simulate(seed: int, policy: str = "none", config: dict | None = None, plan=None,
             apply_actions: bool = True, on_event=None) -> dict:
    """Return immutable-by-convention result with trace, hash and unique-user metrics."""
    if seed < 0:
        raise ValueError("seed must be non-negative")
    if policy in ("coordinated", "ai_coordinated") and plan is None:
        raise NotImplementedError(
            f"policy {policy} requires a plan callable")
    if policy not in ("none", "independent", "guardrails", "coordinated",
                      "ai_coordinated"):
        raise ValueError(f"unknown policy: {policy}")
    cfg = load_config(config)
    # Seed strings, not tuples: random.Random does not accept tuple seeds.
    def stream(name: str) -> random.Random:
        digest = hashlib.sha256(f"{seed}:{name}".encode()).digest()
        return random.Random(int.from_bytes(digest))
    run = _Run(seed, policy, cfg, stream("traffic"), stream("retry"),
               hashlib.sha256(json.dumps([seed, policy, cfg], sort_keys=True).encode()).hexdigest()[:16],
               sensor_rng=stream("telemetry"), on_event=on_event)
    fault = cfg["fault"]
    for tick in range(cfg["ticks"]):
        run.tick = tick
        state = observe(run, tick)
        decision_started = perf_counter()
        if policy in ("coordinated", "ai_coordinated"):
            proposals = _proposals("independent", state, cfg["actions"])
            decision = plan(state, proposals)
            selected = decision.selected_actions
            if (not isinstance(selected, list) or len(selected) != len(set(selected))
                    or not set(selected) <= {p["action"] for p in proposals}):
                raise ValueError("plan selected actions outside the proposed set")
            extra = getattr(decision, "extra", None) or {}
            _emit(run, "decision", {"actions": selected, "predicted_risk": decision.predicted_risk,
                                    "reasons": decision.reasons, "simulated": True, **extra})
            if apply_actions:
                for proposal in proposals:
                    if proposal["action"] in selected:
                        _apply(run, proposal)
        else:
            proposals = _proposals(policy, state, cfg["actions"])
            if apply_actions:
                for proposal in proposals:
                    _apply(run, proposal)
        run.decision_latency_ms.append((perf_counter() - decision_started) * 1000)
        if tick in (fault["start"], fault["end"] + 1, fault["recovery_end"] + 1):
            _emit(run, "incident", {"phase": ("degraded" if tick == fault["start"] else
                                                "partial" if tick == fault["end"] + 1 else "restored")})
        completed = 0
        failures_before = sum(tx.status == "failed" for tx in run.transactions)
        tick_latencies: list[int] = []
        still_active = []
        for finish, attempt in run.active:
            if finish <= tick:
                if attempt.tx.status == "pending":
                    attempt.tx.status = "succeeded"
                    latency = tick - attempt.tx.created + 1
                    run.latencies.append(latency)
                    tick_latencies.append(latency)
                    completed += 1
            else:
                still_active.append((finish, attempt))
        run.active = still_active
        t = cfg["traffic"]
        for tx in run.transactions:
            if tx.status == "pending" and tick - tx.created >= t["transaction_ttl"]:
                _fail(run, tx)
        for name, queue in run.queues.items():
            kept = deque()
            while queue:
                attempt = queue.popleft()
                if attempt.tx.status != "pending":
                    continue
                if tick - attempt.started >= t["timeout"]:
                    _retry_or_fail(run, attempt)
                else:
                    kept.append(attempt)
            run.queues[name] = kept
        due, run.retries = ([item for item in run.retries if item[0] <= tick],
                            [item for item in run.retries if item[0] > tick])
        for _, tx in due:
            _start(run, tx)
        arrivals = max(0, t["arrival"] + run.rng.randint(-t["noise"], t["noise"]))
        for _ in range(arrivals):
            tx = _Transaction(f"tx-{len(run.transactions):08d}", tick,
                              run.rng.choice(("orders", "payments")))
            run.transactions.append(tx)
            _start(run, tx)
        for stage in ("gateway", "orders", "payments"):
            queue = run.queues[stage]
            for _ in range(min(len(queue), _service_capacity(run, stage))):
                attempt = queue.popleft()
                _enqueue(run, attempt, attempt.tx.route if stage == "gateway" else "database")
        db_cap, duration = _capacity(run)
        # Service workers compete for the same connection pool. Added replicas
        # increase orders' share; they do NOT create DB connections.
        available = max(0, cfg["db_connection_limit"] - len(run.active))
        slots = min(available, db_cap)
        queue = run.queues["database"]
        ready_replicas = sum(ready <= tick for ready in run.replicas)
        order_slots = cfg["db_connection_limit"] // 2 + ready_replicas * cfg["actions"]["replica_db_slots"]
        order_slots = min(cfg["db_connection_limit"], order_slots)
        orders_used = 0
        deferred = deque()
        while queue and slots:
            attempt = queue.popleft()
            if attempt.tx.route == "orders" and orders_used >= order_slots:
                deferred.append(attempt)
                continue
            run.active.append((tick + duration, attempt))
            slots -= 1
            orders_used += attempt.tx.route == "orders"
        deferred.extend(queue)
        run.queues["database"] = deferred
        connections = len(run.active)
        run.peak_db_connections = max(run.peak_db_connections, connections)
        depth = sum(len(queue) for queue in run.queues.values())
        run.max_queue_depth = max(run.max_queue_depth, depth)
        failed_tick = sum(tx.status == "failed" for tx in run.transactions) - failures_before
        # Aggregate outcome telemetry; outstanding work is visible via queue/load.
        error_rate = failed_tick / max(1, failed_tick + completed)
        latency = _percentile(tick_latencies, 0.5) or 0
        true_telemetry = {"error_rate": error_rate, "latency": latency,
                          "queue_depth": depth,
                          "db_load": connections / cfg["db_connection_limit"]}
        true_queues = {name: len(queue) for name, queue in run.queues.items()}
        sensor_quality = _sense_telemetry(run, tick, true_telemetry, true_queues)
        h = cfg["healthy"]
        healthy = (tick > fault["start"] and error_rate <= h["error_rate"]
                   and depth <= h["queue_depth"] and latency <= h["latency"])
        run.healthy_streak = run.healthy_streak + 1 if healthy else 0
        if run.recovery_time == -1 and run.healthy_streak >= h["consecutive_ticks"]:
            run.recovery_time = tick - h["consecutive_ticks"] + 1 - fault["start"]
        _emit(run, "metric", {**run.telemetry, **sensor_quality, "arrivals": arrivals,
                              "unique_completed": completed, "unique_failed": failed_tick,
                              "attempts_total": run.total_attempts, "dropped": run.dropped,
                              "service_queues": dict(run.service_telemetry)})
    run.tick = cfg["ticks"]
    for tx in run.transactions:
        _fail(run, tx)  # End-of-horizon pending users count as failures once.
    succeeded = sum(tx.status == "succeeded" for tx in run.transactions)
    offered = len(run.transactions)
    metrics = {"unique_offered": offered, "unique_succeeded": succeeded,
               "unique_failed": offered - succeeded, "total_attempts": run.total_attempts,
               "dropped": run.dropped, "latency_p50": _percentile(run.latencies, 0.5),
               "latency_p95": _percentile(run.latencies, 0.95),
               "max_queue_depth": run.max_queue_depth,
               "peak_db_connections": run.peak_db_connections,
               "sustained_recovery_time": run.recovery_time,
               "actions_executed": len(run.action_history)}
    canonical = json.dumps(run.events, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    latency_values = sorted(run.decision_latency_ms)
    runtime = {"decision_latency_p50_ms": round(latency_values[max(0, math.ceil(len(latency_values) * 0.50) - 1)], 3),
               "decision_latency_p95_ms": round(latency_values[max(0, math.ceil(len(latency_values) * 0.95) - 1)], 3),
               "decision_latency_samples": len(latency_values),
               "source": "local_process_wall_clock"}
    return {"seed": seed, "policy": policy, "config_version": cfg["config_version"],
            "config": cfg, "trace_hash": hashlib.sha256(canonical.encode()).hexdigest(),
            "metrics": metrics, "events": run.events, "simulated": True, "measured": False,
            "runtime": runtime}
