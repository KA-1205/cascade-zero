"""The single registry mapping recovery agents to their allowlisted actions.

Imported by the simulator (which owns action semantics), the proposal agents
and the coordinator, so the three can never drift apart again.
"""

from __future__ import annotations

AGENT_ACTIONS: dict[str, str] = {
    "retry-agent": "increase_retries",
    "scale-agent": "add_replicas",
    "restart-agent": "restart_service",
}

ACTION_AGENTS: dict[str, str] = {action: agent for agent, action in AGENT_ACTIONS.items()}

__all__ = ["AGENT_ACTIONS", "ACTION_AGENTS"]
