/**
 * 工作流模板:节点 + 边 的一个可复用编排。
 * 对齐 backend/internal/domain/template.go。
 *
 * 阶段 2 扩展(2026-08-11):
 *   - parameter_schema:模板级入参契约,Planner(阶段 3)生成 spec 时按它填
 *     parameter_bindings;用户在 /templates 编辑器可配,运行时由调用方传入
 *   - description_required_inputs:Planner prompt 用的"必填入参描述",帮助
 *     LLM 理解该模板需要哪些外部信息
 *   - current_version:版本化保存(阶段 2.4)的当前版本号
 *   - versions:历史版本号列表(只读快照)
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

/**
 * 模板级入参 schema。每个 key 是参数名,描述调用方应提供的值。
 * 阶段 3 Planner 消费:对用户 brief 做实体抽取,匹配 description_required_inputs
 * 自动填入 parameter_bindings;也允许用户在编辑器内手动配置默认值。
 */
export interface ParameterSchemaEntry {
  type: 'string' | 'number' | 'enum' | 'boolean';
  required?: boolean;
  default?: any;
  description?: string;
  /** enum 类型必填:可选值列表 */
  enum_values?: string[];
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

  // ─── 阶段 2 新增字段 ─────────────────────────────────────────────
  /** 模板级入参契约,所有 key 的集合 = 调用方应提供的参数。旧数据 omitempty。 */
  parameter_schema?: { [key: string]: ParameterSchemaEntry };
  /** Planner prompt 用的"必填入参描述",帮助 LLM 理解模板需求 */
  description_required_inputs?: string[];
  /** 当前版本号(阶段 2.4 版本化保存引入) */
  current_version?: number;
  /** 历史版本号列表(只读) */
  versions?: number[];
}
