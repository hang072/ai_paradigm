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

/**
 * 模板级入参 schema。
 * 阶段 2 引入(2026-08-11);阶段 3 Planner 消费。
 * 对应前端 ParameterSchemaEntry。
 */
type ParameterSchemaEntry struct {
	Type        string   `json:"type"`                  // "string" | "number" | "enum" | "boolean"
	Required    bool     `json:"required,omitempty"`    // 是否必填
	Default     any      `json:"default,omitempty"`     // 默认值
	Description string   `json:"description,omitempty"` // 描述(给 Planner / 人类阅读)
	EnumValues  []string `json:"enum_values,omitempty"` // enum 类型必填
}

// WorkflowTemplate 工作流模板:节点 + 边 的一个可复用编排。
// 对齐 frontend/src/types/template.ts。
//
// 阶段 2 扩展(2026-08-11):新增 4 个可选字段(parameter_schema /
// description_required_inputs / current_version / versions),均 omitempty,
// 旧数据/老客户端兼容。Normalize() 给切片与 map 补非 nil 默认值。
type WorkflowTemplate struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Tags        []string       `json:"tags"`
	Entry       string         `json:"entry"`
	Nodes       []NodeInstance `json:"nodes"`
	Edges       []EdgeInstance `json:"edges"`
	Builtin     bool           `json:"builtin"`

	// 阶段 2 新增
	ParameterSchema           map[string]ParameterSchemaEntry `json:"parameter_schema,omitempty"`
	DescriptionRequiredInputs []string                        `json:"description_required_inputs,omitempty"`
	CurrentVersion            int                             `json:"current_version,omitempty"` // 1 = 初始版本
	Versions                  []int                           `json:"versions,omitempty"`        // 历史版本号列表,只读
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
	// 阶段 2 新增字段默认值
	if t.ParameterSchema == nil {
		t.ParameterSchema = map[string]ParameterSchemaEntry{}
	}
	if t.DescriptionRequiredInputs == nil {
		t.DescriptionRequiredInputs = []string{}
	}
	if t.Versions == nil {
		t.Versions = []int{}
	}
	// CurrentVersion:旧数据(0)默认为 1,新建为 1;版本化保存时递增
	if t.CurrentVersion == 0 {
		t.CurrentVersion = 1
		if len(t.Versions) == 0 {
			t.Versions = []int{1}
		}
	}
}
