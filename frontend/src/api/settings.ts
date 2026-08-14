import { client } from './client';

/**
 * 用户偏好设置的服务端持久化 API。
 *
 * 后端存 SQLite settings 表(KV), value 是 JSON string, 前端形状可自由演进。
 * llm_prefs 存 { activeConfigId, modelConfigs }, 替代之前的 localStorage 方案。
 */

export const SettingsApi = {
  /** 读取 LLM 偏好, 未设过返回 null。 */
  async getLlmPrefs<T = unknown>(): Promise<T | null> {
    const r = await client.get('/api/settings/llm_prefs');
    return r.data ?? null;
  },

  /** 写入 LLM 偏好 (整个覆盖)。 */
  async putLlmPrefs<T = unknown>(prefs: T): Promise<void> {
    await client.put('/api/settings/llm_prefs', prefs);
  },

  /** 兼容旧接口:通知后端切换当前 provider (供聊天与任务 compute 节点使用)。 */
  async activateLlm(cfg: {
    provider: string;
    model: string;
    api_key: string;
    base_url?: string;
    temperature?: number;
  }): Promise<{ available: boolean; name: string }> {
    const r = await client.post('/api/settings/llm', cfg);
    return r.data;
  },
};

/** /api/settings/llm/test 真连通性探测的响应。 */
export interface TestLlmResult {
  ok: boolean;
  available: boolean;
  error?: string;
  name?: string;
}

/** 后端真连通性探测(POST /api/settings/llm/test)。
 *
 * 走原生 fetch 而非 axios client: client 命中 installMockAdapter() 后所有 /api/* 都被
 * 拦截,真后端不可达 — 这里必须直连。VITE_API_BASE 缺省 127.0.0.1:8001。
 */
export const testLlmConnection = async (cfg: {
  provider: string;
  model: string;
  api_key: string;
  base_url?: string;
  temperature?: number;
}): Promise<TestLlmResult> => {
  const rawBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://127.0.0.1:8001';
  const base = rawBase.replace(/\/$/, '');
  const r = await fetch(`${base}/api/settings/llm/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return { ok: false, available: false, error: t || `HTTP ${r.status}` };
  }
  return (await r.json()) as TestLlmResult;
};
