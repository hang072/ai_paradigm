import type { AxiosAdapter, AxiosPromise, AxiosRequestConfig, AxiosResponse } from 'axios';
import { client } from '../client';
import * as engine from './engine';
import type { TaskSpec, TaskType } from '../../types/task';
import type { ModelConfig } from '../../store/useAppStore';
import { useAppStore } from '../../store/useAppStore';
import {
  callDirectChatReply,
} from '../direct/llmClient';

/**
 * 简易 axios adapter:根据 URL 分发到 engine 函数,像真实 HTTP 一样返回 { data, status }。
 * 只处理 /api/* 前缀,其他放行。
 */

interface Handler {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  match: RegExp;
  handle: (m: RegExpMatchArray, body: any) => any;
}

const routes: Handler[] = [
  // Agents
  { method: 'GET', match: /^\/api\/agents\/?$/, handle: () => engine.listAgents() },
  { method: 'GET', match: /^\/api\/agents\/(.+)$/, handle: (m) => requireEntity(engine.getAgent(m[1]), 'Agent') },
  { method: 'POST', match: /^\/api\/agents\/?$/, handle: (_m, b) => engine.createAgent(b) },
  {
    method: 'PUT',
    match: /^\/api\/agents\/(.+)$/,
    handle: (m, b) => engine.updateAgent(m[1], b),
  },
  { method: 'DELETE', match: /^\/api\/agents\/(.+)$/, handle: (m) => (engine.deleteAgent(m[1]), { ok: true }) },

  // Nodes
  { method: 'GET', match: /^\/api\/nodes\/?$/, handle: () => engine.listNodes() },
  { method: 'GET', match: /^\/api\/nodes\/(.+)$/, handle: (m) => requireEntity(engine.getNode(m[1]), 'Node') },
  { method: 'POST', match: /^\/api\/nodes\/?$/, handle: (_m, b) => engine.createNode(b) },
  { method: 'PUT', match: /^\/api\/nodes\/(.+)$/, handle: (m, b) => engine.updateNode(m[1], b) },
  { method: 'DELETE', match: /^\/api\/nodes\/(.+)$/, handle: (m) => (engine.deleteNode(m[1]), { ok: true }) },

  // Templates
  { method: 'GET', match: /^\/api\/templates\/?$/, handle: () => engine.listTemplates() },
  { method: 'GET', match: /^\/api\/templates\/(.+)$/, handle: (m) => requireEntity(engine.getTemplate(m[1]), 'Template') },
  { method: 'POST', match: /^\/api\/templates\/?$/, handle: (_m, b) => engine.createTemplate(b) },
  { method: 'PUT', match: /^\/api\/templates\/(.+)$/, handle: (m, b) => engine.updateTemplate(m[1], b) },
  { method: 'DELETE', match: /^\/api\/templates\/(.+)$/, handle: (m) => (engine.deleteTemplate(m[1]), { ok: true }) },

  // Skills
  { method: 'GET', match: /^\/api\/skills\/?$/, handle: () => engine.listSkills() },
  { method: 'GET', match: /^\/api\/skills\/(.+)$/, handle: (m) => requireEntity(engine.getSkill(m[1]), 'Skill') },
  { method: 'POST', match: /^\/api\/skills\/?$/, handle: (_m, b) => engine.createSkill(b) },
  { method: 'PUT', match: /^\/api\/skills\/(.+)$/, handle: (m, b) => engine.updateSkill(m[1], b) },
  { method: 'DELETE', match: /^\/api\/skills\/(.+)$/, handle: (m) => (engine.deleteSkill(m[1]), { ok: true }) },

  // Knowledge Base(顺序:先精确的子路由,再泛路由)
  { method: 'GET', match: /^\/api\/kb\/?$/, handle: () => engine.listKbs() },
  {
    method: 'POST',
    match: /^\/api\/kb\/search$/,
    handle: (_m, b) => engine.searchKb(String(b?.query ?? ''), Array.isArray(b?.kb_ids) ? b.kb_ids : []),
  },
  { method: 'POST', match: /^\/api\/kb\/?$/, handle: (_m, b) => engine.createKb(b) },
  {
    method: 'POST',
    match: /^\/api\/kb\/([^/]+)\/docs$/,
    handle: (m, b) => engine.addKbDoc(m[1], b),
  },
  {
    method: 'PUT',
    match: /^\/api\/kb\/([^/]+)\/docs\/([^/]+)$/,
    handle: (m, b) => engine.updateKbDoc(m[1], m[2], b),
  },
  {
    method: 'DELETE',
    match: /^\/api\/kb\/([^/]+)\/docs\/([^/]+)$/,
    handle: (m) => (engine.removeKbDoc(m[1], m[2]), { ok: true }),
  },
  { method: 'GET', match: /^\/api\/kb\/([^/]+)$/, handle: (m) => requireEntity(engine.getKb(m[1]), 'KnowledgeBase') },
  { method: 'PUT', match: /^\/api\/kb\/([^/]+)$/, handle: (m, b) => engine.updateKb(m[1], b) },
  { method: 'DELETE', match: /^\/api\/kb\/([^/]+)$/, handle: (m) => (engine.deleteKb(m[1]), { ok: true }) },

  // Chat: 主助手 + 可选子智能体调用。若配置了 API key 则主助手正文由真实 LLM 生成,
  // 否则完全走 mock 引擎(engine.generateChatReply)。
  // 子智能体调用轨迹(如果触发)都由 engine 的启发式产生 —— 真跑子 LLM 交给 backend。
  {
    method: 'POST',
    match: /^\/api\/chat\/reply$/,
    handle: async (_m, b) => {
      const input = b as engine.ChatReplyInput;
      const { modelConfigs, activeConfigId } = useAppStore.getState();
      const activeConfig: ModelConfig | undefined =
        modelConfigs.find(c => c.id === activeConfigId);

      // 无 apiKey → 完全走 mock (启发式主助手 + 可能的子调用)
      if (!activeConfig || !activeConfig.apiKey?.trim()) {
        return engine.generateChatReply(input);
      }

      // 有 apiKey → 混合:mock 拿一份包含子调用 tool_calls 的 part, 然后用真实 LLM
      // 覆盖主助手的正文文本。子调用的具体输出仍是 mock 的启发式内容 (不真跑子 LLM)。
      const [mockPart] = engine.generateChatReply(input);
      const mainAgentInfo = {
        id: mockPart.agent_id,
        name: mockPart.agent_name,
        color: mockPart.agent_color,
      };
      const llmParts = await callDirectChatReply(input, mainAgentInfo, activeConfig);
      const llmContent = llmParts[0]?.content ?? mockPart.content;
      return [
        {
          ...mockPart,
          content: llmContent,
        },
      ];
    },
  },

  // Tasks
  { method: 'GET', match: /^\/api\/tasks\/?$/, handle: () => engine.listTasks() },
  {
    method: 'POST',
    match: /^\/api\/tasks\/?$/,
    handle: (_m, b) =>
      engine.startTask({
        brief: String(b?.brief ?? ''),
        task_type: b?.task_type as TaskType,
        title: b?.title,
        template_id: b?.template_id,
        spec: b?.spec as TaskSpec | null,
      }),
  },
  {
    method: 'POST',
    match: /^\/api\/tasks\/([^/]+)\/resume$/,
    handle: (m, b) => engine.resumeTask(m[1], String(b?.answer ?? '')),
  },
  {
    method: 'POST',
    match: /^\/api\/tasks\/([^/]+)\/cancel$/,
    handle: (m) => engine.cancelTask(m[1]),
  },
  {
    method: 'POST',
    match: /^\/api\/tasks\/([^/]+)\/spec$/,
    handle: (m, b) => engine.updateSpec(m[1], b?.spec as TaskSpec),
  },
  { method: 'GET', match: /^\/api\/tasks\/(.+)$/, handle: (m) => engine.getTask(m[1]) },

  // Chat sessions (顺序:先精确子路由再泛路由)
  { method: 'GET', match: /^\/api\/chat\/sessions\/?$/, handle: () => engine.listChatSessions() },
  { method: 'POST', match: /^\/api\/chat\/sessions\/?$/, handle: (_m, b) => engine.upsertChatSession(b) },
  {
    method: 'POST',
    match: /^\/api\/chat\/sessions\/([^/]+)\/messages$/,
    handle: (m, b) => engine.appendChatMessages(m[1], Array.isArray(b?.messages) ? b.messages : []),
  },
  {
    method: 'DELETE',
    match: /^\/api\/chat\/sessions\/([^/]+)\/messages$/,
    handle: (m) => (engine.clearChatMessages(m[1]), { ok: true }),
  },
  { method: 'GET', match: /^\/api\/chat\/sessions\/([^/]+)$/, handle: (m) => requireEntity(engine.getChatSession(m[1]), 'ChatSession') },
  { method: 'PUT', match: /^\/api\/chat\/sessions\/([^/]+)$/, handle: (m, b) => engine.updateChatSession(m[1], b) },
  { method: 'DELETE', match: /^\/api\/chat\/sessions\/([^/]+)$/, handle: (m) => (engine.deleteChatSession(m[1]), { ok: true }) },

  // Settings: llm_prefs 用 engine 里的内存 KV; llm 兼容旧路由返回可用性
  {
    method: 'GET',
    match: /^\/api\/settings\/llm_prefs$/,
    handle: () => engine.getSetting('llm_prefs'),
  },
  {
    method: 'PUT',
    match: /^\/api\/settings\/llm_prefs$/,
    handle: (_m, b) => (engine.setSetting('llm_prefs', b), { ok: true }),
  },
  {
    method: 'GET',
    match: /^\/api\/settings\/llm$/,
    handle: () => ({ available: false, name: 'mock (frontend)' }),
  },
  {
    method: 'POST',
    match: /^\/api\/settings\/llm$/,
    handle: () => ({ ok: true, available: false, name: 'mock (frontend)' }),
  },
];

function requireEntity<T>(v: T | undefined, kind: string): T {
  if (v == null) {
    const err: any = new Error(`${kind} 不存在`);
    err.status = 404;
    throw err;
  }
  return v;
}

const mockAdapter: AxiosAdapter = (config: AxiosRequestConfig): AxiosPromise => {
  const url = config.url ?? '';
  const method = (config.method ?? 'get').toUpperCase() as Handler['method'];
  const body = parseBody(config.data);

  return new Promise((resolve, reject) => {
    // 轻微延迟,更像真实网络
    setTimeout(() => {
      try {
        // 只拦截 /api/*
        if (!url.startsWith('/api')) {
          reject(new Error('mock: 非 /api 请求未处理'));
          return;
        }
        for (const r of routes) {
          if (r.method !== method) continue;
          const m = url.match(r.match);
          if (m) {
            const data = r.handle(m, body);
            const res: AxiosResponse = {
              data,
              status: 200,
              statusText: 'OK',
              headers: {},
              config: config as any,
            };
            resolve(res);
            return;
          }
        }
        const err: any = new Error(`mock: 未匹配路由 ${method} ${url}`);
        err.status = 404;
        throw err;
      } catch (e: any) {
        const status = e.status ?? 500;
        const res: AxiosResponse = {
          data: { detail: e.message ?? String(e) },
          status,
          statusText: e.message ?? 'error',
          headers: {},
          config: config as any,
        };
        // axios 期待非 2xx 走 reject,才能让业务代码走 catch
        (e as any).response = res;
        reject(e);
      }
    }, 80);
  });
};

function parseBody(raw: unknown): any {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export function installMockAdapter(): void {
  const enabled = import.meta.env.VITE_USE_MOCK !== 'false';
  if (!enabled) {
    // 关闭 mock,axios 走默认 http adapter
    return;
  }
  client.defaults.adapter = mockAdapter;

  console.info('[paradigm-eino] Mock 引擎已启用。对话将使用配置的真实 LLM。');
}
