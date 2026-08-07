package fixtures

import "paradigm_eino_backend/internal/domain"

// Templates 返回 3 个内置模板 —— 对齐前端 mock。
// - tpl-slide-simple:幻灯 7 节点(不带审核回路)
// - tpl-article-simple:文章 7 节点(不带审核回路)
// - tpl-full:完整 10 节点(含审核回路)
//
// 注意:每个模板使用**独立**的 Nodes/Edges 切片(不共享底层数组),
// 避免未来 S2+ 阶段任何"就地修改"扩散到其他模板。
func Templates() []*domain.WorkflowTemplate {
	simpleNodes := func() []domain.NodeInstance {
		return []domain.NodeInstance{
			{ID: "parse_brief", Type: "parse_brief"},
			{ID: "ask_clarification", Type: "ask_clarification"},
			{ID: "plan_strategy", Type: "plan_strategy"},
			{ID: "confirm_strategy", Type: "confirm_strategy"},
			{ID: "build_framework", Type: "build_framework"},
			{ID: "enrich_content", Type: "enrich_content"},
			{ID: "human_final", Type: "human_final"},
		}
	}
	simpleEdges := func() []domain.EdgeInstance {
		return []domain.EdgeInstance{
			{From: "parse_brief", To: "ask_clarification", Port: "next"},
			{From: "ask_clarification", To: "plan_strategy", Port: "next"},
			{From: "plan_strategy", To: "confirm_strategy", Port: "next"},
			{From: "confirm_strategy", To: "build_framework", Port: "confirm"},
			{From: "confirm_strategy", To: "plan_strategy", Port: "adjust"},
			{From: "build_framework", To: "enrich_content", Port: "next"},
			{From: "enrich_content", To: "human_final", Port: "next"},
			{From: "human_final", To: "enrich_content", Port: "revise"},
		}
	}

	return []*domain.WorkflowTemplate{
		{
			ID:          "tpl-slide-simple",
			Name:        "幻灯片框架制作(简版)",
			Description: "Agent 1-2-3 · 7 节点 · 输出 Excel",
			Tags:        []string{"幻灯", "Excel", "简版"},
			Entry:       "parse_brief",
			Nodes:       simpleNodes(),
			Edges:       simpleEdges(),
			Builtin:     true,
		},
		{
			ID:          "tpl-article-simple",
			Name:        "文章框架制作(简版)",
			Description: "Agent 1-2-3 · 7 节点 · 输出 Word",
			Tags:        []string{"文章", "Word", "简版"},
			Entry:       "parse_brief",
			Nodes:       simpleNodes(),
			Edges:       simpleEdges(),
			Builtin:     true,
		},
		{
			ID:          "tpl-full",
			Name:        "完整流程(含审核回路)",
			Description: "Agent 1-2-3 · 10 节点 · 含 3 Agent 审核回路",
			Tags:        []string{"完整", "审核回路"},
			Entry:       "parse_brief",
			Nodes: []domain.NodeInstance{
				{ID: "parse_brief", Type: "parse_brief"},
				{ID: "ask_clarification", Type: "ask_clarification"},
				{ID: "plan_strategy", Type: "plan_strategy"},
				{ID: "confirm_strategy", Type: "confirm_strategy"},
				{ID: "build_framework", Type: "build_framework"},
				{ID: "enrich_content", Type: "enrich_content"},
				{ID: "review_quality", Type: "review_quality"},
				{ID: "bump_revision", Type: "bump_revision"},
				{ID: "human_final", Type: "human_final"},
				{ID: "finalize", Type: "finalize"},
			},
			Edges: []domain.EdgeInstance{
				{From: "parse_brief", To: "ask_clarification", Port: "next"},
				{From: "ask_clarification", To: "plan_strategy", Port: "next"},
				{From: "plan_strategy", To: "confirm_strategy", Port: "next"},
				{From: "confirm_strategy", To: "build_framework", Port: "confirm"},
				{From: "confirm_strategy", To: "plan_strategy", Port: "adjust"},
				{From: "build_framework", To: "enrich_content", Port: "next"},
				{From: "enrich_content", To: "review_quality", Port: "next"},
				{From: "review_quality", To: "human_final", Port: "pass"},
				{From: "review_quality", To: "bump_revision", Port: "revise"},
				{From: "review_quality", To: "plan_strategy", Port: "redo"},
				{From: "bump_revision", To: "enrich_content", Port: "next"},
				{From: "human_final", To: "finalize", Port: "pass"},
				{From: "human_final", To: "enrich_content", Port: "revise"},
			},
			Builtin: true,
		},
	}
}
