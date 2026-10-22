# Cascade Zero claims ledger and threat model

## Claims ledger

| Claim | Status | Evidence and limit |
|---|---|---|
| The demo generates telemetry from seeded service state rather than replaying fixed traces. | Supported for the local simulator | `backend/simulator`; repeated seeds reproduce outcomes and traces. This does not validate the simulator against a real service. |
| The operator can approve a local replay or send a candidate to the Experiment Lab. | Supported in the demo flow | Frontend operator-review workflow and `/v1/runs` approval/backtest endpoints. These flows do not contact an external service. |
| `POST /v1/evaluate` screens submitted actions through the coordinator. | Supported as a simulation-only policy check | Endpoint requires the existing bearer token, validates bounded inputs and allowlisted actions, and returns a decision. It does not execute actions or authenticate individual human identities. |
| No action executes without operator approval in the current product flow. | Supported for this branch | Operator-review runs hold candidate actions until approval; the external evaluation endpoint is decision-only. This is not a claim about optional adapters used independently. |
| The coordinator improves recovery or safety. | Not supported | `experiments/holdout-f1/report.md` reports the guardrail policy has fewer failed users than the coordinator on all 190 held-out seeds. No policy reaches sustained recovery in the horizon. Risk estimates are heuristic and uncalibrated. |
| A tuned threshold generalizes beyond one generated fault. | Not supported | `experiments/tune-confirmation/report.md` uses disjoint seeds for one simulator configuration only. It is not external validation and does not change the shipped 0.5 default. |
| The telemetry-fault scenario models sensor noise, delay, and dropout. | Supported in simulation | The simulator applies seeded delay, noise, and dropout to generated telemetry. It does not model real collector, network, or vendor failure distributions. |
| Reported decision latency predicts production latency. | Not supported | Runtime values measure the local per-tick policy block. A live AI planner can include its synchronous model call; the deterministic experiments do not. Neither includes production service actions or infrastructure latency. |

## Threat model

### Scope and trust boundaries

- **Untrusted inputs:** request JSON, scenario selection, submitted action proposals, telemetry values, and client-supplied operator notes.
- **Trusted policy code:** the local allowlists, input validator, risk evaluator, coordinator, and simulator implementation. A compromised process or edited policy code is outside this demo's protections.
- **Credential boundary:** the existing `CASCADE_APPROVAL_TOKEN` is a shared bearer secret for protected API operations. Possession grants access; the demo has no user identity, role separation, token rotation workflow, or durable audit identity.
- **Execution boundary:** the current approval and evaluation paths only run local simulation or return a decision. They do not call live recovery integrations. A future live adapter would create a new and higher-risk boundary requiring separate design and review.
- **State boundary:** run state and idempotency records are held in process memory and disappear on restart. This is a single-process demo, not a durable audit system.

### Main abuse cases and current controls

| Abuse case | Current control | Remaining exposure |
|---|---|---|
| Submit malformed, oversized, unknown, or nonsensical action proposals to influence the policy. | Strict request shape, numeric bounds, 64 KiB request-body limit, maximum three proposals, action-agent pairing, scenario target allowlist, duplicate-action rejection. | There is no rate limit or global admission control. Add these before exposing beyond loopback. |
| Replay stale or incomplete telemetry to trigger a risky decision. | Evaluation returns `hold` when telemetry age is nonzero or telemetry is marked dropped. | Freshness is supplied by the caller and not cryptographically or independently verified. |
| Steal or guess the shared API token. | Protected routes compare bearer tokens with constant-time comparison; default server binds to loopback. | Shared token has no per-user attribution, scoped permissions, expiry, or rotation mechanism. Do not expose the demo server publicly. |
| Abuse a scenario/action combination to bypass policy intent. | Scenario overlays disable actions; request target values are matched against scenario-specific allowlists. | Policy rules are code-defined and require review when new scenarios/actions are introduced. |
| Misrepresent synthetic results as measured or safe. | API and UI mark outcomes simulated and unmeasured; claims ledger states evidence limits. | A user can still copy results out of context. Reports and future integrations must preserve provenance labels. |
| Cause denial of service through expensive or repeated requests. | Evaluation proposals and numeric ranges are bounded; the server uses standard-library handlers. | No global rate limit, request-body cap, admission control, or resource quota is established by this feature. |
| Tamper with, lose, or dispute operator decisions. | Events are emitted in the current run and trace hashes cover simulator events. | Process memory is not durable storage; no tamper-evident external audit log or authenticated operator identity exists. |

### Security posture for the demo

Use only generated or non-sensitive telemetry and keep the server on loopback. Treat the shared token as a local demo credential. Do not connect live execution adapters or expose this API to an untrusted network without request limits, identity and role controls, durable audit storage, and a separately reviewed live-execution gate.
