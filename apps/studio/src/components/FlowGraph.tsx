import { useEffect, useState } from 'react';
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import '@xyflow/react/dist/style.css';

export interface GraphNode {
  id: string;
  label: string;
  sub?: string;
  className?: string;
  title?: string;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  className?: string;
}

const elk = new ELK();
const WIDTH = 170;
const HEIGHT = 52;

/** A read-only graph laid out with ELK (layered, left to right). */
export function FlowGraph({
  nodes,
  edges,
  label,
  height = 560,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  label: string;
  height?: number;
}) {
  const [layout, setLayout] = useState<{ nodes: Node[]; edges: Edge[] } | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const ids = new Set(nodes.map((n) => n.id));
    const valid = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    void elk
      .layout({
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.spacing.nodeNode': '28',
          'elk.layered.spacing.nodeNodeBetweenLayers': '64',
        },
        children: nodes.map((n) => ({ id: n.id, width: WIDTH, height: HEIGHT })),
        edges: valid.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      })
      .then((g) => {
        if (!alive) return;
        const pos = new Map((g.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
        setLayout({
          nodes: nodes.map((n) => ({
            id: n.id,
            position: pos.get(n.id) ?? { x: 0, y: 0 },
            data: {
              label: (
                <div title={n.title}>
                  <div className="node__label">{n.label}</div>
                  {n.sub === undefined ? null : <div className="node__sub">{n.sub}</div>}
                </div>
              ),
            },
            className: `node ${n.className ?? ''}`,
            style: { width: WIDTH },
            draggable: true,
            connectable: false,
          })),
          edges: valid.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            ...(e.label === undefined ? {} : { label: e.label }),
            className: e.className ?? '',
            markerEnd: { type: MarkerType.ArrowClosed },
          })),
        });
      });
    return () => {
      alive = false;
    };
  }, [nodes, edges]);
  return (
    <div className="graph" style={{ height }} role="figure" aria-label={label}>
      {layout === undefined ? (
        <p className="muted">Laying out…</p>
      ) : (
        <ReactFlow
          nodes={layout.nodes}
          edges={layout.edges}
          fitView
          minZoom={0.1}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      )}
    </div>
  );
}
