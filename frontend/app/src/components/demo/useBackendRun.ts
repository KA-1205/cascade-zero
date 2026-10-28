'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { CascadeEvent, Plan, Run, SseStatus, Topology } from '@/types/api';

export function useBackendRun(runId?: string) {
  const [selection, setSelection] = useState(runId ?? '');
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<CascadeEvent[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [live, setLive] = useState(true);
  const [streamStatus, setStreamStatus] = useState<SseStatus>('closed');
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const select = useCallback((id: string) => setSelection(id), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError(''); setRun(null); setEvents([]); setPlans([]);
      try {
        const [history, graph] = await Promise.all([api.listRuns(), api.getTopology()]);
        const saved = localStorage.getItem('cascade-demo-run-id');
        const id = selection || runId || history.find(item => item.id === saved)?.id || history[0]?.id;
        const detail = id ? await Promise.all([api.getRun(id), api.getEvents(id), api.listPlans(id)]) : null;
        if (cancelled) return;
        setRuns(history); setTopology(graph);
        if (detail) {
          setRun(detail[0]); setEvents(detail[1]); setPlans(detail[2]);
          localStorage.setItem('cascade-demo-run-id', detail[0].id);
          window.dispatchEvent(new Event('cascade-selection-changed'));
        } else {
          localStorage.removeItem('cascade-demo-run-id');
          window.dispatchEvent(new Event('cascade-selection-changed'));
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Backend unavailable');
      } finally { if (!cancelled) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [selection, runId, revision]);

  useEffect(() => {
    if (!run?.id || !live) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const id = run.id;
    const sync = async () => {
      try {
        const [current, candidates, history] = await Promise.all([api.getRun(id), api.listPlans(id), api.listRuns()]);
        if (cancelled) return;
        setRun(current); setPlans(candidates); setRuns(history);
        if (current.state !== 'running') clearInterval(timer);
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Refresh failed'); }
    };
    const stop = api.subscribeToEvents(id, event => {
      if (!cancelled) setEvents(prior => prior.some(item => item.event_id === event.event_id) ? prior : [...prior, event]);
    }, reason => { if (!cancelled) setError(reason.message); }, status => {
      if (!cancelled) {
        setStreamStatus(status);
        if (status === 'closed') void sync();
      }
    });
    if (run.state === 'running') timer = setInterval(sync, 2000);
    return () => { cancelled = true; clearInterval(timer); stop(); };
  // Reconnect only when the selected run or live toggle changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, live]);

  return { runs, run, events, plans, topology, error, loading, refresh, select, live, setLive, streamStatus };
}
