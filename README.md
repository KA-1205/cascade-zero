# Cascade Zero

Cascade Zero is a safety firewall and constraint coordinator for autonomous incident-recovery systems. When multi-agent systems attempt concurrent remediation during an outage, uncoordinated actions (such as simultaneous pod restarts, aggressive retry storms, and capacity scaling) can amplify cascading failures. Cascade Zero intercepts proposed recovery actions, calculates compound joint risks, enforces safety invariants, and gates execution plans.

## Runtime AI role and safety policy

The model inside Cascade Zero is an advisor, not an operator. [AI_RUNTIME_POLICY.md](docs/AI_RUNTIME_POLICY.md) defines its role, forbidden capabilities, deterministic validation, bounded probes, fallback behavior and research basis. The versioned rules in [backend/ai/policy.py](backend/ai/policy.py) are included in model requests and enforced at the planner boundary. No failproof-model guarantee is claimed.

## Architecture

```
                 +--------------------------+
                 | Autonomous Recovery      |
                 | Agents (Restart, Scale)  |
                 +------------+-------------+
                              |
                              | Action Proposals
                              v
                 +--------------------------+
                 |  Constraint Coordinator  |
                 +------------+-------------+
                              |
         +--------------------+--------------------+
         |                                         |
         v                                         v
+------------------+                      +------------------+
|   Joint Risk     |                      |  Approval Proxy  |
|  Engine (Rules)  |                      |  & Gatekeeper    |
+------------------+                      +------------------+
         |                                         |
         +--------------------+--------------------+
                              |
                              v
                 +--------------------------+
                 | Execution / n8n Workflow |
                 +------------+-------------+
                              |
                              v
                 +--------------------------+
                 | Target Cluster / Sim     |
                 +--------------------------+
```

### Core Components

1. **Incident Simulator (`backend/simulator`)**: Deterministic microservice simulator that reproduces multi-service degradation, database pool exhaustion, and retry amplification across configurable seeds.
2. **Recovery Agents (`backend/agents`)**: Modular remediation agents (`RestartAgent`, `RetryAgent`, `ScaleAgent`) that monitor service health metrics and propose recovery actions.
3. **Joint-Action Risk Engine (`backend/risk`)**: Rule-based safety evaluator that scores concurrent actions, detects toxic combinations (e.g. restart storms during database saturation), and assigns risk scores.
4. **Constraint Coordinator (`backend/coordinator`)**: Multi-agent mediation layer that filters, sequences, or blocks dangerous concurrent actions according to configured safety policies.
5. **API & Event Streaming Server (`backend/api`)**: Standard library HTTP server delivering REST endpoints for plan evaluation and Server-Sent Events (SSE) for real-time telemetry streaming.
6. **Integration Adapters (`backend/integrations`)**: Optional n8n and model adapters are present in the repository; the current operator-review API does not invoke external recovery actions.
7. **Operator Dashboard (`frontend/app`)**: Next.js 16 operator console featuring incident timelines, service topology graphs, interactive sandbox execution, and plan approvals.

## Dependencies

### Backend
- **Python**: 3.12 or later
- **Dependencies**:
  - `jsonschema`: OpenAPI contract and event schema validation
  - `pyyaml`: YAML parsing for contract specifications
  - `pytest`: Unit and integration testing harness

### Frontend
- **Node.js**: 22.x or later
- **Package Manager**: `npm`
- **Framework**: Next.js 16 (App Router)
- **UI & Styling**: React 19, Tailwind CSS 4, Recharts

## Setup

### 1. Clone & Python Environment

```bash
git clone https://github.com/KA-1205/cascade-zero.git
cd cascade-zero

# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install development dependencies
pip install -e '.[dev]'
```

### 2. Environment

Copy `.env.example` to `.env` and set `GEMINI_API_KEY` to a Google AI Studio
key (optional), and `CASCADE_APPROVAL_TOKEN` to any local value (required for
plan approval and backtesting). Set `CASCADE_OPERATOR_PASSWORD` to a private password for the frontend operator sign-in (username defaults to `operator`). The frontend fails closed if it is unset. Use HTTPS when hosted. Both servers load the repo-root `.env`
automatically, so one file configures everything; without it, set the
variables in each shell instead.

```bash
cp .env.example .env
# edit .env: GEMINI_API_KEY=..., CASCADE_APPROVAL_TOKEN=...
python -m backend.ai.smoke db_slowdown 42   # one live end-to-end AI decision
```

The default model is `gemini-3.8-flash`. Set `GEMINI_MODEL` to override it (`GEMMA_MODEL` remains supported) —
for example `gemma-4-26b-a4b-it` runs the Gemma endpoint, which is slower and
tends to narrate in markdown when loaded (the planner's labeled fallback
covers those calls).

### 3. Frontend Setup

```bash
cd frontend/app
npm install
cd ../..
```

## Usage

### Running Tests

Run the full test suite (agents, API contracts, coordinator, risk engine,
integrations, simulator, scenarios and the offline AI planner path):

```bash
python -m pytest
```

### Running the Seeded Incident Simulator

Run all four policies against the same seed to observe baseline vs. coordinated recovery behavior:

```bash
python -m backend.simulator --seed 42 --policy all
```

### Starting the API Server

Start the REST and SSE streaming server (loads `.env` automatically, including
`CASCADE_APPROVAL_TOKEN`):

```bash
python3 -m backend.api --port 8000
```

### Launching the Operator Dashboard

Start the Next.js frontend in development mode (it also loads the repo-root
`.env`, so the approval token works without extra shell setup):

```bash
cd frontend/app
npm run dev
```

Navigate to `http://localhost:3000`. Start an operator-review run with one of
the generated scenarios (including noisy / delayed telemetry) and a seed. The default AI planner diagnoses synthetic
telemetry and proposes actions while holding them for operator review. The
operator can approve a local replay, send a candidate to the Experiment Lab,
or reject it. Every approval records a single-decision synthetic replay at the candidate tick, after reconstructing its recorded prefix and using the original horizon; no
external service is contacted. See
[`DEMO_WORKFLOW.md`](DEMO_WORKFLOW.md) for the
walkthrough, pitch, scenario trade-offs, and current evaluation limits. The
**Project Admin** page aggregates simulator health, AI fallback reasons, and
run history.

### Running Holdout Experiments

Execute the holdout evaluation harness across seeded incident scenarios:

```bash
python3 -m experiments.holdout_f1_runner
```

Tune the coordinator threshold on a dedicated seed block, then confirm it once
on a disjoint block:

```bash
python3 -m experiments.tune_confirm
```

Both reports label results as simulated and unmeasured. Runtime decision
latency is local process wall-clock time around the policy block. A live AI
planner can include its synchronous model call; the deterministic experiments
do not measure model or network time.
See [`CLAIMS_LEDGER.md`](CLAIMS_LEDGER.md) for supported claims and the demo
threat model. `POST /v1/evaluate` is a bearer-protected, decision-only proposal
screen; it does not execute submitted actions.

## Deployment

The backend deploys to Render and the frontend to Vercel, both from this repo.

### Backend on Render

1. Render dashboard → **New → Blueprint** → select this repo. The `render.yaml`
   blueprint provisions a Python web service (`python -m backend.api`, health
   check `/v1/health`) and prompts for `CASCADE_APPROVAL_TOKEN` — paste a strong
   random value and keep it for Vercel.
2. Optional: add `GEMINI_API_KEY` / `GEMMA_MODEL` in the service's Environment
   tab to enable live AI decisions (otherwise the deterministic coordinator
   fallback runs).
3. Once deployed, note the service URL (`https://cascade-zero-api.onrender.com`).

Hosted non-health API requests require the bearer token; the authenticated frontend forwards it server-side. The API binds loopback-only by default; hosted container binds (`0.0.0.0` plus
the injected `PORT`) require `CASCADE_ALLOW_PUBLIC_BIND=true`, which the
blueprint sets. Approval/backtest endpoints always require the bearer token.

### Frontend on Vercel

1. Vercel → **Add New → Project** → import this repo.
2. Set **Root Directory** to `frontend/app` (framework auto-detected as Next.js).
3. Add environment variables before the first build:
   - `CASCADE_API_ORIGIN` — the Render service URL from above (the Next server
     proxies `/v1/*` here, so no CORS is needed on the backend)
   - `CASCADE_OPERATOR_PASSWORD` — a strong private operator password; the browser prompts for username `operator` and this password
   - `CASCADE_OPERATOR_USERNAME` — optional override for `operator`
   - `CASCADE_APPROVAL_TOKEN` — the same token entered on Render
4. Deploy. The authenticated `/v1/*` route reads `CASCADE_API_ORIGIN` in the server at runtime. Apply environment changes through your hosting provider.

## Actual Limitations

- **Simulated Environment**: The incident environment and service topologies run in-process as discrete-event simulations rather than manipulating live cloud infrastructure or production Kubernetes clusters.
- **AI Mode Depends on the Gemini API**: Live decisions need `GEMINI_API_KEY` and a responsive model; any failed call falls back to the deterministic coordinator and is labeled with the failure reason in the event stream.
- **Heuristic Risk Model (rule policies)**: The `coordinated` policy and the AI fallback path score joint-action risk with deterministic policy matrices and heuristic thresholds, not learned models.
- **No Live Recovery Integration in the Demo Flow**: Operator approval records a local synthetic replay. It does not contact the optional integration adapters.
- **Single-Node In-Memory State**: The API server manages active run states in memory and binds to loopback interfaces by default; persistent multi-tenant storage is not implemented.

## Operator workflow fixes

- The private frontend requires HTTP Basic operator authentication before viewing data or making decisions; the backend bearer token never enters the browser bundle. Cross-origin writes are rejected. This is one shared operator account, not a multi-tenant identity or role system.
- Live model recommendations pass through the deterministic coordinator. Model risk above the policy threshold or stale telemetry holds the recommendation. The event retains both model and enforced decisions.
- Candidate approval/backtest reconstructs the recorded action prefix and applies the chosen actions **once** at the recorded tick. AI planning probes remain repeated-subset experiments; those are distinct from candidate replays.
- Plan pages are paginated. Audit pages filter, paginate, and export the complete retained event history, including operator approval/rejection receipts with time and reason. Receipts share the operator account identity; history is process-local and is not a durable compliance log.
- Events are published incrementally. The UI polls resumable snapshots while a run is active; `/v1/runs/{id}/events?stream=1` offers a live stream with heartbeat, event IDs, completion notification, and Last-Event-ID/after resume.
- Admission is capped at eight active runs and 60 starts per minute per process. The newest 100 runs are retained; older completed runs and their plans/decision keys are evicted. No production load capacity is claimed.
- Frontend validation: `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npm run test:e2e` from `frontend/app`. First install the test browser with `npx playwright install chromium`. CI runs these checks with an isolated local backend and test-only credentials.
