package domain

// AttachedExpert 表示会话上挂载的子智能体(专家 or 专家团)。
// 至多挂 1 个;kind 决定 ID 指向 AgentDef 还是 WorkflowTemplate。
type AttachedExpert struct {
	Kind string `json:"kind"` // "agent" | "team"
	ID   string `json:"id"`
}

// ChatMessage 一条聊天消息。字段对齐 frontend/src/types/chat.ts:ChatMessage。
//
// AssistantMessage 的 agent_* 字段承载 "谁说的" 展示信息:
//   - 主助手消息:填 agent-main / 主助手 / #6b7a90
type ChatMessage struct {
	ID         string          `json:"id"`
	Role       string          `json:"role"` // user / assistant / system / tool
	AgentID    string          `json:"agent_id,omitempty"`
	AgentName  string          `json:"agent_name,omitempty"`
	AgentColor string          `json:"agent_color,omitempty"`
	Content    string          `json:"content"`
	ToolCalls  []ToolCallTrace `json:"tool_calls,omitempty"`
	Streaming  bool            `json:"streaming,omitempty"`
	Timestamp  string          `json:"timestamp"`
}

// ToolCallTrace 工具调用轨迹。
//
// 两种用法:
//   1) 普通工具 (search_kb / search_literature / verify_reference):Tool 是工具名,
//      Agent* 字段留空;
//   2) 子智能体调用:Tool = "invoke_expert",Agent* 字段填该专家的身份信息。
//      前端据 AgentID 是否非空切换到 "🧩 调用了 X 专家" 的折叠样式。
type ToolCallTrace struct {
	Tool          string         `json:"tool"`
	Input         map[string]any `json:"input"`
	OutputPreview string         `json:"output_preview"`
	AgentID       string         `json:"agent_id,omitempty"`
	AgentName     string         `json:"agent_name,omitempty"`
	AgentColor    string         `json:"agent_color,omitempty"`
}

// ChatSession 一个会话。字段对齐 frontend/src/types/chat.ts:ChatSession。
//
// Messages 是从 chat_messages 表按 idx 顺序拼出来的; GET /api/chat/sessions/:id 返回。
//
// ActiveTaskID: 若挂载 team 且已通过 /api/tasks 起了一个任务, 存 thread_id;
// 单专家挂载/未挂载时为空。任务 done 之后仍保留供回溯 (前端显示 "任务已完成" tag)。
type ChatSession struct {
	ID             string          `json:"id"`
	Title          string          `json:"title"`
	AttachedExpert *AttachedExpert `json:"attached_expert,omitempty"`
	ActiveTaskID   string          `json:"active_task_id,omitempty"`
	Tools          []string        `json:"tools"`
	Skills         []string        `json:"skills"`
	KBIDs          []string        `json:"kb_ids,omitempty"`
	Model          string          `json:"model,omitempty"`
	Messages       []ChatMessage   `json:"messages"`
	CreatedAt      string          `json:"created_at"`
	UpdatedAt      string          `json:"updated_at"`
}

// ChatSessionSummary GET /api/chat/sessions 列表用, 不带 messages。
type ChatSessionSummary struct {
	ID             string          `json:"id"`
	Title          string          `json:"title"`
	AttachedExpert *AttachedExpert `json:"attached_expert,omitempty"`
	ActiveTaskID   string          `json:"active_task_id,omitempty"`
	Model          string          `json:"model,omitempty"`
	CreatedAt      string          `json:"created_at"`
	UpdatedAt      string          `json:"updated_at"`
}
