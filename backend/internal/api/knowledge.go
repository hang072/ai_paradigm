// Package api — 本文件实现知识库 REST 端点 (S4)。
//
// 路由:
//   GET/POST      /api/kb
//   GET/PUT/DEL   /api/kb/:id
//   POST          /api/kb/:id/docs
//   PUT/DEL       /api/kb/:id/docs/:docId
//   POST          /api/kb/search   { query, kb_ids } → []KbSearchHit
//
// 注意路由挂载顺序:/api/kb/search 与 /api/kb/:id/docs 必须挂在 /api/kb/:id 之前,
// 否则 chi 会先匹配到 :id。见前端约定:frontend/src/api/mock/index.ts。
package api

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/kb"
	"paradigm_eino_backend/internal/store"
)

func nowKbStr() string {
	return time.Now().Format("2006-01-02 15:04:05")
}

func mountKnowledge(r chi.Router, s store.Store[*domain.KnowledgeBase]) {
	// ===== search:必须在 /kb/{id} 之前注册,否则 chi 会把 "search" 当成 id =====
	r.Post("/kb/search", func(w http.ResponseWriter, req *http.Request) {
		var body struct {
			Query string   `json:"query"`
			KBIDs []string `json:"kb_ids"`
		}
		if err := decodeJSON(req, &body); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		hits := runSearch(s, body.Query, body.KBIDs)
		if hits == nil {
			// 保证返回 [] 而不是 null
			hits = []domain.KbSearchHit{}
		}
		respondJSON(w, http.StatusOK, hits)
	})

	// ===== KB CRUD =====
	r.Get("/kb", func(w http.ResponseWriter, _ *http.Request) {
		respondJSON(w, http.StatusOK, s.List())
	})
	r.Get("/kb/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		kbObj, ok := s.Get(id)
		if !ok {
			respondErr(w, http.StatusNotFound, "知识库不存在")
			return
		}
		respondJSON(w, http.StatusOK, kbObj)
	})
	r.Post("/kb", func(w http.ResponseWriter, r2 *http.Request) {
		var in domain.KnowledgeBase
		if err := decodeJSON(r2, &in); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		if in.Name == "" {
			respondErr(w, http.StatusBadRequest, "name 必填")
			return
		}
		in.Builtin = false
		in.CreatedAt = nowKbStr()
		in.UpdatedAt = in.CreatedAt
		if in.Docs == nil {
			in.Docs = []*domain.KnowledgeDoc{}
		}
		created := s.Create(&in)
		respondJSON(w, http.StatusOK, created)
	})
	r.Put("/kb/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		var patch domain.KnowledgeBase
		if err := decodeJSON(r2, &patch); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		updated, err := s.Update(id, true, func(cur *domain.KnowledgeBase) error {
			// 只允许改元信息,docs 保持不变(通过 /docs 子路由改)
			if patch.Name != "" {
				cur.Name = patch.Name
			}
			if patch.Description != "" {
				cur.Description = patch.Description
			}
			if patch.Color != "" {
				cur.Color = patch.Color
			}
			cur.UpdatedAt = nowKbStr()
			return nil
		})
		if err != nil {
			respondStoreErr(w, err, "知识库", "内置知识库不可修改")
			return
		}
		respondJSON(w, http.StatusOK, updated)
	})
	r.Delete("/kb/{id}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		if err := s.Delete(id); err != nil {
			respondStoreErr(w, err, "知识库", "内置知识库不可删除")
			return
		}
		respondJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	// ===== Doc CRUD(子路由,通过 patch 回调修改 KB.Docs) =====
	r.Post("/kb/{id}/docs", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		var in domain.KnowledgeDoc
		if err := decodeJSON(r2, &in); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		if in.Title == "" {
			respondErr(w, http.StatusBadRequest, "title 必填")
			return
		}

		var created *domain.KnowledgeDoc
		// 注意:传 lockBuiltin=false —— 允许往内置 KB 里追加文档
		_, err := s.Update(id, false, func(cur *domain.KnowledgeBase) error {
			doc := &domain.KnowledgeDoc{
				ID:        in.ID,
				Title:     in.Title,
				Content:   in.Content,
				Type:      in.Type,
				Tags:      in.Tags,
				URL:       in.URL,
				CreatedAt: nowKbStr(),
				UpdatedAt: nowKbStr(),
			}
			if doc.ID == "" {
				doc.ID = domain.IDPrefixDoc + randomHex4()
			}
			if doc.Type == "" {
				doc.Type = domain.KbDocTypeMarkdown
			}
			if doc.Tags == nil {
				doc.Tags = []string{}
			}
			cur.Docs = append(cur.Docs, doc)
			cur.UpdatedAt = nowKbStr()
			created = doc
			return nil
		})
		if err != nil {
			respondStoreErr(w, err, "知识库", "内置知识库不可修改")
			return
		}
		respondJSON(w, http.StatusOK, created)
	})

	r.Put("/kb/{id}/docs/{docId}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		docID := chi.URLParam(r2, "docId")
		var patch domain.KnowledgeDoc
		if err := decodeJSON(r2, &patch); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}

		var updated *domain.KnowledgeDoc
		var docNotFound bool
		_, err := s.Update(id, false, func(cur *domain.KnowledgeBase) error {
			docNotFound = true
			for i, d := range cur.Docs {
				if d.ID != docID {
					continue
				}
				docNotFound = false
				if patch.Title != "" {
					cur.Docs[i].Title = patch.Title
				}
				if patch.Content != "" {
					cur.Docs[i].Content = patch.Content
				}
				if patch.Type != "" {
					cur.Docs[i].Type = patch.Type
				}
				if patch.Tags != nil {
					cur.Docs[i].Tags = patch.Tags
				}
				if patch.URL != "" {
					cur.Docs[i].URL = patch.URL
				}
				cur.Docs[i].UpdatedAt = nowKbStr()
				updated = cur.Docs[i]
				cur.UpdatedAt = nowKbStr()
				return nil
			}
			return nil
		})
		if err != nil {
			respondStoreErr(w, err, "知识库", "内置知识库不可修改")
			return
		}
		if docNotFound {
			respondErr(w, http.StatusNotFound, "文档不存在")
			return
		}
		respondJSON(w, http.StatusOK, updated)
	})

	r.Delete("/kb/{id}/docs/{docId}", func(w http.ResponseWriter, r2 *http.Request) {
		id := chi.URLParam(r2, "id")
		docID := chi.URLParam(r2, "docId")

		var docNotFound bool
		_, err := s.Update(id, false, func(cur *domain.KnowledgeBase) error {
			docNotFound = true
			for i, d := range cur.Docs {
				if d.ID != docID {
					continue
				}
				docNotFound = false
				cur.Docs = append(cur.Docs[:i], cur.Docs[i+1:]...)
				cur.UpdatedAt = nowKbStr()
				return nil
			}
			return nil
		})
		if err != nil {
			respondStoreErr(w, err, "知识库", "内置知识库不可修改")
			return
		}
		if docNotFound {
			respondErr(w, http.StatusNotFound, "文档不存在")
			return
		}
		respondJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
}

// runSearch 收集要查的 KB 集合,交给 kb.Search 计算。
// 若 kbIDs 为空则搜全部。
func runSearch(s store.Store[*domain.KnowledgeBase], query string, kbIDs []string) []domain.KbSearchHit {
	var scope []*domain.KnowledgeBase
	if len(kbIDs) == 0 {
		scope = s.List()
	} else {
		for _, id := range kbIDs {
			kbObj, ok := s.Get(id)
			if !ok {
				continue
			}
			scope = append(scope, kbObj)
		}
	}
	return kb.Search(scope, query)
}

// randomHex4 生成 8 位 hex,给新文档做 id。
func randomHex4() string {
	buf := make([]byte, 4)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}
