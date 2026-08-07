package domain

// NodeInstance 是模板里的一个节点实例(指向 NodeDef)。
// 对齐 frontend/src/types/template.ts
//
// X/Y 坐标 fixture 阶段不给,序列化用 omitempty 隐藏。
type NodeInstance struct {
	ID   string   `json:"id"`
	Type string   `json:"type"` // NodeDef.id
	X    *float64 `json:"x,omitempty"`
	Y    *float64 `json:"y,omitempty"`
}

// EdgeInstance 是模板里的一条边。
type EdgeInstance struct {
	From string `json:"from"`
	To   string `json:"to"`
	Port string `json:"port"`
}

// WorkflowTemplate 工作流模板:节点 + 边 的一个可复用编排。
type WorkflowTemplate struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Tags        []string       `json:"tags"`
	Entry       string         `json:"entry"`
	Nodes       []NodeInstance `json:"nodes"`
	Edges       []EdgeInstance `json:"edges"`
	Builtin     bool           `json:"builtin"`
}

func (t *WorkflowTemplate) GetID() string   { return t.ID }
func (t *WorkflowTemplate) IsBuiltin() bool { return t.Builtin }
func (t *WorkflowTemplate) SetID(id string) { t.ID = id }

func (t *WorkflowTemplate) Normalize() {
	if t.Tags == nil {
		t.Tags = []string{}
	}
	if t.Nodes == nil {
		t.Nodes = []NodeInstance{}
	}
	if t.Edges == nil {
		t.Edges = []EdgeInstance{}
	}
}
