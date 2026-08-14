import { create } from 'zustand';
import { SettingsApi } from '../api/settings';

/**
 * 全局应用状态:多套模型配置 + 当前激活的一套。
 *
 * S3 阶段:数据源换到后端 SQLite (settings 表, key='llm_prefs')。
 * - 应用启动时 useAppStore.loadFromBackend() 拉取一次
 * - 每次 add/update/delete/setActive 触发写回
 * - 切换 active 时同步 POST /api/settings/llm 让后端的 LLM ConfigManager 感知
 */

export type ProviderType = 'deepseek' | 'claude' | 'openai' | 'tongyi' | 'baidu' | 'zhipu' | 'dianciyuann' | 'custom';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ProviderType;
  model: string;
  apiKey: string;
  baseURL: string;
  runtime?: '云端' | '本地 Mac mini';
  /** P92: 测连接时透传给后端 /api/settings/llm/test,缺省 0.7 (与后端 env 默认一致) */
  temperature?: number;
}

interface AppState {
  activeConfigId: string;
  modelConfigs: ModelConfig[];
  loaded: boolean; // 从后端加载完成
  loadFromBackend: () => Promise<void>;
  addModelConfig: (config: Omit<ModelConfig, 'id'>) => string;
  updateModelConfig: (id: string, patch: Partial<ModelConfig>) => void;
  deleteModelConfig: (id: string) => void;
  setActiveConfigId: (id: string) => void;
}

// 默认预置(空 apiKey), 只在后端没存过时使用。
const getDefaultConfigs = (): ModelConfig[] => [
  {
    id: 'default-deepseek',
    name: 'DeepSeek',
    provider: 'deepseek',
    model: 'deepseek-chat',
    apiKey: '',
    baseURL: 'https://api.deepseek.com/v1',
    runtime: '云端',
  },
  {
    id: 'default-claude',
    name: 'Claude',
    provider: 'claude',
    model: 'claude-4-sonnet',
    apiKey: '',
    baseURL: 'https://api.anthropic.com/v1',
    runtime: '云端',
  },
  {
    id: 'default-openai',
    name: 'OpenAI',
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: '',
    baseURL: 'https://api.openai.com/v1',
  },
  {
    id: 'default-tongyi',
    name: '通义千问',
    provider: 'tongyi',
    model: 'qwen-plus',
    apiKey: '',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    id: 'default-baidu',
    name: '文心一言',
    provider: 'baidu',
    model: 'ernie-4.0-8k',
    apiKey: '',
    baseURL: 'https://api-doc.baidubce.com/compatible-mode/v1',
  },
  {
    id: 'default-dianciyuann',
    name: '典名词元',
    provider: 'dianciyuann',
    model: 'qwen3.6-plus',
    apiKey: '',
    baseURL: 'https://api.aa.com.cn/api/v1',
  },
];

export const providerPresets: Record<ProviderType, {
  label: string;
  defaultBaseURL: string;
  defaultModel: string;
}> = {
  deepseek: { label: 'DeepSeek', defaultBaseURL: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  claude: { label: 'Claude', defaultBaseURL: 'https://api.anthropic.com/v1', defaultModel: 'claude-4-sonnet' },
  openai: { label: 'OpenAI', defaultBaseURL: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  tongyi: { label: '通义千问', defaultBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
  zhipu: { label: '智谱清言', defaultBaseURL: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-plus' },
  baidu: { label: '文心一言', defaultBaseURL: 'https://api-doc.baidubce.com/compatible-mode/v1', defaultModel: 'ernie-4.0-8k' },
  dianciyuann: { label: '典名词元', defaultBaseURL: 'https://api.aa.com.cn/api/v1', defaultModel: 'qwen3.6-plus' },
  custom: { label: '自定义兼容', defaultBaseURL: '', defaultModel: '' },
};

/**
 * 触发后端应用当前 active 配置 (POST /api/settings/llm)。
 * apiKey 为空时后端会自动进入 Unavailable, 走 mock 回退, 不影响可用性。
 */
async function pushActiveToBackend(state: AppState) {
  const cfg = state.modelConfigs.find((c) => c.id === state.activeConfigId);
  if (!cfg) return;
  try {
    await SettingsApi.activateLlm({
      provider: cfg.provider,
      model: cfg.model,
      api_key: cfg.apiKey,
      base_url: cfg.baseURL,
    });
  } catch (e) {
    console.error('[settings] activateLlm failed:', e);
  }
}

/**
 * 把 { activeConfigId, modelConfigs } 整体 PUT 到 /api/settings/llm_prefs。
 * 用于跨端口 / 重启保留。
 */
async function persistPrefs(state: AppState) {
  try {
    await SettingsApi.putLlmPrefs({
      activeConfigId: state.activeConfigId,
      modelConfigs: state.modelConfigs,
    });
  } catch (e) {
    console.error('[settings] putLlmPrefs failed:', e);
  }
}

export const useAppStore = create<AppState>()((set, get) => ({
  activeConfigId: 'default-deepseek',
  modelConfigs: getDefaultConfigs(),
  loaded: false,

  async loadFromBackend() {
    try {
      const prefs = await SettingsApi.getLlmPrefs<{
        activeConfigId: string;
        modelConfigs: ModelConfig[];
      }>();
      if (prefs && Array.isArray(prefs.modelConfigs) && prefs.modelConfigs.length > 0) {
        set({
          activeConfigId: prefs.activeConfigId || prefs.modelConfigs[0].id,
          modelConfigs: prefs.modelConfigs,
          loaded: true,
        });
        // 应用启动后, 让后端的 LLM ConfigManager 也感知一次 (主要覆盖 dev 场景 ——
        // 后端启动时也会自己从 settings 读, 这里是保险)
        pushActiveToBackend(get());
      } else {
        // 后端没有 → 先把默认写过去一次, 保证之后是有权威来源的
        set({ loaded: true });
        persistPrefs(get());
      }
    } catch (e) {
      console.error('[settings] loadFromBackend failed:', e);
      set({ loaded: true }); // 即使失败也标记, 不阻塞 UI
    }
  },

  addModelConfig: (config) => {
    const id = `config-${Date.now()}`;
    set({ modelConfigs: [...get().modelConfigs, { ...config, id }] });
    persistPrefs(get());
    return id;
  },

  updateModelConfig: (id, patch) => {
    set({
      modelConfigs: get().modelConfigs.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
    persistPrefs(get());
    if (id === get().activeConfigId) {
      pushActiveToBackend(get());
    }
  },

  deleteModelConfig: (id) => {
    const remain = get().modelConfigs.filter((c) => c.id !== id);
    const activeStillOk = remain.some((c) => c.id === get().activeConfigId);
    set({
      modelConfigs: remain,
      activeConfigId: activeStillOk ? get().activeConfigId : remain[0]?.id ?? '',
    });
    persistPrefs(get());
    pushActiveToBackend(get());
  },

  setActiveConfigId: (id) => {
    set({ activeConfigId: id });
    persistPrefs(get());
    pushActiveToBackend(get());
  },
}));
