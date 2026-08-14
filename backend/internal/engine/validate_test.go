package engine

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/cloudwego/eino/schema"

	"paradigm_eino_backend/internal/domain"
)

// mockProvider 是 llm.Provider 的最小实现,按 replies 列表逐次回放,让我们可以精确编排"第一次坏、第二次好"这种场景。
type mockProvider struct {
	replies []string
	errs    []error
	calls   int
	lastMsg []*schema.Message // 记录最后一次调用的完整消息序列,用于断言 "补丁提示" 被追加
}

func (m *mockProvider) Complete(_ context.Context, msgs []*schema.Message) (*schema.Message, error) {
	m.lastMsg = msgs
	i := m.calls
	m.calls++
	if i < len(m.errs) && m.errs[i] != nil {
		return nil, m.errs[i]
	}
	if i < len(m.replies) {
		return &schema.Message{Role: schema.Assistant, Content: m.replies[i]}, nil
	}
	return &schema.Message{Role: schema.Assistant, Content: ""}, nil
}

func (m *mockProvider) Available() bool { return true }
func (m *mockProvider) Name() string    { return "mock" }

// Stream 把当前回放项作为单帧流返回,行为与 Complete 一致(测试够用)。
func (m *mockProvider) Stream(_ context.Context, msgs []*schema.Message) (*schema.StreamReader[*schema.Message], error) {
	m.lastMsg = msgs
	i := m.calls
	m.calls++
	if i < len(m.errs) && m.errs[i] != nil {
		return nil, m.errs[i]
	}
	content := ""
	if i < len(m.replies) {
		content = m.replies[i]
	}
	return schema.StreamReaderFromArray([]*schema.Message{
		{Role: schema.Assistant, Content: content},
	}), nil
}

// ---------- runWithValidation 通用行为 ----------

func TestRunWithValidation_HappyPath(t *testing.T) {
	m := &mockProvider{replies: []string{`{"topic":"心衰","audience":"主治","duration":"40 分钟","goal":"更新","meeting_type":"院内","enough":true,"missing":[]}`}}
	got, err := runWithValidation(context.Background(), m,
		[]*schema.Message{{Role: schema.User, Content: "x"}},
		parseBriefResponse, validateParseBrief, "parse_brief")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got.Info["topic"] != "心衰" || !got.Enough {
		t.Fatalf("bad result: %+v", got)
	}
	if m.calls != 1 {
		t.Fatalf("expected 1 call, got %d", m.calls)
	}
}

func TestRunWithValidation_RetryRecovers(t *testing.T) {
	// 第一次:合法 JSON,但业务违约(enough=true 且 missing 4 项)
	// 第二次:改好
	bad := `{"topic":"心衰","audience":"","duration":"","goal":"","meeting_type":"","enough":true,"missing":["a","b","c","d"]}`
	good := `{"topic":"心衰","audience":"主治","duration":"40 分钟","goal":"更新","meeting_type":"院内","enough":true,"missing":[]}`
	m := &mockProvider{replies: []string{bad, good}}

	got, err := runWithValidation(context.Background(), m,
		[]*schema.Message{{Role: schema.User, Content: "x"}},
		parseBriefResponse, validateParseBrief, "parse_brief")
	if err != nil {
		t.Fatalf("expected recovery, got err: %v", err)
	}
	if got.Info["topic"] != "心衰" {
		t.Fatalf("bad recovered result: %+v", got)
	}
	if m.calls != 2 {
		t.Fatalf("expected 2 calls, got %d", m.calls)
	}
	// 第二次调用应携带矫正提示 + 上一次的坏输出
	if len(m.lastMsg) < 3 {
		t.Fatalf("second call should have base + assistant + correction, got %d msgs", len(m.lastMsg))
	}
	last := m.lastMsg[len(m.lastMsg)-1]
	if last.Role != schema.User || !strings.Contains(last.Content, "校验") {
		t.Fatalf("last msg not a correction: %+v", last)
	}
	assistant := m.lastMsg[len(m.lastMsg)-2]
	if assistant.Role != schema.Assistant || assistant.Content != bad {
		t.Fatalf("assistant echo not preserved: %+v", assistant)
	}
}

func TestRunWithValidation_ExhaustedReturnsError(t *testing.T) {
	// 两次都坏 —— 中间件返 err,调用方据此把任务标为 failed。
	m := &mockProvider{replies: []string{"not json at all", "still not json"}}
	_, err := runWithValidation(context.Background(), m,
		[]*schema.Message{{Role: schema.User, Content: "x"}},
		parseBriefResponse, validateParseBrief, "parse_brief")
	if err == nil {
		t.Fatalf("expected error after exhausting attempts")
	}
	if m.calls != 2 {
		t.Fatalf("expected 2 calls, got %d", m.calls)
	}
}

func TestRunWithValidation_UpstreamErrorNoRetry(t *testing.T) {
	// llm 调用本身失败(网络等)—— 立刻返 err,不做二次尝试。
	m := &mockProvider{errs: []error{errors.New("connection reset")}}
	_, err := runWithValidation(context.Background(), m,
		[]*schema.Message{{Role: schema.User, Content: "x"}},
		parseBriefResponse, validateParseBrief, "parse_brief")
	if err == nil {
		t.Fatalf("expected err on upstream failure")
	}
	if m.calls != 1 {
		t.Fatalf("upstream failure should not retry, got %d calls", m.calls)
	}
}

// ---------- 每个 validator 各自的边界 ----------

func TestValidateParseBrief(t *testing.T) {
	cases := []struct {
		name string
		in   *ParsedBriefResult
		bad  bool
	}{
		{"ok", &ParsedBriefResult{Info: map[string]any{"topic": "x"}, Enough: false, Missing: []string{"a"}}, false},
		{"empty topic", &ParsedBriefResult{Info: map[string]any{"topic": ""}}, true},
		{"enough but too many missing", &ParsedBriefResult{Info: map[string]any{"topic": "x"}, Enough: true, Missing: []string{"a", "b", "c"}}, true},
	}
	for _, c := range cases {
		err := validateParseBrief(c.in)
		if (err != nil) != c.bad {
			t.Errorf("%s: got err=%v want bad=%v", c.name, err, c.bad)
		}
	}
}

func TestValidatePlanStrategy(t *testing.T) {
	ok := &PlanStrategyResult{Doc: "## 策略确认书\n\n背景 15% 关键证据 45%", NarrativeMode: "问题—证据—共识"}
	if err := validatePlanStrategy(ok); err != nil {
		t.Errorf("happy: %v", err)
	}
	if err := validatePlanStrategy(&PlanStrategyResult{Doc: "short", NarrativeMode: "x"}); err == nil {
		t.Errorf("short doc should fail")
	}
	if err := validatePlanStrategy(&PlanStrategyResult{Doc: strings.Repeat("a", 60), NarrativeMode: ""}); err == nil {
		t.Errorf("empty mode should fail")
	}
	if err := validatePlanStrategy(&PlanStrategyResult{Doc: strings.Repeat("a", 60), NarrativeMode: "x"}); err == nil {
		t.Errorf("no weight/percent should fail")
	}
}

func TestValidateBuildFramework(t *testing.T) {
	ok := &BuildFrameworkResult{Sections: []map[string]any{
		{"title": "一", "weight": 0.25},
		{"title": "二", "weight": 0.25},
		{"title": "三", "weight": 0.25},
		{"title": "四", "weight": 0.25},
	}}
	if err := validateBuildFramework(ok); err != nil {
		t.Errorf("happy: %v", err)
	}
	tooFew := &BuildFrameworkResult{Sections: []map[string]any{{"title": "x", "weight": 1.0}}}
	if err := validateBuildFramework(tooFew); err == nil {
		t.Errorf("too few sections should fail")
	}
	badSum := &BuildFrameworkResult{Sections: []map[string]any{
		{"title": "a", "weight": 0.1}, {"title": "b", "weight": 0.1},
		{"title": "c", "weight": 0.1}, {"title": "d", "weight": 0.1},
	}}
	if err := validateBuildFramework(badSum); err == nil {
		t.Errorf("sum 0.4 should fail")
	}
	emptyTitle := &BuildFrameworkResult{Sections: []map[string]any{
		{"title": "", "weight": 0.25}, {"title": "b", "weight": 0.25},
		{"title": "c", "weight": 0.25}, {"title": "d", "weight": 0.25},
	}}
	if err := validateBuildFramework(emptyTitle); err == nil {
		t.Errorf("empty title should fail")
	}
}

func TestValidateEnrichContent(t *testing.T) {
	body := "## 一、背景\n\n" + strings.Repeat("这是一段正文内容不少于三百字。", 30) +
		"\n\n## 二、证据\n\n" + strings.Repeat("段落。", 30) +
		"\n\n## 三、要点\n\n" + strings.Repeat("段落。", 30)
	if err := validateEnrichContent(&EnrichContentResult{Body: body}); err != nil {
		t.Errorf("happy: %v", err)
	}
	if err := validateEnrichContent(&EnrichContentResult{Body: "## 一\n\n短短短"}); err == nil {
		t.Errorf("too few H2 should fail")
	}
	shortAllH2 := "## 一\n## 二\n## 三\n就这几个字"
	if err := validateEnrichContent(&EnrichContentResult{Body: shortAllH2}); err == nil {
		t.Errorf("too short body should fail")
	}
}

// 回归测试:enricher 的 parser 必须
// (1) 优先解 JSON envelope,把 enriched_framework 字段的字符串取出来当正文,
//     绝不能把整段 {"enriched_framework": ...} JSON 原样存进终稿(这是上一版 bug)
// (2) 兼容旧的 markdown-直出行为(不严格按 JSON 输出的模型仍能跑)
// (3) 拒绝坏 JSON(以 { 开头但解不出 enriched_framework)当 markdown 渲染
func TestParseEnrichContentResponse_JSONEnvelope(t *testing.T) {
	// (1) 合法 JSON envelope —— 只取出 body,不带 JSON 结构
	inner := "## 一、背景\n\n正文段落。\n\n## 二、证据\n\n更多正文。\n\n## 三、要点\n\n要点内容。"
	// 用 encoding/json 生成 escaped 字符串,免手拼引号
	jsonInput := `{"enriched_framework": ` + jsonQuote(inner) + `, "citations": [], "unresolved": []}`
	body, err := parseEnrichContentResponse(jsonInput)
	if err != nil {
		t.Fatalf("json envelope: %v", err)
	}
	if strings.HasPrefix(body, "{") || strings.Contains(body, `"enriched_framework"`) {
		t.Errorf("body 不应包含 JSON 结构,got: %q", body[:min(80, len(body))])
	}
	if !strings.Contains(body, "## 一、背景") {
		t.Errorf("markdown 内容丢失: %q", body[:min(80, len(body))])
	}
}

func TestParseEnrichContentResponse_MarkdownFallback(t *testing.T) {
	// (2) 直接 markdown —— 兼容路径
	md := "## 一\n\n" + strings.Repeat("字", 40) + "\n\n## 二\n\n更多"
	body, err := parseEnrichContentResponse(md)
	if err != nil {
		t.Fatalf("markdown fallback: %v", err)
	}
	if body != md {
		t.Errorf("markdown 应原样返回")
	}
}

func TestParseEnrichContentResponse_RejectsMalformedJSON(t *testing.T) {
	// (3) 以 { 开头但 enriched_framework 字段缺失 —— 必须拒绝,不能把 JSON 结构当 markdown
	bad := `{"citations":[], "note":"这里有 ## 一 的假标题"}`
	_, err := parseEnrichContentResponse(bad)
	if err == nil {
		t.Errorf("坏 JSON envelope 应拒绝,不能当 markdown 渲染")
	}
}

// jsonQuote 用 encoding/json 生成合法转义的 JSON 字符串字面量。
func jsonQuote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestValidateReviewQuality(t *testing.T) {
	okPass := &ReviewQualityResult{
		Verdict: "pass",
		Report: &domain.ReviewReport{
			Overall:       "pass",
			StrategyItems: []domain.ReviewItem{{Dimension: "d", Verdict: "pass"}},
			QualityItems:  []domain.ReviewItem{{Dimension: "d", Verdict: "pass"}},
			Advices:       []string{},
		},
	}
	if err := validateReviewQuality(okPass); err != nil {
		t.Errorf("happy pass: %v", err)
	}

	// pass 却带了建议 —— 违约
	passWithAdvice := &ReviewQualityResult{
		Verdict: "pass",
		Report: &domain.ReviewReport{
			Overall: "pass",
			Advices: []string{"补充"},
		},
	}
	if err := validateReviewQuality(passWithAdvice); err == nil {
		t.Errorf("pass with advices should fail")
	}

	// revise 但没有建议 —— 违约
	reviseNoAdvice := &ReviewQualityResult{
		Verdict: "revise",
		Report: &domain.ReviewReport{
			Overall: "revise",
			Advices: []string{},
		},
	}
	if err := validateReviewQuality(reviseNoAdvice); err == nil {
		t.Errorf("revise without advices should fail")
	}

	// verdict 非枚举值
	badVerdict := &ReviewQualityResult{
		Verdict: "maybe",
		Report:  &domain.ReviewReport{Overall: "maybe"},
	}
	if err := validateReviewQuality(badVerdict); err == nil {
		t.Errorf("invalid verdict should fail")
	}

	// item.verdict 非枚举值
	badItem := &ReviewQualityResult{
		Verdict: "revise",
		Report: &domain.ReviewReport{
			Overall:       "revise",
			StrategyItems: []domain.ReviewItem{{Dimension: "d", Verdict: "great"}},
			Advices:       []string{"改"},
		},
	}
	if err := validateReviewQuality(badItem); err == nil {
		t.Errorf("invalid item verdict should fail")
	}

	// ─── 阶段 6 workbuddy 借鉴:target_node 白名单校验 ─────────
	// revise + target_node 合法值 → 通过
	reviseValidTarget := &ReviewQualityResult{
		Verdict: "revise",
		Report: &domain.ReviewReport{
			Overall:    "revise",
			Advices:    []string{"改一改"},
			TargetNode: "plan_strategy",
		},
	}
	if err := validateReviewQuality(reviseValidTarget); err != nil {
		t.Errorf("revise + target=plan_strategy: %v", err)
	}
	if reviseValidTarget.Report.TargetNode != "plan_strategy" {
		t.Errorf("合法 target_node 不应被改写,实际=%q", reviseValidTarget.Report.TargetNode)
	}

	// revise + target_node 非法值 → 降级为 enrich_content,不报错
	reviseBadTarget := &ReviewQualityResult{
		Verdict: "revise",
		Report: &domain.ReviewReport{
			Overall:    "revise",
			Advices:    []string{"改一改"},
			TargetNode: "magic_node", // 非法
		},
	}
	if err := validateReviewQuality(reviseBadTarget); err != nil {
		t.Errorf("revise + 非法 target_node 应降级不报错,实际 error: %v", err)
	}
	if reviseBadTarget.Report.TargetNode != "enrich_content" {
		t.Errorf("非法 target_node 应降级为 enrich_content,实际=%q", reviseBadTarget.Report.TargetNode)
	}

	// revise + target_node 缺省 → 通过(保持空字符串,引擎后续默认 enrich_content)
	reviseEmptyTarget := &ReviewQualityResult{
		Verdict: "revise",
		Report: &domain.ReviewReport{
			Overall:    "revise",
			Advices:    []string{"改一改"},
			TargetNode: "",
		},
	}
	if err := validateReviewQuality(reviseEmptyTarget); err != nil {
		t.Errorf("revise + 空 target_node 应通过,实际 error: %v", err)
	}
}

func TestParseFrameworkResponse_NestedEnvelope(t *testing.T) {
	// builder system_prompt 声明的信封形状: {"framework_skeleton": {"sections": [...]}}
	// section 还带 outline/bullets 等额外字段, 应被忽略。
	input := `{"framework_skeleton":{"sections":[
	  {"title":"一、背景","weight":0.25,"outline":"概述","bullets":["a","b"]},
	  {"title":"二、证据","weight":0.75,"outline":"证据","bullets":["c"]}
	]}}`
	r, err := parseFrameworkResponse(input)
	if err != nil {
		t.Fatalf("嵌套信封解析失败: %v", err)
	}
	if len(r.Sections) != 2 {
		t.Fatalf("期望 2 个 section, 得到 %d", len(r.Sections))
	}
	if r.Sections[0]["title"] != "一、背景" {
		t.Fatalf("title 解析错误: %v", r.Sections[0]["title"])
	}
}

func TestParseFrameworkResponse_FlatShape(t *testing.T) {
	// 扁平形状仍然支持。
	input := `{"sections":[{"title":"一","weight":0.5},{"title":"二","weight":0.5}]}`
	r, err := parseFrameworkResponse(input)
	if err != nil {
		t.Fatalf("扁平形状解析失败: %v", err)
	}
	if len(r.Sections) != 2 {
		t.Fatalf("期望 2 个 section, 得到 %d", len(r.Sections))
	}
}

func TestExtractJSON_StripsThinkBlock(t *testing.T) {
	// qwen 等推理模型的典型输出:<think> 块含 schema 模板样 JSON(空 sections),
	// 正文才是真答案。extractJSON 必须先剥离 think 块,否则误抓空 JSON。
	input := "<think>先看 schema:{\"sections\": []},我照着填</think>\n{\"sections\":[{\"title\":\"一、背景\",\"weight\":0.15}]}"
	raw, err := extractJSON(input)
	if err != nil {
		t.Fatalf("extractJSON error: %v", err)
	}
	if strings.Contains(string(raw), "\"sections\": []") {
		t.Fatalf("误抓了 think 块里的空 sections: %s", string(raw))
	}
	if !strings.Contains(string(raw), "背景") {
		t.Fatalf("未抓到正文 JSON: %s", string(raw))
	}
}

func TestExtractJSON_NoThinkBlockUnaffected(t *testing.T) {
	input := "{\"sections\":[{\"title\":\"一\",\"weight\":0.3}]}"
	raw, err := extractJSON(input)
	if err != nil {
		t.Fatalf("extractJSON error: %v", err)
	}
	if !strings.Contains(string(raw), "sections") {
		t.Fatalf("正常输出被破坏: %s", string(raw))
	}
}

func TestParsePlanStrategy_JSONEnvelope(t *testing.T) {
	// planner system_prompt 声明的信封: {"strategy_doc": "...", "narrative_mode": "..."}
	// strategy_doc 里的 \n 必须被 JSON 解析成真实换行, 不能把整段 JSON 当 markdown 存。
	input := `{"strategy_doc":"## 策略确认书\n\n会议类型:医学综述\n\n叙事模式:问题—证据—共识\n\n1. 背景(25%)\n2. 证据(30%)","narrative_mode":"问题—证据—共识","meeting_type":"综述","academic_commercial_ratio":[85,15]}`
	r, err := parsePlanStrategyResponse(input)
	if err != nil {
		t.Fatalf("JSON 信封解析失败: %v", err)
	}
	if strings.HasPrefix(strings.TrimSpace(r.Doc), "{") {
		t.Fatalf("strategy_doc 仍是原始 JSON, 未抽取内层 markdown: %q", r.Doc)
	}
	if !strings.HasPrefix(strings.TrimSpace(r.Doc), "## 策略确认书") {
		t.Fatalf("strategy_doc 未正确抽取: %q", r.Doc)
	}
	if strings.Contains(r.Doc, `\n`) {
		t.Fatalf("strategy_doc 内 \n 未被解析成真实换行: %q", r.Doc)
	}
	if r.NarrativeMode != "问题—证据—共识" {
		t.Fatalf("narrative_mode 解析错误: %q", r.NarrativeMode)
	}
}

func TestParsePlanStrategy_MarkdownFallback(t *testing.T) {
	// 模型直接输出 markdown(非 JSON)时, 仍应正常处理并从正文抽叙事模式。
	input := "## 策略确认书\n\n会议类型:内部培训\n\n叙事模式:时间轴\n\n1. 背景(50%)\n2. 落地(50%)"
	r, err := parsePlanStrategyResponse(input)
	if err != nil {
		t.Fatalf("markdown 直出解析失败: %v", err)
	}
	if r.NarrativeMode != "时间轴" {
		t.Fatalf("未从正文抽到叙事模式: %q", r.NarrativeMode)
	}
	if !strings.HasPrefix(r.Doc, "## 策略确认书") {
		t.Fatalf("markdown 正文被破坏: %q", r.Doc)
	}
}
