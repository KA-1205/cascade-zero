'use client';
import { useState } from 'react';
import type { CascadeEvent } from '@/types/api';
import { Pagination } from './Pagination';
import { SectionHeader } from '@/components/ui/kit';

export function EventAudit({ events }: { events: CascadeEvent[] }) {
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const filtered = events.filter(e => (kind === 'all' || e.kind === kind)
    && JSON.stringify(e).toLowerCase().includes(search.toLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 40) - 1));
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'cascade-zero-events.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="surface event-audit-panel">
    <SectionHeader index="01" title={`Backend events (${events.length})`} subtitle="Telemetry, decisions, and operator receipts. Filter or export the complete retained history." />
    <div className="audit-filters">
      <label>Event type <select value={kind} onChange={e => { setKind(e.target.value); setPage(0); }}>
        <option value="all">All events</option>
        {['metric', 'incident', 'decision', 'execution', 'verification'].map(k => <option key={k}>{k}</option>)}
      </select></label>
      <label>Search events <input type="search" value={search} placeholder="Tick, plan, reason, or payload" onChange={e => { setSearch(e.target.value); setPage(0); }} /></label>
      <button type="button" onClick={download}>Export filtered events</button>
    </div>
    <Pagination name="Events" page={currentPage} count={filtered.length} size={40} onPage={setPage} />
    {filtered.slice(currentPage * 40, (currentPage + 1) * 40).map(event => <details key={event.event_id}>
      <summary>Tick {event.tick} · {event.kind}
        {event.kind === 'verification' && typeof event.payload.approved === 'boolean' ? (event.payload.approved ? ' · approved' : ' · rejected') : ''}
        <span className="event-timestamp">{event.timestamp?.replace('T', ' ').slice(0, 19)}</span>
      </summary>
      <pre>{JSON.stringify(event, null, 2)}</pre>
    </details>)}
    {!filtered.length && <p>No matching events.</p>}
  </section>;
}
