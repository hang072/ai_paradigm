package api

import (
	"context"
	"errors"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/engine"
	"paradigm_eino_backend/internal/store"
)

// TasksDeps 是 tasks handler 需要的依赖。
type TasksDeps struct {
	Executor *engine.Executor
	Store    store.TaskSnapshotStore
}

func mountTasks(r chi.Router, deps TasksDeps) {
	// GET /api/tasks → TaskSummary[]
	r.Get("/tasks", func(w http.ResponseWriter, _ *http.Request) {
		log.Printf("[api] GET /tasks")
		list := deps.Store.List()
		summaries := make([]domain.TaskSummary, 0, len(list))
		for _, t := range list {
			summaries = append(summaries, t.ToSummary())
		}
		log.Printf("[api] GET /tasks done, %d tasks", len(summaries))
		respondJSON(w, http.StatusOK, summaries)
	})

	// GET /api/tasks/:id → TaskSnapshot
	r.Get("/tasks/{id}", func(w http.ResponseWriter, req *http.Request) {
		id := chi.URLParam(req, "id")
		log.Printf("[api] GET /tasks/%s", id)
		snap, ok := deps.Store.Get(id)
		if !ok {
			log.Printf("[api] GET /tasks/%s: task not found", id)
			respondErr(w, http.StatusNotFound, "Task 不存在")
			return
		}
		respondJSON(w, http.StatusOK, snap)
	})

	// POST /api/tasks → TaskSnapshot
	r.Post("/tasks", func(w http.ResponseWriter, req *http.Request) {
		var body struct {
			Brief      string           `json:"brief"`
			TaskType   domain.TaskType  `json:"task_type"`
			Title      string           `json:"title"`
			TemplateID string           `json:"template_id"`
			Spec       *domain.TaskSpec `json:"spec"`
		}
		if err := decodeJSON(req, &body); err != nil {
			log.Printf("[api] POST /tasks decode failed: %v", err)
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		if body.Brief == "" {
			log.Printf("[api] POST /tasks: brief empty")
			respondErr(w, http.StatusBadRequest, "brief 必填")
			return
		}
		log.Printf("[api] POST /tasks title=%s type=%s template=%s", body.Title, body.TaskType, body.TemplateID)
		snap, err := deps.Executor.Start(req.Context(), engine.StartInput{
			Brief:      body.Brief,
			TaskType:   body.TaskType,
			Title:      body.Title,
			TemplateID: body.TemplateID,
			Spec:       body.Spec,
		})
		if err != nil {
			log.Printf("[api] POST /tasks start failed: %v", err)
			respondErr(w, http.StatusInternalServerError, "创建任务失败: "+err.Error())
			return
		}
		log.Printf("[api] POST /tasks done, task_id=%s status=%s", snap.ThreadID, snap.Status)
		respondJSON(w, http.StatusOK, snap)
	})

	// POST /api/tasks/:id/resume → TaskSnapshot
	r.Post("/tasks/{id}/resume", func(w http.ResponseWriter, req *http.Request) {
		id := chi.URLParam(req, "id")
		var body struct {
			Answer string `json:"answer"`
		}
		if err := decodeJSON(req, &body); err != nil {
			log.Printf("[api] POST /tasks/%s/resume decode failed: %v", id, err)
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		log.Printf("[api] POST /tasks/%s/resume: answer_len=%d", id, len(body.Answer))
		snap, err := deps.Executor.Resume(req.Context(), id, body.Answer)
		if err != nil {
			if errors.Is(err, engine.ErrTaskNotFound) {
				log.Printf("[api] POST /tasks/%s/resume: task not found", id)
				respondErr(w, http.StatusNotFound, "Task 不存在")
				return
			}
			log.Printf("[api] POST /tasks/%s/resume failed: %v", id, err)
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		log.Printf("[api] POST /tasks/%s/resume done, status=%s", id, snap.Status)
		respondJSON(w, http.StatusOK, snap)
	})

	// POST /api/tasks/:id/cancel → TaskSnapshot
	//
	// 请求打断一个 running / waiting_human 的任务。幂等:已终态 → 200 no-op。
	// running 任务通过 ctx cancel 传播打断信号, executor 在 graph.Invoke 错误分支
	// 落 cancelled 状态; waiting_human 任务由 Executor.Cancel 直接改状态。
	r.Post("/tasks/{id}/cancel", func(w http.ResponseWriter, req *http.Request) {
		id := chi.URLParam(req, "id")
		log.Printf("[api] POST /tasks/%s/cancel", id)
		if err := deps.Executor.Cancel(id); err != nil {
			if errors.Is(err, engine.ErrTaskNotFound) {
				respondErr(w, http.StatusNotFound, "Task 不存在")
				return
			}
			log.Printf("[api] POST /tasks/%s/cancel failed: %v", id, err)
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		snap, ok := deps.Executor.Snapshot(id)
		if !ok {
			respondErr(w, http.StatusNotFound, "Task 不存在")
			return
		}
		log.Printf("[api] POST /tasks/%s/cancel done, status=%s", id, snap.Status)
		respondJSON(w, http.StatusOK, snap)
	})

	// POST /api/tasks/:id/spec → TaskSnapshot
	//
	// 只更新快照的 spec 字段;不影响正在运行的 graph。
	// S2a 的 graph 拓扑是硬编码的,spec 只是"记录",不参与执行分派。
	r.Post("/tasks/{id}/spec", func(w http.ResponseWriter, req *http.Request) {
		id := chi.URLParam(req, "id")
		var body struct {
			Spec *domain.TaskSpec `json:"spec"`
		}
		if err := decodeJSON(req, &body); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		if body.Spec == nil {
			respondErr(w, http.StatusBadRequest, "spec 必填")
			return
		}
		snap, err := deps.Store.Update(id, func(s *domain.TaskSnapshot) {
			s.Spec = *body.Spec
			s.Messages = append(s.Messages, "[spec] 编排 spec 已更新")
		})
		if err != nil {
			if errors.Is(err, store.ErrTaskNotFound) {
				respondErr(w, http.StatusNotFound, "Task 不存在")
				return
			}
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, snap)
	})

	// GET /tasks/{id}/stream → SSE 流式推送任务进度
	// 每一步更新完成推送一次完整 snapshot,直到 status=done 后关闭连接。
	r.Get("/tasks/{id}/stream", func(w http.ResponseWriter, req *http.Request) {
		id := chi.URLParam(req, "id")
		snap, ok := deps.Store.Get(id)
		if !ok {
			respondErr(w, http.StatusNotFound, "Task 不存在")
			return
		}

		// 设置 SSE 头
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		flusher, ok := w.(http.Flusher)
		if !ok {
			respondErr(w, http.StatusInternalServerError, "Streaming not supported by server")
			return
		}

		// 订阅更新
		sub := deps.Executor.Subscribe(id)
		defer deps.Executor.Unsubscribe(id, sub)

		// 先发送当前快照
		data, err := json.Marshal(snap)
		if err == nil {
			_, _ = w.Write([]byte("event: snapshot\ndata: " + string(data) + "\n\n"))
			flusher.Flush()
		}

		// 已经 done,发完关闭
		if snap.Status == domain.TaskStatusDone {
			_, _ = w.Write([]byte("event: done\ndata: {}\n\n"))
			flusher.Flush()
			return
		}

		// 10 分钟空闲超时
		ctx, cancel := context.WithTimeout(req.Context(), 10*time.Minute)
		defer cancel()

		// 监听更新事件(snapshot 全量 + token 增量)
		for {
			select {
			case <-ctx.Done():
				return
			case ev, ok := <-sub:
				if !ok {
					return
				}
				switch ev.Kind {
				case engine.TaskEventToken:
					// token 增量:{node, delta}
					payload, err := json.Marshal(map[string]string{
						"node":  ev.Node,
						"delta": ev.Delta,
					})
					if err != nil {
						continue
					}
					_, _ = w.Write([]byte("event: token\ndata: " + string(payload) + "\n\n"))
					flusher.Flush()
				case engine.TaskEventPhase:
					// 阶段提示:{node, label} —— 节点进入时的 spinner 文案
					payload, err := json.Marshal(map[string]string{
						"node":  ev.Node,
						"label": ev.Label,
					})
					if err != nil {
						continue
					}
					_, _ = w.Write([]byte("event: phase\ndata: " + string(payload) + "\n\n"))
					flusher.Flush()
				case engine.TaskEventSnapshot:
					if ev.Snapshot == nil {
						continue
					}
					data, err := json.Marshal(ev.Snapshot)
					if err != nil {
						continue
					}
					_, _ = w.Write([]byte("event: snapshot\ndata: " + string(data) + "\n\n"))
					flusher.Flush()
					switch ev.Snapshot.Status {
					case domain.TaskStatusDone, domain.TaskStatusFailed, domain.TaskStatusCancelled:
						_, _ = w.Write([]byte("event: done\ndata: {}\n\n"))
						flusher.Flush()
						return
					}
				}
			}
		}
	})
}
