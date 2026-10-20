"""Contract and replay checks for the frozen in-process screening harness."""

import csv
import json
from dataclasses import fields
from pathlib import Path

from backend.coordinator import default_coordinator
from backend.simulator import ObservableState, load_config, simulate
from experiments.holdout_f1_runner import FOLDER, run_arm, seed_range


def protocol():
    return json.loads((FOLDER / "config.json").read_text())


def test_split_and_frozen_overlay():
    cfg = protocol()
    assert cfg["coordinator_threshold"] == 0.5
    assert cfg["development_seeds_sanity_only"] == list(range(10))
    blocks = [set(seed_range(s)) for s in cfg["scenarios"]]
    assert list(map(len, blocks)) == [100, 30, 30, 30]
    assert all(not left & right for i, left in enumerate(blocks) for right in blocks[i+1:])
    assert not set(cfg["development_seeds_sanity_only"]) & set.union(*blocks)
    assert set(cfg["negative_controls"].values()) == {0.0, 1.0}
    for scenario in cfg["scenarios"]:
        assert load_config(scenario["overlay"])["config_version"] == cfg["simulator_config_version"]


def test_byte_identical_full_event_replay_and_common_arrivals():
    cfg = load_config({"ticks": 32})
    results = {arm: run_arm(10000, policy, cfg) for arm, policy in protocol()["arms"].items()}
    arrivals = []
    for arm, result in results.items():
        again = run_arm(10000, protocol()["arms"][arm], cfg)
        assert json.dumps(result, sort_keys=True).encode() == json.dumps(again, sort_keys=True).encode()
        assert result["simulated"] is True and result["measured"] is False
        arrivals.append([e["payload"]["arrivals"] for e in result["events"] if e["kind"] == "metric"])
    assert all(stream == arrivals[0] for stream in arrivals)


def test_fairness_observable_state_interface():
    """H1 restriction, not a proof of identical post-action telemetry or counterfactual safety."""
    permitted = {"tick", "error_rate", "latency", "queue_depth", "db_load",
                 "topology", "incident_flags", "action_history", "service_queues"}
    assert {f.name for f in fields(ObservableState)} == permitted
    observations = []
    planner = default_coordinator()

    def record(state, proposals):
        assert type(state) is ObservableState
        assert set(vars(state)) == permitted
        assert not any(key in vars(state) for key in ("config", "fault", "capacity", "rng"))
        observations.append(state)
        return planner.plan(state, proposals)

    simulate(10000, "coordinated", {"ticks": 25}, plan=record)
    assert len(observations) == 25
    # The N0/N1/N2 paths use observe(run, tick) and _proposals(policy, state, actions);
    # see tests/simulator H1 and tests/agents policy parity. We cannot instrument
    # their policy inputs without editing backend, so do not claim stronger proof.


def test_artifact_contract_and_complete_seed_matrix():
    cfg = protocol()
    assert all((FOLDER / name).is_file() for name in
               ("config.json", "runs.csv", "events.jsonl", "report.md", "reproduce.sh"))
    with (FOLDER / "runs.csv").open(newline="") as f:
        rows = list(csv.DictReader(f))
    expected = {(s["id"], a, seed) for s in cfg["scenarios"] for seed in seed_range(s)
                for a in (list(cfg["arms"]) + (list(cfg["negative_controls"]) if s is cfg["scenarios"][0] else []))}
    assert len(rows) == len(expected) == 960
    assert {(r["scenario"], r["arm"], int(r["seed"])) for r in rows} == expected
    assert all(r["simulated"] == "true" and r["measured"] == "false" and
               int(r["unique_offered"]) == int(r["unique_succeeded"]) + int(r["unique_failed"])
               for r in rows)
    events = [json.loads(line) for line in (FOLDER / "events.jsonl").read_text().splitlines()]
    assert events
    assert all(e["seed"] == next(s["seeds"]["start"] for s in cfg["scenarios"] if s["id"] == e["scenario"])
               and e["event"]["tick"] == 10 and e["event"]["kind"] in cfg["committed_events"]["kinds"]
               and e["simulated"] is True and e["measured"] is False
               and e["event"]["simulated"] is True and e["event"]["payload"]["measured"] is False
               for e in events)
    report = (FOLDER / "report.md").read_text()
    assert all(f"### {s['id']}" in report for s in cfg["scenarios"])
    assert all(term in report for term in ("N0 equals/beats N3", "N2 equals/beats N3",
                                       "No-Gemma", "F4", "F5", "No Docker", "false_blocks"))
