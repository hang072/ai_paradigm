/**
 * 工作流模板:节点 + 边 的一个可复用编排。
 */
export interface NodeInstance {
  id: string; // 实例 id,通常同 type 或加后缀
  type: string; // NodeDef.id
  x?: number;
  y?: number;
}

export interface EdgeInstance {
  from: string; // NodeInstance.id
  to: string; // NodeInstance.id
  port: string; // NodeDef.out_ports 中的一个
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  entry: string; // NodeInstance.id
  nodes: NodeInstance[];
  edges: EdgeInstance[];
  builtin: boolean;
}
