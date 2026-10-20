"""One live end-to-end AI decision: proves key, model id, schema and loop.

Usage: python -m backend.ai.smoke [scenario] [seed]
Prints each decision's diagnosis, selection, probes and fallback state. Exit 0
only if at least one live model decision completed.
"""

from __future__ import annotations

import json
import os
import sys

from backend.ai import AIPlanner, GeminiClient
from backend.api import load_dotenv
from backend.simulator import SCENARIOS, scenario_overlay, simulate


def main() -> int:
    load_dotenv()
    scenario = sys.argv[1] if len(sys.argv) > 1 else "db_slowdown"
    try:
        seed = int(sys.argv[2]) if len(sys.argv) > 2 else 42
    except ValueError:
        print("usage: python -m backend.ai.smoke [scenario] [seed]")
        return 2
    if scenario not in SCENARIOS:
        print(f"unknown scenario {scenario}; valid: {sorted(SCENARIOS)}")
        return 2
    if not os.environ.get("GEMINI_API_KEY"):
        print("GEMINI_API_KEY is not set; the live smoke test cannot run.")
        return 2

    overlay = scenario_overlay(scenario)
    planner = AIPlanner(GeminiClient(), seed, overlay)
    config = {**overlay, "ticks": 55}
    result = simulate(seed, "ai_coordinated", config, plan=planner.plan)
    client_model = planner.client.model if planner.client else "none"
    print(f"scenario={scenario} seed={seed} model={client_model}")
    print(f"calls={planner.calls} live_decisions={planner.live_decisions} fallbacks={planner.fallbacks}")
    live = [event for event in result["events"]
            if event["kind"] == "decision" and event["payload"].get("ai", {}).get("live")]
    for event in live:
        payload = event["payload"]
        ai = payload["ai"]
        print(f"\ntick {event.tick}: actions={payload['actions']} risk={payload['predicted_risk']}")
        print(f"  model={ai['model']} latency={ai.get('latency_ms')}ms")
        print(f"  diagnosis: {json.dumps(ai.get('diagnosis'), indent=2)}")
        if ai.get("probes"):
            print(f"  probes: {json.dumps(ai['probes'], indent=2)}")
        print(f"  reasons: {payload['reasons']}")
    failed = [event for event in result["events"]
              if event["kind"] == "decision" and event["payload"].get("ai", {}).get("fallback_reason")]
    for event in failed[:3]:
        print(f"fallback at tick {event['tick']}: {event['payload']['ai']['fallback_reason']}")
    print(f"\nmetrics: {json.dumps(result['metrics'])}")
    return 0 if live else 1


if __name__ == "__main__":
    raise SystemExit(main())
