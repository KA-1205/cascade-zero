# Cascade Zero

Joint-action safety firewall and constraint coordinator for autonomous incident-recovery systems.

## Overview

Cascade Zero provides safety coordination for autonomous recovery agents responding to system outages. When multiple agents propose concurrent remediation actions, Cascade Zero evaluates compound joint risks and enforces safe execution gates.

### Architecture

- **Incident Simulator**: Deterministic microservice simulator reproducing cascade failures.
- **Recovery Agents**: Modular agents (`RestartAgent`, `RetryAgent`, `ScaleAgent`) proposing actions.
- **Joint-Action Risk Engine**: Rule-based evaluator scoring compound action risks.
- **Constraint Coordinator**: Resolves conflicting recovery actions.
- **API Server**: HTTP REST service and Server-Sent Events (SSE) telemetry streaming.
- **Operator Dashboard**: Next.js 16 interface with real-time incident timelines.

## Getting Started

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```
