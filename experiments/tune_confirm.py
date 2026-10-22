"""Tune on one seed block and confirm once on a disjoint frozen block."""

from __future__ import annotations

import csv
import io
import json
import statistics
from pathlib import Path

from backend.coordinator import default_coordinator
from backend.simulator import load_config, simulate

ROOT = Path(__file__).resolve().parent
FOLDER = ROOT / "tune-confirmation"
FIELDS = ("phase", "arm", "policy", "threshold", "seed", "config_version",
          "trace_hash", "simulated", "measured", "unique_offered",
          "unique_succeeded", "unique_failed", "actions_executed",
          "decision_latency_p50_ms", "decision_latency_p95_ms")


def seed_range(block):
    return range(block["start"], block["stop_exclusive"])


def run(seed, policy, config, threshold=0.5, include_interactions=True):
    plan = (default_coordinator(threshold=threshold,
                                include_interactions=include_interactions).plan
            if policy == "coordinated" else None)
    return simulate(seed, policy, config, plan=plan)


def row_for(phase, arm, policy, threshold, seed, result):
    metrics, runtime = result["metrics"], result["runtime"]
    return {"phase": phase, "arm": arm, "policy": policy,
            "threshold": "" if threshold is None else threshold, "seed": seed,
            "config_version": result["config_version"],
            "trace_hash": result["trace_hash"], "simulated": "true", "measured": "false",
            **{key: metrics[key] for key in
               ("unique_offered", "unique_succeeded", "unique_failed", "actions_executed")},
            "decision_latency_p50_ms": runtime["decision_latency_p50_ms"],
            "decision_latency_p95_ms": runtime["decision_latency_p95_ms"]}


def main():
    protocol = json.loads((FOLDER / "config.json").read_text(encoding="utf-8"))
    cfg = load_config(protocol["overlay"])
    assert cfg["config_version"] == protocol["simulator_config_version"]
    tune_rows = []
    for threshold in protocol["threshold_grid"]:
        for seed in seed_range(protocol["tune_seeds"]):
            result = run(seed, "coordinated", cfg, threshold)
            tune_rows.append(row_for("tune", f"threshold_{threshold:.1f}",
                                     "coordinated", threshold, seed, result))

    summaries = []
    for threshold in protocol["threshold_grid"]:
        group = [r for r in tune_rows if float(r["threshold"]) == threshold]
        summaries.append({"threshold": threshold,
                          "mean_failed": statistics.mean(int(r["unique_failed"]) for r in group),
                          "actions": sum(int(r["actions_executed"]) for r in group)})
    selected = min(summaries, key=lambda item: (item["mean_failed"], item["actions"], item["threshold"]))
    tuned = selected["threshold"]

    arms = [
        ("tuned", "coordinated", tuned, True),
        ("default_0_5", "coordinated", protocol["selection"]["default_threshold"], True),
        ("tuned_without_interactions", "coordinated", tuned, False),
        ("guardrails", "guardrails", None, True),
        ("no_action", "none", None, True),
    ]
    confirm_rows = []
    for arm, policy, threshold, interactions in arms:
        for seed in seed_range(protocol["confirmation_seeds"]):
            result = run(seed, policy, cfg, threshold or 0.0, interactions)
            confirm_rows.append(row_for("confirmation", arm, policy, threshold, seed, result))

    all_rows = tune_rows + confirm_rows
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(all_rows)
    (FOLDER / "runs.csv").write_text(stream.getvalue(), encoding="utf-8")

    confirm_groups = {arm: [r for r in confirm_rows if r["arm"] == arm] for arm, *_ in arms}
    lines = [
        "# Threshold tuning and separate confirmation",
        "",
        "**Simulation only: generated telemetry and outcomes; measured: false. No service was contacted.**",
        "",
        f"The threshold was selected on seeds {protocol['tune_seeds']['start']}–{protocol['tune_seeds']['stop_exclusive'] - 1} using the frozen grid and tie-break rule in `config.json`. It was then evaluated once on the disjoint confirmation seeds {protocol['confirmation_seeds']['start']}–{protocol['confirmation_seeds']['stop_exclusive'] - 1}.",
        "",
        f"Selected tuning threshold: **{tuned:.1f}** (mean unique failures {selected['mean_failed']:.2f}; total actions {selected['actions']}). This result does not change the product's default threshold of 0.5.",
        "",
        "## Tuning block",
        "",
        "| Threshold | Mean unique failures | Total actions |",
        "|---:|---:|---:|",
    ]
    lines.extend(f"| {s['threshold']:.1f} | {s['mean_failed']:.2f} | {s['actions']} |" for s in summaries)
    lines += ["", "## One-time confirmation", "",
              "| Arm | Mean unique failures | Total failures / offered | Actions | Decision latency p50 / p95 (ms) |",
              "|---|---:|---:|---:|---:|"]
    for arm, group in confirm_groups.items():
        failures = sum(int(r["unique_failed"]) for r in group)
        offered = sum(int(r["unique_offered"]) for r in group)
        latency50 = statistics.median(float(r["decision_latency_p50_ms"]) for r in group)
        latency95 = statistics.median(float(r["decision_latency_p95_ms"]) for r in group)
        lines.append(f"| {arm} | {statistics.mean(int(r['unique_failed']) for r in group):.2f} | {failures} / {offered} | {sum(int(r['actions_executed']) for r in group)} | {latency50:.4f} / {latency95:.4f} |")
    lines += ["", "Decision latency is local process wall-clock time for the deterministic per-tick policy block. It excludes simulated time, model/API calls, and network or infrastructure latency; it varies by host and is not a production performance claim.",
              "", "The confirmation block is used once. It is not used to pick another threshold. Outcomes describe this simulator and fault configuration only; they do not establish safety or expected production benefit.",
              "", "## Reproduction", "",
              "From the repository root: `python3 -m experiments.tune_confirm`. The complete seed-level tuning and confirmation records are in `runs.csv`; the seed blocks and tie-break rule are frozen in `config.json`.", ""]
    (FOLDER / "report.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"selected threshold {tuned:.1f}; wrote {len(all_rows)} simulated records")


if __name__ == "__main__":
    main()
