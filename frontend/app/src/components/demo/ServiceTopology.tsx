import type { Topology } from '@/types/api';

const positions: Record<string, [number, number]> = {
  gateway: [100, 100], orders: [330, 45], payments: [330, 155], database: [560, 100],
};
export function ServiceTopology({ topology, fault, queues }: {
  topology: Topology | null; fault: string; queues: Record<string, { peak: number; last: number }>;
}) {
  if (!topology) return <p>Loading dependencies…</p>;
  return <svg className="topology-graph" viewBox="0 0 660 210" role="img" aria-label="Service dependencies and run queue depths">
    <title>Gateway calls orders and payments; both depend on the shared database.</title>
    <defs><marker id="dependency-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="var(--accent)" /></marker></defs>
    {topology.edges.map(edge => {
      const from = positions[edge.from], to = positions[edge.to];
      if (!from || !to) return null;
      return <line key={`${edge.from}-${edge.to}`} x1={from[0] + 78} y1={from[1]} x2={to[0] - 82} y2={to[1]} stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#dependency-arrow)" />;
    })}
    {topology.nodes.map(node => {
      const pos = positions[node.id]; if (!pos) return null;
      const stats = queues[node.id];
      return <g key={node.id} transform={`translate(${pos[0]},${pos[1]})`}>
        <rect x="-78" y="-35" width="156" height="70" rx="8" fill={fault === node.id ? 'var(--warning-muted)' : 'var(--bg-elevated)'} stroke={fault === node.id ? 'var(--warning)' : 'var(--border)'} />
        <text textAnchor="middle" y="-12" fontWeight="700">{node.id}{fault === node.id ? ' · fault' : ''}</text>
        <text textAnchor="middle" y="7" fontSize="11">capacity {node.capacity}/tick</text>
        <text textAnchor="middle" y="24" fontSize="10">peak queue {stats?.peak ?? '—'} · final {stats?.last ?? '—'}</text>
      </g>;
    })}
  </svg>;
}
