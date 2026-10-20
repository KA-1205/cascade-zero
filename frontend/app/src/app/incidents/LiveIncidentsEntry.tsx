'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { SectionHeading, ErrorState } from '@/components/ui/primitives';

/**
 * Live-mode entry point for `/incidents` (decision D-0039 follow-up).
 *
 * The contract has no list-incidents endpoint (D-0032), so this page cannot
 * enumerate runs the way the mock fixtures do. Instead it offers to create a
 * demo run via POST /v1/runs — coordinated policy, the only one that produces
 * approval-eligible plans — and routes to its incident page. Without a
 * backend running the create call fails and the inline error says so.
 */
export function LiveIncidentsEntry() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startDemoRun() {
    setBusy(true);
    setError(null);
    try {
      const run = await api.createRun({
        seed: 42,
        scenario: 'db_slowdown',
        policy: 'coordinated',
      });
      localStorage.setItem('cascade-demo-run-id', run.id);
      router.push(`/incidents/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create run');
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="surface" style={{ padding: 20 }}>
        <SectionHeading
          title="Live mode"
          subtitle="The API contract has no list-incidents endpoint (decision D-0032) — open a run by id or create a demo run."
        />
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 16 }}>
          Incident pages are keyed by <strong>run id</strong>. Create a coordinated-policy
          sandbox run below with the reproducible seed 42, or open{' '}
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>/incidents/{'{run_id}'}</code>{' '}
          directly if you already have one. Runs disappear when the backend restarts.
        </p>
        {error && <ErrorState message={`Create run: ${error}`} />}
        <button
          type="button"
          onClick={startDemoRun}
          disabled={busy}
          style={{
            padding: '10px 16px', borderRadius: 6, border: 'none',
            backgroundColor: busy ? 'var(--bg-hover)' : 'var(--accent)',
            color: busy ? 'var(--text-muted)' : '#fff',
            fontSize: 14, fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'Creating run…' : 'Create demo run'}
        </button>
      </div>
    </div>
  );
}
