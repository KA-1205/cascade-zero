# Desktop console audit

Scope: `features`, starting at `78c316e`. All displayed run, event, plan, model-status, topology and comparison data comes from Python through the authenticated `/v1/...` proxy. Input presets and labels are configuration, not observed results.

## Changes

- Fixed-height desktop pages with anchored headers, metric ribbons and action controls. Long lists, evidence and payloads scroll inside their own panes.
- Overview: four KPIs, 48/52 topology/evidence layout, event stream and anchored coordinator accordion.
- Incident index and detail: preset triggers, history selection, telemetry, sparklines and an EventSource pause/resume control.
- Plans: sorted candidate master list, evidence detail and one approval per run. The Python lock prevents concurrent competing approvals; alternative candidates become `superseded` and survive reload.
- Experiments: persisted run history, matching seed/scenario policy comparisons, failed-rate delta, recovery duration and success percentage. Candidate replay remains available.
- Audit: filters, event selection, payload changes, JSON export and server-generated HMAC-SHA256 approval receipts covering operator provenance and the preceding trace digest.
- Admin: backend/model configuration, recorded fallback counts, persisted run count, scenario inventory and background simulation trigger.
- Removed frontend fabricated diagnoses, risk values, approval claims and action parameters. Removed automatic demo creation in an empty backend store and backend fixed-confidence scenario diagnoses.
- Corrected persisted plan event indexing so approvals work after restarting the backend.

## Verification

- `PYTHONPATH=. .venv/bin/pytest tests/`: 179 passed (174 existing, 5 new integrity regressions).
- `npm run build` in `frontend/app`: clean production build.
- `npm run lint`: clean.
- `npm run test:e2e`: authority boundaries, SSE control, backtest, policy comparison, approval/superseding, signed receipt and desktop containment.
- `scratch/browser_walkthrough.js`: full-page captures for seven routes at 1920×1080 and 2560×1440. Checks document dimensions, main-container overflow and page-container overflow. Records real `/v1` responses and browser errors in `scratch/verification.json`.

For isolated screenshot verification after building:

```sh
CONSOLE_START=1 node scratch/browser_walkthrough.js
```

Install Playwright's browser first. `CHROMIUM_PATH` can select an already installed compatible executable. The script starts its own local servers and uses a separate temporary data directory. Browser credentials in test scripts are test-only values.

## Honest limits

The Python backend currently generates infrastructure simulations; these are live API responses, not production telemetry. No provider key was supplied during verification, so live model inference was not tested. Existing rule fallback remains explicitly identified as backend behavior.

Blast radius is not supplied by the backend and displays an unavailable marker; no value is invented. Recovery duration is simulator ticks from fault onset, not wall-clock MTTR. A single-seed comparison is not a statistical holdout study. No rollback execution API exists, so no fictitious rollback events are displayed.

HMAC receipts authenticate the server's shared operator account; they are not individual operator certificates. Existing unsigned events remain unsigned. `CASCADE_RECEIPT_KEY` optionally separates the signing key from `CASCADE_APPROVAL_TOKEN`. Keep the signing key stable to verify retained receipts.

`CASCADE_DATA_DIR` selects a separate persistence directory. Empty stores remain empty until an operator requests a run. Existing stored records are preserved.
