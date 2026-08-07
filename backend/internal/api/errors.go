// Package api 提供 HTTP 路由与 handler。
//
// 契约约定:
//   - 所有响应体统一为 JSON,Content-Type: application/json; charset=utf-8
//   - 错误响应格式:{"detail": "错误信息"},状态码非 2xx
//   - 前端 axios interceptor 只看 response.data.detail,状态码只区分 2xx / 非 2xx
package api

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"

	"paradigm_eino_backend/internal/store"
)

// respondJSON 写 JSON 响应,失败时降级为 500 detail。
func respondJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	buf, err := json.Marshal(payload)
	if err != nil {
		log.Printf("respondJSON: marshal failed: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"detail":"响应序列化失败"}`))
		return
	}
	w.WriteHeader(status)
	_, _ = w.Write(buf)
}

// respondErr 写 { detail } 错误响应。
func respondErr(w http.ResponseWriter, status int, detail string) {
	respondJSON(w, status, map[string]string{"detail": detail})
}

// respondStoreErr 把 store 层错误映射为合适的 HTTP 状态。
// resourceLabel 用于组装人类可读的 detail(如 "Agent 不存在")。
func respondStoreErr(w http.ResponseWriter, err error, resourceLabel, builtinDetail string) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		respondErr(w, http.StatusNotFound, resourceLabel+" 不存在")
	case errors.Is(err, store.ErrBuiltinLocked):
		respondErr(w, http.StatusBadRequest, builtinDetail)
	default:
		respondErr(w, http.StatusInternalServerError, err.Error())
	}
}

// decodeJSON 把请求体解为 target;若失败返回封装好的错误(包含前端可读 detail)。
//
// - 空 body 视为空对象,不报错
// - 不启用 DisallowUnknownFields —— 前端可能透传 id / builtin 等字段,后端应容忍
func decodeJSON(r *http.Request, target any) error {
	if r.Body == nil {
		return nil
	}
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(target); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		return err
	}
	return nil
}
