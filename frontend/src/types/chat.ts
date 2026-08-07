/**
 * 对话数据模型
 *
 * 新模型（2026-07-23 重构）:
 *   会话不再有 "模式" 概念。每个会话始终由一个通用主助手 (agent-main) 承接;
 *   用户可选挂载 0 或 1 个"子智能体"作为主助手的工具:
 *     - kind='agent' : 一个专家
 *     - kind='team'  : 一个工作流模板 (WorkflowTemplate)
 *   主助手根据用户输入自主决定是否调用挂载的子智能体; 调用轨迹作为主助手气泡里的
 *   折叠工具块展示 (复用 tool_calls UI, 通过可选 agent_* 字段区分身份)。
 */

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

/** 会话上挂载的子智能体; kind 决定 id 指向 AgentDef 还是 WorkflowTemplate。 */
export interface AttachedExpert {
  kind: 'agent' | 'team';
  id: string;
}

/** 一条消息 */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** assistant 消息:显示用的身份; 主助手消息填 agent-main。 */
  agent_id?: string;
  agent_name?: string;
  agent_color?: string;
  content: string;
  /** 工具调用轨迹(assistant 消息可选带) */
  tool_calls?: ToolCallTrace[];
  /** 是否正在流式生成中 */
  streaming?: boolean;
  timestamp: string;
}

/**
 * 工具调用轨迹。
 *
 * 有两类:
 *   1) 普通工具 (search_kb / search_literature / verify_reference 等):
 *      tool 字段就是工具名, agent_* 字段留空。
 *   2) 子智能体调用 (专家/专家团): tool='invoke_expert', 同时带上
 *      agent_id / agent_name / agent_color 表明是"哪位专家在说话"。
 *      前端据 agent_id 存在与否切换到"🧩 调用了 X 专家"的折叠样式。
 */
export interface ToolCallTrace {
  tool: string;
  input: Record<string, any>;
  output_preview: string;
  /** 子智能体调用时非空,标识发言的专家身份 */
  agent_id?: string;
  agent_name?: string;
  agent_color?: string;
}

/** 一个会话 */
export interface ChatSession {
  id: string;
  title: string;
  /** 挂载的子智能体; 不挂载则为空。至多挂 1 个。 */
  attached_expert?: AttachedExpert;
  /** 启用的工具 */
  tools: string[];
  /** 挂载的技能 */
  skills: string[];
  /** 挂载的知识库 id 列表(search_kb 工具会在其范围内检索) */
  kb_ids?: string[];
  /** 主模型(空则继承全局) */
  model?: string;
  messages: ChatMessage[];
  /**
   * 若挂载 team 且已起任务, 指向 /api/tasks/:id 的 thread_id;
   * done 之后仍保留供回溯 (UI 会挂 "任务已完成" tag)。
   * 单专家挂载或未挂载时始终为空。
   */
  active_task_id?: string;
  created_at: string;
  updated_at: string;
}
