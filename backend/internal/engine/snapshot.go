package engine

import (
	"strings"
	"time"

	"paradigm_eino_backend/internal/domain"
)

// pushStep 追加一次 step_history 记录。
func pushStep(s *domain.TaskSnapshot, nodeID string, afterKeys []string, skipped bool) {
	s.StepHistory = append(s.StepHistory, domain.StepHistoryItem{
		Step:      len(s.StepHistory) + 1,
		NodeID:    nodeID,
		AfterKeys: afterKeys,
		Skipped:   skipped,
	})
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
