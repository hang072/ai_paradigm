package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/store"
	"paradigm_eino_backend/internal/store/sqlite"
)

// mountTemplates 注册模板 CRUD + 阶段 2.4 版本化保存/读取端点。
//
// 阶段 2.4 改动:
//   - PUT 改为"乐观锁 + 创建新版本":写入 entities(覆盖) + 写 template_versions(新行)
//   - GET 模板时从 template_versions 读完整 Versions 列表回填
//   - 新增 GET /templates/{id}/versions 与 GET /templates/{id}/versions/{v}
//
// 兼容:旧数据(没有 template_versions 行)GET 时仍能拿到模板,Versions 字段为空。
func mountTemplates(
	r chi.Router,
	s store.Store[*domain.WorkflowTemplate],
	versions *sqlite.TemplateVersions,
) {
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
		// 回填 Versions(可能不完整,被外部绕过 PUT 的数据)
		if versions != nil {
			if vs, err := versions.ListVersions(id); err == nil && len(vs) > 0 {
				t.Versions = vs
				if t.CurrentVersion == 0 {
					t.CurrentVersion = vs[0]
				}
			}
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
		in.CurrentVersion = 1
		in.Versions = []int{1}
		created := s.Create(&in)
		// 创建即记 v1
		if versions != nil {
			_, _ = versions.SaveVersion(created)
		}
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
			// 版本号由 TemplateVersions.SaveVersion 自增
			return nil
		})
		if err != nil {
			respondStoreErr(w, err, "Template", "内置模板不可修改")
			return
		}
		// 写历史版本
		if versions != nil {
			if v, err := versions.SaveVersion(updated); err == nil {
				updated.CurrentVersion = v
				if vs, err2 := versions.ListVersions(updated.ID); err2 == nil {
					updated.Versions = vs
				}
			}
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

	// ===== 阶段 2.4 版本历史端点 =====
	if versions != nil {
		r.Get("/templates/{id}/versions", func(w http.ResponseWriter, r2 *http.Request) {
			id := chi.URLParam(r2, "id")
			vs, err := versions.ListVersions(id)
			if err != nil {
				respondErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			respondJSON(w, http.StatusOK, vs)
		})
		r.Get("/templates/{id}/versions/{v}", func(w http.ResponseWriter, r2 *http.Request) {
			id := chi.URLParam(r2, "id")
			v, err := strconv.Atoi(chi.URLParam(r2, "v"))
			if err != nil || v <= 0 {
				respondErr(w, http.StatusBadRequest, "version 必须为正整数")
				return
			}
			t, err := versions.GetVersion(id, v)
			if err != nil {
				if errors.Is(err, sqlite.ErrTemplateVersionNotFound) {
					respondErr(w, http.StatusNotFound, "该版本不存在")
					return
				}
				respondErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			respondJSON(w, http.StatusOK, t)
		})
	}
}
