package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/store"
)

func mountSkills(r chi.Router, s store.Store[*domain.SkillDef]) {
	r.Get("/skills", func(w http.ResponseWriter, _ *http.Request) {
		respondJSON(w, http.StatusOK, s.List())
	})
	r.Get("/skills/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		skill, ok := s.Get(id)
		if !ok {
			respondErr(w, http.StatusNotFound, "Skill 不存在")
			return
		}
		respondJSON(w, http.StatusOK, skill)
	})
	r.Post("/skills", func(w http.ResponseWriter, r2 *http.Request) {
		var in domain.SkillDef
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
	r.Put("/skills/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		var patch domain.SkillDef
		if err := decodeJSON(r2, &patch); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		// lockBuiltin=true:内置技能不可修改。前端 mock engine.ts:597 实际无保护,
		// 是后端更严格的策略(删除也是 400)。详见 docs/mock-vs-backend.md 的差异表。
		updated, err := s.Update(id, true, func(cur *domain.SkillDef) error {
			builtin := cur.Builtin
			id := cur.ID
			*cur = patch
			cur.ID = id
			cur.Builtin = builtin
			return nil
		})
		if err != nil {
			respondStoreErr(w, err, "Skill", "内置技能不可修改")
			return
		}
		respondJSON(w, http.StatusOK, updated)
	})
	r.Delete("/skills/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		if err := s.Delete(id); err != nil {
			respondStoreErr(w, err, "Skill", "内置技能不可删除")
			return
		}
		respondJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
}