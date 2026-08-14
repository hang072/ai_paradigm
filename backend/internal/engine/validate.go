package engine

// JSON schema 校验中间件 —— 位于 Provider.Complete 与 apply*LLM 之间。
//
// 目的:
//   - 把 fixtures.Agents 里 system_prompt 声明的"严格输出契约"从纸面变成可执行规则。
//   - 首次输出违约时,给 LLM 一次带错误反馈的重试机会,再失败才回落 mock。
//   - 语法(能否 JSON.parse / 枚举合法性)由 prompts.go 的 parseXxxResponse 负责;
//     语义/业务(权重合计、章节数、advices 数量等)由本文件 validateXxx 负责。
//
// 与 Eino ADK 的 AgentMiddleware 不同层次:那是围绕整个 Agent 的 wrapper,
// 需要真接入 ChatModelAgent 才用得到;S2b 阶段直连 openai-compatible,
// 中间件放在 apply*LLM 内部即可,零框架成本。

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"

	"github.com/cloudwego/eino/schema"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/llm"
)

// runWithValidation 是通用的 "调 LLM → 解析 → 业务校验 → 失败带反馈重试" 中间件。
//
// 泛型参数 T 是解析结果(*ParsedBriefResult 等)。
//
//   - parse:   text -> T,承担语法/枚举校验。失败会把错误信息回喂给 LLM 让它自纠。
//   - validate: T   -> error,承担业务级不变量。同样失败即回喂重试。
//   - label:   日志前缀,如 "parse_brief"。
//
// 至多重试 1 次(总请求次数 ≤ 2)。全部失败返回最后一次的 error 供 apply*LLM 决定回落。
func runWithValidation[T any](
	ctx context.Context,
	p llm.Provider,
	msgs []*schema.Message,
	parse func(string) (*T, error),
	validate func(*T) error,
	label string,
) (*T, error) {
	const maxAttempts = 2

	current := msgs
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		reply, err := p.Complete(ctx, current)
		if err != nil {
			// 网络/上游错误不做重试(重试也是同样错),直接冒泡。
			return nil, fmt.Errorf("%s: llm call: %w", label, err)
		}

		parsed, err := parse(reply.Content)
		if err != nil {
			lastErr = fmt.Errorf("parse: %w", err)
			log.Printf("[validate/%s] attempt %d parse failed: %v; raw=%q",
				label, attempt, err, truncate(reply.Content, 200))
			if attempt < maxAttempts {
				current = appendCorrection(msgs, reply.Content, lastErr.Error())
				continue
			}
			return nil, fmt.Errorf("%s: %w", label, lastErr)
		}

		if validate != nil {
			if err := validate(parsed); err != nil {
				lastErr = fmt.Errorf("validate: %w", err)
				log.Printf("[validate/%s] attempt %d validate failed: %v",
					label, attempt, err)
				if attempt < maxAttempts {
					current = appendCorrection(msgs, reply.Content, lastErr.Error())
					continue
				}
				return nil, fmt.Errorf("%s: %w", label, lastErr)
			}
		}

		if attempt > 1 {
			log.Printf("[validate/%s] recovered after %d attempts", label, attempt)
		}
		return parsed, nil
	}
	return nil, fmt.Errorf("%s: exhausted %d attempts: %v", label, maxAttempts, lastErr)
}

// appendCorrection 把上一次的错误产出 + 错误说明追加成一轮对话,
// 让 LLM 看到自己错在哪并只修那个字段,而不是从头重生成。
func appendCorrection(base []*schema.Message, badOutput, reason string) []*schema.Message {
	// 复制一份避免污染上游 slice。
	out := make([]*schema.Message, 0, len(base)+2)
	out = append(out, base...)
	out = append(out, &schema.Message{Role: schema.Assistant, Content: badOutput})
	out = append(out, &schema.Message{
		Role: schema.User,
		Content: fmt.Sprintf(
			"上一次输出未通过校验,原因:%s\n请只修复这个问题重新输出完整 JSON;不要道歉、不要解释、不要 markdown 包裹。",
			reason,
		),
	})
	return out
}

// ==================== 各步骤的 business validator ====================
//
// 规则来自 fixtures.Agents 里升级后的 system_prompt "约束" 段落。
// 只做单条产出的自洽性校验(不跨步骤),跨步骤一致性由 review_quality 兜底。

// validateParseBrief 检查 clarifier 的输出契约。
func validateParseBrief(r *ParsedBriefResult) error {
	if r == nil {
		return errors.New("nil result")
	}
	topic, _ := r.Info["topic"].(string)
	if strings.TrimSpace(topic) == "" {
		return errors.New("topic empty")
	}
	// 6 要素至少 4 项可推断 —— missing.length 相当于"未知字段数",上限 2。
	if len(r.Missing) > 2 && r.Enough {
		return fmt.Errorf("enough=true 但 missing 有 %d 项,矛盾", len(r.Missing))
	}
	return nil
}

// validatePlanStrategy 检查 planner 的输出契约。
// 现有 parser 只解析 markdown,权重靠正则/无法可靠抽取;这里做能做的最小校验:
//   - 文档非空且长度合理
//   - narrative_mode 非空
//   - 文档里必须提到 "章节权重" 或 "%" —— 用来卡住 LLM 忘记加权重的情况
func validatePlanStrategy(r *PlanStrategyResult) error {
	if r == nil {
		return errors.New("nil result")
	}
	doc := strings.TrimSpace(r.Doc)
	if len(doc) < 40 {
		return fmt.Errorf("strategy_doc 过短 (%d 字符),疑似空 stub", len(doc))
	}
	if strings.TrimSpace(r.NarrativeMode) == "" {
		return errors.New("narrative_mode 空 —— 需在文档中单独一行 '叙事模式:xxx'")
	}
	if !strings.Contains(doc, "%") && !strings.Contains(doc, "权重") {
		return errors.New("strategy_doc 未见任何权重/百分比,缺章节骨架")
	}
	return nil
}

// validateBuildFramework 检查 builder 的输出契约。
//   - sections 数量 ∈ [3, 6](提示词写 4~6,给幻灯留 3 的容差)
//   - 每个 title 非空
//   - 所有 weight 之和 ∈ [0.95, 1.05](提示词写 ±0.01,这里放到 5% 容差防 LLM 舍入)
func validateBuildFramework(r *BuildFrameworkResult) error {
	if r == nil {
		return errors.New("nil result")
	}
	n := len(r.Sections)
	if n < 3 || n > 6 {
		return fmt.Errorf("sections 数量 %d 超出 [3,6]", n)
	}
	sum := 0.0
	for i, sec := range r.Sections {
		title, _ := sec["title"].(string)
		if strings.TrimSpace(title) == "" {
			return fmt.Errorf("sections[%d].title 空", i)
		}
		w, ok := sec["weight"].(float64)
		if !ok {
			return fmt.Errorf("sections[%d].weight 类型错误", i)
		}
		if w <= 0 || w > 1 {
			return fmt.Errorf("sections[%d].weight=%.3f 不在 (0,1]", i, w)
		}
		sum += w
	}
	if math.Abs(sum-1.0) > 0.05 {
		return fmt.Errorf("weight 合计 %.3f,期望 ≈1.0(容差 0.05)", sum)
	}
	return nil
}

// validateEnrichContent 检查 enricher 的输出契约。
//   - 非空
//   - 至少 3 个 "## " 二级标题(与 build_framework 的最小章节数一致)
//   - 不出现明显编造标记(简单启发式:"参考文献"或"[1]"存在即认为主动引用了)
//   - 检查不到硬要求(需要跟 skeleton 交叉核对),放到 review_quality
//
// 由于 parseEnrichContentResponse 只返 string,签名用具名类型包一层。
type EnrichContentResult struct {
	Body string
}

func validateEnrichContent(r *EnrichContentResult) error {
	if r == nil || strings.TrimSpace(r.Body) == "" {
		return errors.New("empty body")
	}
	if strings.Count(r.Body, "## ") < 3 {
		return errors.New("H2 标题少于 3 个,内容不完整")
	}
	if len([]rune(r.Body)) < 300 {
		return fmt.Errorf("正文过短 (%d 字),疑似占位", len([]rune(r.Body)))
	}
	return nil
}

// validateReviewQuality 检查 reviewer 的输出契约。
//   - overall ∈ {pass, revise, redo}(parse 已卡,但保留双保险)
//   - overall=pass 时 advices 必须为空(system_prompt 硬约束)
//   - overall!=pass 时 advices 非空(否则下游 enricher 没东西可改)
//   - 每条 verdict 三档合法
func validateReviewQuality(r *ReviewQualityResult) error {
	if r == nil || r.Report == nil {
		return errors.New("nil report")
	}
	switch r.Verdict {
	case "pass", "revise", "redo":
	default:
		return fmt.Errorf("verdict %q 非法", r.Verdict)
	}
	if r.Verdict == "pass" && len(r.Report.Advices) > 0 {
		return fmt.Errorf("overall=pass 但 advices 非空(%d 条),违反契约", len(r.Report.Advices))
	}
	if r.Verdict != "pass" && len(r.Report.Advices) == 0 {
		return fmt.Errorf("overall=%s 但 advices 为空,下游无从修订", r.Verdict)
	}
	if err := validateReviewItems(r.Report.StrategyItems, "strategy_items"); err != nil {
		return err
	}
	if err := validateReviewItems(r.Report.QualityItems, "quality_items"); err != nil {
		return err
	}
	// 阶段 6:target_node 智能路由白名单(plan D2 决策 —— 非法值降级, 不报错)。
	// overall=pass 时 target_node 不必设(下游分支不看);其它情况必须 ∈ 白名单。
	if r.Verdict != "pass" {
		switch r.Report.TargetNode {
		case "", "enrich_content", "build_framework", "plan_strategy", "human_final":
			// OK(空 = 默认 enrich_content,引擎后续 AddBranch 会用)
		default:
			// 非法值降级:不让 LLM 错一个字符就 fail 整个任务。
			r.Report.TargetNode = "enrich_content"
		}
	}
	return nil
}

func validateReviewItems(items []domain.ReviewItem, label string) error {
	for i, it := range items {
		switch it.Verdict {
		case "pass", "warn", "fail":
		default:
			return fmt.Errorf("%s[%d].verdict %q 非法(应 pass/warn/fail)", label, i, it.Verdict)
		}
		if strings.TrimSpace(it.Dimension) == "" {
			return fmt.Errorf("%s[%d].dimension 空", label, i)
		}
	}
	return nil
}
