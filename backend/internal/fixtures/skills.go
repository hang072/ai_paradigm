package fixtures

import "paradigm_eino_backend/internal/domain"

// Skills 返回 5 个内置技能包 —— 对齐前端 mock。
func Skills() []*domain.SkillDef {
	return []*domain.SkillDef{
		{
			ID:          "skill-literature",
			Name:        "文献检索与解读",
			Category:    "文献",
			Description: "检索知识库文献 · 提取核心结论 · 标注可点击来源链接",
			PromptFragment: "当涉及医学论断时,主动调用 search_kb 在挂载的知识库中检索,\n" +
				"每条论断都要以 markdown 链接 [文档标题](URL) 引用命中的真实来源;找不到就标 [待补充],严禁编造。",
			SuggestedTools: []string{"search_kb"},
			Color:          "#0891b2",
			Builtin:        true,
		},
		{
			ID:          "skill-slide-outline",
			Name:        "幻灯片大纲生成",
			Category:    "写作",
			Description: "按目标受众/时长生成幻灯片目录 · 分配章节权重",
			PromptFragment: "若用户请求幻灯片相关内容,先输出四段式目录(背景/证据/落地/展望),\n" +
				"并为每章估算时长与页数配比。",
			SuggestedTools: []string{},
			Color:          "#7c4dff",
			Builtin:        true,
		},
		{
			ID:          "skill-article-draft",
			Name:        "医学文章写作",
			Category:    "写作",
			Description: "以研究背景—方法—结果—启示四段式撰写学术文章",
			PromptFragment: "以研究背景—方法—结果—启示的四段式撰写。方法节须交代研究类型、\n" +
				"样本量、随机化方式;结果节须给出主要终点与关键 P 值/HR。",
			SuggestedTools: []string{"search_kb"},
			Color:          "#2b57d6",
			Builtin:        true,
		},
		{
			ID:          "skill-critical-review",
			Name:        "批判性审阅",
			Category:    "分析",
			Description: "从策略对齐/文献支撑/逻辑完整三维度审阅内容",
			PromptFragment: "你的角色是批判性审阅者。对用户提交的内容,分三维度给出 verdict:\n" +
				"- 策略对齐(pass/warn/fail)\n- 文献支撑(pass/warn/fail)\n- 逻辑完整(pass/warn/fail)\n" +
				"每个维度给出 note 与 advice。",
			SuggestedTools: []string{"search_kb"},
			Color:          "#e08600",
			Builtin:        true,
		},
		{
			ID:          "skill-data-analysis",
			Name:        "临床数据解读",
			Category:    "分析",
			Description: "解读 RCT/meta 分析的主要终点、亚组、异质性",
			PromptFragment: "解读临床试验数据时,依次说明:主要终点、次要终点、亚组分析、\n" +
				"安全性信号、异质性(I² 与来源);对阴性结果不做过度解读。",
			SuggestedTools: []string{"search_kb"},
			Color:          "#16a34a",
			Builtin:        true,
		},
	}
}
