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
// 对齐 frontend/src/types/node.ts
//
// AgentID 用指针以便序列化为 JSON null(compute 节点才有意义)。
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
