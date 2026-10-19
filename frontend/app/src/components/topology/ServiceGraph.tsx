'use client';

import React, { useCallback, useMemo } from 'react';
import ReactFlow, {
  type Node,
  type Edge,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  type NodeProps,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { Topology, TopologyNode } from '@/types/api';

// ── Custom node ────────────────────────────────────────────────────────────────

function ServiceNode({ data }: NodeProps) {
  const node = data.node as TopologyNode;
  const loadPct = node.current_load != null && node.capacity
    ? Math.round((node.current_load / node.capacity) * 100)
    : null;

  const healthColor =
    node.health === 'critical' ? 'var(--danger)' :
    node.health === 'degraded' ? 'var(--warning)' :
    'var(--success)';

  const isSelected = data.selected as boolean;

  const typeIcon: Record<string, string> = {
    gateway: '⇆',
    service: '◆',
    database: '🗄',
    queue: '▤',
  };

  return (
    <div
      style={{
        minWidth: 130,
        padding: '10px 14px',
        backgroundColor: isSelected ? 'var(--bg-hover)' : 'var(--bg-elevated)',
        border: `2px solid ${isSelected ? healthColor : 'var(--border)'}`,
        borderRadius: 12,
        cursor: 'pointer',
        boxShadow: isSelected ? `0 0 0 3px ${healthColor}33` : '0 2px 8px rgba(0,0,0,0.4)',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: 'var(--border)', width: 6, height: 6, border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--border)', width: 6, height: 6, border: 'none' }} />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>{typeIcon[node.type ?? 'service'] ?? '◆'}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
          {node.label ?? node.id}
        </span>
        <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: healthColor, flexShrink: 0, display: 'inline-block' }} />
      </div>

      {/* Load bar */}
      {loadPct !== null && (
        <div>
          <div style={{ height: 4, backgroundColor: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min(loadPct, 100)}%`,
                backgroundColor: healthColor,
                borderRadius: 2,
                transition: 'width 0.4s ease',
              }}
            />
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
            {node.current_load}/{node.capacity} ({loadPct}%)
          </div>
        </div>
      )}
    </div>
  );
}

const nodeTypes = { service: ServiceNode };

// ── Layout ─────────────────────────────────────────────────────────────────────

const POSITIONS: Record<string, { x: number; y: number }> = {
  gateway: { x: 200, y: 20 },
  orders: { x: 50, y: 180 },
  payments: { x: 250, y: 180 },
  inventory: { x: 450, y: 180 },
  database: { x: 200, y: 360 },
};

// ── Component ─────────────────────────────────────────────────────────────────

interface ServiceGraphProps {
  topology: Topology;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}

export function ServiceGraph({ topology, selectedId, onSelect }: ServiceGraphProps) {
  const initialNodes: Node[] = useMemo(() =>
    topology.nodes.map((n) => ({
      id: n.id,
      type: 'service',
      position: POSITIONS[n.id] ?? { x: 150, y: 150 },
      data: { node: n, selected: n.id === selectedId },
      selectable: true,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topology],
  );

  const initialEdges: Edge[] = useMemo(() =>
    topology.edges.map((e, i) => ({
      id: `e-${e.from}-${e.to}`,
      source: e.from,
      target: e.to,
      animated: e.latency_ms != null && e.latency_ms > 500,
      style: {
        stroke: e.latency_ms != null && e.latency_ms > 800 ? 'var(--danger)' :
                e.latency_ms != null && e.latency_ms > 400 ? 'var(--warning)' : 'var(--border)',
        strokeWidth: 1.5,
      },
      label: e.throughput != null ? `${e.throughput} rps` : undefined,
      labelStyle: { fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' },
      labelBgStyle: { fill: 'var(--bg-elevated)', fillOpacity: 0.9 },
    })),
    [topology],
  );

  const [nodes, , onNodesChange] = useNodesState(
    initialNodes.map((n) => ({ ...n, data: { ...n.data, selected: n.id === selectedId } })),
  );
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelect?.(node.id === selectedId ? null : node.id);
    },
    [selectedId, onSelect],
  );

  const handlePaneClick = useCallback(() => {
    onSelect?.(null);
  }, [onSelect]);

  // Update selected state
  const displayNodes = nodes.map((n) => ({
    ...n,
    data: { ...n.data, selected: n.id === selectedId },
  }));

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 300 }}>
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-left"
        style={{ background: 'var(--bg-surface)' }}
        aria-label="Service dependency graph"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--border)"
        />
      </ReactFlow>
    </div>
  );
}
