"""Compact JSON CLI for the sandbox simulator."""

import argparse
import json

from . import load_config, simulate


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--policy", choices=("none", "independent", "guardrails", "coordinated", "all"), default="all")
    parser.add_argument("--config", help="optional JSON config overlay")
    args = parser.parse_args()
    if args.policy == "coordinated":
        parser.error("joint-action coordination is implemented in phase 2, task CZ-008")
    config = load_config(args.config)
    policies = ("none", "independent", "guardrails") if args.policy == "all" else (args.policy,)
    for policy in policies:
        result = simulate(args.seed, policy, config)
        print(json.dumps({key: result[key] for key in ("seed", "policy", "config_version",
                                                      "trace_hash", "metrics", "simulated", "measured")},
                         sort_keys=True))


if __name__ == "__main__":
    main()
