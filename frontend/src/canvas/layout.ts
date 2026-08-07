import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

/**
 * 用 dagre 给一堆 xyflow 节点/边做左右流向自动布局。
 */
export function autoLayout(nodes: Node[], edges: Edge[], nodeWidth = 200, nodeHeight = 72): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90, marginx: 20, marginy: 20 });

  nodes.forEach((n) => g.setNode(n.id, { width: nodeWidth, height: nodeHeight }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const p = g.node(n.id);
    return {
      ...n,
      position: { x: p.x - nodeWidth / 2, y: p.y - nodeHeight / 2 },
    };
  });
}
