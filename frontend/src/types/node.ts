/**
 * 节点类型定义:工作流图上的一个节点原型。
 * 对齐 backend/internal/domain/node.go。
 *
 * 阶段 1 扩展(2026-08-11):
 *   - config 仍为 Record<string, any>(保持自由字段,不破坏既有用法,阶段 3 才
 *     由 GenericStep 消费)。新增"约定键"类型化,给编辑器(阶段 2)与 Planner
 *     (阶段 3)做静态校验参考;运行时仍走自由 map,无 schema 强制。
 */
export type NodeKind = 'compute' | 'interrupt' | 'counter' | 'router';

/**
 * NodeDef.config 的"约定键"。这些是 5 个 builtin compute 节点 + bump_revision
 * 已读 / 将读的字段,模板编辑器与 Planner 看到这些键可以做更友好的 UI
 * (如 enum 下拉 / 数字步进器),而非纯 JSON 编辑器。
 *
 * 不影响运行时 —— config 仍是 Record<string, any>,允许任意额外键前向兼容。
 */
export interface NodeDefConfigConventions {
  /** 覆盖 AgentDef.system_prompt 的模板(支持 {{input_key}} 占位) */
  system_prompt_template?: string;
  /** 从 snapshot 读哪些顶层字段作为输入 */
  input_keys?: string[];
  /** 写入 artifact store 的 key 列表(阶段 4 起生效) */
  output_keys?: string[];
  /** 是否启用 search_kb 真检索 */
  retrieve_kb?: boolean;
  /** PubMed 真检索(需 PUBMED_EMAIL) */
  retrieve_pubmed?: { enabled: boolean; max?: number };
  /** 引用渲染方式 */
  cite_rule?: 'markdown' | 'numbered' | 'none';
  /** 任意额外键(前向兼容) */
  [k: string]: any;
}

export interface NodeDef {
  id: string;
  name: string;
  kind: NodeKind;
  agent_id: string | null;
  description: string;
  /** 自由字段,运行时不被强校验。约定键见 NodeDefConfigConventions。 */
  config: Record<string, any>;
  out_ports: string[]; // 默认 ["next"];router 可能是 ["pass","revise","redo"]
  color: string;
}
