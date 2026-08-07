package fixtures

import (
	"time"

	"paradigm_eino_backend/internal/domain"
)

// DemoTasks 返回两个演示任务 —— 对齐前端 mock 引擎的 seedDemoTasks。
// 这两个任务不参与状态机推进,只是初始态。前端首页会直接展示它们。
//
// 用 tplFull 参数是为了填 spec 字段(nodes/edges)。调用方从 templates fixture 传入。
func DemoTasks(tplFull *domain.WorkflowTemplate) []*domain.TaskSnapshot {
	now := time.Now()
	spec := domain.TaskSpec{}
	if tplFull != nil {
		spec.Entry = tplFull.Entry
		spec.Nodes = append([]domain.NodeInstance(nil), tplFull.Nodes...)
		spec.Edges = append([]domain.EdgeInstance(nil), tplFull.Edges...)
	}

	// 示例 1:等待策略确认(waiting_human)
	t1 := &domain.TaskSnapshot{
		ThreadID:  "task-demo-strategy",
		Title:     "心脑血管疾病诊疗新进展 · 幻灯",
		Brief:     "为心内科医生做一份 40 分钟的心脑血管疾病诊疗新进展讲课,受众为主治医师。",
		TaskType:  domain.TaskTypeSlide,
		CreatedAt: now.Add(-12 * time.Minute).Format("2006-01-02 15:04:05"),
		Status:    domain.TaskStatusWaitingHuman,
		Pending: &domain.PendingInterrupt{
			Stage:  domain.PendingConfirmStrategy,
			Prompt: "请确认以下策略,或输入调整意见:",
		},
		Messages: []string{
			"[parse_brief] 已解析需求:主题=心脑血管新进展,受众=主治医师,时长=40min",
			"[ask_clarification] 需求充分,跳过澄清",
			"[plan_strategy] 已生成策略确认书",
		},
		ParsedInfo: map[string]any{
			"topic":        "心脑血管疾病诊疗新进展",
			"audience":     "心内科主治医师",
			"duration":     "40 分钟",
			"goal":         "知识更新",
			"meeting_type": "院内学术会议",
		},
		StrategyDoc: "## 策略确认书\n\n" +
			"- **会议类型**:院内学术会议\n" +
			"- **学术/商业配比**:90% / 10%\n" +
			"- **叙事模式**:问题—证据—共识 三段式\n" +
			"- **章节权重预估**:\n  - 背景与流行病学 · 15%\n  - 关键 RCT 与指南更新 · 45%\n  - 临床落地要点 · 30%\n  - 展望 · 10%",
		NarrativeMode: "问题—证据—共识",
		RevisionCount: 0,
		StepHistory: []domain.StepHistoryItem{
			{Step: 1, NodeID: "parse_brief", AfterKeys: []string{"parsed_info"}, Skipped: false},
			{Step: 2, NodeID: "ask_clarification", AfterKeys: []string{}, Skipped: true},
			{Step: 3, NodeID: "plan_strategy", AfterKeys: []string{"strategy_doc"}, Skipped: false},
		},
		Spec: cloneSpec(spec),
	}

	// 示例 2:已完成(done)
	t2 := &domain.TaskSnapshot{
		ThreadID:  "task-demo-done",
		Title:     "阿尔茨海默病 ANAVEX 临床指南 · 文章",
		Brief:     "撰写 ANAVEX 3-71 阿尔茨海默病 II 期研究的中文解读。",
		TaskType:  domain.TaskTypeArticle,
		CreatedAt: now.Add(-2 * time.Hour).Format("2006-01-02 15:04:05"),
		Status:    domain.TaskStatusDone,
		Pending:   nil,
		Messages: []string{
			"[parse_brief] 已解析需求",
			"[plan_strategy] 已生成策略",
			"[build_framework] 已搭建目录",
			"[enrich_content] 已填充内容,共 4 章节",
			"[review_quality] verdict=pass",
			"[human_final] 用户通过",
			"[finalize] 已定稿",
		},
		ParsedInfo: map[string]any{
			"topic":    "ANAVEX 3-71 II 期 AD 研究解读",
			"audience": "神经内科医师",
		},
		StrategyDoc:   "## 策略确认书(略)",
		NarrativeMode: "研究背景—方法—结果—启示",
		EnrichedFramework: "## 一、研究背景\n\nAnavex 3-71 (Blarcamesine) 是一种 σ-1 受体激动剂...\n\n" +
			"## 二、研究方法\n\n多中心、随机、双盲、安慰剂对照 II 期临床试验...\n\n" +
			"## 三、主要结果\n\n主要终点 ADAS-Cog13 显示统计学显著改善...\n\n" +
			"## 四、临床启示\n\n为早期 AD 患者的疾病修饰治疗提供了新的证据...",
		ReviewReport: &domain.ReviewReport{
			Overall: "pass",
			StrategyItems: []domain.ReviewItem{
				{Dimension: "学术/商业配比", Verdict: "pass", Note: "95/5,符合学术会议"},
				{Dimension: "章节配比", Verdict: "pass", Note: "与策略书对齐"},
			},
			QualityItems: []domain.ReviewItem{
				{Dimension: "文献支撑", Verdict: "pass", Note: "关键论断均引用 III 期数据"},
				{Dimension: "结构合理性", Verdict: "pass", Note: "四段式清晰"},
			},
			Advices: []string{},
		},
		RevisionCount: 0,
		FinalOutput: "# ANAVEX 3-71 阿尔茨海默病 II 期研究解读\n\n> 中文解读版 · 神经内科医师版\n\n" +
			"## 一、研究背景\n\n(此处为最终定稿全文,略)\n\n" +
			"## 二、研究方法\n\n...\n\n## 三、主要结果\n\n...\n\n## 四、临床启示\n\n...",
		StepHistory: []domain.StepHistoryItem{
			{Step: 1, NodeID: "parse_brief", AfterKeys: []string{"parsed_info"}, Skipped: false},
			{Step: 2, NodeID: "plan_strategy", AfterKeys: []string{"strategy_doc"}, Skipped: false},
			{Step: 3, NodeID: "build_framework", AfterKeys: []string{"framework_skeleton"}, Skipped: false},
			{Step: 4, NodeID: "enrich_content", AfterKeys: []string{"enriched_framework"}, Skipped: false},
			{Step: 5, NodeID: "review_quality", AfterKeys: []string{"review_report"}, Skipped: false},
			{Step: 6, NodeID: "human_final", AfterKeys: []string{}, Skipped: false},
			{Step: 7, NodeID: "finalize", AfterKeys: []string{"final_output"}, Skipped: false},
		},
		Spec: cloneSpec(spec),
	}

	return []*domain.TaskSnapshot{t1, t2}
}

func cloneSpec(spec domain.TaskSpec) domain.TaskSpec {
	return domain.TaskSpec{
		Entry: spec.Entry,
		Nodes: append([]domain.NodeInstance(nil), spec.Nodes...),
		Edges: append([]domain.EdgeInstance(nil), spec.Edges...),
	}
}
