"""Deterministic analytic joint-action risk estimates for sandbox proposals.

These are heuristic predictions, not measured outcomes or simulation probes.
Only error_rate, queue_depth and db_load from ObservableState influence scoring.
``config`` is reserved for the future coordinator interface and is not used.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from itertools import combinations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.agents import RecoveryAction
    from backend.simulator import ObservableState


@dataclass(frozen=True)
class RiskAssessment:
    predicted_risk: float
    reasons: list[str]
    simulated: bool = True
    measured: bool = False


# Scores are integer basis points (10_000 = certainty); pressures are thousandths.
# These are explicit, uncalibrated heuristic weights, not empirical probabilities.
_BASE = {
    "add_replicas": (300, 0, 700, 700),
    "increase_retries": (400, 900, 0, 800),
    "restart_service": (500, 700, 400, 0),
}
# (constant, error, queue, database), in basis points at maximum pressure.
_INTERACTIONS = {
    ("add_replicas", "increase_retries"): (1200, 0, 700, 1200),
    ("add_replicas", "restart_service"): (500, 0, 500, 400),
    ("increase_retries", "restart_service"): (600, 500, 0, 500),
}
_PAIR_EXPLANATIONS = {
    ("add_replicas", "increase_retries"): "shared-DB-slot contention",
    ("add_replicas", "restart_service"): "capacity-loss overlap during restart and replica startup",
    ("increase_retries", "restart_service"): "capacity-loss overlap during restart and retry traffic",
}


def _pressure(value: object, saturation: int) -> int:
    """Clamp a finite observable to [0, 1000] thousandths of saturation."""
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("observable pressure must be numeric and finite") from exc
    if not number.is_finite():
        raise ValueError("observable pressure must be numeric and finite")
    return int((max(Decimal(0), min(Decimal(1), number / saturation)) * 1000)
               .to_integral_value(rounding=ROUND_HALF_UP))


def _term(weights: tuple[int, int, int, int], pressures: tuple[int, int, int]) -> int:
    constant, error, queue, db = weights
    e, q, d = pressures
    return constant + (error * e + queue * q + db * d + 500) // 1000


def evaluate(
    proposals: list[dict] | list[RecoveryAction],
    state: ObservableState,
    config: dict | None = None,
) -> RiskAssessment:
    """Estimate action and pairwise overlap risk, independently of simulator internals.

    The same action proposed twice contributes twice; each cross-action pair
    contributes once per occurrence. Risk is capped at 1 after adding all terms.
    ``config`` is accepted for API compatibility but does not tune heuristic weights.
    """
    actions = sorted(
        (proposal if isinstance(proposal, dict) else proposal.to_proposal_dict())["action"]
        for proposal in proposals
    )
    if not actions:
        return RiskAssessment(0.0, ["No actions proposed; no action risk."])
    for action in actions:
        if action not in _BASE:
            raise ValueError(f"unknown action: {action}")

    pressures = (_pressure(state.error_rate, 1),
                 _pressure(state.queue_depth, 100),
                 _pressure(state.db_load, 1))
    reasons: list[str] = []
    total = 0
    for action in actions:
        term = _term(_BASE[action], pressures)
        total += term
        reasons.append(f"{action}: base action risk under observable pressure ({term} basis points).")
    for left, right in combinations(actions, 2):
        pair = (left, right)
        if pair in _INTERACTIONS:
            term = _term(_INTERACTIONS[pair], pressures)
            total += term
            reasons.append(f"{left} x {right}: {_PAIR_EXPLANATIONS[pair]} ({term} basis points).")

    # Integer half-up rounding of basis points to hundredths; no float accumulation.
    cents = (min(total, 10_000) + 50) // 100
    return RiskAssessment(float(Decimal(cents) / 100), reasons)


__all__ = ["RiskAssessment", "evaluate"]
