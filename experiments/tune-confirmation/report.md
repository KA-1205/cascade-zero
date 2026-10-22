# Threshold tuning and separate confirmation

**Simulation only: generated telemetry and outcomes; measured: false. No service was contacted.**

The threshold was selected on seeds 20000–20029 using the frozen grid and tie-break rule in `config.json`. It was then evaluated once on the disjoint confirmation seeds 21000–21099.

Selected tuning threshold: **0.2** (mean unique failures 1412.77; total actions 2979). This result does not change the product's default threshold of 0.5.

## Tuning block

| Threshold | Mean unique failures | Total actions |
|---:|---:|---:|
| 0.0 | 2056.17 | 0 |
| 0.1 | 1475.00 | 46 |
| 0.2 | 1412.77 | 2979 |
| 0.3 | 1412.77 | 2979 |
| 0.4 | 1462.03 | 3201 |
| 0.5 | 1507.63 | 4323 |
| 0.6 | 1456.93 | 4394 |
| 0.7 | 1412.77 | 4298 |
| 0.8 | 1412.77 | 4298 |
| 0.9 | 1412.77 | 4298 |
| 1.0 | 2757.93 | 8231 |

## One-time confirmation

| Arm | Mean unique failures | Total failures / offered | Actions | Decision latency p50 / p95 (ms) |
|---|---:|---:|---:|---:|
| tuned | 1417.55 | 141755 / 605606 | 9942 | 0.0360 / 0.1020 |
| default_0_5 | 1519.63 | 151963 / 605606 | 14472 | 0.0480 / 0.1205 |
| tuned_without_interactions | 1417.55 | 141755 / 605606 | 9942 | 0.0340 / 0.0905 |
| guardrails | 1425.45 | 142545 / 605606 | 700 | 0.0030 / 0.0080 |
| no_action | 2127.18 | 212718 / 605606 | 0 | 0.0000 / 0.0010 |

Decision latency is local process wall-clock time for the deterministic per-tick policy block. It excludes simulated time, model/API calls, and network or infrastructure latency; it varies by host and is not a production performance claim.

The confirmation block is used once. It is not used to pick another threshold. Outcomes describe this simulator and fault configuration only; they do not establish safety or expected production benefit.

## Reproduction

From the repository root: `python3 -m experiments.tune_confirm`. The complete seed-level tuning and confirmation records are in `runs.csv`; the seed blocks and tie-break rule are frozen in `config.json`.
