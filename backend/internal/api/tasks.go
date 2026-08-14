package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/engine"
	"paradigm_eino_backend/internal/store"
	sqlitestore "paradigm_eino_backend/internal/store/sqlite"
)

// TasksDeps 是 tasks handler 需要的依赖。
type TasksDeps struct {
	Executor  *engine.Executor
	Store     store.TaskSnapshotStore
	Artifacts *sqlitestore.TaskArtifacts // 阶段 4 共享工件仓库
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

	// ===== 阶段 4 共享工件仓库端点 =====
	if deps.Artifacts != nil {
		// GET /api/tasks/:id/artifacts 列出该任务所有 key 与版本
		r.Get("/tasks/{id}/artifacts", func(w http.ResponseWriter, req *http.Request) {
			id := chi.URLParam(req, "id")
			keys, err := deps.Artifacts.ListKeys(id)
			if err != nil {
				respondErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			respondJSON(w, http.StatusOK, keys)
		})
		// GET /api/tasks/:id/artifacts/:key 取 latest version
		r.Get("/tasks/{id}/artifacts/{key}", func(w http.ResponseWriter, req *http.Request) {
			id := chi.URLParam(req, "id")
			key := chi.URLParam(req, "key")
			row, err := deps.Artifacts.GetLatest(id, key)
			if err != nil {
				if errors.Is(err, sqlitestore.ErrArtifactNotFound) {
					respondErr(w, http.StatusNotFound, "该 key 不存在")
					return
				}
				respondErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			respondJSON(w, http.StatusOK, row)
		})
		// GET /api/tasks/:id/artifacts/:key/versions 列出某 key 的所有 version 号
		r.Get("/tasks/{id}/artifacts/{key}/versions", func(w http.ResponseWriter, req *http.Request) {
			id := chi.URLParam(req, "id")
			key := chi.URLParam(req, "key")
			vs, err := deps.Artifacts.ListVersions(id, key)
			if err != nil {
				respondErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			respondJSON(w, http.StatusOK, vs)
		})
		// GET /api/tasks/:id/artifacts/:key/versions/:v 取指定 version
		r.Get("/tasks/{id}/artifacts/{key}/versions/{v}", func(w http.ResponseWriter, req *http.Request) {
			id := chi.URLParam(req, "id")
			key := chi.URLParam(req, "key")
			v, err := strconv.Atoi(chi.URLParam(req, "v"))
			if err != nil || v <= 0 {
				respondErr(w, http.StatusBadRequest, "version 必须为正整数")
				return
			}
			row, err := deps.Artifacts.GetVersion(id, key, v)
			if err != nil {
				if errors.Is(err, sqlitestore.ErrArtifactNotFound) {
					respondErr(w, http.StatusNotFound, "该版本不存在")
					return
				}
				respondErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			respondJSON(w, http.StatusOK, row)
		})
		// GET /api/tasks/:id/artifacts/:key/diff?v1=X&v2=Y 文本 diff(unified 格式)
		r.Get("/tasks/{id}/artifacts/{key}/diff", func(w http.ResponseWriter, req *http.Request) {
			id := chi.URLParam(req, "id")
			key := chi.URLParam(req, "key")
			v1, err1 := strconv.Atoi(req.URL.Query().Get("v1"))
			v2, err2 := strconv.Atoi(req.URL.Query().Get("v2"))
			if err1 != nil || err2 != nil || v1 <= 0 || v2 <= 0 {
				respondErr(w, http.StatusBadRequest, "v1 / v2 必须为正整数")
				return
			}
			a, err := deps.Artifacts.GetVersion(id, key, v1)
			if err != nil {
				respondErr(w, http.StatusNotFound, "v1 不存在")
				return
			}
			b, err := deps.Artifacts.GetVersion(id, key, v2)
			if err != nil {
				respondErr(w, http.StatusNotFound, "v2 不存在")
				return
			}
			respondJSON(w, http.StatusOK, map[string]any{
				"task_id": id,
				"key":     key,
				"v1":      v1,
				"v2":      v2,
				"unified": simpleUnifiedDiff(a.Content, b.Content, "v"+strconv.Itoa(v1), "v"+strconv.Itoa(v2)),
			})
		})
	}
}

// simpleUnifiedDiff 算两个字符串的 unified diff(简化版,无 hunk 头)。
// 阶段 4 暂时用 LCS 计算最长公共子序列,O(n*m) 内存;artifact 文本通常 < 50KB,可接受。
// 返回字符串格式类似 git diff,每行带 " " / "+" / "-" 前缀。
func simpleUnifiedDiff(a, b, labelA, labelB string) string {
	aLines := strings.Split(a, "\n")
	bLines := strings.Split(b, "\n")
	n, m := len(aLines), len(bLines)
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, m+1)
	}
	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			if aLines[i-1] == bLines[j-1] {
				dp[i][j] = dp[i-1][j-1] + 1
			} else if dp[i-1][j] >= dp[i][j-1] {
				dp[i][j] = dp[i-1][j]
			} else {
				dp[i][j] = dp[i][j-1]
			}
		}
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "--- %s\n+++ %s\n", labelA, labelB)
	type op struct {
		prefix string
		text   string
	}
	ops := []op{}
	i, j := n, m
	for i > 0 || j > 0 {
		switch {
		case i > 0 && j > 0 && aLines[i-1] == bLines[j-1]:
			ops = append(ops, op{" ", aLines[i-1]})
			i--
			j--
		case j > 0 && (i == 0 || dp[i][j-1] >= dp[i-1][j]):
			ops = append(ops, op{"+", bLines[j-1]})
			j--
		default:
			ops = append(ops, op{"-", aLines[i-1]})
			i--
		}
	}
	for k := len(ops) - 1; k >= 0; k-- {
		fmt.Fprintf(&sb, "%s%s\n", ops[k].prefix, ops[k].text)
	}
	return sb.String()
}
