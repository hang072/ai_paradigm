package engine

import (
	"context"
	"errors"
	"io"
	"log"
	"math/rand"
	"strings"

	"github.com/cloudwego/eino/schema"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/kb"
	"paradigm_eino_backend/internal/llm"
	"paradigm_eino_backend/internal/store"
)

// applyParseBrief 填 parsed_info + completeness。40% 概率 enough=true(即跳过澄清)。
// 对齐前端 mock engine 的 stepParseBrief。
func applyParseBrief(s *domain.TaskSnapshot) {
	s.ParsedInfo = map[string]any{
		"topic":        ExtractTopic(s.Brief),
		"audience":     "(mock) 主治医师",
		"duration":     durationForType(s.TaskType),
		"goal":         "(mock) 学术更新",
		"meeting_type": "院内学术会议",
	}
	// 前端 mock:Math.random() > 0.5 → 有一半概率 enough
	enough := rand.Float64() > 0.5
	s.Completeness = map[string]any{
		"enough":  enough,
		"missing": []string{},
	}
	addMessage(s, "[parse_brief] 已解析需求")
	pushStep(s, "parse_brief", []string{"parsed_info"}, false)
}

func durationForType(t domain.TaskType) string {
	if t == domain.TaskTypeSlide {
		return "40 分钟"
	}
	return "N/A"
}

// applyAskClarification 生成 3 道澄清题。
func applyAskClarification(s *domain.TaskSnapshot) {
	s.ClarifyQuestions = []domain.ClarifyQuestion{
		{Question: "本次讲课的核心目标听众是?", Options: []string{"主治医师", "住院医师", "研究生", "不限"}},
		{Question: "预期时长?", Options: []string{"20 分钟", "40 分钟", "60 分钟", "90 分钟"}},
		{Question: "侧重方向?", Options: []string{"诊断", "治疗", "综合", "前沿进展"}},
	}
	pushStep(s, "ask_clarification", []string{}, false)
}

// applySkipClarification 记录跳过澄清的日志。
func applySkipClarification(s *domain.TaskSnapshot) {
	addMessage(s, "[ask_clarification] 需求充分,跳过澄清")
	pushStep(s, "ask_clarification", []string{}, true)
}

// applyPlanStrategy 生成 mock 策略确认书。
func applyPlanStrategy(s *domain.TaskSnapshot) {
	topic := ExtractTopic(s.Brief)
	if s.ParsedInfo != nil {
		if v, ok := s.ParsedInfo["topic"].(string); ok && v != "" {
			topic = v
		}
	}
	s.StrategyDoc = "## 策略确认书(mock)\n\n" +
		"- **主题**:" + topic + "\n" +
		"- **类型**:" + string(s.TaskType) + "\n" +
		"- **会议类型**:院内学术会议\n" +
		"- **学术/商业配比**:90% / 10%\n" +
		"- **叙事模式**:问题—证据—共识\n" +
		"- **章节权重**:\n  - 背景 · 15%\n  - 关键证据 · 45%\n  - 落地要点 · 30%\n  - 展望 · 10%"
	s.NarrativeMode = "问题—证据—共识"
	addMessage(s, "[plan_strategy] 已生成策略确认书")
	pushStep(s, "plan_strategy", []string{"strategy_doc", "narrative_mode"}, false)
}

// applyBuildFramework 生成 4 章节骨架。
func applyBuildFramework(s *domain.TaskSnapshot) {
	s.FrameworkSkeleton = map[string]any{
		"sections": []map[string]any{
			{"title": "一、背景与流行病学", "weight": 0.15},
			{"title": "二、关键 RCT 与指南更新", "weight": 0.45},
			{"title": "三、临床落地要点", "weight": 0.30},
			{"title": "四、展望", "weight": 0.10},
		},
	}
	addMessage(s, "[build_framework] 已搭建 4 章节目录")
	pushStep(s, "build_framework", []string{"framework_skeleton"}, false)
}

// applyEnrichContent 填 enriched_framework;若有 feedback,追加提示。
func applyEnrichContent(s *domain.TaskSnapshot, feedback string) {
	suffix := ""
	if feedback != "" {
		short := feedback
		if len([]rune(feedback)) > 40 {
			short = string([]rune(feedback))[:40] + "..."
		}
		suffix = "\n\n> 已根据反馈调整:" + short + "\n"
	}
	s.EnrichedFramework = "## 一、背景与流行病学\n\n(mock) 相关流行病学数据…" + suffix + "\n\n" +
		"## 二、关键 RCT 与指南更新\n\n(mock) 引用 EMPEROR-Reduced / DAPA-HF 等关键研究…\n\n" +
		"## 三、临床落地要点\n\n(mock) 用药起始时机、剂量滴定、监测节点…\n\n" +
		"## 四、展望\n\n(mock) 新型靶点与研发管线…"
	addMessage(s, "[enrich_content] 已填充内容 (revision="+itoa(s.RevisionCount)+")")
	pushStep(s, "enrich_content", []string{"enriched_framework"}, false)
}

// applyReviewQuality 生成审核报告。首次运行且 40% 概率 verdict=revise;其余 pass。
// 返回 verdict 供分支节点用。
func applyReviewQuality(s *domain.TaskSnapshot) string {
	overall := "pass"
	if s.RevisionCount == 0 && rand.Float64() < 0.4 {
		overall = "revise"
	}
	report := &domain.ReviewReport{
		Overall: overall,
		StrategyItems: []domain.ReviewItem{
			{Dimension: "学术/商业配比", Verdict: "pass", Note: "与策略书一致"},
			{Dimension: "章节配比", Verdict: "pass", Note: "误差 <5%"},
		},
	}
	if overall == "pass" {
		report.QualityItems = []domain.ReviewItem{
			{Dimension: "文献支撑", Verdict: "pass", Note: "关键论断均有引用"},
			{Dimension: "结构合理性", Verdict: "pass", Note: "四段式清晰"},
		}
		report.Advices = []string{}
	} else {
		report.QualityItems = []domain.ReviewItem{
			{Dimension: "文献支撑", Verdict: "warn", Note: "部分论断缺少引用"},
			{Dimension: "结构合理性", Verdict: "pass", Note: "四段式清晰"},
		}
		report.Advices = []string{"补充第二章关键 RCT 的原始文献引用", "第三章加入用药监测节点表格"}
	}
	s.ReviewReport = report
	addMessage(s, "[review_quality] verdict="+overall)
	pushStep(s, "review_quality", []string{"review_report"}, false)
	return overall
}

// applyBumpRevision revision_count++,记录一条历史。
func applyBumpRevision(s *domain.TaskSnapshot) {
	s.RevisionCount += 1
	addMessage(s, "[route_after_review] 触发修订回路,revision="+itoa(s.RevisionCount))
	pushStep(s, "bump_revision", []string{"revision_count"}, false)
}

// applyForcedHumanFinal 强制通过审核(修订次数达到上限)。
func applyForcedHumanFinal(s *domain.TaskSnapshot) {
	addMessage(s, "[route_after_review] 达到最大修订次数,强制通过")
}

// applyHumanFinal 记录 human_final step_history。
func applyHumanFinal(s *domain.TaskSnapshot) {
	pushStep(s, "human_final", []string{}, false)
}

// applyFinalize 汇总 final_output,status=done。
func applyFinalize(s *domain.TaskSnapshot) {
	body := s.EnrichedFramework
	if body == "" {
		body = "(空)"
	}
	s.FinalOutput = "# " + s.Title + "\n\n> 最终定稿 · 类型:" + string(s.TaskType) + "\n\n" + body
	addMessage(s, "[finalize] 已定稿")
	pushStep(s, "finalize", []string{"final_output"}, false)
	s.Status = domain.TaskStatusDone
	s.Pending = nil
}

// itoa 简易 int→string,避免引 strconv。
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// ==================== S2b · LLM 变体 ====================
//
// 每个 compute 步骤都提供 applyXxxLLM(ctx, snap, configMgr, agents) error:
//   1. 每次从 configMgr 获取当前激活的 provider,支持运行时切换
//   2. provider 不可用 / 调用失败 / 输出解析校验失败 / 空输出 → 返回 error
//      调用方(graph 节点)把 error 冒泡到 executor 的 failed 分支。
//      不再回落 mock —— 产品要求真实 LLM 结果,失败即失败。
//   3. 成功 → 用 LLM 输出更新 snapshot,message 里标 provider 名字
//
// interrupt / router / passthrough / bump_revision / finalize 节点不涉及 LLM。
// 纯 mock 的 applyXxx 函数保留(单测与数据形状参考用),LLM 路径不再调用。
//
// 关键:
//   - LLM 调用必须在 store 写锁之外发生,否则长请求会 block 所有 GET。
//     做法:先短 RLock 拷贝 snapshot 渲染 prompt,无锁调 LLM,最后短写锁 apply。
//   - 每个 LLM 调用用 context.WithTimeout 包住(llmTimeout()),
//     provider 挂起时快速失败为 failed,而不是永久卡住。
func applyParseBriefLLM(ctx context.Context, taskID string, snapStore store.TaskSnapshotStore, configMgr *llm.ConfigManager, agents agentSource) error {
	p := configMgr.Get()
	if !p.Available() {
		return errors.New("parse_brief: LLM provider 未配置")
	}
	ctx, cancel := context.WithTimeout(ctx, llmTimeout())
	defer cancel()

	snap, ok := snapStore.Get(taskID)
	if !ok {
		return errors.New("parse_brief: task snapshot 丢失")
	}
	msgs := renderParseBriefMessages(snap, agents)
	parsed, err := runWithValidation(ctx, p, msgs,
		parseBriefResponse, validateParseBrief, "parse_brief")
	if err != nil {
		log.Printf("[llm/parse_brief] %v", err)
		return err
	}
	providerName := p.Name()
	_, _ = snapStore.Update(taskID, func(s *domain.TaskSnapshot) {
		s.ParsedInfo = parsed.Info
		s.Completeness = map[string]any{"enough": parsed.Enough, "missing": parsed.Missing}
		addMessage(s, "[parse_brief] LLM 已解析需求 ("+providerName+")")
		pushStep(s, "parse_brief", []string{"parsed_info"}, false)
	})
	return nil
}

// applyPlanStrategyLLM 见 applyPlanStrategy。
func applyPlanStrategyLLM(ctx context.Context, taskID string, snapStore store.TaskSnapshotStore, configMgr *llm.ConfigManager, agents agentSource) error {
	p := configMgr.Get()
	if !p.Available() {
		return errors.New("plan_strategy: LLM provider 未配置")
	}
	ctx, cancel := context.WithTimeout(ctx, llmTimeout())
	defer cancel()

	snap, ok := snapStore.Get(taskID)
	if !ok {
		return errors.New("plan_strategy: task snapshot 丢失")
	}
	msgs := renderPlanStrategyMessages(snap, agents)
	parsed, err := runWithValidation(ctx, p, msgs,
		parsePlanStrategyResponse, validatePlanStrategy, "plan_strategy")
	if err != nil {
		log.Printf("[llm/plan_strategy] %v", err)
		return err
	}
	providerName := p.Name()
	_, _ = snapStore.Update(taskID, func(s *domain.TaskSnapshot) {
		s.StrategyDoc = parsed.Doc
		s.NarrativeMode = parsed.NarrativeMode
		addMessage(s, "[plan_strategy] LLM 已生成策略确认书 ("+providerName+")")
		pushStep(s, "plan_strategy", []string{"strategy_doc", "narrative_mode"}, false)
	})
	return nil
}

// applyBuildFrameworkLLM 见 applyBuildFramework。
func applyBuildFrameworkLLM(ctx context.Context, taskID string, snapStore store.TaskSnapshotStore, configMgr *llm.ConfigManager, agents agentSource) error {
	p := configMgr.Get()
	if !p.Available() {
		return errors.New("build_framework: LLM provider 未配置")
	}
	ctx, cancel := context.WithTimeout(ctx, llmTimeout())
	defer cancel()

	snap, ok := snapStore.Get(taskID)
	if !ok {
		return errors.New("build_framework: task snapshot 丢失")
	}
	msgs := renderBuildFrameworkMessages(snap, agents)
	parsed, err := runWithValidation(ctx, p, msgs,
		parseFrameworkResponse, validateBuildFramework, "build_framework")
	if err != nil {
		log.Printf("[llm/build_framework] %v", err)
		return err
	}
	sections := make([]map[string]any, len(parsed.Sections))
	copy(sections, parsed.Sections)
	providerName := p.Name()
	_, _ = snapStore.Update(taskID, func(s *domain.TaskSnapshot) {
		s.FrameworkSkeleton = map[string]any{"sections": sections}
		addMessage(s, "[build_framework] LLM 已搭建 "+itoa(len(sections))+" 章节 ("+providerName+")")
		pushStep(s, "build_framework", []string{"framework_skeleton"}, false)
	})
	return nil
}

// applyEnrichContentLLM 见 applyEnrichContent。
// feedback 由调用方(graph 节点)从 ReviewReport.Advices 或 ResumeAnswer 拼好后传入。
//
// 流式路径:若 ctx 中注入 TokenSink,则使用 p.Stream 逐 token 推送,
// 结束后再写 snapshot;否则使用 p.Complete + runWithValidation(向后兼容)。
func applyEnrichContentLLM(ctx context.Context, taskID string, snapStore store.TaskSnapshotStore, feedback string, configMgr *llm.ConfigManager, agents agentSource, kbs kbSource, lit litSource) error {
	p := configMgr.Get()
	if !p.Available() {
		return errors.New("enrich_content: LLM provider 未配置")
	}
	ctx, cancel := context.WithTimeout(ctx, llmTimeout())
	defer cancel()

	snap, ok := snapStore.Get(taskID)
	if !ok {
		return errors.New("enrich_content: task snapshot 丢失")
	}
	// 检索真实来源池:知识库(带 URL 命中)+ PubMed 文献,只保留带 URL 的条目,供引用。
	sources := retrieveCitationSources(ctx, kbs, lit, snap)
	msgs := renderEnrichContentMessages(snap, feedback, agents, sources)

	// 流式路径:有 token sink 时逐 token 推送再收集完整文本
	if sink := tokenSinkFromContext(ctx); sink != nil {
		return enrichContentStream(ctx, taskID, snapStore, msgs, p, sink, sources)
	}

	// 非流式路径(向后兼容,如单测直接跑 graph)
	parseAdapter := func(text string) (*EnrichContentResult, error) {
		body, err := parseEnrichContentResponse(text)
		if err != nil {
			return nil, err
		}
		return &EnrichContentResult{Body: body}, nil
	}
	parsed, err := runWithValidation(ctx, p, msgs,
		parseAdapter, validateEnrichContent, "enrich_content")
	if err != nil {
		log.Printf("[llm/enrich_content] %v", err)
		return err
	}
	providerName := p.Name()
	citations := citationsFromSources(parsed.Body, sources)
	_, _ = snapStore.Update(taskID, func(s *domain.TaskSnapshot) {
		s.EnrichedFramework = parsed.Body
		s.Citations = citations
		addMessage(s, "[enrich_content] LLM 已填充内容 revision="+itoa(s.RevisionCount)+" ("+providerName+")")
		pushStep(s, "enrich_content", []string{"enriched_framework"}, false)
	})
	return nil
}

// enrichContentStream 流式 LLM 的 enrich_content 实现:逐 token 接收并通过
// TokenSink 广播给 SSE 订阅者,全部接收完后 parse + validate,写入 snapshot。
// 任何失败(启动错 / 读流错 / 空输出 / 校验不过)都返回 error,不回落 mock。
// sources 是从知识库检索的真实来源池(带 URL),用来回填 citations。
func enrichContentStream(ctx context.Context, taskID string, snapStore store.TaskSnapshotStore, msgs []*schema.Message, p llm.Provider, sink TokenSink, sources []domain.KbSearchHit) error {
	stream, err := p.Stream(ctx, msgs)
	if err != nil {
		log.Printf("[llm/enrich_content] stream start failed: %v", err)
		return err
	}
	defer stream.Close()

	var sb strings.Builder
	for {
		frame, rErr := stream.Recv()
		if errors.Is(rErr, io.EOF) {
			break
		}
		if rErr != nil {
			log.Printf("[llm/enrich_content] stream recv error: %v", rErr)
			return rErr
		}
		if frame == nil || frame.Role != schema.Assistant || frame.Content == "" {
			continue
		}
		sb.WriteString(frame.Content)
		sink("enrich_content", frame.Content)
	}

	body := strings.TrimSpace(thinkBlockRe.ReplaceAllString(sb.String(), ""))
	if body == "" {
		return errors.New("enrich_content: 流式输出为空")
	}

	// 尝试 parse(兼容 JSON envelope 旧格式;新 prompt 大概率是纯 markdown)
	parsed, pErr := parseEnrichContentResponse(body)
	if pErr != nil {
		// parse 失败时直接用原始 body,用 validateEnrichContent 卡最低质量
		vr := &EnrichContentResult{Body: body}
		if vErr := validateEnrichContent(vr); vErr != nil {
			log.Printf("[llm/enrich_content] stream content validation: %v", vErr)
			return vErr
		}
		body = vr.Body
	} else {
		body = parsed
	}

	providerName := p.Name()
	citations := citationsFromSources(body, sources)
	_, _ = snapStore.Update(taskID, func(s *domain.TaskSnapshot) {
		s.EnrichedFramework = body
		s.Citations = citations
		addMessage(s, "[enrich_content] LLM 已填充内容(流式) revision="+itoa(s.RevisionCount)+" ("+providerName+")")
		pushStep(s, "enrich_content", []string{"enriched_framework"}, false)
	})
	return nil
}

// retrieveCitationSources 检索本任务可引用的真实来源池:知识库命中 + PubMed 文献。
// 以主题 + 各章节标题拼成 query;只保留带 URL 的命中(可点击溯源)。
// kbs / lit 任一为 nil 都安全跳过;PubMed 检索失败只记日志不影响知识库来源。
func retrieveCitationSources(ctx context.Context, kbs kbSource, lit litSource, snap *domain.TaskSnapshot) []domain.KbSearchHit {
	if snap == nil {
		return nil
	}
	var qb strings.Builder
	qb.WriteString(ExtractTopic(snap.Brief))
	qb.WriteString(" ")
	for _, sec := range sectionTitles(snap.FrameworkSkeleton) {
		qb.WriteString(sec)
		qb.WriteString(" ")
	}
	query := strings.TrimSpace(qb.String())

	var out []domain.KbSearchHit
	seen := make(map[string]bool)

	// 1) 知识库
	if kbs != nil {
		for _, h := range kb.Search(kbs.List(), query) {
			if u := strings.TrimSpace(h.URL); u != "" && !seen[u] {
				seen[u] = true
				out = append(out, h)
			}
		}
	}

	// 2) PubMed 外部文献(失败不阻断,只记日志)
	if lit != nil {
		hits, err := lit.Search(ctx, query, 5)
		if err != nil {
			log.Printf("[llm/enrich_content] pubmed search failed (忽略, 仅用知识库来源): %v", err)
		} else {
			for _, h := range hits {
				if u := strings.TrimSpace(h.URL); u != "" && !seen[u] {
					seen[u] = true
					out = append(out, h)
				}
			}
		}
	}
	return out
}

// citationsFromSources 从来源池中挑出正文实际引用到的条目(按 URL 是否出现在正文判断)。
// 只回填真实命中的来源,保证 citations 里的每条 source_url 都真实且被引用。
func citationsFromSources(body string, sources []domain.KbSearchHit) []domain.Citation {
	if len(sources) == 0 {
		return nil
	}
	var out []domain.Citation
	seen := make(map[string]bool)
	for _, h := range sources {
		if h.URL == "" || seen[h.URL] {
			continue
		}
		if strings.Contains(body, h.URL) {
			seen[h.URL] = true
			out = append(out, domain.Citation{
				RefID:     h.DocID,
				Title:     h.DocTitle,
				SourceURL: h.URL,
			})
		}
	}
	return out
}


//
// 流式路径:若 ctx 注入 TokenSink,审核意见逐字推给前端(像 enrich 一样),
// 末尾解析哨兵裁定行。否则走非流式 JSON 契约路径(向后兼容单测)。
// 任何失败都返回 error(不回落 mock)。
func applyReviewQualityLLM(ctx context.Context, taskID string, snapStore store.TaskSnapshotStore, configMgr *llm.ConfigManager, agents agentSource) (string, error) {
	p := configMgr.Get()
	if !p.Available() {
		return "", errors.New("review_quality: LLM provider 未配置")
	}
	ctx, cancel := context.WithTimeout(ctx, llmTimeout())
	defer cancel()

	snap, ok := snapStore.Get(taskID)
	if !ok {
		return "", errors.New("review_quality: task snapshot 丢失")
	}

	// 流式路径
	if sink := tokenSinkFromContext(ctx); sink != nil {
		msgs := renderReviewQualityStreamMessages(snap, agents)
		return reviewQualityStream(ctx, taskID, snapStore, msgs, p, sink)
	}

	// 非流式路径(JSON 契约)
	msgs := renderReviewQualityMessages(snap, agents)
	parsed, err := runWithValidation(ctx, p, msgs,
		parseReviewResponse, validateReviewQuality, "review_quality")
	if err != nil {
		log.Printf("[llm/review_quality] %v", err)
		return "", err
	}
	providerName := p.Name()
	_, _ = snapStore.Update(taskID, func(s *domain.TaskSnapshot) {
		s.ReviewReport = parsed.Report
		addMessage(s, "[review_quality] LLM verdict="+parsed.Verdict+" ("+providerName+")")
		pushStep(s, "review_quality", []string{"review_report"}, false)
	})
	return parsed.Verdict, nil
}

// reviewQualityStream 流式审核:逐 token 广播人类可读的审核意见,
// 结束后从累积文本解析哨兵裁定行(裁定: pass|revise|redo)与修改建议。
// 任何失败都返回 error,不回落 mock。
func reviewQualityStream(ctx context.Context, taskID string, snapStore store.TaskSnapshotStore, msgs []*schema.Message, p llm.Provider, sink TokenSink) (string, error) {
	stream, err := p.Stream(ctx, msgs)
	if err != nil {
		log.Printf("[llm/review_quality] stream start failed: %v", err)
		return "", err
	}
	defer stream.Close()

	var sb strings.Builder
	for {
		frame, rErr := stream.Recv()
		if errors.Is(rErr, io.EOF) {
			break
		}
		if rErr != nil {
			log.Printf("[llm/review_quality] stream recv error: %v", rErr)
			return "", rErr
		}
		if frame == nil || frame.Role != schema.Assistant || frame.Content == "" {
			continue
		}
		sb.WriteString(frame.Content)
		sink("review_quality", frame.Content)
	}

	// 剥离 <think> 块(推理模型),避免思考过程进入 Summary 与裁定解析。
	text := strings.TrimSpace(thinkBlockRe.ReplaceAllString(sb.String(), ""))
	if text == "" {
		return "", errors.New("review_quality: 流式输出为空")
	}

	verdict, advices, err := parseReviewStreamText(text)
	if err != nil {
		log.Printf("[llm/review_quality] parse verdict failed: %v", err)
		return "", err
	}

	providerName := p.Name()
	_, _ = snapStore.Update(taskID, func(s *domain.TaskSnapshot) {
		s.ReviewReport = &domain.ReviewReport{
			Overall:       verdict,
			StrategyItems: []domain.ReviewItem{},
			QualityItems:  []domain.ReviewItem{},
			Advices:       advices,
			Summary:       text,
		}
		addMessage(s, "[review_quality] LLM verdict="+verdict+"(流式) ("+providerName+")")
		pushStep(s, "review_quality", []string{"review_report"}, false)
	})
	return verdict, nil
}
