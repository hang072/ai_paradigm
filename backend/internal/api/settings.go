// Package api 提供 HTTP 路由与 handler。
//
// 本文件实现 /api/settings/* 端点。
//
// - GET/POST /api/settings/llm       兼容旧行为: 单个 ModelConfig 生效状态 (更新 ConfigManager)
// - GET/PUT  /api/settings/llm_prefs  持久化前端整份 { activeConfigId, modelConfigs, ... } JSON 到 SQLite
//   前端 boot 时先 GET /api/settings/llm_prefs 恢复 store,替代 localStorage。
package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"paradigm_eino_backend/internal/llm"
	"paradigm_eino_backend/internal/store/sqlite"
)

const settingsKeyLLMPrefs = "llm_prefs"

// mountSettings 挂载 /api/settings 路由。
func mountSettings(r chi.Router, mgr *llm.ConfigManager, settings *sqlite.Settings) {
	r.Get("/settings/llm", func(w http.ResponseWriter, req *http.Request) {
		respondJSON(w, http.StatusOK, map[string]any{
			"available": mgr.Get().Available(),
			"name":      mgr.Get().Name(),
		})
	})

	r.Post("/settings/llm", func(w http.ResponseWriter, req *http.Request) {
		var cfg llm.ModelConfig
		if err := decodeJSON(req, &cfg); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		if err := mgr.Update(context.Background(), cfg); err != nil {
			respondErr(w, http.StatusInternalServerError, "更新配置失败: "+err.Error())
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{
			"ok":        true,
			"available": mgr.Get().Available(),
			"name":      mgr.Get().Name(),
		})
	})

	// 前端整份偏好设置 (含 modelConfigs 列表 + activeConfigId) 持久化。
	r.Get("/settings/llm_prefs", func(w http.ResponseWriter, req *http.Request) {
		raw, ok, err := settings.Get(settingsKeyLLMPrefs)
		if err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			// 空:前端沿用默认初始化
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`null`))
			return
		}
		// raw 已是 JSON, 原样返回。
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(raw))
	})

	r.Put("/settings/llm_prefs", func(w http.ResponseWriter, req *http.Request) {
		// 直接读原始 body 存 JSON, 允许任意 shape (前端形状可能演进)
		var payload any
		if err := decodeJSON(req, &payload); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		buf, err := json.Marshal(payload)
		if err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := settings.Set(settingsKeyLLMPrefs, string(buf)); err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
}
