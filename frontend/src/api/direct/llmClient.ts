import type { ChatReplyInput, ChatReplyPart } from '../mock/engine';
import type { ModelConfig } from '../../store/useAppStore';
import { useAppStore } from '../../store/useAppStore';

/** Agent 信息 */
export interface AgentInfo {
  id: string;
  name: string;
  color: string;
}

/** OpenAI 兼容的消息格式 */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** OpenAI 兼容的请求格式 */
interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  stream?: boolean;
}

/** OpenAI 兼容的响应格式 */
interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  error?: {
    message: string;
  };
}

/**
 * 获取当前激活的模型配置 from store
 */
function getActiveConfig(): ModelConfig | null {
  const { modelConfigs, activeConfigId } = useAppStore.getState();
  return modelConfigs.find(c => c.id === activeConfigId) ?? null;
}

/**
 * 将输入转换为 OpenAI 兼容的 messages 数组
 */
function convertToOpenAIMessages(
  input: ChatReplyInput,
  agentInfo: AgentInfo
): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];

  // 添加历史对话
  if (input.history && input.history.length > 0) {
    for (const h of input.history) {
      messages.push({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      });
    }
  }

  // 添加 system 提示（可以用 agent 的 system prompt 如果有的话）
  // 这里先留空，让 LLM 直接回答用户问题
  // 如果 agent 有 system_prompt 可以加上，但是现在我们拿不到，所以只处理用户输入

  // 添加当前用户消息
  messages.push({
    role: 'user',
    content: input.message,
  });

  return messages;
}

/**
 * 直接调用 LLM API（OpenAI 兼容格式）
 */
async function callOpenAIAPI(
  config: ModelConfig,
  messages: OpenAIMessage[]
): Promise<string> {
  // 如果 baseURL 已经以 chat/completions 结尾，直接使用
  // 否则自动拼接 /chat/completions
  let url: string;
  if (config.baseURL.endsWith('/chat/completions')) {
    url = config.baseURL;
  } else {
    const baseURL = config.baseURL.endsWith('/')
      ? config.baseURL
      : config.baseURL + '/';
    url = `${baseURL}chat/completions`;
  }

  const requestBody: OpenAIRequest = {
    model: config.model,
    messages: messages,
    temperature: 0.7,
    stream: false, // MVP 先用非流式
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errJson = await response.json() as any;
        if (errJson.error?.message) {
          errorMsg = errJson.error.message;
        } else if (errJson.detail) {
          errorMsg = errJson.detail;
        }
      } catch (_) {
        // ignore
      }
      throw new Error(errorMsg);
    }

    const data: OpenAIResponse = await response.json();

    if (data.error?.message) {
      throw new Error(data.error.message);
    }

    if (!data.choices || data.choices.length === 0) {
      throw new Error('LLM 返回空响应');
    }

    return data.choices[0].message.content.trim();
  } catch (e: any) {
    if (e.name === 'AbortError') {
      throw new Error('请求超时（60秒），请检查网络或稍后重试');
    }
    // Failed to fetch 通常是 CORS 问题
    if (e.message === 'Failed to fetch') {
      throw new Error(
        'Failed to fetch (跨域问题/CORS)。\\n' +
        '很多 LLM 服务商不允许浏览器直接跨域调用。\\n' +
        '请确认：\\n' +
        '1. Base URL 是否正确（应该是包含 /v1 的地址）\\n' +
        '2. 服务商是否允许浏览器跨域访问\\n' +
        '3. 如果需要代理，请配置代理后的 Base URL'
      );
    }
    throw e;
  }
}

/**
 * 直接调用 LLM 生成聊天回复
 * 对外暴露给 mock 路由调用
 */
export async function callDirectChatReply(
  input: ChatReplyInput,
  agentInfo: AgentInfo,
  config: ModelConfig
): Promise<ChatReplyPart[]> {
  try {
    const messages = convertToOpenAIMessages(input, agentInfo);
    const content = await callOpenAIAPI(config, messages);

    return [{
      agent_id: agentInfo.id,
      agent_name: agentInfo.name,
      agent_color: agentInfo.color,
      content,
      tool_calls: [], // MVP 暂不支持工具调用
    }];
  } catch (e: any) {
    // 错误返回给用户看
    return [{
      agent_id: 'system',
      agent_name: '系统错误',
      agent_color: '#cf1322',
      content: `❌ LLM 调用失败: ${e.message}`,
      tool_calls: [],
    }];
  }
}

