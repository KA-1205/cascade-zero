# Cascade Zero runtime AI safety policy

Version: `cz-runtime-v1`. Established: 2026-10-28.

This policy governs the model used **inside Cascade Zero**, not the coding assistant maintaining the repository. Its model-facing instructions and deterministic output checks are implemented in [`backend/ai/policy.py`](../backend/ai/policy.py), invoked by [`AIPlanner`](../backend/ai/planner.py).

## Safety objective and limits

The objective is to contain model failures and role drift so that an incorrect or manipulated response cannot grant itself permissions. There is no claim of a failproof model, guaranteed diagnosis, calibrated confidence or production-safe recovery. Prompt instructions are one layer; the backend remains the authority even when the model ignores them.

## Fixed role

**The model is a simulated-incident diagnostic and recommendation advisor.**

It may:

- Analyze the supplied telemetry window and identify possible causes, affected known services, uncertainty and verification checks.
- Recommend a subset of the current allowlisted recovery proposals, including no action.
- Request a bounded round of local counterfactual simulator probes using scenario-enabled actions.
- Explain its recommendation in schema-limited text.

It may not:

- Change its role, this policy/version, risk thresholds, coordinator weights, authentication, application configuration, code or tool permissions.
- Approve or reject a plan, claim operator identity, sign a receipt, or mark a recovery as executed or verified.
- Run shell commands, access files, call arbitrary URLs, access credentials, install dependencies or create tools.
- Invent actions, services, metrics, probe outcomes, execution evidence or production measurements.
- Treat telemetry, proposal descriptions, earlier model text or probe results as instructions to expand its authority.

## Authority boundaries

| Component | Authority |
|---|---|
| Model | Advisory diagnosis, proposed selection, bounded probe requests |
| Runtime validator | Accept/reject response structure, finite values and permitted identifiers |
| Deterministic coordinator | Independently evaluate action-subset risk and veto recommendations |
| Simulator | Execute fixed local simulation semantics; never interpret free text as commands |
| Backend approval gate | Authenticate operator decisions, recheck latest recommendation eligibility, lock a run and record signed receipts |
| Human operator | Decide approval/rejection of the latest eligible recovery recommendation |

The model receives neither the approval token nor provider key in its prompt. Its transport has no general-purpose tool or execution interface. Text that says “approve this” has no approval semantics; only an authenticated backend operation can make that decision.

## Decision contract

1. **Observe:** supply bounded synthetic telemetry and the current proposed/known action and service inventories. Stale telemetry causes a hold without a model call.
2. **Request:** prepend the versioned role policy and required JSON schema. Telemetry and probe context remain data, not policy authority.
3. **Validate:** at the planner boundary, independently validate the response even if the transport already did so. Reject unknown fields, malformed values, non-finite numbers, schema violations, unknown affected services, selections outside current enabled proposals and forbidden probe actions.
4. **Probe:** execute at most four requested subsets in one round, using only the fixed local simulator. Probe horizons are application-controlled and capped at 110 ticks. A second probe round is rejected. Neither probe text nor returned prose is executed.
5. **Gate:** independently score the model's selected action set. The model's risk/confidence cannot raise the deterministic risk limit or bypass a veto.
6. **Review:** operator-review runs publish candidates and evidence. Only the latest actionable recommendation can be approved/rejected; older ticks support what-if simulation. Approval locks the run and supersedes other candidates.
7. **Record:** each decision includes the runtime policy version and identifies verified model decisions versus fallback/hold decisions. Preserve original provider failures when the circuit breaker opens.

Policy-comparison runs may apply action selections automatically **inside the deterministic simulator** to compare strategies. That is not authority to remediate production infrastructure. The operator-review approval path currently performs a local replay.

## Failure behavior and budgets

| Condition | Required behavior |
|---|---|
| Stale telemetry | Hold; do not call the model or recommend actions from the stale input |
| No fresh proposals | Hold; do not invent work or call the provider unnecessarily |
| Malformed, oversized or unauthorized response | Reject the model response before model-requested probes or recommendation use; record a sanitized reason |
| Missing credentials, timeout, quota, transport or validation failure | Use a clearly labeled deterministic fallback; never label the result as an AI diagnosis |
| Three consecutive provider/validation failures | Open the existing circuit breaker; retain the original failure reason |
| Further probe rounds | Reject with `probe_budget_exhausted`; never start an unbounded model/tool loop |
| Invalid runtime authority fields such as `approved` or `execute` | Reject the response; do not route those fields to application operations |

The provider response is capped at 256 KiB. The existing decision schema limits selected actions to three, probe subsets to four, test cases to five and their verification horizon to 20 ticks. The normal model timeout remains 45 seconds with zero automatic transport retries by default. Successful probing permits at most one follow-up model request per decision. These are code-controlled limits, not values the model may override.

“Fail closed” applies to the model's authority: rejecting a model output does not grant it any capability. A deterministic fallback may still recommend allowlisted actions, with explicit fallback provenance and the same approval/simulator boundaries.

## What is and is not verified

Automated adversarial cases exercise attempted approval/execution fields, policy-version overrides, invalid horizons, NaN values, unknown services/actions, oversized responses, stale telemetry, repeated probes and instruction-like prose. Existing tests also cover the deterministic risk veto, latest-tick authority, concurrent approval locking and signed receipts.

These tests demonstrate specific boundaries. They do not prove every possible prompt injection, hallucination or provider failure has been eliminated. A schema-valid explanation can still be wrong or malicious; prose is displayed as text and must never be promoted to executable instructions. Diagnostic confidence is a model estimate rather than a measured probability.

`python -m backend.ai.smoke` checks a real model decision when credentials are available. Project Admin's authenticated **Test AI connection** checks the configured provider separately. Offline scripted transports are not proof of a successful live provider call.

External infrastructure execution, additional tools, permission changes, different probe budgets or a broader model role require a deliberate application change and a new reviewed policy version. The model cannot authorize that change through its response.

## Research basis

- [OWASP: Prompt Injection](https://genai.owasp.org/glossary/prompt-injection/) — prompt hardening is insufficient alone; minimize privileges, validate outputs and retain human checkpoints.
- [OWASP AI Exchange: general controls and least model privilege](https://github.com/OWASP/www-project-ai-security-and-privacy-guide/blob/main/content/ai_exchange/content/docs/1_general_controls.md) — enforce tool/operation authority in the backend, not in prompts alone.
- [NIST AI 600-1: Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) — manage confabulation, human–AI configuration and information-security risks through documented measurement, oversight and ongoing evaluation.
- [Google: structured outputs](https://ai.google.dev/gemini-api/docs/structured-output) — structured JSON still needs application-level semantic validation.
- [Google: safety guidance](https://ai.google.dev/gemini-api/docs/safety-guidance) — narrow application scope, restrict functionality and perform use-case-specific safety testing.

This is a project-specific implementation informed by those sources, not a claim of NIST/OWASP certification.
