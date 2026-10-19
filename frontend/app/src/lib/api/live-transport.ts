import type {
  HealthResponse,
  Topology,
  Run,
  RunRequest,
  Plan,
  Incident,
  CascadeEvent,
  SseStatus,
} from '@/types/api';

// ─────────────────────────────────────────────────────────────────────────────
// Live transport — connects to the real backend API.
//
// Default is SAME-ORIGIN (`BASE = ''`): browser requests hit the Next server,
// whose rewrite proxy (next.config.ts) forwards `/v1/*` to the backend at
// `CASCADE_API_ORIGIN` (default http://127.0.0.1:8000). The backend binds
// loopback only and sends no CORS headers, so a direct cross-origin call from
// the browser would be blocked — the proxy keeps every path inside the
// contract without touching backend/**. Set NEXT_PUBLIC_API_URL to bypass the
// proxy (requires a backend that allows that origin).
//
// Responses are typed via `@/types/api` only. There is NO runtime response
// validation here (zod is a project dependency but is not imported in the
// transport layer); a malformed backend response would surface as a type
// mismatch at the consumer, not a thrown ZodError.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API ${init?.method ?? 'GET'} ${path} → ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// SSE reconnect settings: fixed interval, capped number of attempts. The
// attempt counter resets whenever the stream actually opens, so a healthy
// long-lived connection never backs itself into the cap.
const SSE_RECONNECT_INTERVAL_MS = 3000;
const SSE_MAX_RECONNECT_ATTEMPTS = 5;

export const liveTransport = {
  async getHealth(): Promise<HealthResponse> {
    return apiFetch<HealthResponse>('/v1/health');
  },

  async getTopology(): Promise<Topology> {
    return apiFetch<Topology>('/v1/topology');
  },

  async createRun(req: RunRequest): Promise<Run> {
    return apiFetch<Run>('/v1/runs', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async getRun(runId: string): Promise<Run> {
    return apiFetch<Run>(`/v1/runs/${runId}`);
  },

  /**
   * Adapter alias, not a contract endpoint: the UI routes by
   * `incidents/{id}` but the contract has no /v1/incidents resource, so the
   * route param is used directly as the run id (see the alias note on the
   * incident-detail page). This fetches GET /v1/runs/{run_id} and derives a
   * minimal incident record from it. Fields only the streamed `incident` SSE
   * event can supply (severity, status, affected services, timeline) stay
   * unset here and are filled in by the page's event subscription.
   */
  async getIncident(incidentId: string): Promise<Incident> {
    const run = await apiFetch<Run>(`/v1/runs/${incidentId}`);
    return {
      id: incidentId,
      run_id: run.id,
      title: `Run ${run.id} — waiting for first incident event`,
    };
  },

  async listPlans(runId: string): Promise<Plan[]> {
    return apiFetch<Plan[]>(`/v1/runs/${runId}/plans`);
  },

  /**
   * POST /v1/plans/{plan_id}/approval — fail-closed on the backend: requires
   * `Authorization: Bearer $CASCADE_APPROVAL_TOKEN` and an `Idempotency-Key`
   * (decision D-0039 closed the previously documented missing-header gap).
   * The token is read from NEXT_PUBLIC_APPROVAL_TOKEN and must match the
   * backend's CASCADE_APPROVAL_TOKEN. NOTE: NEXT_PUBLIC_ vars are baked into
   * the client bundle — acceptable only because this backend is a
   * loopback-only sandbox; a real deployment must keep the token server-side.
   */
  async approvePlan(planId: string, approved: boolean, reason?: string): Promise<void> {
    const key = crypto.randomUUID();
    const token = process.env.NEXT_PUBLIC_APPROVAL_TOKEN;
    await apiFetch<void>(`/v1/plans/${planId}/approval`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': key,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ approved, reason }),
    });
  },

  /**
   * Opens a real SSE connection (GET /v1/runs/{run_id}/events) with
   * capped-interval reconnect. Returns a cleanup function.
   *
   * Reconnect strategy (decision D-0032): on connection error the previous
   * EventSource is closed first — EventSource retries on its own, and leaving
   * the native retry loop alive alongside our own resubscribe would create
   * duplicate streams and doubled events. Then a fresh EventSource is opened
   * every SSE_RECONNECT_INTERVAL_MS until SSE_MAX_RECONNECT_ATTEMPTS is
   * reached; a successful open resets the attempt counter.
   */
  subscribeToEvents(
    runId: string,
    onEvent: (event: CascadeEvent) => void,
    onError?: (err: Error) => void,
    onStatus?: (status: SseStatus) => void,
  ): () => void {
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      onStatus?.('connecting');

      // Close the previous EventSource before resubscribing so the browser's
      // built-in auto-reconnect never runs in parallel with this loop.
      source?.close();
      source = new EventSource(`${BASE}/v1/runs/${runId}/events`);

      source.onopen = () => {
        attempts = 0;
        onStatus?.('connected');
      };

      source.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data) as CascadeEvent;
          onEvent(parsed);
        } catch {
          onError?.(new Error(`Failed to parse SSE message: ${e.data}`));
        }
      };

      source.onerror = () => {
        source?.close();
        source = null;
        if (disposed) return;
        attempts += 1;
        if (attempts > SSE_MAX_RECONNECT_ATTEMPTS) {
          onStatus?.('failed');
          onError?.(
            new Error(`SSE stream lost after ${SSE_MAX_RECONNECT_ATTEMPTS} reconnect attempts`),
          );
          return;
        }
        onStatus?.('reconnecting');
        reconnectTimer = setTimeout(connect, SSE_RECONNECT_INTERVAL_MS);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      source?.close();
      source = null;
      onStatus?.('closed');
    };
  },
};
