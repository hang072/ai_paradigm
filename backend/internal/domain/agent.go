package domain

import (
	"strings"
	"unicode/utf8"
)

// AgentDef 定义:一个可复用的智能体角色配置。
// 对齐 frontend/src/types/agent.ts。
//
// 阶段 1 扩展(2026-08-11):既有 10 字段保留,新增 4 个可选指针字段,
// 用 omitempty 序列化,旧数据 / 老客户端兼容。Normalize() 给指针补默认
// 非 nil 切片(避免 JSON 出去后下游 .Tools / .Methodology 报 nil)。
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

	// ─── 阶段 1 新增字段 ─────────────────────────────────────────────
	// 全部 omitempty,旧数据反序列化时为 nil;Normalize() 会补默认非 nil 切片。

	/** 一句话人设卡,与 description 解耦 */
	Persona string `json:"persona,omitempty"`
	/** 结构化方法论步骤(每条一句,动词开头) */
	Methodology []string `json:"methodology,omitempty"`
	/**
	 * 产物契约:每个产物键 → ArtifactOutputSpec
	 * 不存为 map[string]any(避免运行时断言),走命名结构体以便后端 validators 强类型化。
	 */
	OutputSchema map[string]ArtifactOutputSpec `json:"output_schema,omitempty"`
	/** 守门规则。指针 omitempty,旧数据保持 nil;Normalize() 不主动建非 nil 零值(避免语义误读) */
	Guardrails *AgentGuardrails `json:"guardrails,omitempty"`

	// ─── 阶段 6 新增字段(workbuddy 借鉴 · 2026-08-11)────────────────
	// 拟人化展示用。DisplayName 为空时 UI fallback 到 Name;Avatar 为空
	// 时 UI fallback 到首字。两字段都 omitempty,旧数据反序列化时为零值,
	// 兼容性 OK。

	/**
	 * UI 友好名,如 "许清楚 · 需求澄清官"。与 Name 解耦,Name 仍是机器
	 * 标识(系统 / 模板 binding 用),DisplayName 仅作展示。
	 */
	DisplayName string `json:"display_name,omitempty"`
	/**
	 * 1-4 字符头像(emoji 或中英文首字),前端 AgentAvatar 组件渲染。
	 * Normalize() 会截断 >4 codepoint 的长字符串并清空纯空白。
	 */
	Avatar string `json:"avatar,omitempty"`
}

/**
 * 单个产物的契约描述。对应前端 output_schema[artifactKey]。
 * Type:渲染方式;Schema:可选 JSON Schema 字符串(草案 7 原文,不二次解析避免运行时依赖)。
 */
type ArtifactOutputSpec struct {
	Type   string `json:"type"`             // "markdown" | "json" | "text"
	Schema string `json:"schema,omitempty"` // JSON Schema 原文,可选
}

/**
 * 守门规则。对应前端 guardrails。
 * - NoFabricate:严禁编造
 * - RequireCitations:关键论断必须带可点击引用
 * - EscalateTo:遇到该类问题转交其他专家(用 agent_id)
 * - RedLines:自由文本禁用项
 */
type AgentGuardrails struct {
	NoFabricate      bool     `json:"no_fabricate,omitempty"`
	RequireCitations bool     `json:"require_citations,omitempty"`
	EscalateTo       []string `json:"escalate_to,omitempty"`
	RedLines         []string `json:"red_lines,omitempty"`
}

func (a *AgentDef) GetID() string   { return a.ID }
func (a *AgentDef) IsBuiltin() bool { return a.Builtin }

// SetID 由 store 在生成 id 时回写。
func (a *AgentDef) SetID(id string) { a.ID = id }

// Normalize 补齐默认值,保证 JSON 出去时字段完整、切片非 nil。
// 对齐 frontend/src/api/mock/engine.ts createAgent 的默认策略。
//
// 阶段 1 变更:
//   - Tools 已有的"nil → []"逻辑保留
//   - Methodology:旧数据为 nil 时补为 [](避免下游 .Methodology 长度断言 nil)
//   - OutputSchema / Guardrails:旧数据为 nil 时补为非 nil 零值(同样避免 nil 断言)
//   - Guardrails.EscalateTo / RedLines:同样 nil → []
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
	// 阶段 1 新增字段的默认值
	if a.Methodology == nil {
		a.Methodology = []string{}
	}
	if a.OutputSchema == nil {
		a.OutputSchema = map[string]ArtifactOutputSpec{}
	}
	if a.Guardrails == nil {
		a.Guardrails = &AgentGuardrails{}
	}
	if a.Guardrails.EscalateTo == nil {
		a.Guardrails.EscalateTo = []string{}
	}
	if a.Guardrails.RedLines == nil {
		a.Guardrails.RedLines = []string{}
	}
	// 阶段 6 新增字段的边界处理:DisplayName 留空让前端 fallback 到 Name;
	// Avatar 截断 >4 codepoint 的字符串(覆盖 zWJ emoji 序列)并清空纯空白。
	a.Avatar = strings.TrimSpace(a.Avatar)
	if utf8.RuneCountInString(a.Avatar) > 4 {
		runes := []rune(a.Avatar)
		a.Avatar = string(runes[:1])
	}
}
