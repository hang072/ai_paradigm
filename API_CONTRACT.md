# 后端契约(Backend API Contract)

> 前端 mock 引擎已经 100% 实现下述契约。后端(Eino Go,位于 `backend/`,独立项目)实现须严格对齐,前端零改动。
>
> 定位:`frontend/src/api/mock/index.ts` 是权威路由清单,`frontend/src/api/mock/engine.ts` 是行为参考。

---

## 通用

- 基础 URL:由前端 `VITE_API_BASE` 决定(默认 `http://127.0.0.1:8001`)
- 请求/响应:JSON,`Content-Type: application/json`
- 错误格式:非 2xx 状态 + `{ "detail": "错误信息" }`(前端 axios interceptor 会把 `detail` 抛给业务层)
- 时间戳:字符串 `YYYY-MM-DD HH:mm:ss`(本地时区)
- ID 生成:后端自定,但前缀建议对齐 mock(`agent-*` / `node-*` / `tpl-*` / `task-*` / `skill-*` / `kb-*` / `doc-*`)

---

## 一、Agents

```
GET    /api/agents             → AgentDef[]
GET    /api/agents/:id         → AgentDef
POST   /api/agents             { ...AgentDef, name required }  → AgentDef
PUT    /api/agents/:id         → AgentDef
DELETE /api/agents/:id         → { ok: true }  ※ builtin=true 时报 400
```

`AgentDef`:
```ts
{
  id: string
  name: string
  description: string
  system_prompt: string
  tools: string[]           // ["search_literature","verify_reference","search_kb"]
  llm_model: string         // "default" | "deepseek-chat" | ...
  recursion_limit: number
  color: string
  runtime?: '云端' | '本地 Mac mini'
  builtin?: boolean
}
```

## 二、Nodes / Templates

Nodes 同 Agents 结构 CRUD。

`NodeDef`:
```ts
{
  id: string
  name: string
  kind: 'compute' | 'interrupt' | 'counter' | 'router'
  agent_id: string | null    // compute 节点才有意义
  description: string
  config: Record<string, any>
  out_ports: string[]        // 默认 ['next'];router 可有 ['pass','revise','redo']
  color: string
}
```

`WorkflowTemplate`:
```ts
{
  id: string
  name: string
  description: string
  tags: string[]
  entry: string              // 起始节点 id
  nodes: NodeInstance[]      // { id, type }[]  ※ type = NodeDef.id
  edges: Edge[]              // { from, to, port? }[]
  builtin?: boolean
}
```

`PUT /api/templates/:id` 对 builtin 报错。

## 三、Skills

同 CRUD 结构。`SkillDef`:
```ts
{
  id: string
  name: string
  category: string           // "文献" | "分析" | "写作" | "医学"
  description: string
  prompt_fragment: string    // 追加到 system prompt
  suggested_tools: string[]
  color: string
  builtin: boolean
}
```

## 四、Knowledge Base

```
GET    /api/kb                              → KnowledgeBase[]
GET    /api/kb/:id                          → KnowledgeBase
POST   /api/kb                              → KnowledgeBase
PUT    /api/kb/:id                          → KnowledgeBase   ※ docs 字段忽略,单独用 docs 端点
DELETE /api/kb/:id                          → { ok }          ※ builtin 报错

POST   /api/kb/:id/docs                     { title, type, content?, tags?, url? } → KnowledgeDoc
PUT    /api/kb/:id/docs/:docId              → KnowledgeDoc
DELETE /api/kb/:id/docs/:docId              → { ok }

POST   /api/kb/search                       { query: string, kb_ids: string[] } → KbSearchHit[]
                                            ※ kb_ids 为空数组 = 搜全部
```

`KnowledgeBase`:
```ts
{
  id: string
  name: string
  description: string
  color: string
  builtin?: boolean
  docs: KnowledgeDoc[]
  created_at: string
  updated_at: string
}
```

`KnowledgeDoc`:
```ts
{
  id: string
  title: string
  content: string           // markdown / text 正文;link 类型可存摘要
  type: 'markdown' | 'text' | 'link'
  tags: string[]
  url?: string              // type === 'link' 才用
  created_at: string
  updated_at: string
}
```

`KbSearchHit`:
```ts
{
  kb_id: string
  kb_name: string
  doc_id: string
  doc_title: string
  snippet: string           // 命中处上下文片段(前后 40 字左右)
  score: number             // 越大越相关
  url?: string              // 命中文档的真实来源链接(来自 KnowledgeDoc.url),供引用可点击跳转
}
```

**检索算法建议**(mock 用的简单版,后端可替换为 embedding):
- tokenize:按标点切,中文再滑窗补 2-3 gram
- 打分:title 命中 +3,tag 命中 +2,content 命中 +1
- 每 doc 只保留最佳一处片段
- 按 score 降序,返回 top 6

## 五、Tasks(核心状态机)

```
GET    /api/tasks                → TaskSummary[]
POST   /api/tasks                { brief, task_type, title?, template_id?, spec? } → TaskSnapshot
GET    /api/tasks/:id            → TaskSnapshot
POST   /api/tasks/:id/resume     { answer: string }   → TaskSnapshot
POST   /api/tasks/:id/spec       { spec: TaskSpec }   → TaskSnapshot
```

`TaskStatus = 'running' | 'waiting_human' | 'done' | 'failed' | 'cancelled'`
`TaskType = '幻灯' | '文章'`

**失败语义**:接真实 LLM 时,provider 不可用 / 调用出错 / 超时(默认 180s,env `PARADIGM_LLM_TIMEOUT_SEC`)/ 输出解析校验失败 → 任务进入 `failed`,`error_message` 带摘要。不再回落 mock 内容。

`PendingInterrupt.stage = 'ask_clarification' | 'confirm_strategy' | 'human_final'`

`TaskSnapshot`(节选,完整见 `src/types/task.ts`):
```ts
{
  thread_id: string
  title: string
  brief: string
  task_type: TaskType
  created_at: string
  status: TaskStatus
  pending: PendingInterrupt | null
  messages: string[]                    // 运行日志,追加式
  parsed_info?: Record<string, any>
  clarify_questions?: ClarifyQuestion[]
  completeness?: { enough: boolean, missing: string[] }
  strategy_doc?: string                 // markdown
  narrative_mode?: string
  framework_skeleton?: Record<string, any>
  enriched_framework?: string           // markdown(关键论断以 [标题](URL) 形式引用真实知识库来源)
  review_report?: ReviewReport          // .summary 为流式审核的 markdown 正文
  citations?: Citation[]                // 内容填充采用的真实来源清单(带可点击 source_url)
  revision_count: number
  final_output?: string                 // markdown
  error_message?: string                // status=failed 时的错误摘要
  step_history: StepHistoryItem[]
  spec: TaskSpec                        // { entry, nodes, edges }
}
```

`Citation`(内容填充引用的一条真实来源;只允许来自知识库文档):
```ts
{
  ref_id: string            // 对应 KnowledgeDoc.id
  title: string
  source_url: string        // 真实可点击链接,回填自 KbSearchHit.url
  used_in_section?: string
}
```
后端只回填「正文里实际出现了该来源 URL」的条目 —— 保证每条 citation 都真实且被引用,不编造。

**状态机行为**(mock 版,后端可参考):
```
POST /api/tasks
  → new task, status=running
  → parse_brief 异步 → 40% 概率 interrupt(ask_clarification)
                    → else plan_strategy → interrupt(confirm_strategy)

POST /api/tasks/:id/resume (第 1 次:澄清答案)
  → plan_strategy → interrupt(confirm_strategy)

POST /api/tasks/:id/resume (第 2 次:确认策略)
  → answer 含 "调整/修改" → 回 plan_strategy → 再 interrupt
  → else → build_framework → enrich_content → review_quality
        → verdict=pass → interrupt(human_final)
        → verdict=revise & revision<2 → revision++ → 回 enrich_content
        → verdict=revise & revision≥2 → 强制 interrupt(human_final)

POST /api/tasks/:id/resume (第 3 次:终稿反馈)
  → answer 含 "退回/修改" → revision++ → 回 enrich_content → human_final 再来
  → else → finalize → status=done
```

**SSE 流式进度推送** (`GET /api/tasks/:id/stream`):

`Content-Type: text/event-stream`。事件序列:

```
event: snapshot   → TaskSnapshot (初始快照, 每当节点完成/状态翻转)
event: phase      → { node, label } (节点进入时: "正在解析需求…"/"正在综合审核…")
event: token      → { node, delta } (流式节点的增量文本, 如 enrich_content / review_quality)
event: done       → {} (终态: done / failed / cancelled 时关闭连接)
```

前端消费: 先等 `event: snapshot` 获得初始状态, `phase` 显示 spinner, `token` 逐字拼接流式气泡, `snapshot` 更新 step_history/pending/done, `done` 关闭连接。SSE 建连失败 → 回落 2s 轮询 `GET /api/tasks/:id`。

## 六、Chat

```
POST /api/chat/reply → ChatReplyPart[]   (长度恒为 1)
```

**语义**:每个会话由一个通用主助手 (`agent-main`) 承接。用户可选挂载 0 或 1 个"子智能体"作为主助手的工具:
- `attached_expert.kind === 'agent'`:一个专家
- `attached_expert.kind === 'team'` :一个 WorkflowTemplate (专家团)

主助手根据用户输入自主决定是否调用挂载的子智能体;调用轨迹作为 tool_call 挂在主助手 part 里。

Request:
```ts
{
  message: string
  attached_expert?: { kind: 'agent' | 'team', id: string }   // 挂载对象; 缺省 = 纯通用主助手
  tools: string[]                                            // search_kb / search_literature / verify_reference
  skills: string[]                                           // skill id 列表 (拼进主助手 system prompt)
  kb_ids?: string[]                                          // search_kb 的检索范围
  history?: { role: string, content: string }[]
}
```

Response:
```ts
Array<{                             // 恒为长度 1
  agent_id: string                  // 主助手固定为 'agent-main'
  agent_name: string                // '主助手'
  agent_color: string
  content: string                   // markdown, 主助手正文
  tool_calls: Array<{
    tool: string                    // 普通工具名 (search_kb 等) 或 'invoke_expert'
    input: Record<string, any>
    output_preview: string          // 工具输出 / 子智能体发言 (markdown)
    // 以下三项仅在子智能体调用时非空:
    agent_id?: string               // 发言专家的 id
    agent_name?: string
    agent_color?: string
  }>
}>
```

**子智能体调用约定**:
- `attached_expert.kind === 'agent'`:主助手若判定应调用,在 `tool_calls` 里追加一条 `tool='invoke_expert'` 且 `agent_*` 填该专家身份的记录。
- `attached_expert.kind === 'team'`:主助手若判定应调用,遍历模板 `nodes`,对 `kind==='compute' && agent_id!=null` 的节点(去重、保序)每位专家追加一条 `tool='invoke_expert'` 记录。
- 前端据 `tool_calls[i].agent_id` 是否非空决定渲染为"🧩 调用了 X 专家"的折叠块(默认收起)。

**主助手身份**:`agent-main` 是系统级常量身份,不进 `entities` 表 / fixtures,用户不可编辑或删除。

**流式**:客户端可在 Accept 头带 `text/event-stream` 触发 SSE。事件序列:
```
start {agent_id, agent_name, agent_color, tool_calls}   // header + 已收集的 tool_calls (含子调用轨迹)
chunk {content, tool_calls?}                             // 增量正文; tool_calls 可选覆盖(子调用完成时补发)
done  {}
finish {}
error {detail}                                           // 错误
```
主助手一次会话对应一段 `start...done...finish`(不再有 team 模式下的多个 start)。

**tools 行为**:
- `search_kb` — 调用 `POST /api/kb/search`(内部函数)得到 hits,格式化到 `output_preview`;命中文档标题渲染为 markdown 可点击链接 `[标题](url)`(url 来自 `KbSearchHit.url`),供溯源核验。**这是唯一提供内部知识库检索的工具**。
- `search_literature` — **已接入真实 PubMed**(NCBI E-utilities, `internal/pubmed/client.go`)。调用 esearch.fcgi + efetch.fcgi 获取真实文献标题/作者/期刊/年份/DOI,标题渲染为 markdown 可点击链接 `[标题](https://pubmed.ncbi.nlm.nih.gov/PMID/)`。需后端配置 `PUBMED_EMAIL`(环境变量);未配置时返回诚实说明,绝不伪造 PMID/期刊卷期。
- `verify_reference` — **已接入真实 PubMed**。按标题/PMID/DOI 反查是否真实存在;命中返回真实条目+可点击链接,未命中如实说明"未核验到"。与 `search_literature` 共享同一 PubMed 客户端配置。
- `search_literature` / `verify_reference` 在 mock 引擎(浏览器内)中保持诚实占位,提示需切换到真实后端才可用。

**遗留字段迁移**:2026-07-23 前的会话仍带 `mode` / `agent_id` / `team_template_id`。新后端应在启动时清空 `chat_sessions` / `chat_messages` 表并重建 schema (新表用单列 `attached_expert TEXT` 存 JSON `{kind, id}`)。前端 `loadAll` 也会顺便清一次遗留 localStorage。

### 6.1 Chat + Team → Task 编排

`attached_expert.kind === 'team'` 时,团是一个带反问确认、审核回路、`pass/revise/redo` 分支的**完整 graph**,一次 tool call 装不下。因此 chat 的 team 挂载走 `/api/tasks` state machine (见第 五 节),而不是 `/api/chat/reply`。

**前端行为**(2026-07-23 起,路径 A):

| 触发 | chat 会话行为 |
| --- | --- |
| 挂载 team, `active_task_id` 空, 用户首条消息 | `POST /api/tasks { template_id: attached_expert.id, brief: message, task_type: 推断 }`;把返回的 `thread_id` 写入 `ChatSession.active_task_id`;append 一条主助手气泡"任务已启动";开始 2s 轮询 `GET /api/tasks/:id` |
| 挂载 team, `active_task_id` 非空且 task 未 `done`, 用户后续消息 | `POST /api/tasks/:id/resume { answer: message }`,不再调 `/api/chat/reply` |
| Poll 检测到 `step_history` 新增 (非 skipped 的 compute 节点) | Append 一条主助手气泡,`tool_calls: [{ tool: 'graph_step', agent_id/name/color, output_preview: 该 step 的产物摘要 }]` |
| Poll 检测到 `status === 'waiting_human'` | Append 一条主助手气泡,`content = pending.prompt + questions 选项`;输入栏 placeholder 提示"回复以推进任务" |
| Poll 检测到 `status === 'done'` | Append 最终"任务已完成"气泡含 `final_output`;停 poll;保留 `active_task_id` 供 UI 展示"已完成" tag,后续消息回到通用主助手模式 |

**Session 字段扩展**:

```ts
interface ChatSession {
  // ... 原字段
  active_task_id?: string   // 若挂载 team 且已起任务, 指向 /api/tasks/:id; done 后保留供回溯
}
```

对应 SQLite schema 加 `active_task_id TEXT`(migration v3, `ALTER TABLE ADD COLUMN`,不 DROP 老数据)。

**后端 `/api/chat/reply` 的 team 兜底**:老前端 / 第三方客户端如果仍传 `attached_expert.kind='team'`,后端应继续走"invoke_expert 遍历专家"的兜底行为(保持兼容),但打一条 warning log 提醒排查。新前端不会再走这条路径。

---

## 七、Eino 后端实现要点

### 关于 interrupt/resume

LangGraph 有 `interrupt()` 原语,Eino 没有直接对应。**这是最大风险项**。建议方案:

方案 A · **checkpointer + 显式退出**:每个 interrupt 节点写入 pending 状态到 checkpoint,函数直接 return;`resume` 端点从 checkpoint 恢复继续。前端 mock 就是这么做的。

方案 B · **channel 阻塞**:节点向 pending channel 发送并阻塞,resume 端点向 channel 发消息唤醒。适合内存态,不适合重启恢复。

**推荐方案 A**,便于持久化,和现有 mock 语义一致。

### 关于并发

- 每个 task 一个 thread_id
- 全局工具调用轨迹必须 **thread-local**(参考 `paradigm_langgraph/src/tools.py` 的 threading.local)
- Go 中用 goroutine + context.WithValue 携带 trace id

### 关于 LLM 抽象

- 兼容 OpenAI SDK 的 chat completions(DeepSeek / 阿里通义 / Kimi 都兼容)
- 未配置 API Key 时回落到 mock 输出(参考 `paradigm_langgraph/src/llm.py` 的 graceful degradation)

---

## 八、测试建议

后端实现每个 API 后,可以直接跑前端来验证:

```bash
# 后端起在 8001
# frontend/.env.local:
VITE_USE_MOCK=false
VITE_API_BASE=http://127.0.0.1:8001
```

跑通验证清单:
- [ ] `/agents` 页看到列表 → 新建/编辑
- [ ] `/templates` 看到 3 个内置
- [ ] `/knowledge` 页跨库搜索能返回 hits
- [ ] `/tasks` 新建任务 → 弹澄清 → 答完 → 弹策略 → 确认 → 弹终稿 → 通过 → done
- [ ] `/chat` 单专家发消息 → 收到回复
- [ ] `/chat` 专家团选模板 → 收到多段回复
