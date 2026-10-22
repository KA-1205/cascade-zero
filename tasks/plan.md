# Implementation Plan: Additional Cascade Zero Features

## Overview

Add the selected features from the review PDF while preserving the prototype's synthetic-only boundary and the operator's final decision. The API contract, simulator, experiment harness, UI, and claims documentation will change in separate increments.

## Decisions

- `/v1/evaluate` will use the existing bearer-token gate, validate a bounded proposal set, and return a decision only; it will never execute actions.
- Pairwise risk terms remain enabled by default. The ablation is an explicit experiment setting and does not silently change the shipped coordinator threshold.
- Telemetry faults are generated from each seed. The stress scenario changes sensor noise, delay, and dropout parameters rather than replaying a fixed trace.
- Runtime decision latency is reported separately from synthetic transaction metrics and trace hashes.
- Automatic approval stays out of scope so every plan still needs an operator decision.

## Task List

### Phase 1: Proposal evaluation boundary
- [x] Add authenticated `POST /v1/evaluate`, input validation, response schema, and curl example.

### Phase 2: Risk evidence
- [x] Add an explicit pairwise-interaction toggle and a holdout ablation arm.
- [x] Add a tune/confirm protocol with disjoint seed blocks and a frozen selection rule.

### Phase 3: Telemetry robustness
- [x] Add deterministic generated sensor noise, delay, and dropout configuration.
- [x] Add a frontend scenario and visible sensor-quality provenance.

### Phase 4: Runtime evidence and claims
- [x] Report local decision latency percentiles separately from simulated outcomes.
- [x] Add a claim-to-evidence ledger and concise threat model.

## Verification

- Review API schemas and boundary validation against the documented request limits.
- Ran the coordinator holdout and tune/confirm experiment commands to generate reports, including outcome and provenance fields.
- Automated tests and frontend build are not part of this pass; no test or build command will be run.

## Risks

| Risk | Mitigation |
| --- | --- |
| An external agent submits malformed or mismatched actions | Require bearer auth, strict shapes/ranges, action-agent pairing, target allowlists, and a three-proposal cap. |
| Sensor faults contaminate simulator ground truth | Keep actual outcome accounting separate from sensed values; only policy observations and telemetry events are corrupted. |
| Calibration leaks confirmation seeds into selection | Freeze tuning range, candidate thresholds, metric, tie-break rule, and confirmation range in a protocol file before running. |
| Latency appears to be production telemetry | Label it as local process wall-clock measurement and keep it outside deterministic traces/outcome metrics. |
