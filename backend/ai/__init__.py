"""AI-driven incident diagnosis and recovery decisions (Gemma).

The planner replaces rule-based identification and selection: telemetry goes to
the model, the model names the problem, decides which proposals to execute,
defines the test cases to verify its own actions, and may request counterfactual
sandbox probes before committing. The sandbox physics, the action allowlist and
the deterministic coordinator (as a labeled fallback) remain rule-based on
purpose: the model decides, the guardrails gate.
"""

from backend.ai.client import AIUnavailable, GeminiClient
from backend.ai.planner import AIDecision, AIPlanner, DECISION_SCHEMA

__all__ = ["AIPlanner", "AIDecision", "GeminiClient", "AIUnavailable",
           "DECISION_SCHEMA"]
