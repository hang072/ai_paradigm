package engine

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"

	"github.com/cloudwego/eino/compose"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/store"
)

// Executor 是任务状态机的对外驱动。
//
// 每次 Start / Resume 都起一个后台 goroutine 跑 graph.Invoke,
// HTTP handler 立即返回当前 snapshot,前端靠 2s 轮询看进度。
// 如果前端建立了 SSE 连接,每步更新后会主动推送 snapshot 到连接。
//
// 并发安全:每个 taskID 一个 sync.Mutex,同一任务的 Start / Resume 串行化。
type Executor struct {
	graph           compose.Runnable[string, string]
	snapshotStore   store.TaskSnapshotStore
	checkpointStore compose.CheckPointStore
	templateStore   interface {
		Get(id string) (*domain.WorkflowTemplate, bool)
		List() []*domain.WorkflowTemplate
	}

	locksMu sync.Mutex
	locks   map[string]*sync.Mutex

	// cancels 持有每个正在跑的 taskID 的 context.CancelFunc。
	// Cancel(taskID) 会调用它,eino compose.Graph 在每步循环开头 poll ctx.Done,
	// 一旦收到就 return context.Canceled 包裹的 GraphRunError, run() 在错误分支
	// 里落 TaskStatusCancelled 终态。
	//
	// waiting_human 期间 goroutine 已退出, map 里不会有对应 entry —— Cancel 那时
	// 直接同步改 status(见 Cancel 方法内)。
	cancelsMu sync.Mutex
	cancels   map[string]context.CancelFunc

	// broadcasters 保存每个 taskID 所有订阅 SSE 的 channel
	// 每次 snapshot 更新 / token 增量后,广播给所有订阅者
	broadcMu     sync.RWMutex
	broadcasters map[string][]chan *TaskEvent
}

// NewExecutor 构造。
func NewExecutor(
	g compose.Runnable[string, string],
	snap store.TaskSnapshotStore,
	cp compose.CheckPointStore,
	tpl interface {
		Get(id string) (*domain.WorkflowTemplate, bool)
		List() []*domain.WorkflowTemplate
	},
) *Executor {
	return &Executor{
		graph:           g,
		snapshotStore:   snap,
		checkpointStore: cp,
		templateStore:   tpl,
		locks:           make(map[string]*sync.Mutex),
		cancels:         make(map[string]context.CancelFunc),
		broadcasters:    make(map[string][]chan *TaskEvent),
	}
}

// StartInput 是 POST /api/tasks 的请求参数(handler 层已经解包)。
type StartInput struct {
	Brief      string          `json:"brief"`
	TaskType   domain.TaskType  `json:"task_type"`
	Title      string          `json:"title"`
	TemplateID string          `json:"template_id"`
	Spec       *domain.TaskSpec `json:"spec"`
}

// Start 新建一个任务并异步推进。返回初始 snapshot(status=running)。
func (e *Executor) Start(ctx context.Context, in StartInput) (*domain.TaskSnapshot, error) {
	// 1. 决定 spec:优先 spec,其次 template_id,兜底 tpl-full。
	spec := domain.TaskSpec{Nodes: []domain.NodeInstance{}, Edges: []domain.EdgeInstance{}}
	if in.Spec != nil {
		spec = *in.Spec
	} else {
		tplID := in.TemplateID
		if tplID == "" {
			tplID = "tpl-full"
		}
		if tpl, ok := e.templateStore.Get(tplID); ok {
			spec.Entry = tpl.Entry
			spec.Nodes = append([]domain.NodeInstance{}, tpl.Nodes...)
			spec.Edges = append([]domain.EdgeInstance{}, tpl.Edges...)
		}
	}

	// 2. 构造 snapshot
	taskType := in.TaskType
	if taskType == "" {
		taskType = domain.TaskTypeSlide
	}
	title := in.Title
	if title == "" {
		title = AutoTitle(in.Brief)
	}
	snap := &domain.TaskSnapshot{
		Title:       title,
		Brief:        in.Brief,
		TaskType:    taskType,
		CreatedAt:   nowStr(),
		Status:      domain.TaskStatusRunning,
		Messages:    []string{"[start] 已收到任务 brief"},
		StepHistory: []domain.StepHistoryItem{},
		Spec:        spec,
	}
	stored := e.snapshotStore.Create(snap)

	// 3. 起后台 goroutine 推进
	go e.run(stored.ThreadID, "", false)

	return stored, nil
}

// Resume 从 waiting_human 状态恢复。
func (e *Executor) Resume(ctx context.Context, taskID string, answer string) (*domain.TaskSnapshot, error) {
	cur, ok := e.snapshotStore.Get(taskID)
	if !ok {
		return nil, ErrTaskNotFound
	}
	if cur.Status != domain.TaskStatusWaitingHuman {
		return cur, nil
	}
	if cur.Pending == nil {
		return nil, errors.New("pending 信息缺失,无法 resume")
	}

	// 起后台推进(内部会读 checkpoint,把 answer 送进 pending 的 interrupt 节点)
	go e.run(taskID, answer, true)

	// 立即返回一份 snapshot(状态还没翻转,前端轮询会看到最新)
	return cur, nil
}

// run 是 goroutine 里实际推进逻辑,支持首次运行和 resume。
//
// 错误分类:
//   - interrupt (HITL 挂起)                     → 记录 InterruptID, 广播, 保留 waiting_human 状态
//   - context.Canceled (用户手动打断)           → status=cancelled, 广播
//   - graph.Invoke 其他错误 / step 抛错          → status=failed, 记 ErrorMessage
//   - panic (recover 兜底)                       → status=failed
//
// ctx cancel:每个 run 都从 context.WithCancel 派生, cancel 函数存到 e.cancels[taskID],
// Executor.Cancel(taskID) 通过它异步通知 graph.Invoke 停下 (eino compose 每步 poll ctx.Done)。
func (e *Executor) run(taskID string, answer string, isResume bool) {
	baseCtx := ContextWithTaskID(context.Background(), taskID)
	// 注入 token sink:流式 compute 节点(enrich_content)边生成边把增量 token
	// 通过它广播给 SSE 订阅者。非流式节点忽略。
	baseCtx = ContextWithTokenSink(baseCtx, func(node, delta string) {
		e.BroadcastToken(taskID, node, delta)
	})
	// 注入 progress sink:每个 compute 节点跑完后广播一次最新快照,
	// 让 SSE 订阅者在节点级(而非仅 interrupt/终态)拿到进度。
	baseCtx = ContextWithProgressSink(baseCtx, func() {
		if snap, ok := e.snapshotStore.Get(taskID); ok {
			e.Broadcast(taskID, snap)
		}
	})
	// 注入 phase sink:compute 节点进入时广播"正在处理"提示,
	// 让前端在阻塞/流式产出到达前就显示 spinner,消除"卡住"观感。
	baseCtx = ContextWithPhaseSink(baseCtx, func(node, label string) {
		e.BroadcastPhase(taskID, node, label)
	})
	ctx, cancel := context.WithCancel(baseCtx)

	// 注册 cancel func 供 Cancel(taskID) 调用
	e.cancelsMu.Lock()
	e.cancels[taskID] = cancel
	e.cancelsMu.Unlock()
	defer func() {
		cancel() // 无论何种退出都释放
		e.cancelsMu.Lock()
		delete(e.cancels, taskID)
		e.cancelsMu.Unlock()
	}()

	// panic recover 兜底: 标 failed 终态
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[executor] task %s panic: %v", taskID, r)
			updated, _ := e.snapshotStore.Update(taskID, func(s *domain.TaskSnapshot) {
				s.Status = domain.TaskStatusFailed
				s.ErrorMessage = fmt.Sprintf("内部错误: %v", r)
				s.Pending = nil
				addMessage(s, "[executor] panic 已终止任务: "+fmt.Sprint(r))
			})
			if updated != nil {
				e.Broadcast(taskID, updated)
			}
		}
	}()

	// 串行化同一个 taskID 的推进
	lock := e.lockFor(taskID)
	lock.Lock()
	defer lock.Unlock()

	// resume 分支: 从 checkpoint 恢复, 把 answer 送进 pending 的 interrupt
	if isResume {
		cur, ok := e.snapshotStore.Get(taskID)
		if !ok {
			log.Printf("[executor] resume: task %s vanished", taskID)
			return
		}
		if cur.InterruptID == "" {
			log.Printf("[executor] resume: task %s has no interrupt_id, snapshot may corrupt", taskID)
			return
		}
		ctx = compose.ResumeWithData(ctx, cur.InterruptID, answer)
	}

	// 执行图。传 "start" 当驱动信号 —— 首次还是 resume,input 不重要(checkpoint 里已经有了)
	_, err := e.graph.Invoke(ctx, "start", compose.WithCheckPointID(taskID))
	if err != nil {
		// 1) interrupt (HITL 挂起) —— 保留 waiting_human 状态, 记 interrupt_id 给下次 resume 用
		if info, ok := compose.ExtractInterruptInfo(err); ok && len(info.InterruptContexts) > 0 {
			iid := info.InterruptContexts[0].ID
			updated, _ := e.snapshotStore.Update(taskID, func(s *domain.TaskSnapshot) {
				s.InterruptID = iid
			})
			e.Broadcast(taskID, updated)
			return
		}
		// 2) context canceled → cancelled 终态
		if errors.Is(err, context.Canceled) {
			log.Printf("[executor] task %s cancelled by user", taskID)
			updated, _ := e.snapshotStore.Update(taskID, func(s *domain.TaskSnapshot) {
				s.Status = domain.TaskStatusCancelled
				s.Pending = nil
				s.InterruptID = ""
				addMessage(s, "[executor] 用户已手动打断任务")
			})
			e.Broadcast(taskID, updated)
			return
		}
		// 3) 其他错误 → failed 终态
		log.Printf("[executor] task %s failed: %v", taskID, err)
		updated, _ := e.snapshotStore.Update(taskID, func(s *domain.TaskSnapshot) {
			s.Status = domain.TaskStatusFailed
			s.ErrorMessage = err.Error()
			s.Pending = nil
			addMessage(s, "[executor] 执行错误: "+err.Error())
		})
		e.Broadcast(taskID, updated)
		return
	}
	// 正常结束(finalize 已经把 status 改成 done),清空 InterruptID
	updated, _ := e.snapshotStore.Update(taskID, func(s *domain.TaskSnapshot) {
		s.InterruptID = ""
	})
	e.Broadcast(taskID, updated)
}

// Cancel 请求打断一个 running / waiting_human 的任务。幂等: 已终态 → no-op。
//
// running 场景: ctx.CancelFunc 异步通知 graph.Invoke, run() 里错误分支落 cancelled 状态。
// waiting_human 场景: goroutine 已退出等待 resume, 此时 cancels map 里无对应 entry,
// 需要在这里同步改 status 并 broadcast。
func (e *Executor) Cancel(taskID string) error {
	cur, ok := e.snapshotStore.Get(taskID)
	if !ok {
		return ErrTaskNotFound
	}
	switch cur.Status {
	case domain.TaskStatusDone, domain.TaskStatusFailed, domain.TaskStatusCancelled:
		return nil // 幂等
	}

	e.cancelsMu.Lock()
	cancel, running := e.cancels[taskID]
	e.cancelsMu.Unlock()
	if running {
		cancel()
		// 状态由 run() 里的错误分支落; 这里不重复写, 避免与 run() 的 Update 竞态
		return nil
	}

	// waiting_human 但无正在跑的 goroutine → 直接改状态
	updated, err := e.snapshotStore.Update(taskID, func(s *domain.TaskSnapshot) {
		s.Status = domain.TaskStatusCancelled
		s.Pending = nil
		s.InterruptID = ""
		addMessage(s, "[executor] 用户手动打断任务 (等待人工阶段)")
	})
	if err == nil && updated != nil {
		e.Broadcast(taskID, updated)
	}
	return err
}

// Snapshot 便捷取一份最新 snapshot (供 cancel handler 等使用, 避免 handler 直连 snapshotStore)。
func (e *Executor) Snapshot(taskID string) (*domain.TaskSnapshot, bool) {
	return e.snapshotStore.Get(taskID)
}

func (e *Executor) lockFor(taskID string) *sync.Mutex {
	e.locksMu.Lock()
	defer e.locksMu.Unlock()
	if m, ok := e.locks[taskID]; ok {
		return m
	}
	m := &sync.Mutex{}
	e.locks[taskID] = m
	return m
}

// ErrTaskNotFound 由 Resume / handler 层遇到 404 时返回。
var ErrTaskNotFound = errors.New("task not found")

// Subscribe 订阅 taskID 的事件流(snapshot + token 增量)。
// 调用方收到 done status 的 snapshot 后关闭连接退订。
func (e *Executor) Subscribe(taskID string) <-chan *TaskEvent {
	ch := make(chan *TaskEvent, 32) // 缓冲多一些:token 增量比 snapshot 密集
	e.broadcMu.Lock()
	defer e.broadcMu.Unlock()
	e.broadcasters[taskID] = append(e.broadcasters[taskID], ch)
	return ch
}

// Unsubscribe 取消订阅 taskID。
func (e *Executor) Unsubscribe(taskID string, ch <-chan *TaskEvent) {
	e.broadcMu.Lock()
	defer e.broadcMu.Unlock()

	channels := e.broadcasters[taskID]
	for i, c := range channels {
		if c == ch {
			close(c)
			// 删除:交换最后一个元素填到当前位置
			last := len(channels) - 1
			channels[i] = channels[last]
			e.broadcasters[taskID] = channels[:last]
			break
		}
	}
	if len(e.broadcasters[taskID]) == 0 {
		delete(e.broadcasters, taskID)
	}
}

// Broadcast 广播最新快照给所有订阅者(在 snapshot 更新完成后调用)。
func (e *Executor) Broadcast(taskID string, snap *domain.TaskSnapshot) {
	e.emit(taskID, &TaskEvent{Kind: TaskEventSnapshot, Snapshot: snap})
}

// BroadcastToken 广播某节点的一段增量文本给所有订阅者(流式节点边生成边调)。
func (e *Executor) BroadcastToken(taskID, node, delta string) {
	if delta == "" {
		return
	}
	e.emit(taskID, &TaskEvent{Kind: TaskEventToken, Node: node, Delta: delta})
}

// BroadcastPhase 广播某节点"开始处理"的阶段提示(compute 节点进入时调一次)。
func (e *Executor) BroadcastPhase(taskID, node, label string) {
	e.emit(taskID, &TaskEvent{Kind: TaskEventPhase, Node: node, Label: label})
}

// emit 把事件投递给 taskID 的所有订阅 channel。缓冲满则丢弃该事件(下次还有机会)。
func (e *Executor) emit(taskID string, ev *TaskEvent) {
	e.broadcMu.RLock()
	defer e.broadcMu.RUnlock()

	channels, ok := e.broadcasters[taskID]
	if !ok || len(channels) == 0 {
		return
	}
	for _, ch := range channels {
		select {
		case ch <- ev:
		default:
			// 缓冲满了就丢,下个事件还有机会
			log.Printf("[executor] broadcaster %s: channel full, drop %s event", taskID, ev.Kind)
		}
	}
}
