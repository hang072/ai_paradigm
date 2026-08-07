/**
 * 节点类型定义:工作流图上的一个节点原型。
 * 对齐 paradigm_langgraph 后端 dataclass。
 */
export type NodeKind = 'compute' | 'interrupt' | 'counter' | 'router';

export interface NodeDef {
  id: string;
  name: string;
  kind: NodeKind;
  agent_id: string | null;
  description: string;
  config: Record<string, any>;
  out_ports: string[]; // 默认 ["next"];router 可能是 ["pass","revise","redo"]
  color: string;
}
