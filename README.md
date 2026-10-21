# Cascade Zero

Cascade Zero is a safety firewall and constraint coordinator for autonomous incident-recovery systems. When multi-agent systems attempt concurrent remediation during an outage, uncoordinated actions (such as simultaneous pod restarts, aggressive retry storms, and capacity scaling) can amplify cascading failures. Cascade Zero intercepts proposed recovery actions, calculates compound joint risks, enforces safety invariants, and gates execution plans.

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
6. **Execution Integrations (`backend/integrations`)**: Gated n8n workflow executor with frozen allowlists and Gemma hypothesis validation adapter with deterministic fallbacks.
7. **Operator Dashboard (`frontend/app`)**: Next.js 16 operator console featuring incident timelines, service topology graphs, interactive sandbox execution, and plan approvals.

## Dependencies

### Backend
- **Python**: 3.12 or later
- **Dependencies**:
  - `jsonschema`: OpenAPI contract and event schema validation
  - `pyyaml`: YAML parsing for contract specifications
  - `pytest`: Unit and integration testing harness

### Frontend
- **Node.js**: 18.x or later
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
pip install -e .
```

### 2. Environment

Copy `.env.example` to `.env` and set `GEMINI_API_KEY` to a Google AI Studio
key (optional), and `CASCADE_APPROVAL_TOKEN` to any local value (required for
plan approval and backtesting). Both servers load the repo-root `.env`
automatically, so one file configures everything; without it, set the
variables in each shell instead.

```bash
cp .env.example .env
# edit .env: GEMINI_API_KEY=..., CASCADE_APPROVAL_TOKEN=...
python -m backend.ai.smoke db_slowdown 42   # one live end-to-end AI decision
```

The default model is `gemini-3.8-flash`. Set `GEMMA_MODEL` to override it —
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

Navigate to `http://localhost:3000`. Pick a scenario (database slowdown,
payments degradation, traffic surge) and a policy — the default, **AI
(Gemma)**, sends incident telemetry to the model, which diagnoses the
incident, decides which recovery actions to execute, defines test cases that
the sandbox then scores, and may run counterfactual sandbox probes before
committing. AI runs execute in the background and stream decisions as they
land; every decision carries its provenance (model, latency, probes, checks,
fallback reason). On any candidate plan you can **Backtest** — a local what-if
replay against the recorded seed that reports whether the plan helps or hurts
before you approve it. Approval verifies the plan against the recorded trace
and honestly records `approved` (sandbox default) or `executed` (when a gated
n8n webhook is configured). The **Project Admin** page aggregates system
health, AI engine fallback reasons, and run history.

### Running Holdout Experiments

Execute the holdout evaluation harness across seeded incident scenarios:

```bash
python3 experiments/holdout_f1_runner.py
```

## Actual Limitations

- **Simulated Environment**: The incident environment and service topologies run in-process as discrete-event simulations rather than manipulating live cloud infrastructure or production Kubernetes clusters.
- **AI Mode Depends on the Gemini API**: Live decisions need `GEMINI_API_KEY` and a responsive model; any failed call falls back to the deterministic coordinator and is labeled with the failure reason in the event stream.
- **Heuristic Risk Model (rule policies)**: The `coordinated` policy and the AI fallback path score joint-action risk with deterministic policy matrices and heuristic thresholds, not learned models.
- **Scoped Integrations**: The Gemma hypothesis adapter and n8n execution workflows operate behind frozen allowlists and local fallbacks for safety.
- **Single-Node In-Memory State**: The API server manages active run states in memory and binds to loopback interfaces by default; persistent multi-tenant storage is not implemented.
