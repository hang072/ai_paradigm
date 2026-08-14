import { useMemo } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react';
import { AgentNode, portColor, type FlowNodeData } from './nodes/AgentNode';
import type { NodeDef } from '../types/node';
import type { AgentDef } from '../types/agent';
import type { EdgeInstance, NodeInstance } from '../types/template';
import { autoLayout } from './layout';

const nodeTypes = { agent: AgentNode };

export interface FlowCanvasProps {
  entry: string;
  nodes: NodeInstance[];
  edges: EdgeInstance[];
  nodeDefs: NodeDef[];
  agentDefs: AgentDef[];
  /** 已完成节点 id 集(用于打绿) */
  doneIds?: Set<string>;
  /** 当前正在执行的节点 id(高亮脉冲) */
  currentId?: string;
  /** 跳过节点 id 集 */
  skippedIds?: Set<string>;
  height?: number | string;
  interactive?: boolean;
  /** 节点被点击时触发(只读画布用于打开详情抽屉) */
  onNodeClick?: (nodeId: string) => void;
}

/**
 * 通用只读画布(templates 预览、tasks 状态可视化都用它)。
 * 编辑器另外一层封装可以叠加拖拽/新增节点。
 */
export function FlowCanvas(props: FlowCanvasProps) {
  const {
    entry,
    nodes,
    edges,
    nodeDefs,
    agentDefs,
    doneIds = new Set(),
    currentId,
    skippedIds = new Set(),
    height = 500,
    interactive = true,
    onNodeClick,
  } = props;

  const rfData = useMemo(() => {
    const nodeMap = new Map(nodeDefs.map((n) => [n.id, n]));
    const agentMap = new Map(agentDefs.map((a) => [a.id, a]));

    const rfNodes: Node[] = nodes.map((inst) => {
      const def = nodeMap.get(inst.type);
      const agent = def?.agent_id ? agentMap.get(def.agent_id) : undefined;
      const state: FlowNodeData['state'] = skippedIds.has(inst.id)
        ? 'skipped'
        : currentId === inst.id
          ? 'current'
          : doneIds.has(inst.id)
            ? 'done'
            : 'pending';
      const data: FlowNodeData = {
        label: def?.name ?? inst.type,
        kind: def?.kind ?? 'compute',
        color: def?.color ?? '#2b57d6',
        agentName: agent?.display_name ?? agent?.name,
        outPorts: def?.out_ports ?? ['next'],
        state,
      };
      return {
        id: inst.id,
        type: 'agent',
        position: { x: inst.x ?? 0, y: inst.y ?? 0 },
        data: data as unknown as Record<string, unknown>,
      };
    });

    const rfEdges: Edge[] = edges.map((e, idx) => ({
      id: `e-${idx}-${e.from}-${e.to}-${e.port}`,
      source: e.from,
      target: e.to,
      sourceHandle: e.port,
      label: e.port,
      labelBgPadding: [4, 2],
      labelBgStyle: { fill: '#fff', stroke: portColor(e.port) },
      labelStyle: { fontSize: 10, fill: portColor(e.port) },
      style: { stroke: portColor(e.port), strokeWidth: 1.6 },
      animated: currentId != null && e.from === currentId,
      markerEnd: { type: 'arrowclosed' as any, color: portColor(e.port) },
    }));

    // 若没有布局坐标,跑一次 dagre
    const needLayout = rfNodes.every((n) => n.position.x === 0 && n.position.y === 0);
    return { rfNodes: needLayout ? autoLayout(rfNodes, rfEdges) : rfNodes, rfEdges };
  }, [nodes, edges, nodeDefs, agentDefs, doneIds, currentId, skippedIds]);

  return (
    <div style={{ height, background: '#fafbfc', border: '1px solid #e3e8f0', borderRadius: 8 }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={rfData.rfNodes}
          edges={rfData.rfEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={interactive}
          nodesConnectable={false}
          elementsSelectable={interactive}
          onNodeClick={onNodeClick ? (_e, n) => onNodeClick(n.id) : undefined}
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

// 未来编辑器需要时会用到 entry;这里先接住不让 lint 报未使用
export const _entryPlaceholder = (e: string) => e;
