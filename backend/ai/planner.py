"""The AI recovery planner: diagnose, judge, probe, decide, verify.

One AIPlanner instance drives one simulated run. Every tick the simulator hands
it the observable state and the threshold-woken proposal set; the planner keeps
a telemetry window, evaluates its own past test cases, and — when there is
genuinely something new to decide — asks the model. Everything the model said
and everything that was measured about it afterwards is merged into the
decision event, so the UI and the audit trail show the real AI loop.
"""

from __future__ import annotations

import hashlib
import json
import time
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Callable

from backend.coordinator import Coordinator, default_coordinator
from backend.simulator import ObservableState, simulate


DECISION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["diagnosis", "selected_actions", "risk", "reasons",
                 "need_probes", "test_cases"],
    "properties": {
        "diagnosis": {
            "type": "object", "additionalProperties": False,
            "required": ["cause", "affected", "severity", "confidence",
                         "rationale", "checks"],
            "properties": {
                "cause": {"type": "string", "minLength": 1, "maxLength": 200},
                "affected": {"type": "array", "items": {"type": "string"},
                             "maxItems": 4, "uniqueItems": True},
                "severity": {"enum": ["low", "medium", "high", "critical"]},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "rationale": {"type": "string", "maxLength": 600},
                "checks": {"type": "array", "items": {"type": "string"},
                           "maxItems": 5},
            },
        },
        "selected_actions": {"type": "array", "items": {"type": "string"},
                             "maxItems": 3, "uniqueItems": True},
        "risk": {"type": "number", "minimum": 0, "maximum": 1},
        "reasons": {"type": "array", "items": {"type": "string"},
                    "maxItems": 6},
        "need_probes": {"type": "boolean"},
        "probes": {"type": "array", "maxItems": 4,
                   "items": {"type": "array", "items": {"type": "string"},
                             "maxItems": 3, "uniqueItems": True}},
        "test_cases": {
            "type": "array", "maxItems": 5,
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["description", "metric", "comparator", "threshold",
                             "within_ticks"],
                "properties": {
                    "description": {"type": "string", "maxLength": 200},
                    "metric": {"enum": ["error_rate", "latency", "queue_depth",
                                        "db_load"]},
                    "comparator": {"enum": ["lt", "lte", "gt", "gte"]},
                    "threshold": {"type": "number"},
                    "within_ticks": {"type": "integer", "minimum": 1,
                                     "maximum": 20},
                },
            },
        },
    },
}

_METRICS = ("error_rate", "latency", "queue_depth", "db_load")
_COMPARATORS = {
    "lt": lambda v, t: v < t, "lte": lambda v, t: v <= t,
    "gt": lambda v, t: v > t, "gte": lambda v, t: v >= t,
}
# An action re-proposed this soon after a decline (or a counterfactual replay's
# choice) is not fresh; the numbers are policy, not physics.
DECLINE_COOLDOWN = 12
PROBE_ACTION_COOLDOWN = 8

PROMPT_PREAMBLE = """\
You are the incident-recovery decision model for a simulated microservice
system (gateway -> orders/payments -> shared database). Recovery agents woke
you with candidate actions; deterministic thresholds only detected that
something looks wrong. YOU identify the incident and recommend candidates. A deterministic
joint-risk gate has the final veto; its threshold is not yours to override. You may only select actions from the proposed list (or none). Shared
database connections couple every action: retries, replicas and restarts all
compete for the same pool, and restarts cost downtime, warm-up and a catch-up
spike.
Respond with ONLY one JSON object - no markdown, no code fences, no
commentary. Keep diagnosis.rationale under 40 words, at most 3 reasons of
under 25 words each. The object must conform to this schema:
"""


@dataclass
class AIDecision:
    selected_actions: list[str]
    predicted_risk: float
    reasons: list[str]
    extra: dict = field(default_factory=dict)


@dataclass
class _Check:
    description: str
    metric: str
    comparator: str
    threshold: float
    within_ticks: int
    decided_tick: int
    status: str = "pending"
    observed: float | None = None
    evaluated_tick: int | None = None

    def to_dict(self) -> dict:
        return {"description": self.description, "metric": self.metric,
                "comparator": self.comparator, "threshold": self.threshold,
                "within_ticks": self.within_ticks, "status": self.status,
                "observed": self.observed, "decided_tick": self.decided_tick,
                "evaluated_tick": self.evaluated_tick}


def counterfactual(seed: int, overlay: dict, actions: list[str],
                   horizon: int = 70) -> dict:
    """Replay a seed with a fixed action subset chosen at every decision point.

    Deterministic and local: the same seed, overlay and subset always produce
    the same measured outcome. Used both by the planner's probe round and by
    the operator-facing plan backtest.
    """
    subset = set(actions)
    cooldown: dict[str, int] = {}

    def fixed(state: ObservableState, proposals: list[dict]) -> AIDecision:
        chosen = []
        for proposal in proposals:
            name = proposal["action"]
            if name in subset and state.tick - cooldown.get(name, -10**9) >= PROBE_ACTION_COOLDOWN:
                chosen.append(name)
                cooldown[name] = state.tick
        return AIDecision(sorted(set(chosen)), 0.0, [])

    config = deepcopy(overlay)
    config["ticks"] = horizon
    result = simulate(seed, "coordinated", config, plan=fixed)
    return {"actions": sorted(subset),
            "unique_failed": result["metrics"]["unique_failed"],
            "unique_succeeded": result["metrics"]["unique_succeeded"],
            "peak_db_connections": result["metrics"]["peak_db_connections"],
            "max_queue_depth": result["metrics"]["max_queue_depth"],
            "sustained_recovery_time": result["metrics"]["sustained_recovery_time"],
            "actions_executed": result["metrics"]["actions_executed"],
            "horizon_ticks": horizon}


class AIPlanner:
    """Model-driven planner with the deterministic coordinator as fallback."""

    def __init__(self, client: Any | None, seed: int,
                 overlay: dict | None = None,
                 fallback: Coordinator | None = None,
                 min_interval: int = 3, action_cooldown: int = 20,
                 max_probes: int = 4):
        self.client = client
        self.seed = seed
        self.overlay = overlay or {}
        self.fallback = fallback or default_coordinator()
        self.min_interval = min_interval
        self.action_cooldown = action_cooldown
        self.max_probes = max_probes
        self.history: list[dict] = []
        self.executed: dict[str, int] = {}
        self.declined: dict[str, int] = {}
        self.checks: list[_Check] = []
        self.last_model_tick = -10**9
        self.calls = 0
        self.fallbacks = 0
        self.live_decisions = 0
        self.consecutive_failures = 0
        self.circuit_open = False
        self.first_failure_reason = None
        disabled = set(self.overlay.get("actions", {}).get("disabled_actions", []))
        self.enabled_actions = ["increase_retries", "add_replicas",
                                "restart_service"]
        self.enabled_actions = [a for a in self.enabled_actions if a not in disabled]

    # ── telemetry and self-verification ────────────────────────────────────

    def _record(self, state: ObservableState) -> None:
        self.history.append({
            "tick": state.tick,
            "error_rate": round(state.error_rate, 4),
            "latency": state.latency,
            "queue_depth": state.queue_depth,
            "db_load": round(state.db_load, 3),
            "queues": {name: depth for name, depth in state.service_queues.items()},
        })
        del self.history[:-12]

    def _evaluate_checks(self, state: ObservableState) -> list[_Check]:
        finalized = []
        for check in self.checks:
            if check.status != "pending":
                continue
            value = getattr(state, check.metric)
            if _COMPARATORS[check.comparator](value, check.threshold):
                check.status = "pass"
                check.observed = value
                check.evaluated_tick = state.tick
                finalized.append(check)
            elif state.tick - check.decided_tick >= check.within_ticks:
                check.status = "fail"
                check.observed = value
                check.evaluated_tick = state.tick
                finalized.append(check)
        del self.checks[:-10]
        return finalized

    def _fresh(self, proposals: list[dict], tick: int) -> list[dict]:
        fresh = []
        for proposal in proposals:
            action = proposal["action"]
            if (tick - self.executed.get(action, -10**9) >= self.action_cooldown
                    and tick - self.declined.get(action, -10**9) >= DECLINE_COOLDOWN):
                fresh.append(proposal)
        return fresh

    # ── prompt assembly ────────────────────────────────────────────────────

    def _context(self, state: ObservableState, proposals: list[dict]) -> dict:
        return {
            "tick": state.tick,
            "telemetry_window": self.history,
            "incident_flags": list(state.incident_flags),
            "action_history": [{"action": a, "tick": t}
                               for a, t in state.action_history],
            "proposals": proposals,
            "known_actions": self.enabled_actions,
        }

    def _prompt(self, state: ObservableState, proposals: list[dict],
                probe_outcomes: list[dict] | None = None) -> str:
        context = self._context(state, proposals)
        if probe_outcomes is not None:
            context["probe_outcomes"] = probe_outcomes
            context["note"] = ("Counterfactual sandbox replays you requested are "
                               "included; each ran from tick 0 with that subset "
                               "chosen at every decision point. Decide now.")
        return (PROMPT_PREAMBLE + json.dumps(DECISION_SCHEMA, sort_keys=True)
                + "\nInput: " + json.dumps(context, sort_keys=True,
                                           default=str))

    # ── counterfactual probes ──────────────────────────────────────────────

    def _run_probe(self, subset: list[str], horizon: int) -> dict:
        return counterfactual(self.seed, self.overlay, subset, horizon)

    def _run_probes(self, state: ObservableState,
                    requested: list[list[str]]) -> list[dict]:
        offered = set(self.enabled_actions)
        horizon = min(110, max(40, state.tick + 25))
        outcomes, seen = [], set()
        for subset in requested[:self.max_probes]:
            cleaned = sorted({a for a in subset if a in offered})
            key = tuple(cleaned)
            if key in seen:
                continue
            seen.add(key)
            outcomes.append(self._run_probe(cleaned, horizon))
        return outcomes

    # ── the decision loop ──────────────────────────────────────────────────

    def plan(self, state: ObservableState, proposals: list[dict]) -> AIDecision:
        self._record(state)
        finalized = self._evaluate_checks(state)
        fresh = self._fresh(proposals, state.tick)

        base_extra: dict[str, Any] = {"ai": {
            "live": False, "model": None, "fallback_reason": None,
            "calls": self.calls, "live_decisions": self.live_decisions,
            "first_failure_reason": self.first_failure_reason, "circuit_open": self.circuit_open,
            "checks": [c.to_dict() for c in self.checks],
        }}
        if finalized:
            base_extra["ai"]["checks_evaluated"] = [c.to_dict() for c in finalized]
        base_extra.update(self.fallback.plan(state, fresh).extra)
        if not fresh:
            return AIDecision([], 0.0,
                              ["No new recovery action to consider."], base_extra)
        if state.tick - self.last_model_tick < self.min_interval:
            return AIDecision([], 0.0,
                              ["Holding: previous decision still fresh."], base_extra)

        if self.client is None:
            return self._fallback_decision(state, fresh, "no_client_configured",
                                           base_extra)
        if self.circuit_open:
            # Three consecutive live failures means the provider is unusable
            # for this run; stop burning timeouts and stay on rules.
            return self._fallback_decision(state, fresh, "circuit_open",
                                           base_extra)

        prompt = self._prompt(state, fresh)
        started = time.monotonic()
        outcomes: list[dict] = []

        def provider_failure(exc: Exception) -> AIDecision:
            reason = getattr(exc, "reason", None) or exc.__class__.__name__
            self.first_failure_reason = self.first_failure_reason or reason
            base_extra["ai"]["first_failure_reason"] = self.first_failure_reason
            self.consecutive_failures += 1
            if self.consecutive_failures >= 3:
                self.circuit_open = True
                base_extra["ai"]["circuit_open"] = True
            return self._fallback_decision(state, fresh, reason, base_extra)

        try:
            payload, model_id = self.client.generate_json(prompt, DECISION_SCHEMA)
        except Exception as exc:  # noqa: BLE001 - every failure becomes a labeled fallback
            return provider_failure(exc)
        self.consecutive_failures = 0

        if payload.get("need_probes") and payload.get("probes"):
            # Probes are local deterministic replays: a failure here is a bug
            # in this sandbox, not an unavailable provider, so it is labeled
            # distinctly and must not feed the circuit breaker.
            try:
                outcomes = self._run_probes(state, payload["probes"])
            except Exception as exc:  # noqa: BLE001
                return self._fallback_decision(
                    state, fresh, f"sandbox_probe_error:{exc.__class__.__name__}",
                    base_extra)
            if outcomes:
                prompt = self._prompt(state, fresh, outcomes)
                try:
                    payload, model_id = self.client.generate_json(prompt,
                                                                  DECISION_SCHEMA)
                except Exception as exc:  # noqa: BLE001
                    return provider_failure(exc)
                self.consecutive_failures = 0
        latency_ms = int((time.monotonic() - started) * 1000)

        allowed = {p["action"] for p in fresh}
        selected = [a for a in payload["selected_actions"] if a in allowed]
        if len(selected) != len(payload["selected_actions"]):
            return self._fallback_decision(state, fresh, "selection_outside_proposals",
                                           base_extra)

        model_selected = list(selected)
        guarded = self.fallback.plan(state, [p for p in fresh if p["action"] in selected])
        selected = (list(guarded.selected_actions)
                    if payload["risk"] <= self.fallback.threshold
                    and "telemetry_stale" not in state.incident_flags else [])

        self.last_model_tick = state.tick
        self.calls += 1
        self.live_decisions += 1
        for action in selected:
            self.executed[action] = state.tick
        for action in allowed - set(selected):
            self.declined[action] = state.tick
        for case in payload["test_cases"]:
            self.checks.append(_Check(decided_tick=state.tick, **case))

        reasons = list(payload["reasons"]) or [f"AI decision via {model_id}"]
        if selected != model_selected:
            reasons.append("Deterministic safety gate held one or more model recommendations.")
        extra = deepcopy(base_extra)
        extra["ai"].update({
            "live": True, "model": model_id, "fallback_reason": None,
            "latency_ms": latency_ms,
            "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest()[:16],
            "diagnosis": payload["diagnosis"],
            "probes": outcomes,
            "model_selected_actions": model_selected,
            "model_risk": payload["risk"],
            "safety_reasons": guarded.reasons,
            "calls": self.calls,
            "live_decisions": self.live_decisions,
        })
        return AIDecision(selected, guarded.predicted_risk if selected else 0.0, reasons, extra)

    def _fallback_decision(self, state: ObservableState, fresh: list[dict],
                           reason: str, base_extra: dict) -> AIDecision:
        rules = self.fallback.plan(state, fresh)
        for action in rules.selected_actions:
            self.executed[action] = state.tick
        offered = {p["action"] for p in fresh}
        for action in offered - set(rules.selected_actions):
            self.declined[action] = state.tick
        self.last_model_tick = state.tick
        self.fallbacks += 1
        extra = deepcopy(base_extra)
        extra["ai"].update({"live": False, "fallback_reason": reason,
                            "fallbacks": self.fallbacks})
        return AIDecision(list(rules.selected_actions), rules.predicted_risk,
                          list(rules.reasons), extra)


__all__ = ["AIPlanner", "AIDecision", "DECISION_SCHEMA"]
