// Package llm 提供任务图 compute 节点的 LLM 调用抽象。
//
// 设计要点:
//   - 只暴露 Provider 接口(Complete / Available / Name),不锁死具体实现。
//   - LLM_API_KEY 未配置时,FromEnv 返回 Unavailable{},让所有 compute 节点自动回落 mock —— 与 S2a 行为一致。
//   - S2b 只做 openai-compatible 单通道,覆盖 DeepSeek / Kimi / Qwen / OpenAI / Ollama —— 一份代码通吃。
//   - 支持前端动态配置多种模型供应商,运行时可切换。
package llm

import (
	"context"
	"errors"
	"log"
	"os"
	"strconv"
	"sync"

	"github.com/cloudwego/eino/schema"
)

// Provider 是 compute 节点共用的最小 LLM 调用面。
type Provider interface {
	// Complete 输入若干消息,返回 assistant 消息(非流式)。
	Complete(ctx context.Context, messages []*schema.Message) (*schema.Message, error)

	// Stream 输入若干消息,返回逐 token 增量的 StreamReader。
	// 调用方负责 Close(),每帧 Content 是增量文本(非累积)。
	// Unavailable 直接返回 ErrUnavailable。
	Stream(ctx context.Context, messages []*schema.Message) (*schema.StreamReader[*schema.Message], error)

	// Available 返回 provider 是否可用(false 时节点回落 mock)。
	Available() bool

	// Name 供日志用,如 "openai(deepseek-chat)" / "unavailable"。
	Name() string
}

// ErrUnavailable 由 Unavailable{}.Complete 返回。
var ErrUnavailable = errors.New("llm provider not configured (LLM_API_KEY empty)")

// Unavailable 是无 API key 时的 zero provider。Complete 直接报错,调用方回落 mock。
type Unavailable struct{}

func (Unavailable) Complete(context.Context, []*schema.Message) (*schema.Message, error) {
	return nil, ErrUnavailable
}
func (Unavailable) Stream(context.Context, []*schema.Message) (*schema.StreamReader[*schema.Message], error) {
	return nil, ErrUnavailable
}
func (Unavailable) Available() bool { return false }
func (Unavailable) Name() string    { return "unavailable" }

// Config 前端传来的单个供应商配置。
type ModelConfig struct {
	Provider    string `json:"provider"` // "deepseek" | "claude" | "openai" | "tongyi" | "custom"
	Model       string `json:"model"`
	APIKey      string `json:"api_key"`
	BaseURL     string `json:"base_url"`
	Temperature float32 `json:"temperature"`
}

// ConfigManager 管理全局 LLM 配置,支持动态更新。
//
// 所有 LLM 调用都使用当前配置的主模型。
type ConfigManager struct {
	mu     sync.RWMutex
	current Provider
}

// NewConfigManager 创建管理器,初始化为环境变量加载的 provider。
func NewConfigManager(ctx context.Context) *ConfigManager {
	return &ConfigManager{
		current: FromEnv(ctx),
	}
}

// Get 获取当前 provider。
func (m *ConfigManager) Get() Provider {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.current
}

// Update 更新配置,重新初始化 provider。
func (m *ConfigManager) Update(ctx context.Context, cfg ModelConfig) error {
	if cfg.APIKey == "" {
		m.mu.Lock()
		m.current = Unavailable{}
		m.mu.Unlock()
		log.Printf("[llm] config updated: API key empty, fallback to unavailable")
		return nil
	}

	// 所有供应商都是 OpenAI 兼容格式,直接用 openai client
	baseURL := cfg.BaseURL
	if baseURL == "" {
		switch cfg.Provider {
		case "deepseek":
			baseURL = "https://api.deepseek.com/v1"
		case "claude":
			baseURL = "https://api.anthropic.com/v1"
		case "openai":
			baseURL = "https://api.openai.com/v1"
		case "tongyi":
			baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
		case "zhipu":
			baseURL = "https://open.bigmodel.cn/api/paas/v4"
		case "baidu":
			baseURL = "https://api-doc.baidubce.com/compatible-mode/v1"
		case "dianciyuann":
			baseURL = "https://api.aa.com.cn/api/v1"
		}
	}

	if cfg.Temperature == 0 {
		cfg.Temperature = 0.7
	}

	conf := Config{
		APIKey:      cfg.APIKey,
		BaseURL:     baseURL,
		Model:       cfg.Model,
		Temperature: cfg.Temperature,
	}

	p, err := newOpenAI(ctx, conf)
	if err != nil {
		log.Printf("[llm] init openai provider failed: %v", err)
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	m.current = p
	log.Printf("[llm] config updated: provider=%s model=%s base_url=%s available=%v",
		cfg.Provider, cfg.Model, baseURL, p.Available())
	return nil
}

// Config 是构造 openaiProvider 的入参。
type Config struct {
	APIKey      string
	BaseURL     string  // 空时走 OpenAI 官方 https://api.openai.com/v1
	Model       string  // 如 deepseek-chat / gpt-4o-mini
	Temperature float32 // 默认 0.7
}

// FromEnv 从环境变量读配置。
//
// 支持:
//
//	LLM_API_KEY     必填;未设时返回 Unavailable{}
//	LLM_BASE_URL    可选;DeepSeek 用 https://api.deepseek.com/v1
//	LLM_MODEL       可选;默认 gpt-4o-mini(占位)
//	LLM_TEMPERATURE 可选;默认 0.7
func FromEnv(ctx context.Context) Provider {
	apiKey := os.Getenv("LLM_API_KEY")
	if apiKey == "" {
		return Unavailable{}
	}
	cfg := Config{
		APIKey:      apiKey,
		BaseURL:     os.Getenv("LLM_BASE_URL"),
		Model:       envOr("LLM_MODEL", "gpt-4o-mini"),
		Temperature: parseFloat32(os.Getenv("LLM_TEMPERATURE"), 0.7),
	}
	p, err := newOpenAI(ctx, cfg)
	if err != nil {
		log.Printf("[llm] init openai provider failed: %v; falling back to Unavailable", err)
		return Unavailable{}
	}
	return p
}

func envOr(key, fallback string) string {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	return v
}

func parseFloat32(s string, fallback float32) float32 {
	if s == "" {
		return fallback
	}
	f, err := strconv.ParseFloat(s, 32)
	if err != nil {
		return fallback
	}
	return float32(f)
}
