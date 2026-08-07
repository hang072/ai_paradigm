package sqlite

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"paradigm_eino_backend/internal/domain"
)

// Chat 存 chat_sessions + chat_messages 两张表, 供 REST /api/chat/sessions 使用。
type Chat struct {
	db *sql.DB
}

func NewChat(db *sql.DB) *Chat {
	return &Chat{db: db}
}

// ErrSessionNotFound handler 层映射为 404。
var ErrSessionNotFound = errors.New("chat session not found")

// ListSessions 返回摘要 (不含 messages), 按 updated_at 降序。
func (c *Chat) ListSessions() ([]domain.ChatSessionSummary, error) {
	rows, err := c.db.Query(`
SELECT id, title, attached_expert, active_task_id, model, created_at, updated_at
FROM chat_sessions ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []domain.ChatSessionSummary{}
	for rows.Next() {
		var s domain.ChatSessionSummary
		var attached, activeTaskID, model sql.NullString
		if err := rows.Scan(&s.ID, &s.Title, &attached, &activeTaskID, &model, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		s.Model = model.String
		s.ActiveTaskID = activeTaskID.String
		if attached.Valid && attached.String != "" {
			var a domain.AttachedExpert
			if err := json.Unmarshal([]byte(attached.String), &a); err == nil && a.ID != "" {
				s.AttachedExpert = &a
			}
		}
		out = append(out, s)
	}
	return out, nil
}

// GetSession 返回完整会话 (含 messages, 按 idx 顺序)。
func (c *Chat) GetSession(id string) (*domain.ChatSession, error) {
	s := &domain.ChatSession{ID: id}
	var attached, activeTaskID, model sql.NullString
	var tools, skills, kbIDs string
	err := c.db.QueryRow(`
SELECT title, attached_expert, active_task_id, tools, skills, kb_ids, model, created_at, updated_at
FROM chat_sessions WHERE id=?`, id).Scan(
		&s.Title, &attached, &activeTaskID, &tools, &skills, &kbIDs, &model, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, err
	}
	s.Model = model.String
	s.ActiveTaskID = activeTaskID.String
	if attached.Valid && attached.String != "" {
		var a domain.AttachedExpert
		if err := json.Unmarshal([]byte(attached.String), &a); err == nil && a.ID != "" {
			s.AttachedExpert = &a
		}
	}
	if err := json.Unmarshal([]byte(tools), &s.Tools); err != nil {
		return nil, fmt.Errorf("unmarshal tools: %w", err)
	}
	if err := json.Unmarshal([]byte(skills), &s.Skills); err != nil {
		return nil, fmt.Errorf("unmarshal skills: %w", err)
	}
	if err := json.Unmarshal([]byte(kbIDs), &s.KBIDs); err != nil {
		return nil, fmt.Errorf("unmarshal kb_ids: %w", err)
	}

	msgs, err := c.listMessages(id)
	if err != nil {
		return nil, err
	}
	s.Messages = msgs
	return s, nil
}

func (c *Chat) listMessages(sessionID string) ([]domain.ChatMessage, error) {
	rows, err := c.db.Query(`
SELECT id, role, agent_id, agent_name, agent_color, content, tool_calls, timestamp
FROM chat_messages WHERE session_id=? ORDER BY idx`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []domain.ChatMessage{}
	for rows.Next() {
		var m domain.ChatMessage
		var agentID, agentName, agentColor, toolCalls sql.NullString
		if err := rows.Scan(&m.ID, &m.Role, &agentID, &agentName, &agentColor, &m.Content, &toolCalls, &m.Timestamp); err != nil {
			return nil, err
		}
		m.AgentID = agentID.String
		m.AgentName = agentName.String
		m.AgentColor = agentColor.String
		if toolCalls.Valid && toolCalls.String != "" {
			if err := json.Unmarshal([]byte(toolCalls.String), &m.ToolCalls); err != nil {
				return nil, fmt.Errorf("unmarshal tool_calls: %w", err)
			}
		}
		out = append(out, m)
	}
	return out, nil
}

// UpsertSession 创建或更新会话头部字段 (不动 messages)。
//
// 上层 handler 保证 s.ID 非空;created_at 由 handler 或 mock 侧生成后传入。
func (c *Chat) UpsertSession(s *domain.ChatSession) error {
	if s.Tools == nil {
		s.Tools = []string{}
	}
	if s.Skills == nil {
		s.Skills = []string{}
	}
	if s.KBIDs == nil {
		s.KBIDs = []string{}
	}
	tools, _ := json.Marshal(s.Tools)
	skills, _ := json.Marshal(s.Skills)
	kbIDs, _ := json.Marshal(s.KBIDs)

	var attachedJSON any
	if s.AttachedExpert != nil && s.AttachedExpert.ID != "" {
		b, _ := json.Marshal(s.AttachedExpert)
		attachedJSON = string(b)
	}

	now := nowStr()
	if s.CreatedAt == "" {
		s.CreatedAt = now
	}
	if s.UpdatedAt == "" {
		s.UpdatedAt = now
	}

	_, err := c.db.Exec(`
INSERT INTO chat_sessions(id, title, attached_expert, active_task_id, tools, skills, kb_ids, model, created_at, updated_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  title=excluded.title,
  attached_expert=excluded.attached_expert,
  active_task_id=excluded.active_task_id,
  tools=excluded.tools, skills=excluded.skills, kb_ids=excluded.kb_ids,
  model=excluded.model, updated_at=excluded.updated_at
`, s.ID, s.Title, attachedJSON, nullIfEmpty(s.ActiveTaskID),
		string(tools), string(skills), string(kbIDs),
		nullIfEmpty(s.Model), s.CreatedAt, s.UpdatedAt)
	return err
}

// TouchSession 更新 updated_at (和可选 title), 用于 append 消息时同步。
func (c *Chat) TouchSession(id, title string) error {
	if title != "" {
		_, err := c.db.Exec(`UPDATE chat_sessions SET updated_at=?, title=? WHERE id=?`, nowStr(), title, id)
		return err
	}
	_, err := c.db.Exec(`UPDATE chat_sessions SET updated_at=? WHERE id=?`, nowStr(), id)
	return err
}

// DeleteSession 级联删消息 (FOREIGN KEY ON DELETE CASCADE)。
func (c *Chat) DeleteSession(id string) error {
	res, err := c.db.Exec(`DELETE FROM chat_sessions WHERE id=?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrSessionNotFound
	}
	return nil
}

// AppendMessages 批量插入。idx 从当前最大 idx+1 开始。
func (c *Chat) AppendMessages(sessionID string, msgs []domain.ChatMessage) error {
	if len(msgs) == 0 {
		return nil
	}

	tx, err := c.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var exists int
	if err := tx.QueryRow(`SELECT 1 FROM chat_sessions WHERE id=?`, sessionID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrSessionNotFound
		}
		return err
	}

	var maxIdx sql.NullInt64
	if err := tx.QueryRow(`SELECT MAX(idx) FROM chat_messages WHERE session_id=?`, sessionID).Scan(&maxIdx); err != nil {
		return err
	}
	next := int64(0)
	if maxIdx.Valid {
		next = maxIdx.Int64 + 1
	}

	stmt, err := tx.Prepare(`
INSERT INTO chat_messages(id, session_id, idx, role, agent_id, agent_name, agent_color, content, tool_calls, timestamp)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, m := range msgs {
		var toolCalls any
		if len(m.ToolCalls) > 0 {
			b, err := json.Marshal(m.ToolCalls)
			if err != nil {
				return err
			}
			toolCalls = string(b)
		}
		if m.Timestamp == "" {
			m.Timestamp = nowStr()
		}
		if _, err := stmt.Exec(m.ID, sessionID, next, m.Role,
			nullIfEmpty(m.AgentID), nullIfEmpty(m.AgentName), nullIfEmpty(m.AgentColor),
			m.Content, toolCalls, m.Timestamp); err != nil {
			return err
		}
		next++
	}

	if _, err := tx.Exec(`UPDATE chat_sessions SET updated_at=? WHERE id=?`, nowStr(), sessionID); err != nil {
		return err
	}
	return tx.Commit()
}

// ClearMessages 保留 session 头, 只删消息 (用于前端 "清空当前会话")。
func (c *Chat) ClearMessages(sessionID string) error {
	tx, err := c.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var exists int
	if err := tx.QueryRow(`SELECT 1 FROM chat_sessions WHERE id=?`, sessionID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrSessionNotFound
		}
		return err
	}
	if _, err := tx.Exec(`DELETE FROM chat_messages WHERE session_id=?`, sessionID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE chat_sessions SET updated_at=? WHERE id=?`, nowStr(), sessionID); err != nil {
		return err
	}
	return tx.Commit()
}

// EnsureSummaries 保证返回稳定顺序 (updated_at 降序)。目前 List 已排序, 保留占位方便扩展。
func (c *Chat) EnsureSummaries(list []domain.ChatSessionSummary) []domain.ChatSessionSummary {
	sort.Slice(list, func(i, j int) bool { return list[i].UpdatedAt > list[j].UpdatedAt })
	return list
}

func nowStr() string {
	return time.Now().Format("2006-01-02 15:04:05")
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
