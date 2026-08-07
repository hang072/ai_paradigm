package domain

// AgentDef 定义:一个可复用的智能体角色配置。
// 对齐 frontend/src/types/agent.ts
type AgentDef struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	SystemPrompt   string   `json:"system_prompt"`
	Tools          []string `json:"tools"` // "search_literature" / "verify_reference" / "search_kb"
	LLMModel       string   `json:"llm_model"`
	RecursionLimit int      `json:"recursion_limit"`
	Color          string   `json:"color"`
	Runtime        string   `json:"runtime,omitempty"` // "云端" / "本地 Mac mini"
	Builtin        bool     `json:"builtin,omitempty"`
}

func (a *AgentDef) GetID() string   { return a.ID }
func (a *AgentDef) IsBuiltin() bool { return a.Builtin }

// SetID 由 store 在生成 id 时回写。
func (a *AgentDef) SetID(id string) { a.ID = id }

// Normalize 补齐默认值,保证 JSON 出去时字段完整、切片非 nil。
// 对齐 frontend/src/api/mock/engine.ts createAgent 的默认策略。
func (a *AgentDef) Normalize() {
	if a.Tools == nil {
		a.Tools = []string{}
	}
	if a.LLMModel == "" {
		a.LLMModel = "default"
	}
	if a.RecursionLimit == 0 {
		a.RecursionLimit = 40
	}
	if a.Color == "" {
		a.Color = "#2b57d6"
	}
	if a.Runtime == "" {
		a.Runtime = "云端"
	}
}
