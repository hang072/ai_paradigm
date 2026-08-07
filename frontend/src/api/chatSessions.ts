import { client } from './client';
import type { AttachedExpert, ChatMessage, ChatSession } from '../types/chat';

/**
 * 会话持久化 API。
 *
 * 后端存 SQLite; 前端拿到的 ChatSession 里 messages 是完整历史。
 * mock 模式下 (VITE_USE_MOCK != false) 由 frontend/src/api/mock/index.ts 拦截,
 * 内存实现供离线开发使用 (刷新丢)。
 */

export interface ChatSessionSummary {
  id: string;
  title: string;
  attached_expert?: AttachedExpert;
  active_task_id?: string;
  model?: string;
  created_at: string;
  updated_at: string;
  /** 遗留字段, 仅用于识别旧数据; 新代码不写入。 */
  mode?: string;
}

export const ChatSessionsApi = {
  async list(): Promise<ChatSessionSummary[]> {
    const r = await client.get('/api/chat/sessions');
    return r.data ?? [];
  },

  async get(id: string): Promise<ChatSession> {
    const r = await client.get(`/api/chat/sessions/${encodeURIComponent(id)}`);
    return r.data;
  },

  /** 创建 (或全量 upsert) 一个会话。body 里可选带 messages 用于迁移。 */
  async upsert(session: Partial<ChatSession> & { id: string }): Promise<ChatSession> {
    const r = await client.post('/api/chat/sessions', session);
    return r.data;
  },

  /** 只更新会话头部 (title / attached_expert / tools / skills / kb_ids / model)。 */
  async update(id: string, patch: Partial<ChatSession>): Promise<ChatSession> {
    const r = await client.put(`/api/chat/sessions/${encodeURIComponent(id)}`, patch);
    return r.data;
  },

  async remove(id: string): Promise<void> {
    await client.delete(`/api/chat/sessions/${encodeURIComponent(id)}`);
  },

  async appendMessages(id: string, messages: ChatMessage[]): Promise<void> {
    await client.post(`/api/chat/sessions/${encodeURIComponent(id)}/messages`, { messages });
  },

  async clearMessages(id: string): Promise<void> {
    await client.delete(`/api/chat/sessions/${encodeURIComponent(id)}/messages`);
  },
};
