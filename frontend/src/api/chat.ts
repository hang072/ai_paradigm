import { client } from './client';
import type { AttachedExpert, ToolCallTrace } from '../types/chat';

/**
 * POST /api/chat/reply 的请求体。
 *
 * 新语义:请求始终由主助手承接。若 attached_expert 非空,主助手将其作为一个工具
 * (invoke_expert) 注册,由主助手自主决定何时调用。
 */
export interface ChatReplyInput {
  message: string;
  /** 挂载的子智能体; 空则纯通用助手回答。 */
  attached_expert?: AttachedExpert;
  tools: string[];
  skills: string[];
  /** 挂载的知识库 id 列表 */
  kb_ids?: string[];
  history?: { role: string; content: string }[];
}

/**
 * 主助手一次完整回复。
 *
 * 响应恒定为长度 1 的数组(保留数组仅为向前兼容 SSE 事件流形状)。
 * 子智能体调用作为 tool_calls 里带 agent_* 身份字段的条目挂载。
 */
export interface ChatReplyPart {
  agent_id: string;
  agent_name: string;
  agent_color: string;
  content: string;
  tool_calls: ToolCallTrace[];
}

/** 流式事件类型 */
export type StreamEventType = 'start' | 'chunk' | 'done' | 'error' | 'finish';

export interface StreamEvent {
  event: StreamEventType;
  data: any;
}

export const ChatApi = {
  reply: (input: ChatReplyInput) =>
    client.post<ChatReplyPart[]>('/api/chat/reply', input).then((r) => r.data),
};
