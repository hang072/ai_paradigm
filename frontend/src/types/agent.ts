/**
 * Agent 定义:一个可复用的智能体角色配置。
 * 对齐 paradigm_langgraph 后端 dataclass。
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
}
