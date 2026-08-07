package llm

import (
	"context"

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
)

// OpenaiProvider 封 eino-ext OpenAI-compatible ChatModel。
// 覆盖 DeepSeek / Kimi / Qwen / OpenAI / Ollama —— 一份代码通吃。
type OpenaiProvider struct {
	cm    *openai.ChatModel
	label string
}

func newOpenAI(ctx context.Context, cfg Config) (Provider, error) {
	temp := cfg.Temperature
	cm, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{
		APIKey:      cfg.APIKey,
		BaseURL:     cfg.BaseURL,
		Model:       cfg.Model,
		Temperature: &temp,
	})
	if err != nil {
		return nil, err
	}
	return &OpenaiProvider{
		cm:    cm,
		label: "openai(" + cfg.Model + ")",
	}, nil
}

func (p *OpenaiProvider) Complete(ctx context.Context, msgs []*schema.Message) (*schema.Message, error) {
	return p.cm.Generate(ctx, msgs)
}

// Stream 逐 token 流式生成。调用方负责 Close() 返回的 StreamReader。
func (p *OpenaiProvider) Stream(ctx context.Context, msgs []*schema.Message) (*schema.StreamReader[*schema.Message], error) {
	return p.cm.Stream(ctx, msgs)
}

// ChatModel 暴露底层 *openai.ChatModel 供 ADK ChatModelAgent 使用。
func (p *OpenaiProvider) ChatModel() model.BaseChatModel {
	return p.cm
}

func (p *OpenaiProvider) Available() bool { return true }

func (p *OpenaiProvider) Name() string { return p.label }
