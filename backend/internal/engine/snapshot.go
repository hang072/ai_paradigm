package engine

import (
	"strings"
	"time"

	"paradigm_eino_backend/internal/domain"
)

// pushStep 追加一次 step_history 记录。
//
// 阶段 4(2026-08-11)扩展:可选 before/after 浅拷贝(只拷贝节点关心的字段,
// 避免 step_history 数组膨胀),前端可 diff 节点入口/出口的 state 变化。
func pushStep(s *domain.TaskSnapshot, nodeID string, afterKeys []string, skipped bool) {
	pushStepWithDiff(s, nodeID, afterKeys, skipped, nil, nil)
}

// pushStepWithDiff 同 pushStep,但额外带 before/after 两个 map。
func pushStepWithDiff(
	s *domain.TaskSnapshot,
	nodeID string,
	afterKeys []string,
	skipped bool,
	before, after map[string]any,
) {
	s.StepHistory = append(s.StepHistory, domain.StepHistoryItem{
		Step:           len(s.StepHistory) + 1,
		NodeID:         nodeID,
		AfterKeys:      afterKeys,
		Skipped:        skipped,
		BeforeSnapshot: before,
		AfterSnapshot:  after,
	})
}

// shallowSnapshot 抽 snapshot 的指定字段成 map,给 pushStepWithDiff 用。
// nil keys 表示抽全部(不推荐,可能很大)。
func shallowSnapshot(s *domain.TaskSnapshot, keys []string) map[string]any {
	out := make(map[string]any, len(keys))
	for _, k := range keys {
		switch k {
		case "parsed_info":
			out[k] = s.ParsedInfo
		case "completeness":
			out[k] = s.Completeness
		case "clarify_questions":
			out[k] = s.ClarifyQuestions
		case "strategy_doc":
			out[k] = s.StrategyDoc
		case "narrative_mode":
			out[k] = s.NarrativeMode
		case "framework_skeleton":
			out[k] = s.FrameworkSkeleton
		case "enriched_framework":
			out[k] = s.EnrichedFramework
		case "review_report":
			out[k] = s.ReviewReport
		case "citations":
			out[k] = s.Citations
		case "revision_count":
			out[k] = s.RevisionCount
		case "final_output":
			out[k] = s.FinalOutput
		}
	}
	return out
}

// addMessage 追加一条运行日志。
func addMessage(s *domain.TaskSnapshot, msg string) {
	s.Messages = append(s.Messages, msg)
}

// nowStr 返回本地时间 "YYYY-MM-DD HH:mm:ss" 字符串。
func nowStr() string {
	return time.Now().Format("2006-01-02 15:04:05")
}

// firstLine 抽取 brief 的第一行/前 24 字符作 title fallback。
func firstLine(brief string) string {
	cleaned := strings.NewReplacer(
		"。", " ",
		",", " ",
		",", " ",
		".", " ",
		"!", " ",
		"?", " ",
		"!", " ",
		"?", " ",
		"\n", " ",
	).Replace(brief)
	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		return "未命名主题"
	}
	// 截前 24 rune。
	runes := []rune(cleaned)
	if len(runes) > 24 {
		runes = runes[:24]
	}
	return string(runes)
}

// AutoTitle 从 brief 抽标题。
func AutoTitle(brief string) string {
	return firstLine(brief) + " · 任务"
}

// ExtractTopic 从 brief 抽主题(供 parse_brief 用)。
func ExtractTopic(brief string) string {
	return firstLine(brief)
}
