# Cascade Zero demo workflow and pitch

## Product idea

Cascade Zero is an operator-guided incident response assistant for backend services. It reads telemetry, explains a likely incident, and proposes a set of recovery actions with their expected trade-offs. The operator remains responsible for the decision.

The current branch is a simulation demo. It generates telemetry from a seeded, discrete-tick service model; it does not connect to a production backend. An approved plan runs as a local synthetic replay and records the outcome. No external service is changed.

## Operator workflow

1. **Generate an incident.** Choose database slowdown, payments degradation, traffic surge, or noisy / delayed telemetry. Reusing a seed reproduces the same synthetic incident; a new seed changes the generated traffic and outcomes.
2. **Review the telemetry and diagnosis.** The AI planner can use a configured model, or the deterministic fallback when a model is unavailable. It selects from the actions the simulator makes available for that scenario.
3. **Review a candidate plan.** Inspect the action combination, stated rationale, and risk estimate. The operator can approve, send it to the Experiment Lab, or reject it.
4. **Choose the outcome.** Direct approval runs a local replay and records the synthetic result. The Experiment Lab compares the plan with a no-action baseline and, for combinations, each action on its own. Rejection records the decision without applying an action.
5. **Review the event trail.** The run, decisions, lab result, and operator decision remain visible in the local dashboard while the backend process is running.

## Demo scenarios

| Scenario | What the simulator generates | Example recovery trade-off |
| --- | --- | --- |
| Database slowdown | Shared database capacity degrades, affecting both orders and payments. | More retries can increase pressure on the shared database; extra orders replicas also consume database slots. |
| Payments degradation | The payments service slows and its queue grows. | Restarting payments causes downtime and warm-up; scaling orders is unavailable because it does not address this fault. |
| Traffic surge | Generated arrivals rise across the gateway and downstream services. | Extra replicas can add capacity after startup, while retries may amplify downstream load; restart is unavailable for a pure overload. |
| Noisy / delayed telemetry | The sensor view receives seeded delays, dropouts, and bounded noise while the service model keeps its separate underlying state. | A stale or incomplete signal should cause the operator workflow to hold decisions; noisy values can change the diagnosis without changing the simulated ground truth. |

The simulator generates transaction arrivals, queues, latency, and outcomes during each run. The scenario definitions configure the fault and sensor behavior; they are not pre-recorded telemetry traces. Sensor faults use a separate seeded random stream, and telemetry events identify age, dropout, and noise so the dashboard can distinguish sensed values from service state.

## Proposal screening API

`POST /v1/evaluate` is a decision-only boundary for an external planner or agent. It requires the existing `Authorization: Bearer ...` token and accepts a scenario, bounded telemetry state, and up to three allowlisted proposals. It returns allowed and blocked actions with reasons. Stale or dropped telemetry returns `hold`. The endpoint reports `simulated: true`, `measured: false`, and `external_execution: false`; it never runs the submitted actions.

Example request (replace the placeholder with the local `CASCADE_APPROVAL_TOKEN`):

```bash
curl -sS http://localhost:8000/v1/evaluate \
  -H 'Authorization: Bearer YOUR_LOCAL_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"db_slowdown","state":{"error_rate":0.18,"latency":42,"queue_depth":60,"db_load":0.91},"proposals":[{"agent_id":"retry-agent","action":"increase_retries","target":"database","expected_effect":"retry transient failures","cost":"more shared database pressure","confidence":0.7,"ttl":1}]}'
```

The pairwise interaction terms can be disabled for a controlled ablation with `default_coordinator(include_interactions=False)`. The base risk weights and default behavior remain unchanged. The frozen threshold tune/confirmation experiment selects on one seed block and confirms once on a disjoint block; it does not change the shipped threshold. See [`CLAIMS_LEDGER.md`](CLAIMS_LEDGER.md) and the experiment reports before making product or safety claims.

## Short demo pitch

> Cascade Zero helps operators move from backend telemetry to a reviewable recovery decision. It identifies a likely cause, proposes actions, and shows the trade-offs of each combination in a synthetic experiment before the operator approves or rejects it. The AI never has the final say. Today, the demo uses generated telemetry so we can test the workflow without access to a live backend; the same operator gate is intended to remain when real integrations are added.

## 90-second walkthrough

1. Open **Incidents** and generate a payments degradation with a new seed.
2. Show the changing telemetry and the AI planner's diagnosis. Point out that values are generated by the simulator and labeled synthetic.
3. Open **Recovery Plans**. Explain the candidate actions and why an action can help one service while increasing load elsewhere.
4. Choose **Send to Experiment Lab**. Replay the candidate against the no-action baseline and inspect failures, successes, backlog, database connections, and recovery timing.
5. Return to operator review and either approve the sandbox replay or reject the plan. Show that the result is recorded and no live service was contacted.
6. Optionally repeat with database slowdown or traffic surge to show that the available actions and trade-offs change by scenario.
7. Select noisy / delayed telemetry and show the sensor quality indicator. Explain that the observed signal can lag or drop while the simulator retains the underlying generated service state.

## Claims and limits for the demo

- Say **simulated** or **synthetic** for telemetry and outcomes. They are not measured production results.
- Approval in this branch records a local replay; it does not restart a real service, change worker counts, or retry real payments.
- The AI's risk value is a heuristic estimate, not a calibrated probability of safety.
- Decision latency is local process wall-clock time around the per-tick policy block. A live AI planner may include its synchronous model call; the deterministic experiment harness does not. Neither is a production latency estimate.
- The committed holdout report is negative for the current coordinated rule policy: the simpler guardrail policy had fewer failed users across all 190 held-out seeds in the reported blocks, and none of the policies reached sustained recovery within the simulation horizon. Do not present the current coordinator as superior.
- The API keeps run and decision state in process memory, so it is cleared when the backend restarts.
