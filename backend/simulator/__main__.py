"""Compact JSON CLI for the sandbox simulator."""

import argparse
import json

from backend.coordinator import default_coordinator

from . import load_config, simulate


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--policy", choices=("none", "independent", "guardrails", "coordinated", "all"), default="all")
    parser.add_argument("--config", help="optional JSON config overlay")
    args = parser.parse_args()
    config = load_config(args.config)
    policies = ("none", "independent", "guardrails", "coordinated") if args.policy == "all" else (args.policy,)
    for policy in policies:
        # Match the API wiring: coordinated needs the constraint coordinator.
        plan = default_coordinator().plan if policy == "coordinated" else None
        result = simulate(args.seed, policy, config, plan=plan)
        print(json.dumps({key: result[key] for key in ("seed", "policy", "config_version",
                                                      "trace_hash", "metrics", "simulated", "measured")},
                         sort_keys=True))


if __name__ == "__main__":
    main()
