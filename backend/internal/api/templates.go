package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/store"
)

func mountTemplates(r chi.Router, s store.Store[*domain.WorkflowTemplate]) {
	r.Get("/templates", func(w http.ResponseWriter, _ *http.Request) {
		respondJSON(w, http.StatusOK, s.List())
	})
	r.Get("/templates/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		t, ok := s.Get(id)
		if !ok {
			respondErr(w, http.StatusNotFound, "Template 不存在")
			return
		}
		respondJSON(w, http.StatusOK, t)
	})
	r.Post("/templates", func(w http.ResponseWriter, r2 *http.Request) {
		var in domain.WorkflowTemplate
		if err := decodeJSON(r2, &in); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		if in.Name == "" {
			respondErr(w, http.StatusBadRequest, "name 必填")
			return
		}
		in.Builtin = false
		created := s.Create(&in)
		respondJSON(w, http.StatusOK, created)
	})
	r.Put("/templates/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		var patch domain.WorkflowTemplate
		if err := decodeJSON(r2, &patch); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		// 前端 mock:PUT 内置模板报错 —— 保护开启
		updated, err := s.Update(id, true, func(cur *domain.WorkflowTemplate) error {
			id := cur.ID
			*cur = patch
			cur.ID = id
			cur.Builtin = false
			return nil
		})
		if err != nil {
			respondStoreErr(w, err, "Template", "内置模板不可修改")
			return
		}
		respondJSON(w, http.StatusOK, updated)
	})
	r.Delete("/templates/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		if err := s.Delete(id); err != nil {
			respondStoreErr(w, err, "Template", "内置模板不可删除")
			return
		}
		respondJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
}