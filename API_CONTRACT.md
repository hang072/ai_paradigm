# 后端契约(Backend API Contract)

> 前端 mock 引擎(`frontend/src/api/mock/engine.ts`,~900 行)已实现本契约的核心集。后端 Eino Go(位于 `backend/`,已交付 S1–S4 + 阶段 1-5)对齐契约并扩展(planner / artifact store / template versions / SSE / PubMed)。前端通过 `VITE_API_BASE` 切后端,业务代码零改动。
>
> 定位:`frontend/src/api/mock/index.ts` 是权威路由清单,`frontend/src/api/mock/engine.ts` 是行为参考;`backend/internal/api/router.go` 是后端路由清单,`backend/internal/domain/` 是字段定义的 source of truth(后端)。
>
> **当前契约版本:v1.2**(2026-08-11)。v1.2 相对 v1.1 的变更:
> - **阶段 6**:`AgentDef` +2 字段(`display_name` / `avatar`,workbuddy 借鉴 · 拟人化)
> - **阶段 6**:`ReviewReport` +1 字段(`target_node`,workbuddy 借鉴 · 智能路由)
> - **阶段 6**:review_quality 节点按 `target_node` 路由(静态图 / 动态图都支持)
> - **阶段 6**:Planner system prompt 同步,`spec` 含 `review_quality` 时必须保留 4 个下游 kind
> - **阶段 6**:chat 路径不存 `display_name/avatar`,前端通过 `getAgent` 实时拉取(零 migration)
> - **阶段 6**:后端 `validate.ReviewQuality` 强校验 `target_node` 白名单,非法值降级为 `enrich_content`
>
> v1.1 相对 v1.0 的变更(历史):
> - **阶段 1**:`AgentDef` +5 字段(persona / methodology / output_schema / guardrails)
> - **阶段 2**:`WorkflowTemplate` +4 字段(parameter_schema / description_required_inputs / current_version / versions)+ `NodeDef.config` 约定键
> - **阶段 2.4**:`template_versions` 表 + 2 端点(`/versions` / `/versions/{v}`)
> - **阶段 3**:`POST /api/planner/compose` 端点
> - **阶段 4**:`task_artifacts` 表 + 5 端点(`/artifacts` 等)+ `TaskSnapshot.Artifacts` 索引 + `StepHistoryItem.before_snapshot/after_snapshot`
>
> 所有新增字段 omitempty,旧数据反序列化为 nil/undefined,旧客户端零改动。

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

  // ─── v1.1(2026-08-11)新增,皆 omitempty,旧数据/老客户端兼容 ───
  persona?: string                                 // 一句话人设卡
  methodology?: string[]                           // 结构化方法论步骤
  output_schema?: {                                // 产物契约
    [artifactKey: string]: {
      type: 'markdown' | 'json' | 'text'
      schema?: Record<string, any>                 // 可选 JSON Schema 草案 7
    }
  }
  guardrails?: {                                   // 守门规则
    no_fabricate?: boolean
    require_citations?: boolean
    escalate_to?: string[]                         // agent_id 列表
    red_lines?: string[]                           // 自由文本禁用项
  }

  // ─── v1.2(2026-08-11)新增,workbuddy 借鉴 · 拟人化 ───
  display_name?: string                            // UI 友好名,如 "许清楚 · 需求澄清官";fallback 到 name
  avatar?: string                                  // 1-4 字符头像(emoji 或中英文字符)或 http(s)/data URL;后端 Normalize() 截断 >4 codepoint
}
```

**v1.2 拟人化说明**(阶段 6):
- 新增 2 字段皆 `omitempty`,旧数据/老客户端完全兼容
- `display_name` 为空时,前端 `AgentAvatar` 组件 fallback 到 `name[0]`
- `avatar` 为空时 fallback 到 `display_name[0] ?? name[0]`
- 颜色背景 fallback 顺序:`a.color` → `#6b7a90`(主助手色)
- 真后端 chat 路径**不存** `display_name/avatar` 到 `chat_messages`(避免 schema 变更);前端通过 `GET /api/agents` 实时拉取
- 内置 6 个 agent 的 `display_name` + `avatar` 见 `backend/internal/fixtures/agents.go`(许清楚 👂 / 齐活林 🧭 / 贾架构 🏛️ / 寇豆码 📝 / 严把关 🔍 / 谷百通 💡)
- 前端 `AgentAvatar` 组件(`frontend/src/components/AgentAvatar.tsx`)统一渲染规则:URL → `<Avatar src>`;否则 1-4 字符 / 截首字 + 颜色背景

**v1.2 `target_node` 智能路由说明**(阶段 6):
- `ReviewReport.target_node` ∈ `{plan_strategy, build_framework, enrich_content, human_final}`,空字符串表示默认 `enrich_content`
- 后端 `validate.ReviewQuality` 强校验白名单;非法值降级为 `enrich_content`,**不报错**(不阻断任务)
- 静态图(`graph.go reviewBranch`)和动态图(`graph_dynamic.go AddBranch`)都按 `target_node` 路由
- `target_node=plan_strategy` 经 `PreStrategy` → `plan_strategy` → `confirm_strategy` 链路,**保留用户重新确认策略的机会**
- `target_node=build_framework` 直接回 `build_framework` 节点(骨架是内部产物,不触发 confirm_strategy interrupt)
- `revision_count` 仍每次 revise +1,`MAX_REVISION=2` 硬限不变

**v1.1 兼容说明**:
- 新增字段全部 `omitempty`,旧数据反序列化时为 `null/undefined`
- 后端 `domain.AgentDef.Normalize()` 把 `methodology / output_schema / guardrails.EscalateTo / guardrails.RedLines` 的 nil 补为非 nil 空值
- 前端 mock 引擎 `createAgent` 同样补默认值,见 `frontend/src/api/mock/engine.ts:184`
- builtin agent 重启时 UPSERT 覆盖,用户创建的 agent 走 PUT(不再受 builtin 锁影响)

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
  config: Record<string, any>   // v1.1:仍为自由字段,约定键见 NodeDefConfigConventions
  out_ports: string[]        // 默认 ['next'];router 可有 ['pass','revise','redo']
  color: string
}
```

**v1.1 约定键**(NodeDefConfigConventions):`config` 运行时无 schema 强制,但以下键被 builtin 节点 / 阶段 3 GenericStep 消费,模板编辑器与 Planner 看到这些键可做更友好的 UI:

| key | 类型 | 含义 |
|---|---|---|
| `system_prompt_template` | string | 覆盖 `AgentDef.system_prompt`,支持 `{{input_key}}` 占位 |
| `input_keys` | string[] | 从 snapshot 读哪些顶层字段作为输入 |
| `output_keys` | string[] | 写 artifact store 时的 key(阶段 4 起生效) |
| `retrieve_kb` | boolean | 是否启用 `search_kb` 真检索 |
| `retrieve_pubmed` | `{enabled,max}` | PubMed 真检索(需 `PUBMED_EMAIL`) |
| `cite_rule` | `'markdown'\|'numbered'\|'none'` | 引用渲染方式 |

其他键允许(前向兼容),运行时忽略未识别键。
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

  // ─── 阶段 2(2026-08-11)新增,皆 omitempty,旧数据/老客户端兼容 ───
  parameter_schema?: {                          // 模板级入参契约
    [key: string]: {
      type: 'string' | 'number' | 'enum' | 'boolean'
      required?: boolean
      default?: any
      description?: string                      // 给 Planner / 人类阅读
      enum_values?: string[]                    // enum 类型必填
    }
  }
  description_required_inputs?: string[]        // Planner 拼 system prompt 用的"必填入参描述"
  current_version?: number                     // 1 = 初始版本,版本化保存时递增
  versions?: number[]                          // 历史版本号列表(只读)
}
```

`PUT /api/templates/:id` 对 builtin 报错。

**阶段 2 版本化保存(2026-08-11)**:每次 PUT 走"乐观锁 + 创建新版本",旧版本保留在 `template_versions` 表。前端调用方拿到 `current_version` 与 `versions[]` 知道所有历史。built-in 模板仍不可 PUT(后端返回 400)。

**端点增补**:
```
GET  /api/templates/:id/versions                          → number[]      # 列出所有历史 version
GET  /api/templates/:id/versions/:v                       → WorkflowTemplate  # 取指定 version 快照
```

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
DELETE /api/kb/:id/docs/:docId              → { doc_id, kb_id, deleted: true }
                                            ※ P84: 级联清 Milvus chunks + BLOB + sidecar + 抽出图
POST   /api/kb/:id/docs/:docId/reembed      → { doc_id, status: "pending" }
                                            ※ P84: 单 doc 重灌, 先清 Milvus 旧 chunks 再入队
GET    /api/kb/:id/docs/:docId/embed-status/stream  → SSE
                                            ※ events: pending | parsing | ready | failed
GET    /api/kb/:id/docs/:docId/images/:name → image binary (image/jpeg | image/png | image/webp | image/tiff)
                                            ※ P85: 抽出图, sidecar.images_json 列出的 filename 才返, 防越权
                                            ※ P91: 抽图改走 PyMuPDF sidecar, JSON 形状不变, 旧数据零影响
POST   /api/kb/:id/reembed                   → { kb_id, queued: <int> }   ※ 整 KB 入队
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

  // ─── 阶段 4(2026-08-11)新增,皆 omitempty,旧数据/老客户端兼容 ───
  // 共享工件仓库索引。key → 当前版本号 + 总版本数 + 列表 URL。
  // 实际内容走 GET /api/tasks/:id/artifacts/:key;此处只是元数据。
  artifacts?: { [key: string]: ArtifactKeyRef }
}
```

`ArtifactKeyRef`(TaskSnapshot.Artifacts[k] 的引用结构,无 content,只指向版本):
```ts
{
  key: string             // 'enriched_framework' / 'strategy_doc' / ...
  current_version: number // 最新 version
  total_versions: number  // 历史总数
  latest_url: string      // /api/tasks/{taskID}/artifacts/{key}
}
```

**`StepHistoryItem` 阶段 4 增补**:每步节点执行记录新增 `before_snapshot` / `after_snapshot` 浅拷贝(只拷贝本节点关心的字段,如 `enriched_framework` / `citations` / `revision_count`),前端可 diff 节点入口/出口的 state 变化。
```ts
{
  step: number
  node_id: string
  after_keys: string[]             // 兼容:老 API 仍读这个
  skipped: boolean
  before_snapshot?: { [field: string]: any }  // 阶段 4 新增
  after_snapshot?: { [field: string]: any }   // 阶段 4 新增
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

### 5.x review_quality 智能路由决策表(阶段 6 · workbuddy 借鉴)

`ReviewReport.target_node` 决定 review_quality 后的回流目标。`verdict × target_node` 共同决定下一个节点:

| `verdict` | `target_node` | revision<2 | revision≥2 |
|---|---|---|---|
| `pass` | (空) | → `human_final` | → `human_final` |
| `redo` | (空) | → `human_final` | → `human_final` |
| `revise` | `enrich_content` (默认) | → `enrich_content` (revision_count++) | → `human_final` (强制) |
| `revise` | `build_framework` | → `build_framework` (revision_count++) | → `human_final` (强制) |
| `revise` | `plan_strategy` | → `pre_strategy` → `plan_strategy` → `confirm_strategy` (revision_count++) | → `human_final` (强制) |
| `revise` | `human_final` | → `human_final` (revision_count++) | → `human_final` (强制) |

约束:
- `target_node` 缺省 = `enrich_content`(与 v1.1 行为兼容)
- `target_node` 非法值 → 后端 `validate.ReviewQuality` 降级为 `enrich_content`,不阻断任务
- `revision_count` 每次 revise +1,`MAX_REVISION=2` 硬限保留(智能路由不绕过审稿循环)
- 静态图(`graph.go reviewBranch`)与动态图(`graph_dynamic.go AddBranch`)都按此表路由
- 动态图 spec 校验:`spec` 含 `review_quality` 时,4 个下游 kind(`plan_strategy` / `build_framework` / `enrich_content` / `human_final`)必须全在 `spec.Nodes` 中,否则 `BuildGraphFromSpec` 拒收 + Planner 回退 `tpl-full`

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

### 6.2 阶段 3 · 动态 Planner(2026-08-11)

新端点 `POST /api/planner/compose`,在 chat 团队路径首条消息时由前端调用,根据 brief 让 LLM 实时生成可实例化的 `TaskSpec`,后端执行该 spec 走动态构图 `BuildGraphFromSpec`(与 tpl-full 走 `BuildTaskGraph` 平行)。

```
POST /api/planner/compose
  body: PlannerComposeInput → PlannerComposeResponse
```

Request:
```ts
{
  brief: string                // 用户原始 brief,必填
  task_type?: '幻灯' | '文章'  // 任务类型(可选,Planner 据此推测)
  template_hints?: string[]    // 风格参考模板 id(可选,如 ['tpl-full'])
  available_agent_ids?: string[]  // 候选 agents(默认全 builtin)
  available_node_ids?: string[]   // 候选 nodes(默认全 builtin)
}
```

Response:
```ts
{
  mode: 'dynamic' | 'static'
  spec?: TaskSpec              // mode='dynamic' 时填充,前端拿去做 TasksApi.start({ spec })
  fallback_template_id?: string  // mode='static' 时填充,前端走 TasksApi.start({ template_id })
  reason?: string               // 兜底原因(LLM 不可用 / spec 校验失败 / 缓存命中 ...)
  latency_ms: number
}
```

**回退策略**(由后端决定 `mode`):
- LLM 未配置 / 不可用 / 缓存未命中且调用失败 → `mode='static'`, `fallback_template_id='tpl-full'`, `reason` 说明
- LLM 输出 JSON 但 spec 校验失败(节点 type 未注册 / 边端点缺失 / 节点数超 2-12)→ 同上
- LLM 输出有效 spec → `mode='dynamic'`, `spec` 字段填充

**5min LRU 缓存**:相同 `brief + task_type + template_hints + available_*` 哈希命中即返,不再调 LLM。

**前端 chat 行为**(2026-08-11 起):
| 触发 | 行为 |
| --- | --- |
| team 挂载 + 首条消息 | 调 `POST /api/planner/compose`;`mode='dynamic'` → `TasksApi.start({ spec })`;`mode='static'` → `TasksApi.start({ template_id: fallback_template_id })` |
| 任务启动气泡 | 展示 `planner_mode` 与节点数(动态)或 fallback 模板 ID(静态) |

**mock 引擎**:浏览器无 LLM,固定返回 `mode='static'` + `fallback_template_id='tpl-full'`,行为等价于阶段 1-2 的老 chat 团队路径。


---

## 七、Artifact 仓库(阶段 4 · 2026-08-11)

6 个 compute 节点(parse_brief / plan_strategy / build_framework / enrich_content / review_quality / finalize)与 finalize 节点的 step 函数写盘路径在阶段 4.6 起统一走 artifact store:每写一次自动 +1 version,旧版本不可变保留。`TaskSnapshot.Artifacts` 索引同步更新。

**端点**(前缀 `/api/tasks/:id`):

```
GET  /api/tasks/:id/artifacts                          → ArtifactRef[]
GET  /api/tasks/:id/artifacts/:key                      → ArtifactRow       (latest)
GET  /api/tasks/:id/artifacts/:key/versions            → number[]
GET  /api/tasks/:id/artifacts/:key/versions/:v         → ArtifactRow
GET  /api/tasks/:id/artifacts/:key/diff?v1=X&v2=Y      → ArtifactDiff
```

`ArtifactRef`(列表元素):
```ts
{
  key: string             // 'enriched_framework' / 'strategy_doc' / 'citations' / ...
  current_version: number
  total_versions: number
  latest_url: string      // /api/tasks/{taskID}/artifacts/{key}
}
```

`ArtifactRow`(单条记录):
```ts
{
  task_id: string
  key: string
  version: number             // 单调递增
  content: string            // markdown / JSON 原文
  content_type: 'markdown' | 'json' | 'text'
  produced_by?: string       // NodeDef.id
  produced_by_agent?: string // AgentDef.id
  created_at: string         // 'YYYY-MM-DD HH:mm:ss'
  metadata?: Record<string, any>
}
```

`ArtifactDiff`(diff 端点响应):
```ts
{
  task_id: string
  key: string
  v1: number
  v2: number
  unified: string            // unified diff 格式,每行 ' ' / '+' / '-' 前缀
}
```

**错误码**:
- `v1` / `v2` 非正整数 → 400 `BadRequest`
- `v1` / `v2` 不存在 → 404 `Not Found`
- key 不存在(latest)→ 404 `Not Found`

**实现**:SQLite 新表 `task_artifacts(task_id, key, version, content, content_type, produced_by, produced_by_agent, created_at, metadata_json)`,复合主键 `(task_id, key, version)`,migration v5。diff 由后端 LCS 自实现(不引第三方库)。

**前端消费**:NodeDetailDrawer 的"工件历史"折叠面板(`pages/tasks/NodeDetailDrawer.tsx:ArtifactPanel`)展示所有 key + 版本,默认对比 v_latest vs v_oldest,可选任意两版本 diff。

**mock 引擎**:`frontend/src/api/mock/engine.ts` 的 `composePlanner` 等不实现 artifact 端点(浏览器无 SQLite);前端在 `VITE_USE_MOCK=true` 时不会调这些端点。

---

## 八、模板版本(阶段 2.4 · 2026-08-11)

每次 `PUT /api/templates/:id` 走"乐观锁 + 创建新版本",旧版本保留在 SQLite 新表 `template_versions(template_id, version, data, created_at)`,migration v4。`current_version` 与 `versions[]` 字段返回在 `WorkflowTemplate` 上。

**端点**:
```
GET /api/templates/:id/versions              → number[]
GET /api/templates/:id/versions/:v           → WorkflowTemplate
```

错误码:
- `v` 非正整数 → 400 `BadRequest`
- `v` 不存在 → 404 `Not Found`

**前端消费**:模板编辑器(`pages/templates/edit.tsx`)保存按钮显示当前版本与历史;列表页(`pages/templates/index.tsx`)展示版本号。

---

## 九、Eino 后端实现要点

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

## 十、测试建议

后端实现每个 API 后,可以直接跑前端来验证:

```bash
# 后端起在 8001
# frontend/.env.local:
VITE_USE_MOCK=false
VITE_API_BASE=http://127.0.0.1:8001
```

跑通验证清单:
- [ ] `/agents` 页看到列表 → 新建/编辑 → persona / methodology / output_schema / guardrails 字段能保存
- [ ] `/templates` 看到 3 个内置 → 进入编辑页 → 改某节点 config / agent_id / parameter_schema → 保存 → 列表显示新版本号 → 旧版本仍可读
- [ ] `/templates/:id/versions` 返回 `[1]`;改完再 PUT 一次 → 返回 `[1, 2]`
- [ ] `/knowledge` 页跨库搜索能返回 hits
- [ ] `/tasks` 新建任务 → 弹澄清 → 答完 → 弹策略 → 确认 → 弹终稿 → 通过 → done
- [ ] `/tasks/:id` 的 `artifacts` 字段含 enriched_framework / strategy_doc / final_output 等
- [ ] `/tasks/:id/artifacts` 列出所有 key;`/artifacts/enriched_framework` 返回 latest;`/artifacts/enriched_framework/versions` 返回多版本
- [ ] 触发 revise 后再跑一次 enrich → `/artifacts/enriched_framework` version 递增 → `/diff?v1=1&v2=2` 返回 unified diff(行数 > 0)
- [ ] `/chat` 单专家发消息 → 收到回复
- [ ] `/chat` 专家团选模板 → Planner 调通(spec 来自 LLM 或 fallback 模板)
- [ ] `POST /api/planner/compose { brief: "..." }` → `mode='static'` 或 `'dynamic'` + spec/fallback_template_id

**E2E 集成测试**:`backend/internal/engine/artifact_e2e_test.go` 6 个测试,跑 `go test ./internal/engine/ -run TestE2E -v` 全 PASS(阶段 4.10 落地)。
