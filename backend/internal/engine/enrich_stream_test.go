package engine

import (
	"context"
	"strings"
	"testing"

	"github.com/cloudwego/eino/schema"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/llm"
	"paradigm_eino_backend/internal/store"
)

// streamMockProvider 把一段文本切成多帧回放,模拟真实 LLM 的逐 token 流式。
type streamMockProvider struct {
	frames []string
}

func (p *streamMockProvider) Complete(_ context.Context, _ []*schema.Message) (*schema.Message, error) {
	return &schema.Message{Role: schema.Assistant, Content: strings.Join(p.frames, "")}, nil
}
func (p *streamMockProvider) Stream(_ context.Context, _ []*schema.Message) (*schema.StreamReader[*schema.Message], error) {
	msgs := make([]*schema.Message, len(p.frames))
	for i, f := range p.frames {
		msgs[i] = &schema.Message{Role: schema.Assistant, Content: f}
	}
	return schema.StreamReaderFromArray(msgs), nil
}
func (p *streamMockProvider) Available() bool { return true }
func (p *streamMockProvider) Name() string    { return "stream-mock" }
func (p *streamMockProvider) Probe(ctx context.Context) error { return nil }

// TestEnrichContentStreamTokenSink 验证:enrichContentStream 会把每帧增量通过
// TokenSink 推出去(逐 token),并把累积正文写进 snapshot.enriched_framework。
func TestEnrichContentStreamTokenSink(t *testing.T) {
	snapStore := store.NewMemTaskSnapshotStore()
	seed := &domain.TaskSnapshot{
		Title:       "t",
		Brief:       "心衰 SGLT2",
		TaskType:    domain.TaskTypeArticle,
		Status:      domain.TaskStatusRunning,
		StepHistory: []domain.StepHistoryItem{},
		Spec:        domain.TaskSpec{},
	}
	created := snapStore.Create(seed)
	taskID := created.ThreadID

	// 一段合法 markdown 正文,切成 5 帧(含 3 个 H2 标题、>300 字)
	body := "## 一、背景\n" + strings.Repeat("心衰是常见的临床综合征。", 20) +
		"\n\n## 二、证据\n" + strings.Repeat("多项 RCT 支持 SGLT2i 获益。", 20) +
		"\n\n## 三、落地\n" + strings.Repeat("起始剂量与监测节点如下。", 20)
	// 切 5 帧
	n := len(body) / 5
	var frames []string
	for i := 0; i < len(body); i += n {
		end := i + n
		if end > len(body) {
			end = len(body)
		}
		frames = append(frames, body[i:end])
	}
	p := &streamMockProvider{frames: frames}

	// 收集 sink 收到的增量
	var got []string
	sink := func(node, delta string) {
		if node == "enrich_content" {
			got = append(got, delta)
		}
	}

	msgs := []*schema.Message{{Role: schema.User, Content: "填充"}}
	if err := enrichContentStream(context.Background(), taskID, snapStore, msgs, p, sink, nil, nil); err != nil {
		t.Fatalf("enrichContentStream 返回错误: %v", err)
	}

	// 1) sink 收到多帧增量
	if len(got) != len(frames) {
		t.Fatalf("sink 收到 %d 帧, 期望 %d 帧", len(got), len(frames))
	}
	// 2) 增量拼起来 == 原文
	if strings.Join(got, "") != body {
		t.Fatalf("拼接增量与原文不一致")
	}
	// 3) snapshot 写入了完整正文
	final, ok := snapStore.Get(taskID)
	if !ok {
		t.Fatal("snapshot 不存在")
	}
	if final.EnrichedFramework != body {
		t.Fatalf("enriched_framework 未正确写入; got len=%d want len=%d",
			len(final.EnrichedFramework), len(body))
	}
	// 4) step_history 追加了 enrich_content
	found := false
	for _, s := range final.StepHistory {
		if s.NodeID == "enrich_content" {
			found = true
		}
	}
	if !found {
		t.Fatal("step_history 未追加 enrich_content")
	}
}

// TestEnrichContentStreamEmptyErrors 验证:流式输出为空时返回 error,不写内容(不再回落 mock)。
func TestEnrichContentStreamEmptyErrors(t *testing.T) {
	snapStore := store.NewMemTaskSnapshotStore()
	created := snapStore.Create(&domain.TaskSnapshot{
		Title: "t", Brief: "x", TaskType: domain.TaskTypeArticle,
		Status: domain.TaskStatusRunning, StepHistory: []domain.StepHistoryItem{},
		Spec: domain.TaskSpec{},
	})
	taskID := created.ThreadID

	p := &streamMockProvider{frames: []string{"", ""}} // 空输出
	sink := func(_, _ string) {}

	err := enrichContentStream(context.Background(), taskID, snapStore,
		[]*schema.Message{{Role: schema.User, Content: "填充"}}, p, sink, nil, nil)
	if err == nil {
		t.Fatal("空输出应返回 error, 得到 nil")
	}

	final, _ := snapStore.Get(taskID)
	if final.EnrichedFramework != "" {
		t.Fatal("空输出不应写入 enriched_framework(不再回落 mock)")
	}
}

// TestEnrichContentStreamCapturesCitations 验证:当正文引用了来源池里的真实 URL 时,
// enrichContentStream 会把对应来源回填进 snapshot.Citations;未被引用的来源不回填。
func TestEnrichContentStreamCapturesCitations(t *testing.T) {
	snapStore := store.NewMemTaskSnapshotStore()
	created := snapStore.Create(&domain.TaskSnapshot{
		Title: "t", Brief: "心衰", TaskType: domain.TaskTypeArticle,
		Status: domain.TaskStatusRunning, StepHistory: []domain.StepHistoryItem{},
		Spec: domain.TaskSpec{},
	})
	taskID := created.ThreadID

	usedURL := "https://doi.org/10.1093/eurheartj/ehad195"
	unusedURL := "https://example.org/never-cited"
	sources := []domain.KbSearchHit{
		{DocID: "doc-esc", DocTitle: "ESC 2023", URL: usedURL},
		{DocID: "doc-unused", DocTitle: "未引用", URL: unusedURL},
	}
	body := "## 一、背景\n关键论断见[ESC 2023](" + usedURL + ")。" +
		strings.Repeat("补充说明。", 30) +
		"\n\n## 二、证据\n" + strings.Repeat("证据段落。", 30) +
		"\n\n## 三、落地\n" + strings.Repeat("落地要点。", 30)
	p := &streamMockProvider{frames: []string{body}}

	err := enrichContentStream(context.Background(), taskID, snapStore,
		[]*schema.Message{{Role: schema.User, Content: "填充"}}, p, func(_, _ string) {}, sources, nil)
	if err != nil {
		t.Fatalf("enrichContentStream 返回错误: %v", err)
	}

	final, _ := snapStore.Get(taskID)
	if len(final.Citations) != 1 {
		t.Fatalf("应回填 1 条被引用的 citation, 得到 %d", len(final.Citations))
	}
	if final.Citations[0].SourceURL != usedURL {
		t.Fatalf("回填的 citation URL 不符; got %q want %q", final.Citations[0].SourceURL, usedURL)
	}
}

// 确保 streamMockProvider 满足 llm.Provider(编译期断言)。
var _ llm.Provider = (*streamMockProvider)(nil)
