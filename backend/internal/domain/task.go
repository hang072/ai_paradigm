package domain

// TaskStatus 任务状态枚举。
type TaskStatus string

const (
	TaskStatusRunning      TaskStatus = "running"
	TaskStatusWaitingHuman TaskStatus = "waiting_human"
	TaskStatusDone         TaskStatus = "done"
	TaskStatusFailed       TaskStatus = "failed"
	TaskStatusCancelled    TaskStatus = "cancelled"
)

// TaskType 任务类型枚举。
type TaskType string

const (
	TaskTypeSlide   TaskType = "幻灯"
	TaskTypeArticle TaskType = "文章"
)

// PendingStage 三种 HITL 阶段。
type PendingStage string

const (
	PendingAskClarification PendingStage = "ask_clarification"
	PendingConfirmStrategy  PendingStage = "confirm_strategy"
	PendingHumanFinal       PendingStage = "human_final"
)

// ClarifyQuestion 澄清阶段用的一道选择题。
// 对齐 frontend/src/types/task.ts
type ClarifyQuestion struct {
	Question string   `json:"question"`
	Options  []string `json:"options"`
}

// PendingInterrupt 记录一次 HITL 中断的载荷。
// 由前端读取,决定弹什么表单。
type PendingInterrupt struct {
	Stage     PendingStage      `json:"stage"`
	Prompt    string            `json:"prompt"`
	Questions []ClarifyQuestion `json:"questions,omitempty"`
}

// StepHistoryItem 一步节点执行记录。
//
// 阶段 4(2026-08-11)扩展:加 BeforeSnapshot/AfterSnapshot 字段,各自由该节点
// 入口前 / 出口后的 TaskSnapshot 序列化。供前端 diff 节点前后的状态变化。
// 数据量可能较大(markdown 正文 100KB+),所以在 step_history 里只是引用 +
// 关键字段,完整 snapshot 还是通过 GET /api/tasks/:id 取。
type StepHistoryItem struct {
	Step      int      `json:"step"`
	NodeID    string   `json:"node_id"`
	AfterKeys []string `json:"after_keys"`
	Skipped   bool     `json:"skipped"`
	// BeforeSnapshot/AfterSnapshot 是该节点前后的 TaskSnapshot 浅拷贝(只保留
	// 阶段 4 关心的字段,避免 step_history 数组过大)。key 是字段名(与
	// TaskSnapshot 顶层一致),value 是序列化值。omitempty 兼容阶段 1-3 数据。
	BeforeSnapshot map[string]any `json:"before_snapshot,omitempty"`
	AfterSnapshot  map[string]any `json:"after_snapshot,omitempty"`
}

// TaskSpec 任务当前使用的工作流规格。
// 对齐 frontend/src/types/task.ts:TaskSpec
type TaskSpec struct {
	Entry string         `json:"entry"`
	Nodes []NodeInstance `json:"nodes"`
	Edges []EdgeInstance `json:"edges"`
}

// ReviewItem 审核维度的单项结论。
type ReviewItem struct {
	Dimension string `json:"dimension"`
	Verdict   string `json:"verdict"`
	Note      string `json:"note"`
}

// Citation 内容填充阶段引用的一条来源 —— 只允许来自真实知识库文档,
// SourceURL 供前端渲染为可点击链接以溯源核验。
type Citation struct {
	RefID         string `json:"ref_id"`
	Title         string `json:"title"`
	SourceURL     string `json:"source_url"`
	UsedInSection string `json:"used_in_section,omitempty"`
}

// ReviewReport 综合审核报告。
type ReviewReport struct {
	Overall       string       `json:"overall"` // "pass" | "revise" | "redo"
	StrategyItems []ReviewItem `json:"strategy_items"`
	QualityItems  []ReviewItem `json:"quality_items"`
	Advices       []string     `json:"advices"`
	// Summary 是审核节点流式生成的人类可读 markdown 正文(逐字推送给前端)。
	// 流式路径下有值;结构化的 StrategyItems/QualityItems 可能为空。
	Summary string `json:"summary,omitempty"`
	// ─── 阶段 6 新增(workbuddy 借鉴)─────────────────────────────────
	// TargetNode 智能路由目标节点 kind(阶段 6 workbuddy 借鉴)。
	// reviewer 根据 fail 维度决定"问题出在哪里,应回退到哪个上游节点重做":
	//   - "plan_strategy"  → strategy_items fail(策略 / 叙事 / 配比严重偏离)
	//   - "build_framework" → quality_items "结构合理性" fail
	//   - "enrich_content"  → 其它内容 / 文献 / 时长问题(默认兜底)
	//   - "human_final"     → 重大策略 / 概念错误需用户介入(慎用)
	// Validator 强制白名单;非法值降级为 "enrich_content"。
	// 空字符串表示未设置(默认 enrich_content);overall=pass 时可不设置。
	TargetNode string `json:"target_node,omitempty"`
}

// TaskSnapshot 任务在某一时刻的完整快照。
// 前端 GET /api/tasks/:id 直接消费。
//
// 字段命名与顺序对齐 frontend/src/types/task.ts:TaskSnapshot。
type TaskSnapshot struct {
	ThreadID    string            `json:"thread_id"`
	Title       string            `json:"title"`
	Brief       string            `json:"brief"`
	TaskType    TaskType          `json:"task_type"`
	CreatedAt   string            `json:"created_at"`
	Status      TaskStatus        `json:"status"`
	Pending     *PendingInterrupt `json:"pending"`
	Messages    []string          `json:"messages"`

	// 阶段产物(可选,零值时 omitempty)
	ParsedInfo         map[string]any    `json:"parsed_info,omitempty"`
	Completeness       map[string]any    `json:"completeness,omitempty"`
	ClarifyQuestions   []ClarifyQuestion `json:"clarify_questions,omitempty"`
	StrategyDoc        string            `json:"strategy_doc,omitempty"`
	NarrativeMode      string            `json:"narrative_mode,omitempty"`
	FrameworkSkeleton  map[string]any    `json:"framework_skeleton,omitempty"`
	EnrichedFramework  string            `json:"enriched_framework,omitempty"`
	ReviewReport       *ReviewReport     `json:"review_report,omitempty"`
	// Citations 内容填充阶段采用的真实来源清单(带可点击 source_url),供终稿溯源。
	Citations          []Citation        `json:"citations,omitempty"`
	RevisionCount      int               `json:"revision_count"`
	FinalOutput        string            `json:"final_output,omitempty"`
	// ErrorMessage 终态为 failed 时的错误摘要;其他状态为空。
	ErrorMessage       string            `json:"error_message,omitempty"`
	StepHistory        []StepHistoryItem `json:"step_history"`
	Spec               TaskSpec          `json:"spec"`

	// 阶段 4(2026-08-11):artifact 索引。key → 当前版本号 + 总版本数 + 列表 URL。
	// 实际内容走 GET /api/tasks/:id/artifacts/:key;此处只是元数据。
	Artifacts map[string]ArtifactKeyRef `json:"artifacts,omitempty"`

	// 后端内部字段:记录当前 Eino interrupt id 供 resume 定位。
	//
	// 注意:必须序列化到 JSON,因为 SQLite 里 snapshot 以 JSON blob 形式存储 ——
	// 用 `json:"-"` 会导致 interrupt_id 永远不落库, resume 时读回来是空,
	// run() 就走"has no interrupt_id"分支直接 return, 表现为 resume 无响应。
	//
	// 字段名以下划线开头, 表明是后端内部字段, 前端 TS 类型不消费它。
	// omitempty 让首次 running 时 (还没 interrupt) 不占字节。
	InterruptID string `json:"_interrupt_id,omitempty"`
}

// ArtifactKeyRef 是 TaskSnapshot.Artifacts[k] 的引用结构(无 content,只指向版本)。
// 字段 json tag 与 store/sqlite 同名类型一致;handler 构造时直接赋值。
type ArtifactKeyRef struct {
	Key            string `json:"key"`
	CurrentVersion int    `json:"current_version"`
	TotalVersions  int    `json:"total_versions"`
	LatestURL      string `json:"latest_url"`
}

// TaskSummary GET /api/tasks 列表页用的摘要。
// 对齐 frontend/src/types/task.ts:TaskSummary
type TaskSummary struct {
	ThreadID      string     `json:"thread_id"`
	Title         string     `json:"title"`
	CreatedAt     string     `json:"created_at"`
	TaskType      TaskType   `json:"task_type"`
	Status        TaskStatus `json:"status"`
	Stage         string     `json:"stage"`
	RevisionCount int        `json:"revision_count"`
}

// ToSummary 从 snapshot 抽出列表摘要。
func (t *TaskSnapshot) ToSummary() TaskSummary {
	stage := ""
	if t.Pending != nil {
		stage = string(t.Pending.Stage)
	}
	return TaskSummary{
		ThreadID:      t.ThreadID,
		Title:         t.Title,
		CreatedAt:     t.CreatedAt,
		TaskType:      t.TaskType,
		Status:        t.Status,
		Stage:         stage,
		RevisionCount: t.RevisionCount,
	}
}

// Clone 返回一个深拷贝到"字段级",足够 handler 或 goroutine 独立读写。
//
// 深拷贝范围:
//   - 顶层结构 struct value
//   - Messages / StepHistory 切片(浅拷贝元素;元素本身都是值类型,无引用)
//   - ClarifyQuestions 切片
//   - ParsedInfo / Completeness / FrameworkSkeleton(map[string]any 一层浅拷贝)
//   - Pending / ReviewReport 指针字段独立分配
//   - Spec.Nodes / Spec.Edges 切片
//
// 未拷贝:map 里的深层嵌套结构(any 值可能是引用)。当前 mock 内容里不放引用类型,可接受。
func (t *TaskSnapshot) Clone() *TaskSnapshot {
	if t == nil {
		return nil
	}
	c := *t

	if t.Messages != nil {
		c.Messages = append([]string(nil), t.Messages...)
	}
	if t.StepHistory != nil {
		c.StepHistory = append([]StepHistoryItem(nil), t.StepHistory...)
	}
	if t.ClarifyQuestions != nil {
		c.ClarifyQuestions = append([]ClarifyQuestion(nil), t.ClarifyQuestions...)
	}
	if t.ParsedInfo != nil {
		c.ParsedInfo = copyMap(t.ParsedInfo)
	}
	if t.Completeness != nil {
		c.Completeness = copyMap(t.Completeness)
	}
	if t.FrameworkSkeleton != nil {
		c.FrameworkSkeleton = copyMap(t.FrameworkSkeleton)
	}
	if t.Pending != nil {
		p := *t.Pending
		if t.Pending.Questions != nil {
			p.Questions = append([]ClarifyQuestion(nil), t.Pending.Questions...)
		}
		c.Pending = &p
	}
	if t.ReviewReport != nil {
		r := *t.ReviewReport
		r.StrategyItems = append([]ReviewItem(nil), t.ReviewReport.StrategyItems...)
		r.QualityItems = append([]ReviewItem(nil), t.ReviewReport.QualityItems...)
		r.Advices = append([]string(nil), t.ReviewReport.Advices...)
		c.ReviewReport = &r
	}
	c.Spec.Nodes = append([]NodeInstance(nil), t.Spec.Nodes...)
	c.Spec.Edges = append([]EdgeInstance(nil), t.Spec.Edges...)
	return &c
}

func copyMap(src map[string]any) map[string]any {
	dst := make(map[string]any, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}
