package engine

import (
	"context"
	"fmt"

	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/llm"
	"paradigm_eino_backend/internal/store"
)

// 节点名常量。与前端 fixture 里的 NodeInstance.id 保持一致,便于日志排错。
const (
	nodeParseBrief       = "parse_brief"
	nodeAskClarification = "ask_clarification"
	nodePlanStrategy     = "plan_strategy"
	nodeConfirmStrategy  = "confirm_strategy"
	nodeBuildFramework   = "build_framework"
	nodeEnrichContent    = "enrich_content"
	nodeReviewQuality    = "review_quality"
	nodeBumpRevision     = "bump_revision"
	nodeHumanFinal       = "human_final"
	nodeFinalize         = "finalize"

	// 汇合点:让"跳过澄清"和"走过澄清"两条支路的下游都是同一个入口
	nodePreStrategy = "pre_strategy_passthrough"
)

// TaskLocalState 是 compose.Graph 的 per-run 本地状态。
//
// 关键设计:snapshot 不放在这里(那样 Graph 首次 run 时 state 是 nil,GenLocalState 只给空实例)。
// 所有业务数据都通过 taskID 从 TaskSnapshotStore 里读/写。
// 这里只保留 ResumeAnswer —— 分支节点在同一次运行内做出决策时使用。
type TaskLocalState struct {
	ResumeAnswer string `json:"resume_answer,omitempty"`
}

// InterruptPayload 是 Eino Interrupt 携带的 user-facing 信息 —— 序列化进 checkpoint。
// 必须通过 schema.RegisterName 注册。
type InterruptPayload struct {
	Stage     string                   `json:"stage"`
	Prompt    string                   `json:"prompt"`
	Questions []domain.ClarifyQuestion `json:"questions,omitempty"`
}

// InterruptState 记录 interrupt 时节点内部状态(S2a 用不到,占位)。
type InterruptState struct {
	StageEnteredAt string `json:"stage_entered_at"`
}

func init() {
	// Eino 用 gob 编码 checkpoint,依赖类型注册表。
	schema.RegisterName[*InterruptPayload]("paradigm_interrupt_payload_v1")
	schema.RegisterName[*InterruptState]("paradigm_interrupt_state_v1")
	schema.RegisterName[*TaskLocalState]("paradigm_task_local_state_v1")
}

// BuildTaskGraph 编译任务状态机 Graph。
//
// 拓扑参见 plan 文件。节点内部通过 taskIDFromContext(ctx) 获取当前任务 id,
// 再从 snapshotStore 读写快照;WithStatePostHandler 用来在 branch 前更新 ResumeAnswer。
//
// S2b:5 个 compute 节点会调 provider.Complete;provider Unavailable 时回落 mock,
// 与 S2a 行为完全等价。agentStore 用于实时拉取 SystemPrompt(用户在 /agents 页面修改后立即生效)。
// ConfigManager 用于获取当前激活的 LLM 配置,支持运行时切换。
func BuildTaskGraph(
	snapshotStore store.TaskSnapshotStore,
	checkpointStore compose.CheckPointStore,
	configMgr *llm.ConfigManager,
	agentStore agentSource,
	kbStore kbSource,
	litStore litSource,
) (compose.Runnable[string, string], error) {
	g := compose.NewGraph[string, string](
		compose.WithGenLocalState(func(_ context.Context) *TaskLocalState {
			return &TaskLocalState{}
		}),
	)

	// mutSnap 是最常用的 helper —— 节点内调用它就地改快照。
	mutSnap := func(ctx context.Context, mut func(*domain.TaskSnapshot)) error {
		taskID := taskIDFromContext(ctx)
		if taskID == "" {
			return fmt.Errorf("no task_id in ctx")
		}
		_, err := snapshotStore.Update(taskID, mut)
		return err
	}

	// ---- parse_brief ----
	// 关键:LLM 调用不能夹在 mutSnap 的写锁里(会 block 所有 GET)。
	// applyXxxLLM 内部自己控锁 —— 先 Get 快照做 prompt,再无锁调 LLM,最后短写锁 apply 结果。
	if err := g.AddLambdaNode(nodeParseBrief,
		compose.InvokableLambda(func(ctx context.Context, _ string) (string, error) {
			taskID := taskIDFromContext(ctx)
			if taskID == "" {
				return "", fmt.Errorf("no task_id in ctx")
			}
			emitPhase(ctx, nodeParseBrief, "正在解析需求…")
			if err := applyParseBriefLLM(ctx, taskID, snapshotStore, configMgr, agentStore); err != nil {
				return "", err
			}
			emitProgress(ctx)
			return "advance", nil
		}),
	); err != nil {
		return nil, err
	}

	// ---- ask_clarification (interrupt) ----
	if err := g.AddLambdaNode(nodeAskClarification,
		compose.InvokableLambda(func(ctx context.Context, _ string) (string, error) {
			wasInterrupted, _, _ := compose.GetInterruptState[*InterruptState](ctx)
			if !wasInterrupted {
				// 首次进入:生成澄清题、触发 interrupt
				var questions []domain.ClarifyQuestion
				if err := mutSnap(ctx, func(s *domain.TaskSnapshot) {
					applyAskClarification(s)
					s.Status = domain.TaskStatusWaitingHuman
					s.Pending = &domain.PendingInterrupt{
						Stage:     domain.PendingAskClarification,
						Prompt:    "需求信息不完整,请回答以下问题以精准推进",
						Questions: s.ClarifyQuestions,
					}
					questions = s.ClarifyQuestions
				}); err != nil {
					return "", err
				}
				return "", compose.StatefulInterrupt(ctx,
					&InterruptPayload{
						Stage:     string(domain.PendingAskClarification),
						Prompt:    "需求信息不完整,请回答以下问题以精准推进",
						Questions: questions,
					},
					&InterruptState{StageEnteredAt: nowStr()},
				)
			}
			// resume 后:取 answer,清 pending
			isResume, hasData, data := compose.GetResumeContext[string](ctx)
			answer := ""
			if isResume && hasData {
				answer = data
			}
			// 存到 state 供后续分支节点看(虽然澄清阶段之后不 branch,保持一致)
			if err := compose.ProcessState[*TaskLocalState](ctx, func(_ context.Context, s *TaskLocalState) error {
				s.ResumeAnswer = answer
				return nil
			}); err != nil {
				return "", err
			}
			return "advance", mutSnap(ctx, func(s *domain.TaskSnapshot) {
				s.Status = domain.TaskStatusRunning
				s.Pending = nil
				addMessage(s, "[human@ask_clarification] "+truncate(answer, 200))
				addMessage(s, "[ask_clarification] 已收到澄清答复")
			})
		}),
	); err != nil {
		return nil, err
	}

	// ---- pre_strategy_passthrough ----
	if err := g.AddLambdaNode(nodePreStrategy,
		compose.InvokableLambda(func(_ context.Context, _ string) (string, error) {
			return "advance", nil
		}),
	); err != nil {
		return nil, err
	}

	// ---- plan_strategy ----
	if err := g.AddLambdaNode(nodePlanStrategy,
		compose.InvokableLambda(func(ctx context.Context, _ string) (string, error) {
			taskID := taskIDFromContext(ctx)
			if taskID == "" {
				return "", fmt.Errorf("no task_id in ctx")
			}
			emitPhase(ctx, nodePlanStrategy, "正在生成策略确认书…")
			if err := applyPlanStrategyLLM(ctx, taskID, snapshotStore, configMgr, agentStore); err != nil {
				return "", err
			}
			emitProgress(ctx)
			return "advance", nil
		}),
	); err != nil {
		return nil, err
	}

	// ---- confirm_strategy (interrupt) ----
	if err := g.AddLambdaNode(nodeConfirmStrategy,
		compose.InvokableLambda(func(ctx context.Context, _ string) (string, error) {
			wasInterrupted, _, _ := compose.GetInterruptState[*InterruptState](ctx)
			if !wasInterrupted {
				if err := mutSnap(ctx, func(s *domain.TaskSnapshot) {
					s.Status = domain.TaskStatusWaitingHuman
					s.Pending = &domain.PendingInterrupt{
						Stage:  domain.PendingConfirmStrategy,
						Prompt: "请确认以下策略,或输入调整意见:",
					}
					pushStep(s, nodeConfirmStrategy, []string{}, false)
				}); err != nil {
					return "", err
				}
				return "", compose.StatefulInterrupt(ctx,
					&InterruptPayload{
						Stage:  string(domain.PendingConfirmStrategy),
						Prompt: "请确认以下策略,或输入调整意见:",
					},
					&InterruptState{StageEnteredAt: nowStr()},
				)
			}
			isResume, hasData, data := compose.GetResumeContext[string](ctx)
			answer := ""
			if isResume && hasData {
				answer = data
			}
			if err := compose.ProcessState[*TaskLocalState](ctx, func(_ context.Context, s *TaskLocalState) error {
				s.ResumeAnswer = answer
				return nil
			}); err != nil {
				return "", err
			}
			return "advance", mutSnap(ctx, func(s *domain.TaskSnapshot) {
				s.Status = domain.TaskStatusRunning
				s.Pending = nil
				addMessage(s, "[human@confirm_strategy] "+truncate(answer, 200))
				if hasAdjustKeyword(answer) {
					addMessage(s, "[confirm_strategy] 用户请求调整,回退至策略规划")
				} else {
					addMessage(s, "[confirm_strategy] 用户确认策略")
				}
			})
		}),
	); err != nil {
		return nil, err
	}

	// ---- build_framework ----
	if err := g.AddLambdaNode(nodeBuildFramework,
		compose.InvokableLambda(func(ctx context.Context, _ string) (string, error) {
			taskID := taskIDFromContext(ctx)
			if taskID == "" {
				return "", fmt.Errorf("no task_id in ctx")
			}
			emitPhase(ctx, nodeBuildFramework, "正在搭建目录骨架…")
			if err := applyBuildFrameworkLLM(ctx, taskID, snapshotStore, configMgr, agentStore); err != nil {
				return "", err
			}
			emitProgress(ctx)
			return "advance", nil
		}),
	); err != nil {
		return nil, err
	}

	// ---- enrich_content ----
	if err := g.AddLambdaNode(nodeEnrichContent,
		compose.InvokableLambda(func(ctx context.Context, _ string) (string, error) {
			taskID := taskIDFromContext(ctx)
			if taskID == "" {
				return "", fmt.Errorf("no task_id in ctx")
			}
			// 从 state 拿 ResumeAnswer(可能为空)决定 feedback
			var resumeAnswer string
			_ = compose.ProcessState[*TaskLocalState](ctx, func(_ context.Context, s *TaskLocalState) error {
				resumeAnswer = s.ResumeAnswer
				return nil
			})
			// 决定 feedback:优先 review advices,若 resume 里有 revise 关键字则用 resume
			feedback := ""
			if snap, ok := snapshotStore.Get(taskID); ok {
				if snap.ReviewReport != nil && len(snap.ReviewReport.Advices) > 0 {
					feedback = joinStrings(snap.ReviewReport.Advices, "; ")
				}
			}
			if hasReviseKeyword(resumeAnswer) {
				feedback = resumeAnswer
			}
			emitPhase(ctx, nodeEnrichContent, "正在填充章节内容…")
			if err := applyEnrichContentLLM(ctx, taskID, snapshotStore, feedback, configMgr, agentStore, kbStore, litStore); err != nil {
				return "", err
			}
			emitProgress(ctx)
			return "advance", nil
		}),
	); err != nil {
		return nil, err
	}

	// ---- review_quality ----
	if err := g.AddLambdaNode(nodeReviewQuality,
		compose.InvokableLambda(func(ctx context.Context, _ string) (string, error) {
			taskID := taskIDFromContext(ctx)
			if taskID == "" {
				return "", fmt.Errorf("no task_id in ctx")
			}
			emitPhase(ctx, nodeReviewQuality, "正在综合审核…")
			verdict, err := applyReviewQualityLLM(ctx, taskID, snapshotStore, configMgr, agentStore)
			if err != nil {
				return "", err
			}
			emitProgress(ctx)
			return verdict, nil
		}),
	); err != nil {
		return nil, err
	}

	// ---- bump_revision ----
	if err := g.AddLambdaNode(nodeBumpRevision,
		compose.InvokableLambda(func(ctx context.Context, _ string) (string, error) {
			err := mutSnap(ctx, applyBumpRevision)
			emitProgress(ctx)
			return "advance", err
		}),
	); err != nil {
		return nil, err
	}

	// ---- human_final (interrupt) ----
	if err := g.AddLambdaNode(nodeHumanFinal,
		compose.InvokableLambda(func(ctx context.Context, _ string) (string, error) {
			wasInterrupted, _, _ := compose.GetInterruptState[*InterruptState](ctx)
			if !wasInterrupted {
				if err := mutSnap(ctx, func(s *domain.TaskSnapshot) {
					s.Status = domain.TaskStatusWaitingHuman
					s.Pending = &domain.PendingInterrupt{
						Stage:  domain.PendingHumanFinal,
						Prompt: "终稿已生成,请确认或提出修改意见",
					}
					applyHumanFinal(s)
				}); err != nil {
					return "", err
				}
				return "", compose.StatefulInterrupt(ctx,
					&InterruptPayload{
						Stage:  string(domain.PendingHumanFinal),
						Prompt: "终稿已生成,请确认或提出修改意见",
					},
					&InterruptState{StageEnteredAt: nowStr()},
				)
			}
			isResume, hasData, data := compose.GetResumeContext[string](ctx)
			answer := ""
			if isResume && hasData {
				answer = data
			}
			if err := compose.ProcessState[*TaskLocalState](ctx, func(_ context.Context, s *TaskLocalState) error {
				s.ResumeAnswer = answer
				return nil
			}); err != nil {
				return "", err
			}
			return "advance", mutSnap(ctx, func(s *domain.TaskSnapshot) {
				s.Status = domain.TaskStatusRunning
				s.Pending = nil
				addMessage(s, "[human@human_final] "+truncate(answer, 200))
				if hasReviseKeyword(answer) {
					addMessage(s, fmt.Sprintf("[human_final] 用户退回修改,准备第 %d 次修订", s.RevisionCount+1))
				} else {
					addMessage(s, "[human_final] 用户通过")
				}
			})
		}),
	); err != nil {
		return nil, err
	}

	// ---- finalize ----
	if err := g.AddLambdaNode(nodeFinalize,
		compose.InvokableLambda(func(ctx context.Context, _ string) (string, error) {
			return "done", mutSnap(ctx, applyFinalize)
		}),
	); err != nil {
		return nil, err
	}

	// ==================== 边与分支 ====================

	if err := g.AddEdge(compose.START, nodeParseBrief); err != nil {
		return nil, err
	}

	// parse_brief → should_clarify?
	shouldClarify := func(ctx context.Context, _ string) (string, error) {
		enough := false
		taskID := taskIDFromContext(ctx)
		if snap, ok := snapshotStore.Get(taskID); ok && snap.Completeness != nil {
			if v, ok := snap.Completeness["enough"].(bool); ok {
				enough = v
			}
		}
		if enough {
			// 记一条跳过澄清
			_, _ = snapshotStore.Update(taskID, applySkipClarification)
			return nodePreStrategy, nil
		}
		return nodeAskClarification, nil
	}
	if err := g.AddBranch(nodeParseBrief, compose.NewGraphBranch(shouldClarify, map[string]bool{
		nodeAskClarification: true,
		nodePreStrategy:      true,
	})); err != nil {
		return nil, err
	}

	if err := g.AddEdge(nodeAskClarification, nodePreStrategy); err != nil {
		return nil, err
	}
	if err := g.AddEdge(nodePreStrategy, nodePlanStrategy); err != nil {
		return nil, err
	}
	if err := g.AddEdge(nodePlanStrategy, nodeConfirmStrategy); err != nil {
		return nil, err
	}

	// confirm_strategy → branch
	strategyBranch := func(ctx context.Context, _ string) (string, error) {
		adjust := false
		_ = compose.ProcessState[*TaskLocalState](ctx, func(_ context.Context, s *TaskLocalState) error {
			adjust = hasAdjustKeyword(s.ResumeAnswer)
			return nil
		})
		if adjust {
			return nodePlanStrategy, nil
		}
		return nodeBuildFramework, nil
	}
	if err := g.AddBranch(nodeConfirmStrategy, compose.NewGraphBranch(strategyBranch, map[string]bool{
		nodePlanStrategy:   true,
		nodeBuildFramework: true,
	})); err != nil {
		return nil, err
	}

	if err := g.AddEdge(nodeBuildFramework, nodeEnrichContent); err != nil {
		return nil, err
	}
	if err := g.AddEdge(nodeEnrichContent, nodeReviewQuality); err != nil {
		return nil, err
	}

	// review_quality → branch(verdict)
	reviewBranch := func(ctx context.Context, verdict string) (string, error) {
		if verdict != "revise" {
			return nodeHumanFinal, nil
		}
		taskID := taskIDFromContext(ctx)
		snap, ok := snapshotStore.Get(taskID)
		if !ok {
			return nodeHumanFinal, nil
		}
		if snap.RevisionCount < 2 {
			return nodeBumpRevision, nil
		}
		_, _ = snapshotStore.Update(taskID, applyForcedHumanFinal)
		return nodeHumanFinal, nil
	}
	if err := g.AddBranch(nodeReviewQuality, compose.NewGraphBranch(reviewBranch, map[string]bool{
		nodeHumanFinal:   true,
		nodeBumpRevision: true,
	})); err != nil {
		return nil, err
	}

	// bump_revision → enrich_content (loop)
	if err := g.AddEdge(nodeBumpRevision, nodeEnrichContent); err != nil {
		return nil, err
	}

	// human_final → branch
	finalBranch := func(ctx context.Context, _ string) (string, error) {
		revise := false
		_ = compose.ProcessState[*TaskLocalState](ctx, func(_ context.Context, s *TaskLocalState) error {
			revise = hasReviseKeyword(s.ResumeAnswer)
			return nil
		})
		if !revise {
			return nodeFinalize, nil
		}
		// 退回:revision_count++,回到 enrich_content
		taskID := taskIDFromContext(ctx)
		_, _ = snapshotStore.Update(taskID, func(s *domain.TaskSnapshot) {
			s.RevisionCount += 1
			addMessage(s, "[human_final] revision_count → "+itoa(s.RevisionCount))
		})
		return nodeEnrichContent, nil
	}
	if err := g.AddBranch(nodeHumanFinal, compose.NewGraphBranch(finalBranch, map[string]bool{
		nodeEnrichContent: true,
		nodeFinalize:      true,
	})); err != nil {
		return nil, err
	}

	if err := g.AddEdge(nodeFinalize, compose.END); err != nil {
		return nil, err
	}

	return g.Compile(context.Background(),
		compose.WithCheckPointStore(checkpointStore),
		compose.WithGraphName("paradigm_task_graph"),
	)
}

// ---- helpers ----

func joinStrings(ss []string, sep string) string {
	if len(ss) == 0 {
		return ""
	}
	out := ss[0]
	for _, s := range ss[1:] {
		out += sep + s
	}
	return out
}

func truncate(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "..."
}
