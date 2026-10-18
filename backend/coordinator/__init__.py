"""Pure, deterministic subset planner for sandbox-only recovery proposals.

Risk scores are heuristic predictions, not measured outcomes or guarantees.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import combinations

from backend.agents import default_agents
from backend.risk import evaluate
from backend.simulator import ObservableState


_AGENT_ACTIONS = {
    "retry-agent": "increase_retries",
    "scale-agent": "add_replicas",
    "restart-agent": "restart_service",
}


@dataclass(frozen=True)
class PlanResult:
    selected_actions: list[str]
    predicted_risk: float
    reasons: list[str]
    simulated: bool = True
    measured: bool = False


class Coordinator:
    def __init__(self, threshold: float = 0.5, allowed_actions: tuple[str, ...] | None = None):
        if not isinstance(threshold, (int, float)) or not math.isfinite(threshold) or not 0 <= threshold <= 1:
            raise ValueError("threshold must be finite and between 0 and 1")
        self.threshold = threshold
        self.allowed_actions = frozenset(allowed_actions if allowed_actions is not None
                                         else _AGENT_ACTIONS.values())
        if not self.allowed_actions <= set(_AGENT_ACTIONS.values()):
            raise ValueError("unknown allowed action")

    def plan(self, state: ObservableState, proposals: list[dict]) -> PlanResult:
        """Evaluate every subset; prefer most actions, then lexicographically first."""
        if len(proposals) > 3:
            raise ValueError("at most three proposals are supported")
        if any(not isinstance(p, dict) or p.get("action") not in self.allowed_actions
               or _AGENT_ACTIONS.get(p.get("agent_id")) != p.get("action") for p in proposals):
            raise ValueError("proposal must be from an allowlisted agent and action")
        by_name = {p["action"]: p for p in proposals}
        if len(by_name) != len(proposals):
            raise ValueError("duplicate actions are not supported")
        names = sorted(by_name)
        assessments = {}
        for count in range(len(names) + 1):
            for subset in combinations(names, count):
                assessments[subset] = evaluate([by_name[name] for name in subset], state)
        safe = [subset for subset, assessment in assessments.items()
                if assessment.predicted_risk <= self.threshold]
        chosen = min(safe, key=lambda subset: (-len(subset), subset))
        assessment = assessments[chosen]
        reasons = []
        if not names:
            reasons.append("No actions proposed; empty plan has no action risk.")
        for name in names:
            if name in chosen:
                term = next(reason for reason in assessment.reasons if reason.startswith(name + ":"))
                reasons.append(f"Selected {name}: {term} plan risk {assessment.predicted_risk:.2f} <= threshold {self.threshold:.2f}.")
            else:
                augmented = tuple(sorted((*chosen, name)))
                candidate = assessments[augmented]
                terms = [reason for reason in candidate.reasons
                         if reason.startswith(name + ":") or
                         (" x " in reason and name in reason.split(":", 1)[0].split(" x "))]
                if candidate.predicted_risk > self.threshold:
                    reasons.append(f"Excluded {name}: adding it gives risk {candidate.predicted_risk:.2f} > threshold {self.threshold:.2f}; " + " ".join(terms))
                else:
                    reasons.append(f"Excluded {name}: lexicographic tie-break favors {chosen}; " + " ".join(terms))
        return PlanResult(list(chosen), assessment.predicted_risk, reasons)


def default_coordinator(threshold: float = 0.5) -> Coordinator:
    """Use the default agents' allowlisted recovery action set."""
    return Coordinator(threshold, tuple(_AGENT_ACTIONS[agent.agent_id] for agent in default_agents()))


__all__ = ["Coordinator", "PlanResult", "default_coordinator"]
