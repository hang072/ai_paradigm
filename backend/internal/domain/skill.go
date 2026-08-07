package domain

// SkillDef 技能包:可挂载到对话中的能力模块。
// 对齐 frontend/src/types/skill.ts
//
// 与 Agent 的区别:Agent 是长期角色,Skill 是即插即用的 prompt fragment。
type SkillDef struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Category       string   `json:"category"`         // "文献" | "分析" | "写作" | "医学"
	Description    string   `json:"description"`
	PromptFragment string   `json:"prompt_fragment"`  // 追加到 system prompt
	SuggestedTools []string `json:"suggested_tools"`
	Color          string   `json:"color"`
	Builtin        bool     `json:"builtin"`
}

func (s *SkillDef) GetID() string   { return s.ID }
func (s *SkillDef) IsBuiltin() bool { return s.Builtin }
func (s *SkillDef) SetID(id string) { s.ID = id }

func (s *SkillDef) Normalize() {
	if s.SuggestedTools == nil {
		s.SuggestedTools = []string{}
	}
	if s.Category == "" {
		s.Category = "通用"
	}
	if s.Color == "" {
		s.Color = "#2b57d6"
	}
}
