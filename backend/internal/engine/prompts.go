package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/cloudwego/eino/schema"

	"paradigm_eino_backend/internal/domain"
)

// agentSource 抽象 agent 只读访问 —— graph 层通过这个接口拉 SystemPrompt。
// store.Store[*domain.AgentDef] 天然满足。
type agentSource interface {
	Get(id string) (*domain.AgentDef, bool)
}

// kbSource 抽象知识库只读访问 —— enrich_content 节点用它检索真实来源,
// 供内容填充引用可点击链接。store.Store[*domain.KnowledgeBase] 天然满足。
// 可能为 nil(未接入知识库),此时不注入来源池,模型不得编造引用。
type kbSource interface {
	List() []*domain.KnowledgeBase
}

// litSource 抽象外部文献检索(PubMed)—— enrich_content 节点用它补充真实的循证来源。
// *pubmed.Client 天然满足。可能为 nil(未配置 PUBMED_EMAIL),此时不注入外部来源。
type litSource interface {
	Search(ctx context.Context, query string, maxResults int) ([]domain.KbSearchHit, error)
}

// nodeToAgentID 是 compute 节点到 agent 角色的固定映射。
// 用户在 /agents 页面修改 SystemPrompt 后,下一次任务立即生效(通过 agentStore.Get 拉最新)。
var nodeToAgentID = map[string]string{
	nodeParseBrief:     "agent-clarifier",
	nodePlanStrategy:   "agent-planner",
	nodeBuildFramework: "agent-builder",
	nodeEnrichContent:  "agent-enricher",
	nodeReviewQuality:  "agent-reviewer",
}

// systemPromptForNode 从 agent store 拉 SystemPrompt;找不到返回空(LLM 只用 user 消息)。
func systemPromptForNode(nodeID string, agents agentSource) string {
	agentID, ok := nodeToAgentID[nodeID]
	if !ok {
		return ""
	}
	if agents == nil {
		return ""
	}
	a, ok := agents.Get(agentID)
	if !ok {
		return ""
	}
	return a.SystemPrompt
}

// buildMessages 是渲染 system + user 两条消息的公共 helper。
func buildMessages(system, user string) []*schema.Message {
	msgs := []*schema.Message{}
	if strings.TrimSpace(system) != "" {
		msgs = append(msgs, &schema.Message{Role: schema.System, Content: system})
	}
	msgs = append(msgs, &schema.Message{Role: schema.User, Content: user})
	return msgs
}

// ==================== parse_brief ====================

// ParsedBriefResult 是 parse_brief 输出的解析目标。
type ParsedBriefResult struct {
	Info    map[string]any
	Enough  bool
	Missing []string
}

func renderParseBriefMessages(s *domain.TaskSnapshot, agents agentSource) []*schema.Message {
	sys := systemPromptForNode(nodeParseBrief, agents)
	user := fmt.Sprintf(`任务 brief:
"""
%s
"""

任务类型:%s

请严格按以下 JSON schema 输出(不要多余文字,不要 markdown 包裹):
{
  "topic":       "核心主题(短语)",
  "audience":    "目标听众",
  "duration":    "时长,如 40 分钟",
  "goal":        "核心目标",
  "meeting_type": "会议类型,如 院内学术会议 / 学术峰会",
  "enough":      true | false,
  "missing":     ["缺失要素名 1", "..."]
}

判断标准:
- enough=true 要求 topic / audience / duration / goal / meeting_type 至少 4 项从 brief 中可推断。
- 无法从 brief 直接推断的字段填 "(待确认)",并把字段名加入 missing。`, s.Brief, string(s.TaskType))
	return buildMessages(sys, user)
}

// parseBriefResponse 从 LLM 文本解析出 ParsedBriefResult。
func parseBriefResponse(text string) (*ParsedBriefResult, error) {
	raw, err := extractJSON(text)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Topic       string   `json:"topic"`
		Audience    string   `json:"audience"`
		Duration    string   `json:"duration"`
		Goal        string   `json:"goal"`
		MeetingType string   `json:"meeting_type"`
		Enough      bool     `json:"enough"`
		Missing     []string `json:"missing"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	if payload.Topic == "" {
		return nil, errors.New("parse_brief: topic empty")
	}
	info := map[string]any{
		"topic":        payload.Topic,
		"audience":     payload.Audience,
		"duration":     payload.Duration,
		"goal":         payload.Goal,
		"meeting_type": payload.MeetingType,
	}
	missing := payload.Missing
	if missing == nil {
		missing = []string{}
	}
	return &ParsedBriefResult{Info: info, Enough: payload.Enough, Missing: missing}, nil
}

// ==================== plan_strategy ====================

func renderPlanStrategyMessages(s *domain.TaskSnapshot, agents agentSource) []*schema.Message {
	sys := systemPromptForNode(nodePlanStrategy, agents)
	parsed := parsedInfoSummary(s.ParsedInfo)
	user := fmt.Sprintf(`已确认的需求要素:
%s

任务类型:%s

请严格按以下 JSON 格式输出,策略确认书为 markdown 字符串嵌套在 JSON 中(注意换行用 \\n 转义):
{
  "strategy_doc": "## 策略确认书\\n\\n会议类型:xxx\\n\\n学术/商业配比:xx%% / xx%%\\n\\n叙事模式:xxx\\n\\n1. 章节一(xx%%)\\n2. 章节二(xx%%)\\n3. 章节三(xx%%)\\n4. 章节四(xx%%)",
  "narrative_mode": "问题—证据—共识",
  "meeting_type": "医学综述与科普文章",
  "academic_commercial_ratio": [85, 15]
}

要求:
- strategy_doc 内必须包含单独一行"叙事模式:xxx"(与 narrative_mode 字段字面一致)
- 章节 4 章,百分比合计 100%%
- 只输出 JSON,不要加 markdown code fence`, parsed, string(s.TaskType))
	return buildMessages(sys, user)
}

// PlanStrategyResult 是 plan_strategy 的解析结果。
type PlanStrategyResult struct {
	Doc           string
	NarrativeMode string
}

var narrativeModeRe = regexp.MustCompile(`叙事模式\s*[:：]\s*([^\r\n]+)`)

func parsePlanStrategyResponse(text string) (*PlanStrategyResult, error) {
	// 先剥离推理模型的 think 块
	text = thinkBlockRe.ReplaceAllString(text, "")
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, errors.New("plan_strategy: empty response")
	}

	// 1) 优先解析 system_prompt 声明的 JSON 信封
	raw, err := extractJSON(text)
	if err == nil {
		var payload struct {
			StrategyDoc    string  `json:"strategy_doc"`
			NarrativeMode  string  `json:"narrative_mode"`
			// meeting_type / academic_commercial_ratio 目前不写入 state,只在 doc 里展示
		}
		if jerr := json.Unmarshal(raw, &payload); jerr == nil {
			doc := strings.TrimSpace(payload.StrategyDoc)
			mode := strings.TrimSpace(payload.NarrativeMode)
			if doc != "" {
				if mode == "" {
					// 兜底从 doc 里抽
					if m := narrativeModeRe.FindStringSubmatch(doc); len(m) > 1 {
						mode = strings.TrimSpace(m[1])
					}
				}
				if mode == "" {
					mode = "问题—证据—共识"
				}
				return &PlanStrategyResult{Doc: doc, NarrativeMode: mode}, nil
			}
		}
	}

	// 2) 兼容路径:模型直接输出 markdown —— 从正文抽叙事模式
	mode := ""
	if m := narrativeModeRe.FindStringSubmatch(text); len(m) > 1 {
		mode = strings.TrimSpace(m[1])
	}
	if mode == "" {
		mode = "问题—证据—共识"
	}
	return &PlanStrategyResult{Doc: text, NarrativeMode: mode}, nil
}

// ==================== build_framework ====================

func renderBuildFrameworkMessages(s *domain.TaskSnapshot, agents agentSource) []*schema.Message {
	sys := systemPromptForNode(nodeBuildFramework, agents)
	user := fmt.Sprintf(`基于以下策略确认书,搭建章节目录骨架:

"""
%s
"""

请严格按以下 JSON schema 输出(不要多余文字、不要 markdown 包裹、不要思考过程):
{
  "framework_skeleton": {
    "sections": [
      {"title": "一、背景与流行病学", "weight": 0.15},
      {"title": "二、关键 RCT 与指南更新", "weight": 0.45},
      {"title": "三、临床落地要点", "weight": 0.30},
      {"title": "四、展望", "weight": 0.10}
    ]
  }
}
要求:sections 不能为空,每个 section 必须有非空 title 与 0-1 的 weight,所有 weight 之和 = 1.0。`, s.StrategyDoc)
	return buildMessages(sys, user)
}

// BuildFrameworkResult 是 build_framework 的解析结果。
type BuildFrameworkResult struct {
	Sections []map[string]any
}

func parseFrameworkResponse(text string) (*BuildFrameworkResult, error) {
	raw, err := extractJSON(text)
	if err != nil {
		return nil, err
	}
	type sectionT struct {
		Title  string  `json:"title"`
		Weight float64 `json:"weight"`
	}
	// 同时容忍两种形状:
	//   1) 扁平: {"sections": [...]}
	//   2) 信封: {"framework_skeleton": {"sections": [...]}}  ← builder system_prompt 声明的契约
	var payload struct {
		Sections          []sectionT `json:"sections"`
		FrameworkSkeleton *struct {
			Sections []sectionT `json:"sections"`
		} `json:"framework_skeleton"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	sections := payload.Sections
	if len(sections) == 0 && payload.FrameworkSkeleton != nil {
		sections = payload.FrameworkSkeleton.Sections
	}
	if len(sections) == 0 {
		return nil, errors.New("build_framework: sections empty")
	}
	out := make([]map[string]any, 0, len(sections))
	for _, s := range sections {
		if s.Title == "" {
			continue
		}
		out = append(out, map[string]any{"title": s.Title, "weight": s.Weight})
	}
	if len(out) == 0 {
		return nil, errors.New("build_framework: no valid sections")
	}
	return &BuildFrameworkResult{Sections: out}, nil
}

// ==================== enrich_content ====================

func renderEnrichContentMessages(s *domain.TaskSnapshot, feedback string, agents agentSource, sources []domain.KbSearchHit) []*schema.Message {
	sys := systemPromptForNode(nodeEnrichContent, agents)
	sections := sectionsSummary(s.FrameworkSkeleton)
	feedbackBlock := ""
	if feedback != "" {
		feedbackBlock = fmt.Sprintf("\n\n上一版反馈(请针对性修订):\n\"\"\"\n%s\n\"\"\"\n", feedback)
	}

	// 可引用来源池:仅列出带真实 URL 的知识库命中,模型只能从中引用,不得编造。
	sourceBlock := ""
	citeRule := "- 本次未提供可引用来源,涉及数据/结论一律标 \"[待补充]\",严禁编造任何文献或链接"
	var withURL []domain.KbSearchHit
	for _, h := range sources {
		if strings.TrimSpace(h.URL) != "" {
			withURL = append(withURL, h)
		}
	}
	if len(withURL) > 0 {
		var sb strings.Builder
		sb.WriteString("\n可引用来源(仅可引用以下真实来源:知识库文档或 PubMed 文献,严禁编造其它文献或链接):\n")
		for i, h := range withURL {
			sb.WriteString(fmt.Sprintf("[%d] %s — %s\n", i+1, h.DocTitle, h.URL))
		}
		sourceBlock = sb.String()
		citeRule = "- 关键论断处以 markdown 链接形式引用上表来源,格式 [文档标题](URL);只能引用上表列出的 URL,严禁编造\n" +
			"- 正文末尾追加 \"## 参考文献\",逐条列出实际引用的来源(markdown 链接)\n" +
			"- 找不到来源支撑的数据/结论标 \"[待补充]\",不要编造文献"
	}

	user := fmt.Sprintf(`基于目录骨架填充完整内容,四个章节各占 300~600 字。

目录骨架:
%s

策略要点:
%s%s%s

输出要求(直接输出 markdown 正文,便于流式逐字渲染):
- 直接输出正文,不要用 JSON 包裹,不要加 markdown code fence 围栏
- 每章以 "## " 二级标题起头,至少 3 个 "## " 标题
%s
- 不要在正文之外输出任何解释性文字或元信息`, sections, truncate(s.StrategyDoc, 600), feedbackBlock, sourceBlock, citeRule)
	return buildMessages(sys, user)
}

// parseEnrichContentResponse 先尝试解 JSON envelope(system_prompt 声明的严格契约),
// 解不出时回退到旧行为 —— 把整段作为 markdown 用。这样即使模型漂了也不会把 JSON 字符串塞进终稿。
func parseEnrichContentResponse(text string) (string, error) {
	// 剥离推理模型的 <think> 块,避免思考过程漏进正文。
	text = thinkBlockRe.ReplaceAllString(text, "")
	text = strings.TrimSpace(text)
	if text == "" {
		return "", errors.New("enrich_content: empty response")
	}
	// 1) 尝试 JSON envelope:{"enriched_framework": "...", ...}
	if raw, err := extractJSON(text); err == nil {
		var payload struct {
			EnrichedFramework string `json:"enriched_framework"`
		}
		if jerr := json.Unmarshal(raw, &payload); jerr == nil {
			body := strings.TrimSpace(payload.EnrichedFramework)
			if body != "" {
				if !strings.Contains(body, "## ") {
					return "", errors.New("enrich_content: enriched_framework 内无 H2 标题")
				}
				return body, nil
			}
			// enriched_framework 字段缺失或为空 —— 不算合法 JSON envelope,继续走 markdown 分支
		}
	}
	// 2) 回退:markdown-直出
	body := stripFence(text)
	if !strings.Contains(body, "## ") {
		return "", errors.New("enrich_content: no markdown H2 headings")
	}
	// 防御:若 body 起手仍是 '{' 说明是坏 JSON,拒绝当 markdown 用
	if strings.HasPrefix(body, "{") {
		return "", errors.New("enrich_content: looks like malformed JSON, refusing to render as markdown")
	}
	return body, nil
}

// ==================== review_quality ====================

func renderReviewQualityMessages(s *domain.TaskSnapshot, agents agentSource) []*schema.Message {
	sys := systemPromptForNode(nodeReviewQuality, agents)
	user := fmt.Sprintf(`综合审核以下产出。

策略确认书:
"""
%s
"""

内容全文:
"""
%s
"""

修订轮次:%d

请严格按以下 JSON schema 输出(不要多余文字,不要 markdown 包裹):
{
  "overall": "pass" | "revise" | "redo",
  "strategy_items": [{"dimension": "维度", "verdict": "pass|warn|fail", "note": "备注"}],
  "quality_items":  [{"dimension": "维度", "verdict": "pass|warn|fail", "note": "备注"}],
  "advices": ["修改建议 1", "修改建议 2"],
  "target_node": "plan_strategy" | "build_framework" | "enrich_content" | "human_final"
}

智能路由(阶段 6 workbuddy 借鉴):除 overall 外,必须输出 "target_node",告诉引擎"问题出在哪里,应回退到哪个上游节点重做":
- strategy_items 出现 fail(尤其是叙事一致性、配比严重偏离)→ "plan_strategy"
- quality_items 出现 "结构合理性" fail → "build_framework"
- 其它内容 / 文献 / 时长问题 → "enrich_content"(默认兜底)
- 重大策略 / 概念错误需用户介入 → "human_final"(慎用)

target_node 从上述 4 个中选一;非法值引擎会降级为 "enrich_content"。
target_node 不影响 overall;overall=pass 时 target_node 可省略,引擎不会消费。

判定标准:
- pass:两类维度均合格
- revise:内容质量有小问题,advices 给出可执行建议
- redo:方向性问题,建议重来
如果修订轮次 >= 2 且质量已合格,应判 pass 避免死循环。`, truncate(s.StrategyDoc, 400), truncate(s.EnrichedFramework, 1200), s.RevisionCount)
	return buildMessages(sys, user)
}

// ReviewQualityResult 是 review_quality 的解析结果。
type ReviewQualityResult struct {
	Report  *domain.ReviewReport
	Verdict string // "pass" / "revise" / "redo"
}

func parseReviewResponse(text string) (*ReviewQualityResult, error) {
	raw, err := extractJSON(text)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Overall       string              `json:"overall"`
		StrategyItems []domain.ReviewItem `json:"strategy_items"`
		QualityItems  []domain.ReviewItem `json:"quality_items"`
		Advices       []string            `json:"advices"`
		TargetNode    string              `json:"target_node"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	overall := strings.ToLower(strings.TrimSpace(payload.Overall))
	switch overall {
	case "pass", "revise", "redo":
	default:
		return nil, fmt.Errorf("review_quality: invalid overall %q", payload.Overall)
	}
	if payload.StrategyItems == nil {
		payload.StrategyItems = []domain.ReviewItem{}
	}
	if payload.QualityItems == nil {
		payload.QualityItems = []domain.ReviewItem{}
	}
	if payload.Advices == nil {
		payload.Advices = []string{}
	}
	// 阶段 6:target_node 解析(Validator 后续会再次白名单校验并降级)
	target := strings.TrimSpace(payload.TargetNode)
	return &ReviewQualityResult{
		Report: &domain.ReviewReport{
			Overall:       overall,
			StrategyItems: payload.StrategyItems,
			QualityItems:  payload.QualityItems,
			Advices:       payload.Advices,
			TargetNode:    target,
		},
		Verdict: overall,
	}, nil
}

// ==================== review_quality 流式变体 ====================

// renderReviewQualityStreamMessages 渲染流式审核的 prompt:要求模型先输出
// 人类可读的 markdown 审核意见(便于逐字渲染),末尾用哨兵行给出裁定与建议。
// 与非流式 JSON 契约不同 —— 流式若吐 JSON 会把裸花括号打给用户。
func renderReviewQualityStreamMessages(s *domain.TaskSnapshot, agents agentSource) []*schema.Message {
	sys := systemPromptForNode(nodeReviewQuality, agents)
	user := fmt.Sprintf(`综合审核以下产出,给出可读的审核意见。

策略确认书:
"""
%s
"""

内容全文:
"""
%s
"""

修订轮次:%d

输出要求(直接输出 markdown 审核意见,便于流式逐字渲染):
- 先用若干 "## " 小节分维度点评(如策略契合度、文献支撑、结构合理性),指出问题
- 不要用 JSON 包裹,不要加 markdown code fence 围栏
- 正文写完后,另起一行输出裁定哨兵(必须严格如下格式,单独成行):
  裁定: pass
  或 裁定: revise
  或 裁定: redo
- 若裁定为 revise 或 redo,紧接着逐行列出可执行的修改建议,每行以 "- " 起头
- 若裁定为 pass,不要输出任何修改建议

智能路由(阶段 6):除"裁定"行外,还需另起一行输出"回流到: <kind>"哨兵,告诉引擎应回退到哪个上游节点重做:
  回流到: plan_strategy        (策略 / 叙事 / 配比严重偏离)
  或 回流到: build_framework    (结构骨架与 skeleton 不对齐)
  或 回流到: enrich_content     (内容 / 文献 / 时长问题;默认兜底)
  或 回流到: human_final        (重大策略 / 概念错误需用户介入;慎用)

若裁定为 pass,"回流到:"行可省略。
回流到: 行的 kind 必须从 {plan_strategy, build_framework, enrich_content, human_final} 中选一;非法值引擎会降级为 enrich_content。

判定标准:
- pass:两类维度均合格
- revise:内容质量有小问题,给出可执行建议
- redo:方向性问题,建议重来
- 如果修订轮次 >= 2 且质量已合格,应判 pass 避免死循环`, truncate(s.StrategyDoc, 400), truncate(s.EnrichedFramework, 1200), s.RevisionCount)
	return buildMessages(sys, user)
}

// reviewVerdictRe 匹配哨兵裁定行:"裁定: pass" / "裁定：revise" 等(全/半角冒号皆可)。
var reviewVerdictRe = regexp.MustCompile(`(?m)^\s*裁定\s*[:：]\s*(pass|revise|redo)\s*$`)

// reviewTargetRe 匹配阶段 6 新增的"回流到:"哨兵行(可选)。
// 整体可省略(verdict=pass 时),未省略时必须形如 "回流到: enrich_content" 等。
var reviewTargetRe = regexp.MustCompile(`(?m)^\s*回流到\s*[:：]\s*(\S+)\s*$`)

// parseReviewStreamText 从流式审核正文里解析裁定、修改建议与回流目标。
//   - 找哨兵行 "裁定: pass|revise|redo";找不到 → error(不猜)
//   - 找哨兵行 "回流到: <kind>";找不到 → targetNode = ""(Validator 后续默认 enrich_content)
//   - verdict != pass 时,收集哨兵行之后以 "- " 起头的行作为 advices;为空 → error
//   - verdict == pass 时 advices 恒为空
func parseReviewStreamText(text string) (verdict string, advices []string, targetNode string, err error) {
	m := reviewVerdictRe.FindStringSubmatchIndex(text)
	if m == nil {
		return "", nil, "", errors.New("review_quality: 未找到裁定哨兵行(裁定: pass|revise|redo)")
	}
	verdict = strings.ToLower(text[m[2]:m[3]])
	advices = []string{}
	if t := reviewTargetRe.FindStringSubmatch(text); t != nil {
		targetNode = strings.TrimSpace(t[1])
	}
	if verdict != "pass" {
		tail := text[m[1]:] // 哨兵行之后的内容
		for _, line := range strings.Split(tail, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "- ") {
				if a := strings.TrimSpace(line[2:]); a != "" {
					advices = append(advices, a)
				}
			}
		}
		if len(advices) == 0 {
			return "", nil, "", fmt.Errorf("review_quality: verdict=%s 但未解析到修改建议", verdict)
		}
	}
	return verdict, advices, targetNode, nil
}

// ==================== JSON 提取 & 辅助 ====================

var fencedJSONRe = regexp.MustCompile("(?s)```(?:json)?\\s*([\\s\\S]*?)\\s*```")

// thinkBlockRe 匹配 qwen/deepseek 等推理模型的思考块 <think>…</think>。
// 思考块里常含 schema 模板样的 JSON(如空的 {"sections":[]}),若不剥离,
// extractJSON 会误抓思考块里的伪 JSON,导致下游拿到空字段。
var thinkBlockRe = regexp.MustCompile(`(?s)<think>.*?</think>`)

// extractJSON 从 LLM 文本中挖出 JSON 段。
// 优先剥 ```json fenced code block;退化到找第一个平衡的 {...} 段;都失败则返 err。
func extractJSON(text string) ([]byte, error) {
	// 先剥离 <think>…</think> 推理块,避免误抓思考块里的伪 JSON。
	text = thinkBlockRe.ReplaceAllString(text, "")
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, errors.New("empty text")
	}
	// 1) fenced code block
	if m := fencedJSONRe.FindStringSubmatch(text); len(m) > 1 {
		candidate := strings.TrimSpace(m[1])
		if json.Valid([]byte(candidate)) {
			return []byte(candidate), nil
		}
	}
	// 2) 找第一个 { 到匹配的 }
	start := strings.Index(text, "{")
	if start < 0 {
		return nil, errors.New("no '{' found")
	}
	depth := 0
	inStr := false
	esc := false
	for i := start; i < len(text); i++ {
		c := text[i]
		if inStr {
			if esc {
				esc = false
			} else if c == '\\' {
				esc = true
			} else if c == '"' {
				inStr = false
			}
			continue
		}
		switch c {
		case '"':
			inStr = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				candidate := text[start : i+1]
				if json.Valid([]byte(candidate)) {
					return []byte(candidate), nil
				}
				return nil, errors.New("balanced braces but invalid json")
			}
		}
	}
	return nil, errors.New("unbalanced braces")
}

// stripFence 剥掉外层 ```markdown / ``` 围栏(如果有)。
func stripFence(s string) string {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "```") {
		return s
	}
	if idx := strings.Index(s, "\n"); idx > 0 {
		s = s[idx+1:]
	}
	s = strings.TrimSuffix(s, "```")
	return strings.TrimSpace(s)
}

// parsedInfoSummary 把 ParsedInfo map 渲染成 human-readable 多行文本,供 user prompt 拼接。
func parsedInfoSummary(info map[string]any) string {
	if len(info) == 0 {
		return "(暂无)"
	}
	keys := []string{"topic", "audience", "duration", "goal", "meeting_type"}
	labels := map[string]string{
		"topic":        "主题",
		"audience":     "听众",
		"duration":     "时长",
		"goal":         "目标",
		"meeting_type": "会议类型",
	}
	var b strings.Builder
	for _, k := range keys {
		if v, ok := info[k]; ok {
			b.WriteString("- ")
			b.WriteString(labels[k])
			b.WriteString(":")
			b.WriteString(fmt.Sprint(v))
			b.WriteString("\n")
		}
	}
	return b.String()
}

// sectionsSummary 把 FrameworkSkeleton.sections 渲染成人类可读列表。
func sectionsSummary(fw map[string]any) string {
	if fw == nil {
		return "(暂无)"
	}
	arr, ok := fw["sections"].([]map[string]any)
	if !ok {
		// 可能是 []any(JSON 反解常见)
		if raw, ok := fw["sections"].([]any); ok {
			arr = make([]map[string]any, 0, len(raw))
			for _, x := range raw {
				if m, ok := x.(map[string]any); ok {
					arr = append(arr, m)
				}
			}
		}
	}
	if len(arr) == 0 {
		return "(暂无)"
	}
	var b strings.Builder
	for i, sec := range arr {
		title, _ := sec["title"].(string)
		weight, _ := sec["weight"].(float64)
		fmt.Fprintf(&b, "%d. %s(权重 %.0f%%)\n", i+1, title, weight*100)
	}
	return b.String()
}

// sectionTitles 抽取 FrameworkSkeleton.sections 的标题列表,供知识库检索拼 query。
func sectionTitles(fw map[string]any) []string {
	if fw == nil {
		return nil
	}
	arr, ok := fw["sections"].([]map[string]any)
	if !ok {
		if raw, ok := fw["sections"].([]any); ok {
			arr = make([]map[string]any, 0, len(raw))
			for _, x := range raw {
				if m, ok := x.(map[string]any); ok {
					arr = append(arr, m)
				}
			}
		}
	}
	var titles []string
	for _, sec := range arr {
		if title, _ := sec["title"].(string); title != "" {
			titles = append(titles, title)
		}
	}
	return titles
}
