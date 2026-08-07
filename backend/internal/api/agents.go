package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/store"
)

func mountAgents(r chi.Router, s store.Store[*domain.AgentDef]) {
	r.Get("/agents", func(w http.ResponseWriter, _ *http.Request) {
		respondJSON(w, http.StatusOK, s.List())
	})
	r.Get("/agents/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		a, ok := s.Get(id)
		if !ok {
			respondErr(w, http.StatusNotFound, "Agent 不存在")
			return
		}
		respondJSON(w, http.StatusOK, a)
	})
	r.Post("/agents", func(w http.ResponseWriter, r2 *http.Request) {
		var in domain.AgentDef
		if err := decodeJSON(r2, &in); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		if in.Name == "" {
			respondErr(w, http.StatusBadRequest, "name 必填")
			return
		}
		// POST 不允许把 builtin 传成 true(前端 mock 一律置 false)
		in.Builtin = false
		created := s.Create(&in)
		respondJSON(w, http.StatusOK, created)
	})
	r.Put("/agents/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		var patch domain.AgentDef
		if err := decodeJSON(r2, &patch); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		// lockBuiltin=true:内置 Agent 不可修改,这是产品策略(也是前端 mock 已有的保护)。
		// 之前 false 是为了"对齐前端 mock",但实测前端 mock 也拒绝内置修改,故改为 true。
		updated, err := s.Update(id, true, func(cur *domain.AgentDef) error {
			// 对齐前端 mock 的 { ...cur, ...patch, id: cur.id } 语义:
			// - 前端 UI 编辑弹窗一般会带回完整对象,这个策略实用上安全。
			builtin := cur.Builtin
			id := cur.ID
			*cur = patch
			cur.ID = id
			cur.Builtin = builtin
			return nil
		})
		if err != nil {
			respondStoreErr(w, err, "Agent", "内置 Agent 不可修改")
			return
		}
		respondJSON(w, http.StatusOK, updated)
	})
	r.Delete("/agents/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		if err := s.Delete(id); err != nil {
			respondStoreErr(w, err, "Agent", "内置 Agent 不可删除")
			return
		}
		respondJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
}
