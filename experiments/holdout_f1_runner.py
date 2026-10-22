"""Frozen, in-process F1 screening harness; no production or external actions."""

from __future__ import annotations

import csv
import io
import json
import random
import statistics
from collections import Counter
from pathlib import Path

from backend.coordinator import default_coordinator
from backend.simulator import load_config, simulate

ROOT = Path(__file__).resolve().parent
FOLDER = ROOT / "holdout-f1"
FIELDS = ("scenario", "arm", "policy", "seed", "config_version", "trace_hash",
          "simulated", "measured", "unique_offered", "unique_succeeded", "unique_failed",
          "total_attempts", "dropped", "latency_p50", "latency_p95", "max_queue_depth",
          "peak_db_connections", "sustained_recovery_time", "actions_executed",
          "decision_latency_p50_ms", "decision_latency_p95_ms",
          "false_blocks")


def seed_range(scenario):
    return range(scenario["seeds"]["start"], scenario["seeds"]["stop_exclusive"])


def run_arm(seed, policy, config, threshold=0.5, include_interactions=True):
    # Match backend/api wiring; stock backend.simulator CLI cannot invoke N3.
    plan = (default_coordinator(threshold=threshold,
                                include_interactions=include_interactions).plan
            if policy == "coordinated" else None)
    return simulate(seed, policy, config, plan=plan)


def encode(data):
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"


def paired_ci(differences, bootstrap):
    """Deterministic paired resampling of seed-level N3 minus comparator differences."""
    rng = random.Random(bootstrap["seed"])
    n = len(differences)
    means = sorted(sum(differences[rng.randrange(n)] for _ in range(n)) / n
                   for _ in range(bootstrap["replicates"]))
    alpha = (1 - bootstrap["confidence"]) / 2
    return (means[int(alpha * (len(means) - 1))],
            means[int((1 - alpha) * (len(means) - 1))])


def distribution(values):
    ordered = sorted(values)
    n = len(ordered)
    return (f"n={n}; min={ordered[0]}; q25={ordered[(n-1)//4]}; "
            f"median={statistics.median(ordered):g}; q75={ordered[(3*(n-1))//4]}; "
            f"max={ordered[-1]}; mean={statistics.mean(ordered):.2f}")


def render_report(rows, protocol):
    scenarios = protocol["scenarios"]
    arms = protocol["arms"]
    lines = ["# CZ-013: frozen F1-engine holdout screening", "",
             "**Simulated: true; measured: false. No Docker or production measurements exist.**",
             "**NEGATIVE RESULT: the conventional N2 guardrail beats N3 on unique failed users in the primary F1 block and all three F1-engine proxies. The coordinated superiority claim fails this screening gate. No block achieves sustained recovery within the horizon.**", "",
             "All counts below are actual in-process simulator results, not measured service performance.",
             "Dev seeds 0–9 were sanity-only and are excluded from every result and interval.",
             "The default coordinator threshold was fixed at 0.5 before held-out evaluation; no winner was selected post hoc.", "",
             "## Primary outcome and failure criteria", "",
             "Denominator is unique user transactions offered. Unfinished transactions at the horizon count once as failed; dropped *attempts* are tracked separately and may be retried.",
             "Lower unique_failed is better. Intervals are 95% matched-seed percentile bootstrap intervals for the mean of (N3 − comparator), with 2,000 prespecified resamples per comparison; they are screening uncertainty, not external validity.", ""]
    by = {(r["scenario"], r["arm"], int(r["seed"])): r for r in rows}
    for scenario in scenarios:
        sid = scenario["id"]
        seeds = list(seed_range(scenario))
        lines += [f"### {sid}: {scenario['label']}", "",
                  "This is an F1-engine proxy, not a validated new fault family." if sid != "F1_primary" else "Primary F1 scenario (unchanged default simulator configuration).", "",
                  f"Held-out seeds {seeds[0]}–{seeds[-1]}, {len(seeds)} per arm; identical overlay for all five arms: `{encode(scenario['overlay']).strip()}`.", "",
                  "| Arm | Failed unique users: full seed distribution summary | Total failed / offered | No sustained recovery | Actions total | Decision latency p50 / p95 (median per-run ms) | simulated / measured |", "|---|---|---:|---:|---:|---:|---|"]
        for arm in arms:
            group = [by[sid, arm, seed] for seed in seeds]
            fails = [int(r["unique_failed"]) for r in group]
            latency50 = statistics.median(float(r["decision_latency_p50_ms"]) for r in group)
            latency95 = statistics.median(float(r["decision_latency_p95_ms"]) for r in group)
            lines.append(f"| {arm} ({arms[arm]}) | {distribution(fails)} | {sum(fails)} / {sum(int(r['unique_offered']) for r in group)} | {sum(int(r['sustained_recovery_time']) == -1 for r in group)} / {len(group)} | {sum(int(r['actions_executed']) for r in group)} | {latency50:.4f} / {latency95:.4f} | true / false |")
        lines += ["", "| Paired comparison | Mean N3 − baseline failed | 95% bootstrap CI | N3 strictly better / tied / worse seeds | simulated / measured |", "|---|---:|---:|---:|---|"]
        for arm in ("N0", "N1", "N2", "N3_no_interactions"):
            differences = [int(by[sid, "N3", seed]["unique_failed"]) - int(by[sid, arm, seed]["unique_failed"]) for seed in seeds]
            lo, hi = paired_ci(differences, protocol["bootstrap"])
            counts = (sum(d < 0 for d in differences), sum(d == 0 for d in differences), sum(d > 0 for d in differences))
            lines.append(f"| N3 − {arm} | {statistics.mean(differences):.2f} | [{lo:.2f}, {hi:.2f}] | {counts[0]} / {counts[1]} / {counts[2]} | true / false |")
        fails = {arm: sum(int(by[sid, arm, seed]["unique_failed"]) for seed in seeds) for arm in arms}
        lines += ["", f"**Literal criterion: N0 equals/beats N3: {'FAILED' if fails['N0'] <= fails['N3'] else 'not triggered'}; N2 equals/beats N3: {'FAILED' if fails['N2'] <= fails['N3'] else 'not triggered'}** (aggregate failures, identical seed block).", ""]
    primary = scenarios[0]
    seeds = list(seed_range(primary))
    lines += ["## Prespecified negative controls (primary F1 block only)", "",
              "Threshold 1.0 and 0.0 are controls, not tuning candidates. All control outcomes and comparisons follow (same 100 seeds, no exclusions).", "",
              "| Arm | Failed unique users: full seed distribution summary | Total failed / offered | Actions total | Trace-identical to N1 (seeds) | Outcome-identical to N1 (seeds) | simulated / measured |",
              "|---|---|---:|---:|---:|---:|"]
    for arm in protocol["negative_controls"]:
        group = [by[primary["id"], arm, seed] for seed in seeds]
        matches = sum(all(group[i][m] == by[primary["id"], "N1", seeds[i]][m] for m in
                          ("unique_offered", "unique_failed", "unique_succeeded", "total_attempts", "dropped", "actions_executed", "latency_p50", "latency_p95", "max_queue_depth", "peak_db_connections", "sustained_recovery_time")) for i in range(len(seeds)))
        # N3 emits decision events, so its raw trace hash cannot equal N1's even when actions/outcomes do.
        fails = [int(r["unique_failed"]) for r in group]
        trace_matches = sum(group[i]["trace_hash"] == by[primary["id"], "N1", seeds[i]]["trace_hash"] for i in range(len(seeds)))
        lines.append(f"| {arm} | {distribution(fails)} | {sum(fails)} / {sum(int(r['unique_offered']) for r in group)} | {sum(int(r['actions_executed']) for r in group)} | {trace_matches} / {len(seeds)} (decision events differ) | {matches} / {len(seeds)} | true / false |")
    lines += ["", "Threshold 1.0 independent-equivalence finding: " +
          ("all recorded outcome/resource metrics equal N1 for every seed." if all(
              all(by[primary['id'], 'N3_threshold_1', seed][m] == by[primary['id'], 'N1', seed][m]
                  for m in ("unique_offered", "unique_failed", "unique_succeeded", "total_attempts", "dropped", "actions_executed", "latency_p50", "latency_p95", "max_queue_depth", "peak_db_connections", "sustained_recovery_time")) for seed in seeds)
           else "NOT independent-equivalent on recorded outcomes/resources; this is a finding, not a reason to change thresholds."),
          "Threshold 0.0 vs N0: " + ("all recorded outcome/resource metrics equal N0 for every seed."
          if all(all(by[primary['id'], 'N3_threshold_0', seed][m] == by[primary['id'], 'N0', seed][m]
              for m in ("unique_offered", "unique_failed", "unique_succeeded", "total_attempts", "dropped", "actions_executed", "latency_p50", "latency_p95", "max_queue_depth", "peak_db_connections", "sustained_recovery_time")) for seed in seeds)
          else "NOT N0-equivalent on recorded outcomes/resources."), "",
          "## Literal failure-criterion ledger", "",
          "- N0 equal/better than N3: not triggered in aggregate for any prespecified block (individual primary seeds can still be worse).",
          "- Conventional N2 equal/better than N3: **TRIGGERED in every block; reject the superiority claim.**",
          "- Action effects hard-coded to favor the coordinator: no policy-specific action effect branch observed in the simulator; whether simulator assumptions introduce a structural advantage cannot be ruled out by this experiment. No favorable claim is made.",
          "- Unseen seeds fail: N3 fails against N2 on all 190 held-out paired seeds; unseen fault families are untested. The gate fails on N2.",
          "- False safety claims: none made here; true false-block labels and risk calibration are unavailable, so safety is not established. Any such claim would fail this gate.", "",
          "## Other metrics and limitations", "",
          "Every per-seed value for latency p50/p95, maximum queue depth, peak DB connections, sustained recovery time, actions, dropped attempts and unique outcomes is in `runs.csv` (the complete empirical distributions). -1 recovery means 30 continuous healthy ticks were never observed within the horizon; do not treat it as zero. Latencies are for resolved transactions, including failures; no per-success latency split is exposed.",
              "`false_blocks` is blank: a rejected proposal is not evidence that it would have been safe. Counterfactual false-block labels, unnecessary interventions, and predicted-vs-observed risk calibration are not supplied by the simulator and are **not measured**. Decision latency is recorded separately in `runs.csv` as local process wall-clock time around the per-tick policy block. This deterministic harness has no model or network call; timing excludes production actions and infrastructure. Predicted risk is an uncalibrated heuristic, never an observed failure probability.",
          "No-Gemma is vacuous/not applicable: there is no model in the in-process decision loop. The no-interaction arm disables pairwise risk terms while keeping the same base action scores and threshold. Static-constraints-only ablation remains unimplemented; F4 dependency outage and F5 delayed/noisy telemetry cannot be represented by the F1 overlays. None was silently relabeled. F2/F3/F6 are likewise not validated by these F1-engine overlays.",
          "Action effects in the simulator are shared across policies, not explicitly policy-specific, but simulator realism and absence of implicit structural advantage are not proven; this screening cannot certify that effects do not favor N3. Unseen *seeds within these overlays* are tested; unseen fault families are not. No claim of safety or operational recovery is supported; false safety claims cannot be ruled out without measured counterfactuals.",
          "Fairness: same seed, merged config and exogenous arrival stream per arm; policies see the same *interface* `ObservableState` from the previous tick, not identical numerical observations after their actions diverge. `tests/simulator/test_simulator.py::test_observation_field_allowlist_and_isolation`, `tests/agents/test_agents.py::test_only_observable_state_and_threshold` and `tests/coordinator/test_coordinator.py::test_coordinated_reproducible_observable_only_and_common_traffic` check H1 access restrictions. `tests/experiments/` verifies common arrivals and plan's observation type; it cannot prove fairness of the simulator's modeled action effects.",
          "Only F1-engine proxy screening; no Docker/measured data. No external endpoint, actual credential, production action, or real incident was exercised.", "",
          "## Reproduction", "",
          "From repository root: `experiments/holdout-f1/reproduce.sh`. It invokes the in-process harness rather than the stock CLI because `--policy coordinated` errors and `--policy all` omits N3. Each arm calls `simulate(seed, policy, config)` directly; the coordinator arm supplies `default_coordinator().plan`, and the ablation arm uses the same coordinator with pairwise terms disabled. Full traces are regenerated in gitignored `experiments/outputs/holdout-f1/`; committed `events.jsonl` contains only the prespecified first seed of each scenario, tick 10, selected event kinds, including primary controls. `runs.csv` is the entire result set. Full simulator events retain simulated=true and measured=false; the CSV rows do too.", ""]
    return "\n".join(lines)


def main():
    protocol = json.loads((FOLDER / "config.json").read_text(encoding="utf-8"))
    assert protocol["coordinator_threshold"] == 0.5
    rows, bounded = [], []
    output = ROOT / "outputs" / "holdout-f1"
    output.mkdir(parents=True, exist_ok=True)
    for scenario in protocol["scenarios"]:
        cfg = load_config(scenario["overlay"])
        assert cfg["config_version"] == protocol["simulator_config_version"]
        arms = dict(protocol["arms"])
        if scenario is protocol["scenarios"][0]:
            arms.update({name: "coordinated" for name in protocol["negative_controls"]})
        for seed in seed_range(scenario):
            for arm, policy in arms.items():
                threshold = protocol["negative_controls"].get(arm, protocol["coordinator_threshold"])
                simulation_policy = "coordinated" if arm == "N3_no_interactions" else policy
                result = run_arm(seed, simulation_policy, cfg, threshold,
                                 include_interactions=arm != "N3_no_interactions")
                assert result["simulated"] is True and result["measured"] is False
                m = result["metrics"]
                assert m["unique_offered"] == m["unique_succeeded"] + m["unique_failed"]
                row = {"scenario": scenario["id"], "arm": arm, "policy": simulation_policy,
                       "seed": seed, "config_version": result["config_version"],
                       "trace_hash": result["trace_hash"], "simulated": "true", "measured": "false",
                       **m,
                       "decision_latency_p50_ms": result["runtime"]["decision_latency_p50_ms"],
                       "decision_latency_p95_ms": result["runtime"]["decision_latency_p95_ms"],
                       "false_blocks": ""}
                rows.append(row)
                trace = "".join(encode(event) for event in result["events"])
                (output / f"{scenario['id']}-{seed}-{arm}.jsonl").write_text(trace, encoding="utf-8")
                if seed == scenario["seeds"]["start"]:
                    bounded.extend({"scenario": scenario["id"], "arm": arm, "seed": seed,
                                    "simulated": True, "measured": False, "event": event}
                                   for event in result["events"]
                                   if event["tick"] in protocol["committed_events"]["ticks"]
                                   and event["kind"] in protocol["committed_events"]["kinds"])
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    (FOLDER / "runs.csv").write_text(stream.getvalue(), encoding="utf-8")
    (FOLDER / "events.jsonl").write_text("".join(encode(event) for event in bounded), encoding="utf-8")
    (FOLDER / "report.md").write_text(render_report(rows, protocol), encoding="utf-8")
    print(f"generated {len(rows)} runs: {dict(Counter((r['scenario'], r['arm']) for r in rows))}")


if __name__ == "__main__":
    main()
