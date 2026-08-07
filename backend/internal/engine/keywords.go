// Package engine 实现任务状态机 —— 基于 Eino compose.Graph + HITL。
//
// S2a 阶段:节点里输出用 mock 内容,与 frontend/src/api/mock/engine.ts 保持一致行为。
// S2b 阶段会把 compute 节点内部替换为 adk.ChatModelAgent 真调用。
package engine

import (
	"context"
	"strings"
)

// ---- 关键词匹配(前端 answer 字符串) ----

// hasAdjustKeyword 判断确认策略阶段用户是否在要求"调整"。
func hasAdjustKeyword(answer string) bool {
	return strings.Contains(answer, "调整") || strings.Contains(answer, "修改")
}

// hasReviseKeyword 判断终稿反馈阶段用户是否在"退回修改"。
func hasReviseKeyword(answer string) bool {
	return strings.Contains(answer, "退回") || strings.Contains(answer, "修改")
}

// ---- taskID 通过 context 传给节点(用来在节点内定位 store 记录) ----

type taskIDKey struct{}

// ContextWithTaskID 把 taskID 挂进 ctx,供 lambda 节点内通过 taskIDFromContext 取。
func ContextWithTaskID(ctx context.Context, taskID string) context.Context {
	return context.WithValue(ctx, taskIDKey{}, taskID)
}

// taskIDFromContext 从 ctx 取 taskID;缺失返回 ""(不会 panic)。
func taskIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(taskIDKey{}).(string); ok {
		return v
	}
	return ""
}
