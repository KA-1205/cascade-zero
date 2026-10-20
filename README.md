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
- **Python**: 3.11 or later
- **Dependencies**:
  - `jsonschema`: OpenAPI contract and event schema validation
  - `pyyaml`: YAML parsing for contract specifications
  - `pytest`: Unit and integration testing harness

### Frontend
- **Node.js**: 18.x or later
- **Package Manager**: `npm`
- **Framework**: Next.js 16 (App Router)
- **UI & Styling**: React 19, Tailwind CSS 4, Lucide React

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

### 2. Frontend Setup

```bash
cd frontend/app
npm install
cd ../..
```

## Usage

### Running Tests

Run the full test suite (116 tests covering agents, API contracts, coordinator, risk engine, integrations, and simulator):

```bash
python -m pytest
```

### Running the Seeded Incident Simulator

Run the reference simulation to observe baseline vs. coordinated recovery behavior:

```bash
python3 backend/reference_sim.py --seed 42 --policy all
```

### Starting the API Server

Start the REST and SSE streaming server:

```bash
CASCADE_APPROVAL_TOKEN=local-demo-only python3 -m backend.api --port 8000
```

### Launching the Operator Dashboard

Start the Next.js frontend in development mode:

```bash
cd frontend/app
CASCADE_APPROVAL_TOKEN=local-demo-only npm run dev
```

Navigate to `http://localhost:3000` to interact with the dashboard, trigger sandbox simulation runs, inspect telemetry streams, and review coordinated recovery plans.

### Running Holdout Experiments

Execute the holdout evaluation harness across seeded incident scenarios:

```bash
python3 experiments/holdout_f1_runner.py
```

## Actual Limitations

- **Simulated Environment**: The incident environment and service topologies run in-process as discrete-event simulations rather than manipulating live cloud infrastructure or production Kubernetes clusters.
- **Heuristic Risk Model**: Joint-action risk scoring is currently evaluated using deterministic policy matrices and heuristic thresholds rather than online machine-learned risk models.
- **Scoped Integrations**: The Gemma hypothesis adapter and n8n execution workflows operate behind frozen allowlists and local fallbacks for safety.
- **Single-Node In-Memory State**: The API server manages active run states in memory and binds to loopback interfaces by default; persistent multi-tenant storage is not implemented.
