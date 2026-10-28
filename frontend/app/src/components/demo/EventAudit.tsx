'use client';
import { useState } from 'react';
import type { CascadeEvent, Run } from '@/types/api';

export function EventAudit({ events, run }: { events: CascadeEvent[]; run: Run }) {
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const filtered = events.filter(e => (kind === 'all' || e.kind === kind)
    && JSON.stringify(e).toLowerCase().includes(search.toLowerCase())).slice().reverse();
  const selected = filtered.find(event => event.event_id === selectedId) ?? filtered[0];
  const prior = selected ? events.slice(0, events.indexOf(selected)).reverse().find(event => event.kind === selected.kind) : undefined;
  const payload = selected?.payload as Record<string, unknown> | undefined;
  const before = prior?.payload as Record<string, unknown> | undefined;
  const changed = payload ? [...new Set([...Object.keys(before ?? {}), ...Object.keys(payload)])].filter(key => JSON.stringify(before?.[key]) !== JSON.stringify(payload[key])) : [];
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'cascade-zero-events.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="master-detail audit-layout">
    <section className="panel master-pane"><header className="panel-heading"><h2>Audit events</h2><span>{filtered.length} / {events.length}</span></header>
      <div className="audit-filters"><label>Type<select aria-label="Type" value={kind} onChange={e => setKind(e.target.value)}><option value="all">All events</option>{['metric', 'incident', 'proposal', 'decision', 'execution', 'verification'].map(k => <option key={k}>{k}</option>)}</select></label>
        <label>Search<input aria-label="Search" type="search" value={search} placeholder="Plan, tick, reason…" onChange={e => setSearch(e.target.value)} /></label></div>
      <div className="pane-scroll">{filtered.map(event => <button key={event.event_id} onClick={() => setSelectedId(event.event_id)} aria-pressed={selected?.event_id === event.event_id} className={`master-row ${selected?.event_id === event.event_id ? 'is-selected' : ''}`}>
        <strong>Tick {event.tick} <span className="status-pill">{event.kind}</span></strong><span>{event.timestamp ?? 'Timestamp unavailable'}</span>
        <small>{event.kind === 'verification' ? (event.payload.approved === true ? 'Approved' : event.payload.approved === false ? 'Rejected' : 'Verification') : event.event_id}</small>
      </button>)}{!filtered.length && <p className="detail-content">No matching events.</p>}</div>
      <footer className="panel-actions"><button onClick={download}>Export filtered JSON</button></footer>
    </section>
    <section className="panel detail-pane"><header className="panel-heading"><h2>Trace receipt inspector</h2><span>{selected?.kind ?? 'No selection'}</span></header>
      <div className="pane-scroll detail-content">{selected && <>
        <dl className="receipt-fields"><dt>Event</dt><dd>{selected.event_id}</dd><dt>Timestamp</dt><dd>{selected.timestamp ?? 'Not supplied'}</dd>
          <dt>Simulator trace SHA-256</dt><dd className="hash-value">{run.trace_hash ?? 'Not supplied'}</dd>
          <dt>Signed trace digest</dt><dd className="hash-value">{String(payload?.trace_sha256 ?? 'No signed receipt for this event')}</dd>
          <dt>Receipt signature</dt><dd className="hash-value">{String(payload?.signature ?? 'Unsigned event')}</dd>
          <dt>Algorithm / actor</dt><dd>{String(payload?.signature_algorithm ?? 'Not signed')} · {String(payload?.actor ?? 'No operator action')}</dd></dl>
        <p className="muted">HMAC authenticates the server receipt for the shared operator account. It is not an individual operator certificate; the signing key stays on the backend.</p>
        <details><summary>Payload changes vs previous {selected.kind} event</summary><table className="data-table"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>{changed.map(key => <tr key={key}><td>{key}</td><td><code>{JSON.stringify(before?.[key]) ?? 'Absent'}</code></td><td><code>{JSON.stringify(payload?.[key]) ?? 'Absent'}</code></td></tr>)}</tbody></table></details>
        <h3>Recorded payload</h3><pre className="payload-json">{JSON.stringify(selected, null, 2)}</pre>
      </>}</div>
    </section>
  </div>;
}
