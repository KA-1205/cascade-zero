# CZ-013: frozen F1-engine holdout screening

**Simulated: true; measured: false. No Docker or production measurements exist.**
**NEGATIVE RESULT: the conventional N2 guardrail beats N3 on unique failed users in the primary F1 block and all three F1-engine proxies. The coordinated superiority claim fails this screening gate. No block achieves sustained recovery within the horizon.**

All counts below are actual in-process simulator results, not measured service performance.
Dev seeds 0–9 were sanity-only and are excluded from every result and interval.
The default coordinator threshold was fixed at 0.5 before held-out evaluation; no winner was selected post hoc.

## Primary outcome and failure criteria

Denominator is unique user transactions offered. Unfinished transactions at the horizon count once as failed; dropped *attempts* are tracked separately and may be retried.
Lower unique_failed is better. Intervals are 95% matched-seed percentile bootstrap intervals for the mean of (N3 − comparator), with 2,000 prespecified resamples per comparison; they are screening uncertainty, not external validity.

### F1_primary: F1 database slowdown/retry storm

Primary F1 scenario (unchanged default simulator configuration).

Held-out seeds 10000–10099, 100 per arm; identical overlay for all four arms: `{}`.

| Arm | Failed unique users: full seed distribution summary | Total failed / offered | No sustained recovery | Actions total | simulated / measured |
|---|---|---:|---:|---:|---|
| N0 (none) | n=100; min=1344; q25=1783; median=2065; q75=2297; max=2642; mean=2040.48 | 204048 / 605614 | 100 / 100 | 0 | true / false |
| N1 (independent) | n=100; min=1344; q25=2830; median=2860; q75=2883; max=2949; mean=2758.86 | 275886 / 605614 | 100 / 100 | 27532 | true / false |
| N2 (guardrails) | n=100; min=1344; q25=1398; median=1424.5; q75=1442; max=1509; mean=1422.00 | 142200 / 605614 | 100 / 100 | 700 | true / false |
| N3 (coordinated) | n=100; min=1405; q25=1475; median=1513.5; q75=1543; max=1656; mean=1516.87 | 151687 / 605614 | 100 / 100 | 14442 | true / false |

| Paired comparison | Mean N3 − baseline failed | 95% bootstrap CI | N3 strictly better / tied / worse seeds | simulated / measured |
|---|---:|---:|---:|---|
| N3 − N0 | -523.61 | [-586.72, -457.70] | 92 / 0 / 8 | true / false |
| N3 − N1 | -1241.99 | [-1306.50, -1166.29] | 94 / 0 / 6 | true / false |
| N3 − N2 | 94.87 | [85.94, 104.46] | 0 / 0 / 100 | true / false |

**Literal criterion: N0 equals/beats N3: not triggered; N2 equals/beats N3: FAILED** (aggregate failures, identical seed block).

### F1_proxy_transient: F1-engine proxy: shorter, less severe slowdown (not F2)

This is an F1-engine proxy, not a validated new fault family.

Held-out seeds 10100–10129, 30 per arm; identical overlay for all four arms: `{"fault":{"degraded_capacity":45,"end":18,"recovery_end":28}}`.

| Arm | Failed unique users: full seed distribution summary | Total failed / offered | No sustained recovery | Actions total | simulated / measured |
|---|---|---:|---:|---:|---|
| N0 (none) | n=30; min=758; q25=1474; median=1575.5; q75=1736; max=2407; mean=1579.87 | 47396 / 181820 | 30 / 30 | 0 | true / false |
| N1 (independent) | n=30; min=684; q25=788; median=2687.5; q75=2725; max=2773; mean=2045.80 | 61374 / 181820 | 30 / 30 | 7034 | true / false |
| N2 (guardrails) | n=30; min=656; q25=697; median=717; q75=752; max=785; mean=719.13 | 21574 / 181820 | 30 / 30 | 150 | true / false |
| N3 (coordinated) | n=30; min=728; q25=756; median=792; q75=817; max=1136; mean=813.33 | 24400 / 181820 | 30 / 30 | 3706 | true / false |

| Paired comparison | Mean N3 − baseline failed | 95% bootstrap CI | N3 strictly better / tied / worse seeds | simulated / measured |
|---|---:|---:|---:|---|
| N3 − N0 | -766.53 | [-891.03, -634.27] | 29 / 0 / 1 | true / false |
| N3 − N1 | -1232.47 | [-1546.00, -898.67] | 22 / 0 / 8 | true / false |
| N3 − N2 | 94.20 | [71.37, 122.50] | 0 / 0 / 30 | true / false |

**Literal criterion: N0 equals/beats N3: not triggered; N2 equals/beats N3: FAILED** (aggregate failures, identical seed block).

### F1_proxy_long: F1-engine proxy: prolonged deep slowdown (not F4)

This is an F1-engine proxy, not a validated new fault family.

Held-out seeds 10130–10159, 30 per arm; identical overlay for all four arms: `{"fault":{"degraded_capacity":22,"end":52,"recovery_end":68}}`.

| Arm | Failed unique users: full seed distribution summary | Total failed / offered | No sustained recovery | Actions total | simulated / measured |
|---|---|---:|---:|---:|---|
| N0 (none) | n=30; min=2196; q25=2471; median=2618.5; q75=2699; max=3061; mean=2608.23 | 78247 / 181755 | 30 / 30 | 0 | true / false |
| N1 (independent) | n=30; min=2069; q25=3007; median=3028; q75=3044; max=3107; mean=2939.57 | 88187 / 181755 | 30 / 30 | 8290 | true / false |
| N2 (guardrails) | n=30; min=2062; q25=2108; median=2140; q75=2152; max=2194; mean=2133.97 | 64019 / 181755 | 30 / 30 | 265 | true / false |
| N3 (coordinated) | n=30; min=2106; q25=2189; median=2233; q75=2265; max=2386; mean=2236.17 | 67085 / 181755 | 30 / 30 | 4953 | true / false |

| Paired comparison | Mean N3 − baseline failed | 95% bootstrap CI | N3 strictly better / tied / worse seeds | simulated / measured |
|---|---:|---:|---:|---|
| N3 − N0 | -372.07 | [-446.97, -299.10] | 30 / 0 / 0 | true / false |
| N3 − N1 | -703.40 | [-799.20, -593.97] | 27 / 0 / 3 | true / false |
| N3 − N2 | 102.20 | [82.67, 123.57] | 0 / 0 / 30 | true / false |

**Literal criterion: N0 equals/beats N3: not triggered; N2 equals/beats N3: FAILED** (aggregate failures, identical seed block).

### F1_proxy_capacity: F1-engine proxy: reduced connection pool and higher traffic (not F6)

This is an F1-engine proxy, not a validated new fault family.

Held-out seeds 10160–10189, 30 per arm; identical overlay for all four arms: `{"db_connection_limit":42,"traffic":{"arrival":63}}`.

| Arm | Failed unique users: full seed distribution summary | Total failed / offered | No sustained recovery | Actions total | simulated / measured |
|---|---|---:|---:|---:|---|
| N0 (none) | n=30; min=4477; q25=4535; median=4558.5; q75=4587; max=4641; mean=4561.63 | 136849 / 207881 | 30 / 30 | 0 | true / false |
| N1 (independent) | n=30; min=3396; q25=3772; median=3799.5; q75=3826; max=3894; mean=3780.37 | 113411 / 207881 | 30 / 30 | 9104 | true / false |
| N2 (guardrails) | n=30; min=3344; q25=3375; median=3391.5; q75=3426; max=3472; mean=3398.20 | 101946 / 207881 | 30 / 30 | 360 | true / false |
| N3 (coordinated) | n=30; min=3475; q25=3804; median=3828.5; q75=3848; max=3900; mean=3811.90 | 114357 / 207881 | 30 / 30 | 6195 | true / false |

| Paired comparison | Mean N3 − baseline failed | 95% bootstrap CI | N3 strictly better / tied / worse seeds | simulated / measured |
|---|---:|---:|---:|---|
| N3 − N0 | -749.73 | [-778.00, -726.87] | 30 / 0 / 0 | true / false |
| N3 − N1 | 31.53 | [-4.70, 75.77] | 4 / 0 / 26 | true / false |
| N3 − N2 | 413.70 | [386.33, 434.90] | 0 / 0 / 30 | true / false |

**Literal criterion: N0 equals/beats N3: not triggered; N2 equals/beats N3: FAILED** (aggregate failures, identical seed block).

## Prespecified negative controls (primary F1 block only)

Threshold 1.0 and 0.0 are controls, not tuning candidates. All control outcomes and comparisons follow (same 100 seeds, no exclusions).

| Arm | Failed unique users: full seed distribution summary | Total failed / offered | Actions total | Trace-identical to N1 (seeds) | Outcome-identical to N1 (seeds) | simulated / measured |
|---|---|---:|---:|---:|---:|
| N3_threshold_1 | n=100; min=1344; q25=2830; median=2860; q75=2883; max=2949; mean=2758.86 | 275886 / 605614 | 27532 | 0 / 100 (decision events differ) | 100 / 100 | true / false |
| N3_threshold_0 | n=100; min=1344; q25=1783; median=2065; q75=2297; max=2642; mean=2040.48 | 204048 / 605614 | 0 | 0 / 100 (decision events differ) | 0 / 100 | true / false |

Threshold 1.0 independent-equivalence finding: all recorded outcome/resource metrics equal N1 for every seed.
Threshold 0.0 vs N0: all recorded outcome/resource metrics equal N0 for every seed.

## Literal failure-criterion ledger

- N0 equal/better than N3: not triggered in aggregate for any prespecified block (individual primary seeds can still be worse).
- Conventional N2 equal/better than N3: **TRIGGERED in every block; reject the superiority claim.**
- Action effects hard-coded to favor the coordinator: no policy-specific action effect branch observed in the simulator; whether simulator assumptions introduce a structural advantage cannot be ruled out by this experiment. No favorable claim is made.
- Unseen seeds fail: N3 fails against N2 on all 190 held-out paired seeds; unseen fault families are untested. The gate fails on N2.
- False safety claims: none made here; true false-block labels and risk calibration are unavailable, so safety is not established. Any such claim would fail this gate.

## Other metrics and limitations

Every per-seed value for latency p50/p95, maximum queue depth, peak DB connections, sustained recovery time, actions, dropped attempts and unique outcomes is in `runs.csv` (the complete empirical distributions). -1 recovery means 30 continuous healthy ticks were never observed within the horizon; do not treat it as zero. Latencies are for resolved transactions, including failures; no per-success latency split is exposed.
`false_blocks` is blank: a rejected proposal is not evidence that it would have been safe. Counterfactual false-block labels, unnecessary interventions, predicted-vs-observed risk calibration, and decision wall-clock overhead are not supplied by the simulator and are **not measured**. Predicted risk is an uncalibrated heuristic, never an observed failure probability.
No-Gemma is vacuous/not applicable: there is no model in the in-process decision loop. No-interaction-term and static-constraints-only ablations require changing backend risk/coordinator code; F4 dependency outage and F5 delayed/noisy telemetry cannot be represented by existing F1 config overlays without backend changes. None was silently relabeled. F2/F3/F6 are likewise not validated by these F1-engine overlays.
Action effects in the simulator are shared across policies, not explicitly policy-specific, but simulator realism and absence of implicit structural advantage are not proven; this screening cannot certify that effects do not favor N3. Unseen *seeds within these overlays* are tested; unseen fault families are not. No claim of safety or operational recovery is supported; false safety claims cannot be ruled out without measured counterfactuals.
Fairness: same seed, merged config and exogenous arrival stream per arm; policies see the same *interface* `ObservableState` from the previous tick, not identical numerical observations after their actions diverge. `tests/simulator/test_simulator.py::test_observation_field_allowlist_and_isolation`, `tests/agents/test_agents.py::test_only_observable_state_and_threshold` and `tests/coordinator/test_coordinator.py::test_coordinated_reproducible_observable_only_and_common_traffic` check H1 access restrictions. `tests/experiments/` verifies common arrivals and plan's observation type; it cannot prove fairness of the simulator's modeled action effects.
Only F1-engine proxy screening; no Docker/measured data. No external endpoint, actual credential, production action, or real incident was exercised.

## Reproduction

From repository root: `experiments/holdout-f1/reproduce.sh`. It invokes the in-process harness rather than the stock CLI because `--policy coordinated` errors and `--policy all` omits N3. All four arms call `simulate(seed, policy, config)` directly; N3 supplies `plan=default_coordinator().plan`, matching backend/api wiring. Full traces are regenerated in gitignored `experiments/outputs/holdout-f1/`; committed `events.jsonl` contains only the prespecified first seed of each scenario, tick 10, selected event kinds, including both primary controls. `runs.csv` is the entire result set. Full simulator events retain simulated=true and measured=false; the CSV rows do too.
