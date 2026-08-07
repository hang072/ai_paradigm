// Package api 提供 HTTP 路由与 handler。
//
// 本文件实现 /api/chat/sessions 相关端点 (会话持久化, 存 SQLite)。
package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/store/sqlite"
)

// remarshalInto 把 raw JSON map 序列化再反序列化到目标 struct。
// 用于 PUT 分支需要区分 "字段未传" 与 "字段传了 null" 的场景 —— 先用 map 拿到出现过的 key,
// 再 remarshal 到 struct 拿到解析后的字段值。
func remarshalInto(raw map[string]json.RawMessage, out any) error {
	b, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, out)
}

// mountChatSessions 挂载会话 CRUD 路由。
//
// 路由:
//   GET    /api/chat/sessions            列表 (摘要, 不含 messages)
//   POST   /api/chat/sessions            创建 / upsert (body 是 ChatSession, 允许无 id → 由前端生成)
//   GET    /api/chat/sessions/:id        单个 (含 messages)
//   PUT    /api/chat/sessions/:id        更新会话字段 (不动 messages)
//   DELETE /api/chat/sessions/:id        删除会话及其所有消息
//   POST   /api/chat/sessions/:id/messages  批量追加消息 (body: { messages: ChatMessage[] })
//   DELETE /api/chat/sessions/:id/messages  清空当前会话消息 (保留 session)
func mountChatSessions(r chi.Router, chat *sqlite.Chat) {
	r.Get("/chat/sessions", func(w http.ResponseWriter, req *http.Request) {
		list, err := chat.ListSessions()
		if err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if list == nil {
			list = []domain.ChatSessionSummary{}
		}
		respondJSON(w, http.StatusOK, list)
	})

	r.Post("/chat/sessions", func(w http.ResponseWriter, req *http.Request) {
		var s domain.ChatSession
		if err := decodeJSON(req, &s); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		if s.ID == "" {
			respondErr(w, http.StatusBadRequest, "id 必填")
			return
		}
		if s.Title == "" {
			s.Title = "新会话"
		}
		if err := chat.UpsertSession(&s); err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		// 如果 body 里带了 messages, 一并 append (常见于前端 localStorage 迁移)
		if len(s.Messages) > 0 {
			if err := chat.AppendMessages(s.ID, s.Messages); err != nil {
				respondErr(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		out, err := chat.GetSession(s.ID)
		if err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, out)
	})

	r.Get("/chat/sessions/{id}", func(w http.ResponseWriter, req *http.Request) {
		id := chi.URLParam(req, "id")
		s, err := chat.GetSession(id)
		if err != nil {
			if errors.Is(err, sqlite.ErrSessionNotFound) {
				respondErr(w, http.StatusNotFound, "会话不存在")
				return
			}
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, s)
	})

	r.Put("/chat/sessions/{id}", func(w http.ResponseWriter, req *http.Request) {
		id := chi.URLParam(req, "id")

		// 用 raw map 判定 attached_expert 是否在 body 里 —— 需要区分
		// "字段没传"(保留原值) 与 "字段传了 null 或空对象"(卸载挂载)。
		var raw map[string]json.RawMessage
		if err := decodeJSON(req, &raw); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		var patch domain.ChatSession
		if err := remarshalInto(raw, &patch); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}

		cur, err := chat.GetSession(id)
		if err != nil {
			if errors.Is(err, sqlite.ErrSessionNotFound) {
				respondErr(w, http.StatusNotFound, "会话不存在")
				return
			}
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}

		if patch.Title != "" {
			cur.Title = patch.Title
		}
		if _, ok := raw["attached_expert"]; ok {
			// 字段被显式传了 —— 允许清空 (nil / "" ID → 卸载)
			if patch.AttachedExpert != nil && patch.AttachedExpert.ID != "" {
				cur.AttachedExpert = patch.AttachedExpert
			} else {
				cur.AttachedExpert = nil
			}
		}
		if _, ok := raw["active_task_id"]; ok {
			// 显式传 —— 允许清空 (空串 → 清)
			cur.ActiveTaskID = patch.ActiveTaskID
		}
		if patch.Tools != nil {
			cur.Tools = patch.Tools
		}
		if patch.Skills != nil {
			cur.Skills = patch.Skills
		}
		if patch.KBIDs != nil {
			cur.KBIDs = patch.KBIDs
		}
		if patch.Model != "" {
			cur.Model = patch.Model
		}
		cur.ID = id
		if err := chat.UpsertSession(cur); err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		out, err := chat.GetSession(id)
		if err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, out)
	})

	r.Delete("/chat/sessions/{id}", func(w http.ResponseWriter, req *http.Request) {
		id := chi.URLParam(req, "id")
		if err := chat.DeleteSession(id); err != nil {
			if errors.Is(err, sqlite.ErrSessionNotFound) {
				respondErr(w, http.StatusNotFound, "会话不存在")
				return
			}
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	r.Post("/chat/sessions/{id}/messages", func(w http.ResponseWriter, req *http.Request) {
		id := chi.URLParam(req, "id")
		var body struct {
			Messages []domain.ChatMessage `json:"messages"`
		}
		if err := decodeJSON(req, &body); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		if err := chat.AppendMessages(id, body.Messages); err != nil {
			if errors.Is(err, sqlite.ErrSessionNotFound) {
				respondErr(w, http.StatusNotFound, "会话不存在")
				return
			}
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{"ok": true, "appended": len(body.Messages)})
	})

	r.Delete("/chat/sessions/{id}/messages", func(w http.ResponseWriter, req *http.Request) {
		id := chi.URLParam(req, "id")
		if err := chat.ClearMessages(id); err != nil {
			if errors.Is(err, sqlite.ErrSessionNotFound) {
				respondErr(w, http.StatusNotFound, "会话不存在")
				return
			}
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
}
