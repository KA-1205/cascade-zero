import type {
  HealthResponse,
  Topology,
  Run,
  RunRequest,
  Plan,
  Incident,
  AuditRecord,
  ExecutionStep,
  ExperimentSummary,
} from '@/types/api';
import {
  mockTopology,
  mockRun,
  mockPlans,
  mockIncident,
  mockExecutionSteps,
  mockExperiment,
  mockAuditRecords,
} from '@/lib/fixtures';

// ─────────────────────────────────────────────────────────────────────────────
// Mock transport — simulates all API endpoints locally using fixtures.
// SSE events are replayed from the incident timeline fixture.
// ─────────────────────────────────────────────────────────────────────────────

const TICK_MS = 1500; // Simulate one tick per 1.5s in mock mode

async function delay(ms = 200) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export const mockTransport = {
  async getHealth(): Promise<HealthResponse> {
    await delay();
    return { status: 'ok' };
  },

  async getTopology(): Promise<Topology> {
    await delay(300);
    return mockTopology;
  },

  async createRun(req: RunRequest): Promise<Run> {
    await delay(400);
    return {
      ...mockRun,
      id: `demo-${Date.now()}`,
      seed: req.seed,
      scenario: req.scenario,
      policy: req.policy,
      state: 'created',
      started_at: new Date().toISOString(),
    };
  },

  async getRun(runId: string): Promise<Run> {
    await delay(200);
    return { ...mockRun, id: runId };
  },

  async listPlans(runId: string): Promise<Plan[]> {
    await delay(300);
    return mockPlans.map((p) => ({ ...p, run_id: runId }));
  },

  async approvePlan(
    planId: string,
    approved: boolean,
    reason?: string,
  ): Promise<void> {
    await delay(600);
    console.info(`[mock] plan ${planId} ${approved ? 'approved' : 'rejected'}`, { reason });
  },

  async getIncident(incidentId: string): Promise<Incident> {
    await delay(250);
    return { ...mockIncident, id: incidentId };
  },

  async getExecutionSteps(runId: string): Promise<ExecutionStep[]> {
    await delay(200);
    return mockExecutionSteps;
  },

  async getExperiment(seed: number): Promise<ExperimentSummary> {
    await delay(400);
    return { ...mockExperiment, seed };
  },

  async getAudit(runId?: string): Promise<AuditRecord[]> {
    await delay(300);
    if (runId) {
      return mockAuditRecords.filter((r) => r.run_id === runId);
    }
    return mockAuditRecords;
  },

  /** 
   * Simulates SSE by calling onEvent repeatedly from the fixture timeline.
   * Returns a cleanup function.
   */
  subscribeToEvents(
    runId: string,
    onEvent: (event: import('@/types/api').CascadeEvent) => void,
    onError?: (err: Error) => void,
  ): () => void {
    const events = mockIncident.timeline ?? [];
    let index = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled || index >= events.length) return;
      onEvent({ ...events[index], run_id: runId });
      index++;
      setTimeout(tick, TICK_MS);
    };

    // Start after a short initial delay
    setTimeout(tick, 800);

    return () => {
      cancelled = true;
    };
  },
};
