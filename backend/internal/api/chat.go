// Package api 提供 HTTP 路由与 handler。
//
// 本文件实现 POST /api/chat/reply 端点。
//
// 新架构 (2026-07-23):
//   - 主助手 (agent-main) 是永远存在的通用 LLM。
//   - 用户可选挂载 0 或 1 个子智能体 (AttachedExpert: agent | team)。
//   - 挂载的子智能体作为 `invoke_expert` 工具注册到主助手,由主助手自主决定何时调用。
//   - 每次子调用产生一条带 agent_* 身份字段的 ToolCallTrace, 挂在主助手的 tool_calls 里。
//   - 响应恒为长度 1 的 chatReplyPart 数组(主助手一条)。
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	"github.com/go-chi/chi/v5"
	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/embedding"
	"paradigm_eino_backend/internal/fixtures"
	"paradigm_eino_backend/internal/llm"
	"paradigm_eino_backend/internal/pubmed"
	"paradigm_eino_backend/internal/store"
)

// mainAssistant 主助手系统身份 —— 常量,不进 entities 表 / fixtures,用户不可编辑。
var mainAssistant = struct {
	ID           string
	Name         string
	Color        string
	Description  string
	SystemPrompt string
}{
	ID:          "agent-main",
	Name:        "主助手",
	Color:       "#6b7a90",
	Description: "通用主助手,理解用户需求并按需调用挂载的专家/专家团。",
	SystemPrompt: "你是一位通用主助手,精通医学内容制作场景。回答用户问题时请:\n" +
		"1. 用简洁自然的中文回答,不要机械照搬 system 指令;\n" +
		"2. 如果本轮挂载了名为 `invoke_expert` 的工具,说明用户为本轮准备了专家协助;" +
		"你应当根据用户问题与工具描述的匹配度决定是否调用它,不要盲目每问必调;\n" +
		"3. 调用完专家后,请综合专家反馈用你自己的话给出结论,不要原样转述专家原文。",
}

// chatReplyRequest 是 POST /api/chat/reply 的请求体。
// 对齐 frontend/src/api/chat.ts ChatReplyInput。
type chatReplyRequest struct {
	Message        string                `json:"message"`
	AttachedExpert *attachedExpertInput  `json:"attached_expert"`
	Tools          []string              `json:"tools"`
	Skills         []string              `json:"skills"`
	KBIDs          []string              `json:"kb_ids"`
	History        []map[string]string   `json:"history"`
}

type attachedExpertInput struct {
	Kind string `json:"kind"` // "agent" | "team"
	ID   string `json:"id"`
}

// toolCallItem 对应前端 ToolCallTrace。
type toolCallItem struct {
	Tool          string         `json:"tool"`
	Input         map[string]any `json:"input"`
	OutputPreview string         `json:"output_preview"`
	AgentID       string         `json:"agent_id,omitempty"`
	AgentName     string         `json:"agent_name,omitempty"`
	AgentColor    string         `json:"agent_color,omitempty"`
}

// chatReplyPart 对应前端 ChatReplyPart。响应恒为长度 1 的数组。
type chatReplyPart struct {
	AgentID    string         `json:"agent_id"`
	AgentName  string         `json:"agent_name"`
	AgentColor string         `json:"agent_color"`
	Content    string         `json:"content"`
	ToolCalls  []toolCallItem `json:"tool_calls"`
}

// mountChat 挂载 /api/chat 路由。
func mountChat(r chi.Router, agents store.Store[*domain.AgentDef], nodes store.Store[*domain.NodeDef], templates store.Store[*domain.WorkflowTemplate], skills store.Store[*domain.SkillDef], knowledge store.Store[*domain.KnowledgeBase], llmMgr *llm.ConfigManager, pubmedClient *pubmed.Client) {
	r.Post("/chat/reply", func(w http.ResponseWriter, req *http.Request) {
		handleChatReply(w, req, agents, nodes, templates, skills, knowledge, llmMgr.Get(), pubmedClient)
	})
}

func handleChatReply(w http.ResponseWriter, req *http.Request, agents store.Store[*domain.AgentDef], nodes store.Store[*domain.NodeDef], templates store.Store[*domain.WorkflowTemplate], skills store.Store[*domain.SkillDef], knowledge store.Store[*domain.KnowledgeBase], llmProv llm.Provider, pubmedClient *pubmed.Client) {
	var body chatReplyRequest
	if err := decodeJSON(req, &body); err != nil {
		log.Printf("[api] POST %s decode failed: %v", req.URL.Path, err)
		respondErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
		return
	}
	log.Printf("[api] POST %s message_len=%d attached=%v", req.URL.Path, len(body.Message), body.AttachedExpert)

	streaming := strings.Contains(req.Header.Get("Accept"), "text/event-stream")

	// 累积 tool_calls trace (包含普通工具 + 子智能体调用)
	traces := newTraceAccumulator()

	// 1) 普通工具的 mock/真实 trace 预先塞进去 (search_kb 实际由 LLM 触发, 这里只做展示预览)
	preview := buildToolCallPreviews(req.Context(), body.Message, body.Tools, body.KBIDs, knowledge, pubmedClient)
	for _, p := range preview {
		traces.add(p)
	}

	// 2) 主助手 system prompt = 基础 prompt + 挂载技能
	systemPrompt := buildMainSystemPrompt(body.Skills, skills)

	// 3) 构造 LLM tools:普通工具(search_kb / search_literature / verify_reference 等) + invoke_expert(若挂载了子智能体)
	llmTools := buildLLMTools(body.Tools, body.KBIDs, knowledge, pubmedClient)
	if body.AttachedExpert != nil && body.AttachedExpert.ID != "" {
		if body.AttachedExpert.Kind == "team" {
			// 从 2026-07-23 (路径 A) 起, 前端 chat 挂载 team 时改走 POST /api/tasks +
			// polling 而不是这里 —— 因为 team 是一个带反问/审核回路的完整 graph, 一次
			// tool call 装不下。此处保留兜底 (老前端 / 第三方客户端仍可 work), 但打
			// 一条 warning 提醒排查。
			log.Printf("[api] WARN chat/reply attached_expert.kind=team (%s) — 建议前端改走 /api/tasks + resume", body.AttachedExpert.ID)
		}
		expertTool, err := buildInvokeExpertTool(body.AttachedExpert, agents, nodes, templates, traces)
		if err != nil {
			log.Printf("[api] build invoke_expert tool failed: %v", err)
		} else if expertTool != nil {
			llmTools = append(llmTools, expertTool)
		}
	}

	messages := buildMessages(systemPrompt, body.Message, body.History)

	if streaming {
		handleChatStream(w, req, body, messages, llmTools, llmProv, traces)
		return
	}

	// 非流式
	content := runMainAssistant(req.Context(), messages, llmTools, llmProv)
	part := chatReplyPart{
		AgentID:    mainAssistant.ID,
		AgentName:  mainAssistant.Name,
		AgentColor: mainAssistant.Color,
		Content:    content,
		ToolCalls:  traces.snapshot(),
	}
	respondJSON(w, http.StatusOK, []chatReplyPart{part})
}

// runMainAssistant 跑一次主助手 (含 tool use), 返回完整正文。
// llmProv 不可用时返回 mock 文本。
func runMainAssistant(ctx context.Context, messages []*schema.Message, tools []tool.BaseTool, llmProv llm.Provider) string {
	if !llmProv.Available() {
		return mockMainReply(messages)
	}
	openaiProv, ok := llmProv.(*llm.OpenaiProvider)
	if !ok {
		return mockMainReply(messages)
	}

	chatAgent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name:        mainAssistant.Name,
		Description: mainAssistant.Description,
		Instruction: extractSystemPrompt(messages),
		Model:       openaiProv.ChatModel(),
		ToolsConfig: adk.ToolsConfig{
			ToolsNodeConfig: compose.ToolsNodeConfig{Tools: tools},
		},
		MaxIterations: 8,
	})
	if err != nil {
		return "[创建主助手 Agent 失败: " + err.Error() + "]"
	}

	runner := adk.NewRunner(ctx, adk.RunnerConfig{
		Agent:           chatAgent,
		EnableStreaming: false,
	})

	var sb strings.Builder
	iter := runner.Run(ctx, messagesWithoutSystem(messages))
	for {
		event, ok := iter.Next()
		if !ok {
			break
		}
		if event.Err != nil {
			sb.WriteString("\n\n[LLM 生成中断: " + event.Err.Error() + "]")
			break
		}
		if event.Output == nil || event.Output.MessageOutput == nil {
			continue
		}
		msg, err := event.Output.MessageOutput.GetMessage()
		if err != nil || msg == nil || msg.Role != schema.Assistant {
			continue
		}
		sb.WriteString(msg.Content)
	}
	return sb.String()
}

// handleChatStream 处理流式 SSE 响应。恒一段主助手回复:start → chunks → done → finish。
func handleChatStream(w http.ResponseWriter, req *http.Request, body chatReplyRequest, messages []*schema.Message, tools []tool.BaseTool, llmProv llm.Provider, traces *traceAccumulator) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, ok := w.(http.Flusher)
	if !ok {
		respondErr(w, http.StatusInternalServerError, "Streaming not supported")
		return
	}

	// start 事件:主助手身份 + 目前已有的 tool_calls (通常为普通工具的 preview)
	header := map[string]any{
		"agent_id":    mainAssistant.ID,
		"agent_name":  mainAssistant.Name,
		"agent_color": mainAssistant.Color,
		"tool_calls":  traces.snapshot(),
	}
	writeEvent(w, flusher, "start", header)

	if !llmProv.Available() {
		content := mockMainReply(messages)
		writeEvent(w, flusher, "chunk", map[string]any{
			"content":    content,
			"tool_calls": traces.snapshot(),
		})
		writeEvent(w, flusher, "done", map[string]any{})
		writeEvent(w, flusher, "finish", map[string]any{})
		_ = body
		return
	}
	openaiProv, ok := llmProv.(*llm.OpenaiProvider)
	if !ok {
		writeEvent(w, flusher, "chunk", map[string]any{"content": "(LLM provider 类型不兼容, mock 回复)"})
		writeEvent(w, flusher, "done", map[string]any{})
		writeEvent(w, flusher, "finish", map[string]any{})
		return
	}

	chatAgent, err := adk.NewChatModelAgent(req.Context(), &adk.ChatModelAgentConfig{
		Name:        mainAssistant.Name,
		Description: mainAssistant.Description,
		Instruction: extractSystemPrompt(messages),
		Model:       openaiProv.ChatModel(),
		ToolsConfig: adk.ToolsConfig{
			ToolsNodeConfig: compose.ToolsNodeConfig{Tools: tools},
		},
		MaxIterations: 8,
	})
	if err != nil {
		writeEvent(w, flusher, "error", map[string]any{"detail": "创建主助手 Agent 失败: " + err.Error()})
		writeEvent(w, flusher, "done", map[string]any{})
		writeEvent(w, flusher, "finish", map[string]any{})
		return
	}

	runner := adk.NewRunner(req.Context(), adk.RunnerConfig{
		Agent:           chatAgent,
		EnableStreaming: true,
	})
	iter := runner.Run(req.Context(), messagesWithoutSystem(messages))
	for {
		event, okNext := iter.Next()
		if !okNext {
			break
		}
		if event.Err != nil {
			if event.Err.Error() != "" {
				writeEvent(w, flusher, "error", map[string]any{"detail": event.Err.Error()})
			}
			break
		}
		if event.Output == nil || event.Output.MessageOutput == nil {
			continue
		}
		mv := event.Output.MessageOutput

		// 流式路径:直接从 MessageStream 逐帧 Recv, 每收到一个 assistant 增量 token
		// 就发一个 chunk 出去 —— 这才是真正的打字机效果。
		// 千万不要在这里调 mv.GetMessage(): 它会 concatMessageStream 把整个流一次性
		// 抽干拼成完整消息, 让前端一次拿到全文, 打字机效果失效。
		if mv.IsStreaming {
			if mv.MessageStream == nil {
				continue
			}
			streamMessageChunks(w, flusher, mv.MessageStream, traces)
			continue
		}

		// 非流式路径:上游一次给出完整消息 (例如 tool 结果), 直接整块发出去。
		if mv.Message == nil || mv.Message.Role != schema.Assistant || mv.Message.Content == "" {
			continue
		}
		writeEvent(w, flusher, "chunk", map[string]any{
			"content":    mv.Message.Content,
			"tool_calls": traces.snapshot(),
		})
	}
	writeEvent(w, flusher, "done", map[string]any{})
	writeEvent(w, flusher, "finish", map[string]any{})
}

// streamMessageChunks 逐帧读 MessageStream, 每帧的 assistant 增量文本作为一个
// SSE chunk 事件发出去。EOF / ctx cancel / stream error 都负责关流并返回。
//
// 注意:StreamReader.Close() 必须调用 (见 schema/stream.go 文档), 否则底层
// pipe 泄漏。用 defer 兜底即使中途 panic 也能收尾。
func streamMessageChunks(w http.ResponseWriter, flusher http.Flusher, stream *schema.StreamReader[*schema.Message], traces *traceAccumulator) {
	defer stream.Close()
	for {
		frame, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return
		}
		if err != nil {
			writeEvent(w, flusher, "error", map[string]any{"detail": "流读取错误: " + err.Error()})
			return
		}
		if frame == nil || frame.Role != schema.Assistant || frame.Content == "" {
			continue
		}
		writeEvent(w, flusher, "chunk", map[string]any{
			"content":    frame.Content,
			"tool_calls": traces.snapshot(),
		})
	}
}

func writeEvent(w http.ResponseWriter, f http.Flusher, event string, data map[string]any) {
	b, _ := json.Marshal(data)
	_, _ = w.Write([]byte("event: " + event + "\ndata: " + string(b) + "\n\n"))
	f.Flush()
}

// ========================================================================
// invoke_expert tool 实现
// ========================================================================

// buildInvokeExpertTool 若挂载了子智能体, 构造一个 invoke_expert 工具供主助手调用。
// 工具 desc 来自被挂载对象的 name+description, 让主助手看懂什么时候用它。
//
// 调用时 (mock 实现):
//   - kind=agent: 返回一段角色化 mock 文本, 同时向 traces 追加一条带该 agent 身份的 trace。
//   - kind=team : 按模板节点顺序遍历 compute agents, 对每位专家追加一条 trace,
//                返回聚合后的多段文本给主助手汇总。
//
// 这里刻意不真跑子 ChatModelAgent —— 保持 MVP 简单、成本可控。真跑留作后续演进。
func buildInvokeExpertTool(att *attachedExpertInput, agents store.Store[*domain.AgentDef], nodes store.Store[*domain.NodeDef], templates store.Store[*domain.WorkflowTemplate], traces *traceAccumulator) (tool.BaseTool, error) {
	label, desc, subAgents, err := resolveAttachedExpert(att, agents, nodes, templates)
	if err != nil {
		return nil, err
	}
	if len(subAgents) == 0 {
		return nil, nil
	}
	return &invokeExpertTool{
		label:     label,
		desc:      desc,
		subAgents: subAgents,
		traces:    traces,
	}, nil
}

func resolveAttachedExpert(att *attachedExpertInput, agents store.Store[*domain.AgentDef], nodes store.Store[*domain.NodeDef], templates store.Store[*domain.WorkflowTemplate]) (label, desc string, subAgents []*domain.AgentDef, err error) {
	switch att.Kind {
	case "agent":
		a, ok := agents.Get(att.ID)
		if !ok {
			for _, f := range fixtures.Agents() {
				if f.ID == att.ID {
					a = f
					ok = true
					break
				}
			}
		}
		if !ok {
			return "", "", nil, fmt.Errorf("attached agent %s 不存在", att.ID)
		}
		return a.Name, a.Description, []*domain.AgentDef{a}, nil
	case "team":
		tpl, ok := templates.Get(att.ID)
		if !ok {
			for _, f := range fixtures.Templates() {
				if f.ID == att.ID {
					tpl = f
					ok = true
					break
				}
			}
		}
		if !ok {
			return "", "", nil, fmt.Errorf("attached team template %s 不存在", att.ID)
		}
		agentIDs := collectTeamAgentIDsFromTpl(tpl, nodes)
		var subs []*domain.AgentDef
		for _, id := range agentIDs {
			a, ok := agents.Get(id)
			if !ok {
				for _, f := range fixtures.Agents() {
					if f.ID == id {
						a = f
						ok = true
						break
					}
				}
			}
			if ok {
				subs = append(subs, a)
			}
		}
		return tpl.Name, tpl.Description, subs, nil
	default:
		return "", "", nil, fmt.Errorf("unknown attached_expert.kind: %s", att.Kind)
	}
}

func collectTeamAgentIDsFromTpl(tpl *domain.WorkflowTemplate, nodes store.Store[*domain.NodeDef]) []string {
	seen := make(map[string]bool)
	var res []string
	for _, inst := range tpl.Nodes {
		nodeDef, ok := nodes.Get(inst.Type)
		if !ok {
			for _, f := range fixtures.Nodes() {
				if f.ID == inst.Type {
					nodeDef = f
					ok = true
					break
				}
			}
		}
		if !ok {
			continue
		}
		if nodeDef.Kind == domain.NodeKindCompute && nodeDef.AgentID != nil && *nodeDef.AgentID != "" && !seen[*nodeDef.AgentID] {
			seen[*nodeDef.AgentID] = true
			res = append(res, *nodeDef.AgentID)
		}
	}
	return res
}

type invokeExpertTool struct {
	label     string             // 展示名 (专家/专家团名)
	desc      string             // 描述 —— 主助手用来判定何时调用
	subAgents []*domain.AgentDef // 团展开后的专家; 单专家场景长度为 1
	traces    *traceAccumulator
}

func (t *invokeExpertTool) Info(_ context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: "invoke_expert",
		Desc: fmt.Sprintf(
			"请求当前挂载的专家(%s)协助分析。适用场景:%s。当你判断用户问题与此专家职责相关时才调用,不要机械调用。",
			t.label, t.desc,
		),
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"question": {
				Type:     schema.String,
				Desc:     "转发给专家的具体问题;通常是用户输入的简化或明确化版本",
				Required: true,
			},
		}),
	}, nil
}

func (t *invokeExpertTool) InvokableRun(_ context.Context, argumentsInJSON string, _ ...tool.Option) (string, error) {
	var args struct {
		Question string `json:"question"`
	}
	if argumentsInJSON != "" {
		_ = json.Unmarshal([]byte(argumentsInJSON), &args)
	}
	if strings.TrimSpace(args.Question) == "" {
		args.Question = "(无具体问题)"
	}

	var out strings.Builder
	for _, a := range t.subAgents {
		reply := mockExpertReply(a, args.Question)
		t.traces.add(toolCallItem{
			Tool: "invoke_expert",
			Input: map[string]any{
				"target":   t.label,
				"question": args.Question,
			},
			OutputPreview: reply,
			AgentID:       a.ID,
			AgentName:     a.Name,
			AgentColor:    a.Color,
		})
		out.WriteString("### " + a.Name + "\n")
		out.WriteString(reply)
		out.WriteString("\n\n")
	}
	return out.String(), nil
}

// mockExpertReply 根据 agent 名称生成角色化 mock 输出。真跑子 LLM 是后续项。
func mockExpertReply(a *domain.AgentDef, question string) string {
	topic := question
	if len(topic) > 30 {
		topic = topic[:30]
	}
	name := a.Name
	switch {
	case strings.Contains(name, "需求"):
		return "从「" + topic + "...」我识别出以下要素:主题、受众、场景、时长。建议进一步确认这些要素。"
	case strings.Contains(name, "策略") || strings.Contains(name, "规划"):
		return "建议策略:学术/商业配比 90/10,叙事模式 问题—证据—共识,四段式结构。"
	case strings.Contains(name, "框架") || strings.Contains(name, "搭建"):
		return "目录草案:一、背景(15%);二、关键证据(45%);三、临床落地(30%);四、展望(10%)。"
	case strings.Contains(name, "填充") || strings.Contains(name, "内容"):
		return "关于「" + topic + "」核心要点:流行病学负担、关键 RCT 证据、落地要点。详细文献将在完整草稿引用。"
	case strings.Contains(name, "审核") || strings.Contains(name, "质量"):
		return "审核结论:策略对齐 pass,文献支撑 warn(建议补 2 处引用),逻辑完整 pass。"
	default:
		return "针对「" + topic + "」的初步分析:(mock)后续接真 LLM 后由本专家实际生成。"
	}
}

// ========================================================================
// trace 累积
// ========================================================================

type traceAccumulator struct {
	mu   sync.Mutex
	list []toolCallItem
}

func newTraceAccumulator() *traceAccumulator {
	return &traceAccumulator{list: []toolCallItem{}}
}

func (a *traceAccumulator) add(item toolCallItem) {
	a.mu.Lock()
	a.list = append(a.list, item)
	a.mu.Unlock()
}

func (a *traceAccumulator) snapshot() []toolCallItem {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]toolCallItem, len(a.list))
	copy(out, a.list)
	return out
}

// ========================================================================
// 辅助
// ========================================================================

func buildMainSystemPrompt(skillIDs []string, skills store.Store[*domain.SkillDef]) string {
	sb := strings.Builder{}
	sb.WriteString(mainAssistant.SystemPrompt)
	if len(skillIDs) > 0 {
		sb.WriteString("\n\n---\n挂载的技能:\n")
		for _, sid := range skillIDs {
			skill, ok := skills.Get(sid)
			if !ok {
				continue
			}
			sb.WriteString("\n### " + skill.Name + "\n" + skill.PromptFragment + "\n")
		}
	}
	return sb.String()
}

// buildMessages 构造统一消息序列 (含 system prompt)。
func buildMessages(systemPrompt, userMessage string, history []map[string]string) []*schema.Message {
	var messages []*schema.Message
	if systemPrompt != "" {
		messages = append(messages, &schema.Message{
			Role:    schema.System,
			Content: systemPrompt,
		})
	}
	for _, h := range history {
		role, okh := h["role"]
		content, okc := h["content"]
		if !okh || !okc {
			continue
		}
		messages = append(messages, &schema.Message{
			Role:    schema.RoleType(role),
			Content: content,
		})
	}
	messages = append(messages, &schema.Message{
		Role:    schema.User,
		Content: userMessage,
	})
	return messages
}

func extractSystemPrompt(messages []*schema.Message) string {
	for _, m := range messages {
		if m.Role == schema.System {
			return m.Content
		}
	}
	return ""
}

func messagesWithoutSystem(messages []*schema.Message) []*schema.Message {
	out := make([]*schema.Message, 0, len(messages))
	for _, m := range messages {
		if m.Role == schema.System {
			continue
		}
		out = append(out, m)
	}
	return out
}

// buildToolCallPreviews 生成 tool_calls 展示预览 (供前端在流式 start 事件里立刻可见)。
// 这只是给用户看的轨迹, LLM 侧真调工具走的是 buildLLMTools 里注册的 tool.BaseTool。
func buildToolCallPreviews(ctx context.Context, query string, tools []string, kbIDs []string, knowledge store.Store[*domain.KnowledgeBase], pubmedClient *pubmed.Client) []toolCallItem {
	var calls []toolCallItem
	preview := query
	if len(preview) > 20 {
		preview = preview[:20]
	}

	// search_literature —— 真实 PubMed 检索。命中即返回带可点击链接的真实文献;
	// 未配置 PubMed(缺 PUBMED_EMAIL)或检索失败时,给出诚实说明,绝不伪造 PMID / 期刊卷期。
	if contains(tools, "search_literature") {
		call := toolCallItem{
			Tool:  "search_literature",
			Input: map[string]any{"query": preview},
		}
		if pubmedClient == nil || !pubmedClient.Available() {
			call.OutputPreview = "(PubMed 文献检索未启用:需在后端配置 PUBMED_EMAIL。为确保数据真实性,不提供未经核验的引用;可改用知识库检索 search_kb。)"
		} else {
			hits, err := pubmedClient.Search(ctx, query, 5)
			if err != nil {
				call.OutputPreview = "(PubMed 检索失败:" + err.Error() + "。未返回任何引用以确保数据真实性。)"
			} else if len(hits) == 0 {
				call.OutputPreview = "在 PubMed 未检索到相关文献。"
			} else {
				call.OutputPreview = formatPubmedHits(hits)
			}
		}
		calls = append(calls, call)
	}

	// verify_reference —— 真实 PubMed 核验。按标题/PMID/DOI 反查是否真实存在。
	if contains(tools, "verify_reference") {
		call := toolCallItem{
			Tool:  "verify_reference",
			Input: map[string]any{"query": preview},
		}
		if pubmedClient == nil || !pubmedClient.Available() {
			call.OutputPreview = "(PubMed 核验未启用:需在后端配置 PUBMED_EMAIL。无法核验外部引用真伪;请以知识库 search_kb 命中的带链接文档为准。)"
		} else {
			hit, err := pubmedClient.Verify(ctx, query, "", "")
			if err != nil {
				call.OutputPreview = "(PubMed 核验失败:" + err.Error() + ")"
			} else if hit == nil {
				call.OutputPreview = "未在 PubMed 核验到该文献(可能不存在或标题不匹配)。"
			} else {
				call.OutputPreview = "已核验:" + formatPubmedHits([]pubmed.PubmedHit{*hit})
			}
		}
		calls = append(calls, call)
	}
	if contains(tools, "search_kb") {
		call := toolCallItem{
			Tool:  "search_kb",
			Input: map[string]any{"query": preview, "kb_ids": kbIDs},
		}
		if knowledge == nil {
			call.OutputPreview = "(知识库未启用)"
		} else {
			hits, err := searchKBWithStore(ctx, knowledge, query, kbIDs)
			if err != nil {
				call.OutputPreview = "(search_kb 失败: " + err.Error() + ")"
			} else if len(hits) == 0 {
				if len(kbIDs) == 0 {
					call.OutputPreview = "(未挂载知识库,search_kb 未命中)"
				} else {
					call.OutputPreview = "未在挂载的知识库中命中相关内容。"
				}
			} else {
				var sb strings.Builder
				for i, h := range hits {
					if i > 0 {
						sb.WriteString("\n")
					}
					// 文档标题渲染为 markdown 可点击链接(有 URL 时),便于溯源核验。
					title := h.DocTitle
					if h.URL != "" {
						title = fmt.Sprintf("[%s](%s)", h.DocTitle, h.URL)
					}
					sb.WriteString(fmt.Sprintf("%d. %s / %s — %s (score=%.0f)",
						i+1, h.KBName, title, h.Snippet, h.Score))
				}
				call.OutputPreview = sb.String()
			}
		}
		calls = append(calls, call)
	}
	return calls
}

// searchKBWithStore 走 embedding.Search(向量检索)。空 kbIDs 搜全部。
// Milvus 不可用时返 error(用户决策: hard dep, 不降级 SQL)。
//
// 用 package-level vars(pkgEmbedder / pkgMilvusCli) 拿依赖,避免把 3 个
// embedding 参数一路透传到每个 chat 工具函数。
func searchKBWithStore(
	ctx context.Context,
	s store.Store[*domain.KnowledgeBase],
	query string,
	kbIDs []string,
) ([]embedding.SearchHit, error) {
	if pkgEmbedder == nil || pkgMilvusCli == nil {
		return nil, fmt.Errorf("embedding 未初始化(后端未配置 Milvus / LLM)")
	}
	return embedding.Search(ctx, pkgEmbedder, pkgMilvusCli, s, query, kbIDs, 6)
}

// ==============================
// LLM tools (供 ChatModelAgent 真调用)
// ==============================

// buildLLMTools 构造挂到 ChatModelAgent 的工具列表。search_kb + PubMed 文献检索/核验;
// invoke_expert 由 buildInvokeExpertTool 在挂载了子智能体时另行 append。
func buildLLMTools(reqTools []string, kbIDs []string, knowledge store.Store[*domain.KnowledgeBase], pubmedClient *pubmed.Client) []tool.BaseTool {
	var tools []tool.BaseTool
	if contains(reqTools, "search_kb") && knowledge != nil {
		tools = append(tools, newSearchKBTool(knowledge, kbIDs))
	}
	if contains(reqTools, "search_literature") && pubmedClient != nil && pubmedClient.Available() {
		tools = append(tools, newSearchLiteratureTool(pubmedClient))
	}
	if contains(reqTools, "verify_reference") && pubmedClient != nil && pubmedClient.Available() {
		tools = append(tools, newVerifyReferenceTool(pubmedClient))
	}
	return tools
}

// formatPubmedHits 把 PubMed 命中渲染为带 markdown 可点击链接的多行文本。
func formatPubmedHits(hits []pubmed.PubmedHit) string {
	var sb strings.Builder
	for i, h := range hits {
		if i > 0 {
			sb.WriteString("\n")
		}
		// 标题渲染为可点击 PubMed 链接
		title := fmt.Sprintf("[%s](%s)", h.Title, h.URL)
		meta := make([]string, 0, 3)
		if h.Authors != "" {
			meta = append(meta, h.Authors)
		}
		if h.Journal != "" {
			meta = append(meta, h.Journal)
		}
		if h.Year != "" {
			meta = append(meta, h.Year)
		}
		line := fmt.Sprintf("%d. %s", i+1, title)
		if len(meta) > 0 {
			line += " — " + strings.Join(meta, ", ")
		}
		if h.DOI != "" {
			line += fmt.Sprintf(" (DOI: [%s](https://doi.org/%s), PMID: %s)", h.DOI, h.DOI, h.PMID)
		} else {
			line += fmt.Sprintf(" (PMID: %s)", h.PMID)
		}
		sb.WriteString(line)
	}
	return sb.String()
}

type searchKBTool struct {
	store        store.Store[*domain.KnowledgeBase]
	defaultKBIDs []string
}

func newSearchKBTool(s store.Store[*domain.KnowledgeBase], defaultKBIDs []string) *searchKBTool {
	return &searchKBTool{store: s, defaultKBIDs: defaultKBIDs}
}

func (t *searchKBTool) Info(_ context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: "search_kb",
		Desc: "在挂载的知识库中检索关键字,返回命中的文档片段。用于查询临床指南、SOP、用药清单等内部资料。",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"query": {
				Type:     schema.String,
				Desc:     "要检索的关键字或短语,支持中英文",
				Required: true,
			},
			"kb_ids": {
				Type:     schema.Array,
				Desc:     "可选,限定搜索的知识库 id 列表;为空则搜索会话已挂载的全部知识库",
				ElemInfo: &schema.ParameterInfo{Type: schema.String},
			},
		}),
	}, nil
}

func (t *searchKBTool) InvokableRun(ctx context.Context, argumentsInJSON string, _ ...tool.Option) (string, error) {
	var args struct {
		Query string   `json:"query"`
		KBIDs []string `json:"kb_ids"`
	}
	if argumentsInJSON != "" {
		if err := json.Unmarshal([]byte(argumentsInJSON), &args); err != nil {
			return "", fmt.Errorf("parse search_kb args: %w", err)
		}
	}
	if strings.TrimSpace(args.Query) == "" {
		return `{"hits":[],"note":"query 为空"}`, nil
	}
	kbIDs := args.KBIDs
	if len(kbIDs) == 0 {
		kbIDs = t.defaultKBIDs
	}
	hits, err := searchKBWithStore(ctx, t.store, args.Query, kbIDs)
	if err != nil {
		// 工具调用出错 → 返带 note 的 payload, 让 LLM 知道原因
		out, _ := json.Marshal(map[string]any{"hits": []any{}, "note": "search_kb error: " + err.Error()})
		return string(out), nil
	}
	payload := map[string]any{"hits": hits}
	out, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// ——— PubMed 文献检索工具 ———

type searchLiteratureTool struct {
	client *pubmed.Client
}

func newSearchLiteratureTool(c *pubmed.Client) *searchLiteratureTool {
	return &searchLiteratureTool{client: c}
}

func (t *searchLiteratureTool) Info(_ context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: "search_literature",
		Desc: "在 PubMed 检索真实生物医学文献。返回标题、作者、期刊、年份、DOI 和可点击的 PubMed 链接。用于查找临床研究、指南、meta 分析等外部循证依据。检索词建议用英文医学术语。",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"query": {
				Type:     schema.String,
				Desc:     "PubMed 检索式,建议英文医学术语,可用 AND/OR 组合,如 \"SGLT2 inhibitor AND heart failure\"",
				Required: true,
			},
			"max_results": {
				Type: schema.Integer,
				Desc: "返回条数上限,默认 5,最大 10",
			},
		}),
	}, nil
}

func (t *searchLiteratureTool) InvokableRun(ctx context.Context, argumentsInJSON string, _ ...tool.Option) (string, error) {
	var args struct {
		Query      string `json:"query"`
		MaxResults int    `json:"max_results"`
	}
	if argumentsInJSON != "" {
		if err := json.Unmarshal([]byte(argumentsInJSON), &args); err != nil {
			return "", fmt.Errorf("parse search_literature args: %w", err)
		}
	}
	if strings.TrimSpace(args.Query) == "" {
		return `{"hits":[],"note":"query 为空"}`, nil
	}
	max := args.MaxResults
	if max <= 0 {
		max = 5
	}
	if max > 10 {
		max = 10
	}
	hits, err := t.client.Search(ctx, args.Query, max)
	if err != nil {
		// 不伪造:把真实错误返回给模型,由模型如实告知用户。
		return "", fmt.Errorf("PubMed 检索失败(为确保数据真实性,不提供未经核验的引用): %w", err)
	}
	payload := map[string]any{
		"hits": hits,
		"note": "以上为 PubMed 真实检索结果;引用时请使用给出的 PubMed 链接或 DOI,不要编造其它引用。",
	}
	out, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// ——— PubMed 文献核验工具 ———

type verifyReferenceTool struct {
	client *pubmed.Client
}

func newVerifyReferenceTool(c *pubmed.Client) *verifyReferenceTool {
	return &verifyReferenceTool{client: c}
}

func (t *verifyReferenceTool) Info(_ context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: "verify_reference",
		Desc: "在 PubMed 核验一条文献引用是否真实存在。可按标题、PMID 或 DOI 核验。命中则返回真实条目与可点击链接;未命中说明该引用无法核验(可能不存在)。",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"title": {
				Type: schema.String,
				Desc: "待核验文献标题(英文优先)",
			},
			"pmid": {
				Type: schema.String,
				Desc: "PubMed ID(若已知)",
			},
			"doi": {
				Type: schema.String,
				Desc: "DOI(若已知)",
			},
		}),
	}, nil
}

func (t *verifyReferenceTool) InvokableRun(ctx context.Context, argumentsInJSON string, _ ...tool.Option) (string, error) {
	var args struct {
		Title string `json:"title"`
		PMID  string `json:"pmid"`
		DOI   string `json:"doi"`
	}
	if argumentsInJSON != "" {
		if err := json.Unmarshal([]byte(argumentsInJSON), &args); err != nil {
			return "", fmt.Errorf("parse verify_reference args: %w", err)
		}
	}
	if strings.TrimSpace(args.Title) == "" && args.PMID == "" && args.DOI == "" {
		return `{"verified":false,"note":"至少需提供 title / pmid / doi 之一"}`, nil
	}
	hit, err := t.client.Verify(ctx, args.Title, args.PMID, args.DOI)
	if err != nil {
		return "", fmt.Errorf("PubMed 核验失败: %w", err)
	}
	if hit == nil {
		payload := map[string]any{
			"verified": false,
			"note":     "未在 PubMed 核验到该文献,可能不存在或标题不匹配。请勿据此声称该引用真实。",
		}
		out, _ := json.Marshal(payload)
		return string(out), nil
	}
	payload := map[string]any{
		"verified": true,
		"hit":      hit,
		"note":     "已在 PubMed 核验到该文献;引用时请使用给出的 PubMed 链接或 DOI。",
	}
	out, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// mockMainReply 供 LLM 不可用时兜底。
func mockMainReply(messages []*schema.Message) string {
	var userMsg string
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == schema.User {
			userMsg = messages[i].Content
			break
		}
	}
	topic := userMsg
	if len(topic) > 30 {
		topic = topic[:30]
	}
	return "**" + mainAssistant.Name + "**\n\n" +
		"你的问题:「" + topic + "...」\n\n" +
		"(这是 mock 回复。LLM API key 未配置,切换到真实后端后此处会由 LLM 生成实际内容。)"
}

func contains(ss []string, s string) bool {
	for _, v := range ss {
		if v == s {
			return true
		}
	}
	return false
}
