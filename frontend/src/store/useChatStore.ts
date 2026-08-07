import { create } from 'zustand';
import { nanoid } from 'nanoid';
import dayjs from 'dayjs';
import type { ChatMessage, ChatSession } from '../types/chat';
import { ChatSessionsApi } from '../api/chatSessions';

/**
 * 会话 store —— 后端持久化 (SQLite)。
 *
 * 与旧版对比:
 *   - 去掉 zustand persist(localStorage), 数据源改为后端 /api/chat/sessions/*
 *   - 保留内存镜像 (sessions[]) 供 UI 响应式渲染, 每次改动同步落库
 *   - 首次进入页面调用 loadAll() 拉列表, 选中某个会话时调 loadSession(id) 拉全量消息
 *
 * 写入策略 (乐观更新):
 *   - append/patch 消息:先更新本地, 再异步 POST 到后端。失败时打日志, UI 不回滚
 *     (原因:失败通常是网络暂断, 下次 loadSession 会以后端为准同步回来)。
 *   - 更新会话头字段:同样先本地再服务端。
 */

interface ChatState {
  sessions: ChatSession[];
  activeId: string | null;
  loading: boolean;

  loadAll: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  createSession: (init?: Partial<ChatSession>) => Promise<string>;
  selectSession: (id: string | null) => void;
  updateSession: (id: string, patch: Partial<ChatSession>) => Promise<void>;
  appendMessage: (id: string, msg: ChatMessage) => Promise<void>;
  patchMessage: (sessionId: string, msgId: string, patch: Partial<ChatMessage>) => void;
  removeMessage: (sessionId: string, msgId: string) => void;
  removeSession: (id: string) => Promise<void>;
  clearMessages: (id: string) => Promise<void>;
}

function nowStr() {
  return dayjs().format('YYYY-MM-DD HH:mm:ss');
}

export function makeMessage(
  role: ChatMessage['role'],
  content: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: 'msg-' + nanoid(8),
    role,
    content,
    timestamp: nowStr(),
    ...extra,
  };
}

const defaultSession = (patch: Partial<ChatSession>): ChatSession => ({
  id: 'chat-' + nanoid(8),
  title: '新会话',
  attached_expert: undefined,
  active_task_id: undefined,
  tools: [],
  skills: [],
  kb_ids: [],
  model: undefined,
  messages: [],
  created_at: nowStr(),
  updated_at: nowStr(),
  ...patch,
});

export const useChatStore = create<ChatState>()((set, get) => ({
  sessions: [],
  activeId: null,
  loading: false,

  async loadAll() {
    set({ loading: true });
    try {
      let summaries = await ChatSessionsApi.list();

      // 一次性迁移:清空所有旧格式会话 (旧格式 = 有 mode 字段 / 无 attached_expert 字段)。
      // 2026-07-23 前的会话都属于旧格式,新格式不再有 mode,故这一段本质上是"清空所有旧数据"。
      // 一旦所有会话都是新格式,后续调用是 no-op。
      const legacy = summaries.filter(isLegacySummary);
      if (legacy.length > 0) {
        console.info(`[chat] 清理 ${legacy.length} 条旧格式会话`);
        await Promise.allSettled(legacy.map((s) => ChatSessionsApi.remove(s.id)));
        summaries = summaries.filter((s) => !isLegacySummary(s));
        // 顺便清一下 zustand persist 可能留下的旧 key(历史遗物,不确定用户是否有)
        try {
          window.localStorage.removeItem('paradigm.chat.v1');
        } catch {
          /* ignore */
        }
      }

      // 保留已加载会话的 messages, 避免刷列表时把已展开的消息清空
      const prev = get().sessions;
      const prevMap = new Map(prev.map((s) => [s.id, s]));
      const merged: ChatSession[] = summaries.map((sum) => {
        const existing = prevMap.get(sum.id);
        return {
          id: sum.id,
          title: sum.title,
          attached_expert: sum.attached_expert,
          active_task_id: sum.active_task_id,
          model: sum.model,
          tools: existing?.tools ?? [],
          skills: existing?.skills ?? [],
          kb_ids: existing?.kb_ids ?? [],
          messages: existing?.messages ?? [],
          created_at: sum.created_at,
          updated_at: sum.updated_at,
        };
      });
      set({ sessions: merged });
    } catch (e) {
      console.error('[chat] loadAll failed:', e);
    } finally {
      set({ loading: false });
    }
  },

  async loadSession(id) {
    try {
      const full = await ChatSessionsApi.get(id);
      set((prev) => ({
        sessions: prev.sessions.map((s) => (s.id === id ? full : s)),
      }));
    } catch (e) {
      console.error('[chat] loadSession failed:', e);
    }
  },

  async createSession(init) {
    const s = defaultSession(init ?? {});
    // 乐观:先塞进本地
    set((prev) => ({ sessions: [s, ...prev.sessions], activeId: s.id }));
    try {
      const saved = await ChatSessionsApi.upsert(s);
      set((prev) => ({
        sessions: prev.sessions.map((x) => (x.id === saved.id ? saved : x)),
      }));
    } catch (e) {
      console.error('[chat] createSession failed:', e);
    }
    return s.id;
  },

  selectSession(id) {
    set({ activeId: id });
    // 顺便拉一下最新消息 (loadSession 内部处理错误)
    if (id) {
      get().loadSession(id);
    }
  },

  async updateSession(id, patch) {
    set((prev) => ({
      sessions: prev.sessions.map((s) =>
        s.id === id ? { ...s, ...patch, updated_at: nowStr() } : s,
      ),
    }));
    try {
      await ChatSessionsApi.update(id, patch);
    } catch (e) {
      console.error('[chat] updateSession failed:', e);
    }
  },

  async appendMessage(id, msg) {
    // 幂等: 若同 id 消息已存在,视作 no-op。避免 React 报"两个孩子相同 key"警告 ——
    // 常见触发路径:poll tick 因时序原因同一终态消息 (msg-done/msg-cancelled/msg-failed)
    // 被 append 两次; 或 loadSession 从后端拉回后又本地 append。
    const existing = get().sessions.find((s) => s.id === id);
    if (existing && existing.messages.some((m) => m.id === msg.id)) {
      return;
    }
    set((prev) => ({
      sessions: prev.sessions.map((s) =>
        s.id === id
          ? {
              ...s,
              messages: [...s.messages, msg],
              updated_at: nowStr(),
              // 首条 user 消息自动作为标题
              title:
                s.messages.length === 0 && msg.role === 'user'
                  ? msg.content.slice(0, 20) || s.title
                  : s.title,
            }
          : s,
      ),
    }));
    // 只把非流式消息落库。流式消息(streaming=true)先在内存,
    // 流结束后由 persistFinalizedMessage 一次性写库。
    if (msg.streaming) return;
    if (msg.role === 'assistant' && !msg.content) return;
    await appendMessageWithSessionRepair(id, msg, get);
  },

  patchMessage(sessionId, msgId, patch) {
    // patchMessage 是流式过程中的高频调用, 只更新内存;
    // 结束后调用 persistFinalizedMessage 一次性写库。
    set((prev) => ({
      sessions: prev.sessions.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              messages: s.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
              updated_at: nowStr(),
            }
          : s,
      ),
    }));
  },

  removeMessage(sessionId, msgId) {
    // 仅内存删除 —— 用于移除从未落库的临时气泡 (如 phase spinner)。
    set((prev) => ({
      sessions: prev.sessions.map((s) =>
        s.id === sessionId
          ? { ...s, messages: s.messages.filter((m) => m.id !== msgId) }
          : s,
      ),
    }));
  },

  async removeSession(id) {
    set((prev) => ({
      sessions: prev.sessions.filter((s) => s.id !== id),
      activeId: prev.activeId === id ? null : prev.activeId,
    }));
    try {
      await ChatSessionsApi.remove(id);
    } catch (e) {
      console.error('[chat] removeSession failed:', e);
    }
  },

  async clearMessages(id) {
    set((prev) => ({
      sessions: prev.sessions.map((s) => (s.id === id ? { ...s, messages: [] } : s)),
    }));
    try {
      await ChatSessionsApi.clearMessages(id);
    } catch (e) {
      console.error('[chat] clearMessages failed:', e);
    }
  },
}));

/**
 * 把一条已经流式完成的消息写到后端。
 *
 * 与 patchMessage 分开的原因:patchMessage 每收一 chunk 触发一次 setState,
 * 频率非常高, 不适合每次都打网络请求。改用 "流结束后手动 flush 一次" 的模式。
 */
export async function persistFinalizedMessage(sessionId: string, msg: ChatMessage) {
  await appendMessageWithSessionRepair(sessionId, msg, useChatStore.getState);
}

/**
 * 追加消息, 如果后端返回 404 (会话未持久化) 则先 upsert 会话再重试一次。
 *
 * 场景:用户快速点了 "新建会话" 后立刻发消息, createSession 的 POST 还没落库,
 * appendMessages 就来了。乐观 UX 下不该给用户看到失败。
 */
async function appendMessageWithSessionRepair(
  sessionId: string,
  msg: ChatMessage,
  getState: () => ChatState,
) {
  try {
    await ChatSessionsApi.appendMessages(sessionId, [msg]);
    return;
  } catch (e: any) {
    const is404 = e?.cause?.response?.status === 404 || /不存在/.test(e?.message ?? '');
    if (!is404) {
      console.error('[chat] appendMessages failed:', e);
      return;
    }
  }
  // 修复:先 upsert 会话头, 再重试
  const local = getState().sessions.find((s) => s.id === sessionId);
  if (!local) {
    console.error('[chat] appendMessages 404 but no local session either');
    return;
  }
  try {
    await ChatSessionsApi.upsert({ ...local, messages: [] });
    await ChatSessionsApi.appendMessages(sessionId, [msg]);
  } catch (e2) {
    console.error('[chat] appendMessages retry after upsert failed:', e2);
  }
}

export function getActiveSession(state: ChatState): ChatSession | null {
  return state.sessions.find((s) => s.id === state.activeId) ?? null;
}

/**
 * 判定一个会话摘要是否是重构前的旧格式。
 *
 * 旧格式的标志:后端仍返回 mode='single'|'team'。新格式返回 attached_expert(可能 null),
 * 并且 mode 字段不存在。这里两条兜底:
 *   - 有 mode 字段 → 一定旧
 *   - 无 attached_expert 且无 mode → 也可能是旧后端刚清库,保守起见按新格式对待
 */
function isLegacySummary(sum: { mode?: string; attached_expert?: unknown }): boolean {
  return typeof sum.mode === 'string' && sum.mode.length > 0;
}
