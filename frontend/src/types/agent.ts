/**
 * Agent 定义:一个可复用的智能体角色配置。
 * 对齐 backend/internal/domain/agent.go。
 *
 * 阶段 1 扩展(2026-08-11):
 *   既有 10 字段保留。新增 5 个可选字段(都是 omitempty),
 *   旧数据 / 老客户端不会因为字段缺失而崩,前端用 ?. 兼容读。
 *   - persona:独立于人设卡的"一句话人设",与 description 解耦
 *   - methodology:结构化方法论步骤(取代散落在 system_prompt 里的"先…再…")
 *   - output_schema:每个产物键的 JSON Schema(可选)
 *   - guardrails:守门规则(no_fabricate / require_citations / escalate_to / red_lines)
 */
/**
 * Agent 定义:一个可复用的智能体角色配置。
 * 对齐 backend/internal/domain/agent.go。
 *
 * 阶段 1 扩展(2026-08-11):
 *   既有 10 字段保留。新增 5 个可选字段(都是 omitempty),
 *   旧数据 / 老客户端不会因为字段缺失而崩,前端用 ?. 兼容读。
 *   - persona:独立于人设卡的"一句话人设",与 description 解耦
 *   - methodology:结构化方法论步骤(取代散落在 system_prompt 里的"先…再…")
 *   - output_schema:每个产物键的 JSON Schema(可选)
 *   - guardrails:守门规则(no_fabricate / require_citations / escalate_to / red_lines)
 *
 * 阶段 6 扩展(2026-08-11 workbuddy 借鉴):
 *   - display_name:UI 友好名(中文花名),fallback 到 name
 *   - avatar:1-4 字符头像(emoji 或首字),由 AgentAvatar 组件渲染
 */
export interface AgentDef {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  tools: string[]; // ["search_literature","verify_reference","search_kb"]
  llm_model: string; // "default" | "deepseek-chat" | "claude-4-sonnet" | ...
  recursion_limit: number;
  color: string;
  /** 运行时环境:云端 / 本地 Mac mini。前端展示用,后端目前不严格约束。*/
  runtime?: '云端' | '本地 Mac mini';
  /** 内置角色标记 */
  builtin?: boolean;

  // ─── 阶段 1 新增字段 ─────────────────────────────────────────────

  /**
   * 一句话人设卡,与 description 解耦。
   * 例子:"你是 10 年 B 端产品经验的资深 PM,习惯先澄清问题再拆解。"
   * 后端用作 system_prompt 的"角色锚定"前缀,Planner 也用它做专家匹配。
   */
  persona?: string;

  /**
   * 结构化方法论步骤。每条一句动词开头,描述该专家的工作流。
   * 例子:["先识别 6 要素是否齐全","不齐全时生成精炼的反问","全部齐全时输出 JSON"]
   * Planner 会读这个列表来评估"该专家能不能完成子任务"。
   */
  methodology?: string[];

  /**
   * 产物契约:每个产物键 → { type, schema? }
   * - type:渲染方式('markdown' / 'json' / 'text')
   * - schema:可选 JSON Schema,validate 时按它校
   * 例子:enricher 的 output_schema = { enriched_framework: {type:'markdown'}, citations: {type:'json'} }
   */
  output_schema?: {
    [artifactKey: string]: {
      type: 'markdown' | 'json' | 'text';
      /** 可选 JSON Schema 草案 7;后端 validate 时按它校 */
      schema?: Record<string, any>;
    };
  };

  /**
   * 守门规则。Planner 编排时与前端 UI 都会读。
   * - no_fabricate:严禁编造(文献/数据/链接),违反 → 任务 fail
   * - require_citations:关键论断必须带可点击引用
   * - escalate_to:遇到该类问题转交其他专家(用 agent_id)
   * - red_lines:自由文本禁用项,前端展示给用户看
   */
  guardrails?: {
    no_fabricate?: boolean;
    require_citations?: boolean;
    /** 转交目标 agent_id 列表,例如 escalate_to: ["agent-planner"] */
    escalate_to?: string[];
    /** 自由文本禁用项,例如 ["不要给具体用药剂量建议"] */
    red_lines?: string[];
  };

  // ─── 阶段 6 新增字段(workbuddy 借鉴)──────────────────────────────

  /**
   * UI 友好名(中文花名 + 角色),如 "许清楚 · 需求澄清官"。
   * 与 name 解耦:name 仍为机器标识(系统 / 模板 binding 用),
   * display_name 仅作展示。fallback 规则:display_name ?? name ?? 'Agent'。
   */
  display_name?: string;

  /**
   * 1-4 字符头像,通常是一个 emoji(👂 🧭 🏛️ 📝 🔍 💡)。
   * 也支持 http(s):// 开头或 data: 开头的 URL(用作图片头像)。
   * 由前端 AgentAvatar 组件渲染,fallback 规则:avatar ?? display_name[0] ?? name[0]。
   * 后端 Normalize() 会截断 >4 codepoint 字符串并清空纯空白。
   */
  avatar?: string;
}
