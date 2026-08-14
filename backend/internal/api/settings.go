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
	"time"

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

	// POST /api/settings/llm/test —— 真连通性探测(发最小 chat 调用,验证鉴权+网络)。
	// 与 POST /api/settings/llm 区别: 不污染 ConfigManager 状态(临时构造 provider),
	// 8s 显式 ctx timeout 防 deepseek/anthropic 慢响应卡 UI。
	r.Post("/settings/llm/test", func(w http.ResponseWriter, req *http.Request) {
		var cfg llm.ModelConfig
		if err := decodeJSON(req, &cfg); err != nil {
			respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
			return
		}
		if cfg.APIKey == "" {
			respondJSON(w, http.StatusOK, map[string]any{
				"ok": false, "available": false, "error": "API key 为空",
			})
			return
		}
		baseURL := llm.ResolveBaseURL(cfg.Provider, cfg.BaseURL)
		if cfg.Temperature == 0 {
			cfg.Temperature = 0.7
		}
		p, err := llm.NewProbeProvider(req.Context(), llm.Config{
			APIKey: cfg.APIKey, BaseURL: baseURL, Model: cfg.Model, Temperature: cfg.Temperature,
		})
		if err != nil {
			respondJSON(w, http.StatusOK, map[string]any{
				"ok": false, "available": false, "error": "构造 provider 失败: " + err.Error(),
			})
			return
		}
		ctx, cancel := context.WithTimeout(req.Context(), 8*time.Second)
		defer cancel()
		if perr := p.Probe(ctx); perr != nil {
			respondJSON(w, http.StatusOK, map[string]any{
				"ok": false, "available": false, "error": perr.Error(),
			})
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{
			"ok": true, "available": true, "name": p.Name(),
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
