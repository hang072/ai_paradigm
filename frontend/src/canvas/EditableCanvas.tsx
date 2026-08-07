import { useCallback, useMemo } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import { AgentNode, portColor, type FlowNodeData } from './nodes/AgentNode';
import type { NodeDef } from '../types/node';
import type { AgentDef } from '../types/agent';
import type { EdgeInstance, NodeInstance } from '../types/template';
import { autoLayout } from './layout';

const nodeTypes = { agent: AgentNode };

export interface EditableCanvasProps {
  nodes: NodeInstance[];
  edges: EdgeInstance[];
  nodeDefs: NodeDef[];
  agentDefs: AgentDef[];
  entry: string;
  height?: number | string;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  onNodesChange: (nodes: NodeInstance[]) => void;
  onEdgesChange: (edges: EdgeInstance[]) => void;
  onSelect: (sel: { nodeId: string | null; edgeId: string | null }) => void;
}

/**
 * 可编辑画布:基于 FlowCanvas 升级,支持
 *  - 节点拖动(写回 x/y)
 *  - Handle 端口连接 → 新 EdgeInstance
 *  - 节点/边选择 → 上抛 selectedId
 *  - 边删除(选中按 Delete 或面板删除按钮)
 */
export function EditableCanvas(props: EditableCanvasProps) {
  const {
    nodes,
    edges,
    nodeDefs,
    agentDefs,
    entry,
    height = 'calc(100vh - 220px)',
    selectedNodeId,
    selectedEdgeId,
    onNodesChange,
    onEdgesChange,
    onSelect,
  } = props;

  const rfData = useMemo(() => {
    const nodeMap = new Map(nodeDefs.map((n) => [n.id, n]));
    const agentMap = new Map(agentDefs.map((a) => [a.id, a]));

    const rfNodes: Node[] = nodes.map((inst) => {
      const def = nodeMap.get(inst.type);
      const agent = def?.agent_id ? agentMap.get(def.agent_id) : undefined;
      const isEntry = inst.id === entry;
      const isSelected = inst.id === selectedNodeId;
      const data: FlowNodeData = {
        label: (inst as any).label ?? def?.name ?? inst.type,
        kind: def?.kind ?? 'compute',
        color: def?.color ?? '#2b57d6',
        agentName: agent?.name,
        outPorts: def?.out_ports ?? ['next'],
        state: isEntry ? 'current' : 'pending',
      };
      return {
        id: inst.id,
        type: 'agent',
        position: { x: inst.x ?? 0, y: inst.y ?? 0 },
        data: data as unknown as Record<string, unknown>,
        selected: isSelected,
      };
    });

    const edgeKey = (e: EdgeInstance, idx: number) => `e-${idx}-${e.from}-${e.to}-${e.port}`;
    const rfEdges: Edge[] = edges.map((e, idx) => ({
      id: edgeKey(e, idx),
      source: e.from,
      target: e.to,
      sourceHandle: e.port,
      label: e.port,
      labelBgPadding: [4, 2],
      labelBgStyle: { fill: '#fff', stroke: portColor(e.port) },
      labelStyle: { fontSize: 10, fill: portColor(e.port) },
      style: { stroke: portColor(e.port), strokeWidth: 1.6 },
      markerEnd: { type: 'arrowclosed' as any, color: portColor(e.port) },
      selected: edgeKey(e, idx) === selectedEdgeId,
    }));

    const needLayout = rfNodes.every((n) => n.position.x === 0 && n.position.y === 0);
    return { rfNodes: needLayout ? autoLayout(rfNodes, rfEdges) : rfNodes, rfEdges, edgeKey };
  }, [nodes, edges, nodeDefs, agentDefs, entry, selectedNodeId, selectedEdgeId]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // 位置/移除变更
      const next = nodes.map((inst) => ({ ...inst }));
      const byId = new Map(next.map((n) => [n.id, n]));
      changes.forEach((c) => {
        if (c.type === 'position' && c.position && byId.has(c.id)) {
          const target = byId.get(c.id)!;
          target.x = c.position.x;
          target.y = c.position.y;
        } else if (c.type === 'remove') {
          const idx = next.findIndex((n) => n.id === c.id);
          if (idx >= 0) next.splice(idx, 1);
        }
      });
      // 删节点时同步清掉挂在它上的边
      const removedIds = new Set(
        changes.filter((c) => c.type === 'remove').map((c) => c.id),
      );
      if (removedIds.size > 0) {
        onNodesChange(next);
        const prunedEdges = edges.filter(
          (e) => !removedIds.has(e.from) && !removedIds.has(e.to),
        );
        if (prunedEdges.length !== edges.length) onEdgesChange(prunedEdges);
      } else if (changes.some((c) => c.type === 'position')) {
        onNodesChange(next);
      }
    },
    [nodes, edges, onNodesChange, onEdgesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removedRfIds = new Set(
        changes.filter((c) => c.type === 'remove').map((c) => c.id),
      );
      if (removedRfIds.size === 0) return;
      const next = edges.filter((_, idx) => !removedRfIds.has(rfData.edgeKey(_, idx)));
      onEdgesChange(next);
    },
    [edges, onEdgesChange, rfData],
  );

  const handleConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || !conn.sourceHandle) return;
      // 同 from+to+port 重复则忽略
      if (
        edges.some(
          (e) => e.from === conn.source && e.to === conn.target && e.port === conn.sourceHandle,
        )
      ) {
        return;
      }
      onEdgesChange([
        ...edges,
        { from: conn.source!, to: conn.target!, port: conn.sourceHandle! },
      ]);
    },
    [edges, onEdgesChange],
  );

  const handleSelectionChange = useCallback(
    (sel: OnSelectionChangeParams) => {
      const nodeId = sel.nodes[0]?.id ?? null;
      const edgeId = sel.edges[0]?.id ?? null;
      onSelect({ nodeId, edgeId });
    },
    [onSelect],
  );

  return (
    <div style={{ height, background: '#fafbfc', border: '1px solid #e3e8f0', borderRadius: 8 }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={rfData.rfNodes}
          edges={rfData.rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onSelectionChange={handleSelectionChange}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable
          nodesConnectable
          elementsSelectable
          deleteKeyCode={['Backspace', 'Delete']}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} />
          <MiniMap zoomable pannable style={{ width: 120, height: 80 }} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
