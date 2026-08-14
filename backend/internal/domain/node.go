package domain

// NodeKind 枚举 —— 工作流节点的四种类型。
type NodeKind string

const (
	NodeKindCompute   NodeKind = "compute"
	NodeKindInterrupt NodeKind = "interrupt"
	NodeKindCounter   NodeKind = "counter"
	NodeKindRouter    NodeKind = "router"
)

// NodeDef 定义:工作流图上的一个节点原型。
// 对齐 frontend/src/types/node.ts。
//
// 阶段 1 扩展(2026-08-11):Config 仍为自由 map[string]any(保持既有用法,
// 阶段 3 才由 GenericStep 消费)。约定键见 NodeDefConfigConventionKeys 列表;
// 模板编辑器与 Planner 看到这些键可做更友好的 UI;运行时无 schema 强制。
type NodeDef struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Kind        NodeKind       `json:"kind"`
	AgentID     *string        `json:"agent_id"`
	Description string         `json:"description"`
	Config      map[string]any `json:"config"`
	OutPorts    []string       `json:"out_ports"`
	Color       string         `json:"color"`
}

// NodeDefConfigConventionKeys 列出 builtin 节点 + 阶段 3/4 即将消费的约定键。
// 不强制,只是给编辑器 / Planner 做静态校验时的白名单参考。
// 真实实现:阶段 3 引入 GenericStepRegistry 严格校验,阶段 1 只做 UI 提示。
var NodeDefConfigConventionKeys = []string{
	"system_prompt_template", // 覆盖 AgentDef.system_prompt
	"input_keys",             // 从 snapshot 读输入字段
	"output_keys",            // 写 artifact 时的 key
	"retrieve_kb",            // 是否启用 search_kb
	"retrieve_pubmed",        // PubMed 检索
	"cite_rule",              // markdown / numbered / none
}

func (n *NodeDef) GetID() string   { return n.ID }
func (n *NodeDef) IsBuiltin() bool { return false } // 前端 mock 对齐:node 无 builtin 保护
func (n *NodeDef) SetID(id string) { n.ID = id }

// Normalize 补齐默认值。
func (n *NodeDef) Normalize() {
	if n.Config == nil {
		n.Config = map[string]any{}
	}
	if n.OutPorts == nil {
		n.OutPorts = []string{"next"}
	}
	if n.Color == "" {
		n.Color = "#2b57d6"
	}
	if n.Kind == "" {
		n.Kind = NodeKindCompute
	}
}

// Ptr 是 *string 字面量辅助函数。fixture 里给 AgentID 赋值用。
func Ptr[T any](v T) *T { return &v }
