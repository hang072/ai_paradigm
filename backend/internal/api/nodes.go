package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/store"
)

func mountNodes(r chi.Router, s store.Store[*domain.NodeDef]) {
	r.Get("/nodes", func(w http.ResponseWriter, _ *http.Request) {
		respondJSON(w, http.StatusOK, s.List())
	})
	r.Get("/nodes/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		n, ok := s.Get(id)
		if !ok {
			respondErr(w, http.StatusNotFound, "Node 不存在")
			return
		}
		respondJSON(w, http.StatusOK, n)
	})
	r.Post("/nodes", func(w http.ResponseWriter, r2 *http.Request) {
		var in domain.NodeDef
		if err := decodeJSON(r2, &in); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		if in.Name == "" {
			respondErr(w, http.StatusBadRequest, "name 必填")
			return
		}
		if in.Kind == "" {
			in.Kind = domain.NodeKindCompute
		}
		// 前端 mock:createNode 不设内置,builtin 不适用
		created := s.Create(&in)
		respondJSON(w, http.StatusOK, created)
	})
	r.Put("/nodes/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		var patch domain.NodeDef
		if err := decodeJSON(r2, &patch); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		// Node 无 builtin 保护(前端 mock 对齐),lockBuiltin=false
		updated, err := s.Update(id, false, func(cur *domain.NodeDef) error {
			// 保留 id
			id := cur.ID
			*cur = patch
			cur.ID = id
			return nil
		})
		if err != nil {
			respondStoreErr(w, err, "Node", "内置 Node 不可修改")
			return
		}
		respondJSON(w, http.StatusOK, updated)
	})
	r.Delete("/nodes/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		// Node 无 builtin 保护,直接删
		if err := s.Delete(id); err != nil {
			respondStoreErr(w, err, "Node", "内置 Node 不可删除")
			return
		}
		respondJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
}