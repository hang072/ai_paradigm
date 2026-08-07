package engine

import (
	"context"
	"os"
	"strconv"
	"time"

	"paradigm_eino_backend/internal/domain"
)

// llmTimeout 是单个 compute 节点 LLM 调用的默认超时,防止 provider 挂起导致任务永久卡住。
// 可用环境变量 PARADIGM_LLM_TIMEOUT_SEC 覆盖(<=0 时用默认值)。
func llmTimeout() time.Duration {
	const def = 180 * time.Second
	if v := os.Getenv("PARADIGM_LLM_TIMEOUT_SEC"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return def
}

// TaskEventKind 区分广播事件类型:整快照 / token 增量 / 阶段提示。
type TaskEventKind string

const (
	// TaskEventSnapshot 携带一份完整 snapshot(节点跑完 / 状态翻转时广播)。
	TaskEventSnapshot TaskEventKind = "snapshot"
	// TaskEventToken 携带某节点的一段增量文本(流式节点边生成边推)。
	TaskEventToken TaskEventKind = "token"
	// TaskEventPhase 携带某节点"开始处理"的提示(compute 节点进入时广播一次),
	// 让前端在阻塞/流式产出到达前就显示"正在 XX…",消除卡住观感。
	TaskEventPhase TaskEventKind = "phase"
)

// TaskEvent 是 Executor 广播给 SSE 订阅者的统一事件。
//
// Kind=snapshot 时 Snapshot 有效;Kind=token 时 Node/Delta 有效;
// Kind=phase 时 Node/Label 有效。三条通道复用同一个 broadcaster,
// 保证同一订阅者按发生顺序拿到事件。
type TaskEvent struct {
	Kind     TaskEventKind        `json:"kind"`
	Snapshot *domain.TaskSnapshot `json:"snapshot,omitempty"`
	Node     string               `json:"node,omitempty"`
	Delta    string               `json:"delta,omitempty"`
	Label    string               `json:"label,omitempty"`
}

// TokenSink 是流式节点用来向外吐增量 token 的回调。
// node 是节点名(如 "enrich_content"),delta 是本次增量文本(非累积)。
type TokenSink func(node, delta string)

type tokenSinkKey struct{}

// ContextWithTokenSink 把 TokenSink 挂进 ctx,供流式 compute 节点在生成时逐 token 推送。
// 无 sink(如单测直接跑 graph)时节点走非流式路径,不受影响。
func ContextWithTokenSink(ctx context.Context, sink TokenSink) context.Context {
	return context.WithValue(ctx, tokenSinkKey{}, sink)
}

// tokenSinkFromContext 取出 TokenSink;缺失返回 nil(节点据此判断是否走流式)。
func tokenSinkFromContext(ctx context.Context) TokenSink {
	if v, ok := ctx.Value(tokenSinkKey{}).(TokenSink); ok {
		return v
	}
	return nil
}

// ProgressSink 是 compute 节点跑完后用来广播最新快照的回调。
// executor.run() 注入,读最新 snapshot 并 Broadcast 给 SSE 订阅者。
// 这样 SSE 订阅者能在每个节点完成时(而非仅 interrupt/终态)拿到进度,
// 保证前端步骤气泡的顺序与流式 token 一致。
type ProgressSink func()

type progressSinkKey struct{}

// ContextWithProgressSink 把 ProgressSink 挂进 ctx。
func ContextWithProgressSink(ctx context.Context, sink ProgressSink) context.Context {
	return context.WithValue(ctx, progressSinkKey{}, sink)
}

// emitProgress 若 ctx 里有 ProgressSink 就调用它广播一次最新快照;无则 no-op。
func emitProgress(ctx context.Context) {
	if v, ok := ctx.Value(progressSinkKey{}).(ProgressSink); ok && v != nil {
		v()
	}
}

// PhaseSink 是 compute 节点进入时用来广播"正在处理"提示的回调。
// node 是节点名,label 是人类可读的阶段文案(如"综合审核中…")。
type PhaseSink func(node, label string)

type phaseSinkKey struct{}

// ContextWithPhaseSink 把 PhaseSink 挂进 ctx。
func ContextWithPhaseSink(ctx context.Context, sink PhaseSink) context.Context {
	return context.WithValue(ctx, phaseSinkKey{}, sink)
}

// emitPhase 若 ctx 里有 PhaseSink 就广播一次阶段提示;无则 no-op。
func emitPhase(ctx context.Context, node, label string) {
	if v, ok := ctx.Value(phaseSinkKey{}).(PhaseSink); ok && v != nil {
		v(node, label)
	}
}
