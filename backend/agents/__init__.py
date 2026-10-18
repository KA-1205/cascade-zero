"""Stateless, sandbox-only independent recovery proposals.

The proposal adapter preserves the simulator's existing independent-policy
payload; provenance belongs to the enclosing simulated event/run.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from backend.simulator import DEFAULT_CONFIG, ObservableState, load_config


_ACTIONS = {
    "retry-agent": "increase_retries",
    "scale-agent": "add_replicas",
    "restart-agent": "restart_service",
}


@dataclass(frozen=True)
class RecoveryAction:
    agent: str
    target: str
    effect: str
    cost: str
    confidence: float
    ttl: int

    def to_proposal_dict(self) -> dict[str, str | float | int]:
        """Translate the documented action shape to the simulator's payload."""
        return {
            "agent_id": self.agent,
            "action": _ACTIONS[self.agent],
            "target": self.target,
            "expected_effect": self.effect,
            "cost": self.cost,
            "confidence": self.confidence,
            "ttl": self.ttl,
        }


@dataclass(frozen=True)
class RetryAgent:
    retry_error_trigger: float = field(
        default_factory=lambda: DEFAULT_CONFIG["actions"]["retry_error_trigger"]
    )
    agent_id: str = "retry-agent"

    def decide(self, state: ObservableState) -> RecoveryAction | None:
        if state.error_rate < self.retry_error_trigger:
            return None
        return RecoveryAction(self.agent_id, "database", "more attempts sharing DB slots",
                              "shared DB connections", 0.5, 1)


@dataclass(frozen=True)
class ScaleAgent:
    scale_queue_trigger: int = field(
        default_factory=lambda: DEFAULT_CONFIG["actions"]["scale_queue_trigger"]
    )
    agent_id: str = "scale-agent"

    def decide(self, state: ObservableState) -> RecoveryAction | None:
        if state.queue_depth < self.scale_queue_trigger:
            return None
        return RecoveryAction(self.agent_id, "orders",
                              "more orders workers sharing DB slots after startup",
                              "shared DB connections", 0.5, 1)


@dataclass(frozen=True)
class RestartAgent:
    restart_error_trigger: float = field(
        default_factory=lambda: DEFAULT_CONFIG["actions"]["restart_error_trigger"]
    )
    agent_id: str = "restart-agent"

    def decide(self, state: ObservableState) -> RecoveryAction | None:
        if state.error_rate < self.restart_error_trigger:
            return None
        return RecoveryAction(self.agent_id, "orders",
                              "orders downtime, warm-up and catch-up spike",
                              "shared DB connections", 0.5, 1)


def default_agents(config: dict[str, Any] | None = None) -> tuple[RetryAgent, ScaleAgent, RestartAgent]:
    """Create independent agents from the simulator's action thresholds."""
    actions = load_config(config)["actions"]
    return (RetryAgent(retry_error_trigger=actions["retry_error_trigger"]),
            ScaleAgent(scale_queue_trigger=actions["scale_queue_trigger"]),
            RestartAgent(restart_error_trigger=actions["restart_error_trigger"]))


__all__ = ["RecoveryAction", "RetryAgent", "ScaleAgent", "RestartAgent", "default_agents"]
