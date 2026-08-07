# Paradigm Eino Workbench · 进度文档

> 最新更新:2026-08-04
>
> 本文件记录项目开发进度、决策记录、待办清单,便于下次会话/后续开发者快速接续。

---

## 一、当前状态一句话

**前端 MVP 完整可跑,mock 后端支撑全部主流程。等待 Eino Go 后端进场替换 mock。**

| 指标 | 值 |
|---|---|
| tsc --noEmit | ✅ 通过 |
| vite build | ✅ 通过(1.57 MB · gzip 505 KB · 3869 modules)|
| 主流程闭环 | ✅ 澄清 → 策略确认 → 框架 → 内容 → 审核回路 → 终稿反馈 → 定稿 |
| 页面数 | 7 · 全部可用 |
| Mock 内置数据 | 6 Agents / 10 Nodes / 3 Templates / 5 Skills / 3 KB(7 篇文档)/ 2 示例任务 |

---

## 二、✅ 已完成事项

### 2.1 脚手架 & 基础设施

- Vite 5 + React 18 + TypeScript(strict)
- Ant Design 5 · zh-CN locale · 品牌配色(#2b57d6 主色 + #7c4dff 辅色)
- Zustand(会话/应用状态,`useChatStore` 持久化到 localStorage,`useTasksStore` 内存)
- React Router 6(BrowserRouter,7 条路由)
- @xyflow/react 12 + dagre LR 自动布局
- axios + 自定义 mock adapter(80ms 假延迟),`VITE_USE_MOCK=false` 无缝切真后端
- ESLint + Prettier · `.env.example` · `vite-env.d.ts`

### 2.2 类型层(与 paradigm_langgraph 后端 dataclass 对齐)

`src/types/`:
- `agent.ts` · `AgentDef`
- `node.ts` · `NodeDef` / `NodeKind = compute | interrupt | counter | router`
- `template.ts` · `WorkflowTemplate` / `NodeInstance` / `Edge`
- `task.ts` · `TaskSnapshot` / `PendingInterrupt` / `StepHistoryItem` / `TaskSpec`
- `review.ts` · `ReviewReport` / `ReviewItem`
- `skill.ts` · `SkillDef`
- `chat.ts` · `ChatSession` / `ChatMessage` / `ToolCallTrace`
- `knowledge.ts` · `KnowledgeBase` / `KnowledgeDoc` / `KbSearchHit`

### 2.3 Mock 后端引擎(`src/api/mock/engine.ts`)

- Agents / Nodes / Templates / Skills / Tasks / KnowledgeBase 全套 CRUD
- **任务状态机完整闭环**:
  ```
  start
    → parse_brief
    → [40%] ask_clarification interrupt
    → plan_strategy
    → confirm_strategy interrupt
       → [含"调整/修改"] 回 plan_strategy
       → else build_framework
    → enrich_content
    → review_quality
       → [pass] human_final interrupt
       → [revise + revision<2] revision_count++ → 回 enrich_content
       → [强制] human_final(达到 2 次)
    → human_final interrupt
       → [含"退回/修改"] revision_count++ → 回 enrich_content
       → else finalize → done
  ```
- **知识库检索** `searchKb(query, kb_ids)`:tokenize(中英+2-3 gram) → title×3 / tag×2 / content×1 加权 → top 6 命中片段(前后各 40 字上下文)
- **Chat 回复引擎**:
  - single 模式:单专家 1 段回复
  - team 模式:按 WorkflowTemplate 解析 compute 节点顺序,涉及 Agent 依次发言(去重)
- 每步 compute 用 setTimeout 300~800ms 模拟延迟

### 2.4 7 大页面

| 路由 | 内容 | 状态 |
|---|---|---|
| `/workbench` | 系统健康度 · 今日待办 · 最近任务卡片 | ✅ |
| `/chat` | 三栏对话:会话列表 240px · 消息流 · 右侧配置面板 340px(专家/专家团 + 工具 + 技能 + 知识库) | ✅ |
| `/tasks` · `/tasks/:id` | 左右布局 · 4 Tab(概览/画布/产物/日志)· HITL 浮动面板 · 2s 轮询 | ✅ |
| `/agents` | 卡片列表 + 新建/编辑弹窗(prompt/工具/模型/色) | ✅ |
| `/knowledge` | 左 KB 列表 · 右上文档列表 · 右下 Markdown 预览 · 顶部跨库检索 | ✅ |
| `/templates` | 3 个内置模板 + xyflow 只读画布预览 | ✅ 只读 |
| `/settings` | 3 Tab:模型接入(DeepSeek/Claude API Key 存 localStorage)· 三方集成(mock)· 关于 | ✅ |

### 2.5 Fixtures(内置数据)

**Agents(6 个)** — `src/api/mock/fixtures/builtins.ts`
- agent-clarifier · 需求理解与反问
- agent-planner · 策略规划师
- agent-builder · 框架搭建师
- agent-enricher · 内容填充专员
- agent-reviewer · 质量审核员
- agent-designer · 通用设计助手

**Templates(3 个)**
- tpl-slide-simple · 幻灯片框架制作(简版)· 7 节点
- tpl-article-simple · 文章框架制作(简版)· 7 节点
- tpl-full · 完整流程(含审核回路)· 10 节点

**Skills(5 个)** — `src/api/mock/fixtures/skills.ts`
- skill-literature · 文献检索与解读
- skill-slide-outline · 幻灯片大纲生成
- skill-article-draft · 医学文章写作
- skill-critical-review · 批判性审阅
- skill-data-analysis · 临床数据解读

**KnowledgeBase(3 个 · 7 篇文档)** — `src/api/mock/fixtures/knowledge.ts`
- kb-guidelines · 临床指南库(ESC 心衰 / ADA 糖尿病 / AHA 卒中)
- kb-drug-checklist · 用药清单库(SGLT2i / GLP-1RA)
- kb-internal-sop · 内部 SOP 库(幻灯 SOP / 审核评分)

**示例任务(2 个)** — 内存动态生成
- 等待策略确认的幻灯任务
- 已完成的文章任务

### 2.6 xyflow 画布

- 自定义 AgentNode(4 种 kind 图标 + 状态脉冲边框:done/running/pending/failed)
- LabeledEdge(pass/revise/redo 端口染色)
- dagre 自动 LR 布局
- FlowCanvas 通用封装,任务视图只读 + 高亮当前节点

### 2.7 关键决策 & 语义纠正记录

| 时点 | 议题 | 结论 |
|---|---|---|
| 初期 | 新项目位置 | `D:\DH\Project\paradigm_eino`,与 paradigm_langgraph 并列 |
| 初期 | 前端技术栈 | React + AntD + xyflow(Dify 同栈,便于后续借鉴) |
| 初期 | 交付顺序 | 前端优先 + mock 后端;本轮只交付前端 |
| 迭代 1 | 会话增加对话界面 | 加 `/chat` 页,支持专家/专家团/工具/技能选择 |
| 迭代 2 | **专家 vs 专家团语义** | 专家 = 单智能体;专家团 = 已配置好的多智能体架构(即 WorkflowTemplate)。团模式改为「选一个模板 → 按其 compute 节点顺序触发专家序列」 |
| 迭代 3 | Skill vs Agent | Skill 是即插即用的能力模块(prompt fragment + 建议工具);Agent 是长期角色 |
| 迭代 4 | **知识库落地** | 从虚假 `search_kb` 打桩升级为独立模块:CRUD + tokenize 打分检索 + 对话挂载 |

---

## 三、⏳ 未完成事项(按优先级)

### P0 · 后端替换(核心里程碑)

- [ ] **Eino Go 后端骨架初始化**
  - Go module 建立,选定项目结构(建议 `paradigm_eino_backend/` 或 `paradigm_eino/backend/`)
  - Eino Compose Graph 编排,把 LangGraph 的 9 节点搬过来
  - 关键难点:**Eino 中的 interrupt/resume 语义映射**(LangGraph 有原生 interrupt,Eino 需要研究实现方案)
  - Checkpointer 选型:内存(POC)→ SQLite / Redis(生产)
- [ ] **API 逐个替换**
  - 优先级:agents / templates(纯 CRUD)→ tasks(状态机)→ chat(LLM 调用)→ knowledge(检索)
  - 契约已在 `src/api/mock/index.ts` 里定死,前端零改动
- [ ] **`VITE_USE_MOCK=false` 端到端验证**

### P1 · 前端未实现的编辑器

- [x] **模板画布编辑器** (`pages/templates/edit.tsx` + `canvas/EditableCanvas.tsx`) — 2026-08-04 交付
  - ✅ 三栏布局 / 拖拽建节点 / Handle 端口连接 / 属性面板 / 保存到后端
  - ✅ 内置模板进入时自动 fork(后端 builtin 锁,前端零特殊路径)
  - ✅ 节点/边均可键盘删除;删节点自动清理悬空边
  - ⏳ 未做:agent_id / config 编辑(本轮只编辑结构,Agent 绑定走 NodeDef 后台编辑)
- [x] **任务画布节点点击 → 抽屉** (`pages/tasks/NodeDetailDrawer.tsx`) — 2026-08-04 交付
  - ✅ 点击画布节点 → 右侧 720px Drawer,展示基础信息(实例/类型/Agent 绑定/端口)+ 运行状态(步骤号/影响字段数)+ 产物(按 after_keys 渲染)
  - ✅ 字段渲染分发:`strategy_doc` / `enriched_framework` / `final_output` 走 `MarkdownView`;`review_report` 走 `ReviewReportView`;`citations` 走可点击链接列表;`parsed_info` / `framework_skeleton` / `completeness` 走 JSON pre;`narrative_mode` / `revision_count` 走 Tag
  - ✅ 多轮 revision:取该节点在 `step_history` 中最后一次运行的记录,优先用 `lastRun.after_keys` 决定展示哪些字段
  - ✅ 顶部「复制产物」按钮:把节点元信息 + 字段全量 dump 成 markdown 写入剪贴板
  - ✅ 兼容前端 mock(只声明 `strategy_doc` 单字段)与后端真模型(声明 `strategy_doc + narrative_mode` 双字段)
  - ⏳ 未做:节点输入(进入该节点时的 state 快照),目前 `StepHistoryItem` 只存 `after_keys` 缺 `before_keys`,需要后端补字段后前端才能展示 diff
- [ ] **知识库文件上传** — 目前只有粘贴 Markdown,缺 PDF/DOCX/TXT 导入
- [ ] **知识库分块/向量化** — 目前是关键字匹配,接入 Eino 后需要 chunk + embedding 层

### P2 · 实时性 & 流式

- [ ] **SSE / WebSocket 替换 2s 轮询**
  - 影响:`useTasksStore` 的 pollActiveTask · `pages/tasks` 的日志刷新
  - Chat 流式打字机效果(目前是整段返回)

### P3 · 三方集成(真接)

- [ ] Teambition API 联通(目前是 mock UI)
- [ ] 钉钉会议 API 联通

### P4 · 工程质量

- [ ] **单元测试**:Vitest + React Testing Library
- [ ] **E2E**:Playwright 覆盖 HITL 主流程
- [ ] Bundle 拆分(1.57 MB 过大,建议 antd + xyflow + react-markdown 按需分 chunk)
- [ ] `search_literature` / `verify_reference` 工具轨迹仍是硬编码假回复(未接入真检索器,`search_kb` 已经实体化)

### 明确不做

- 用户登录 / 权限(POC 无)
- i18n(全中文)
- 移动端适配(桌面优先)

---

## 四、恢复开发指南(给下次会话/新开发者)

### 4.1 环境准备

```bash
cd D:\DH\Project\paradigm_eino\frontend
npm install
```

### 4.2 常用命令

均在 `frontend/` 目录下执行:

```bash
npm run dev           # 开发服务器,默认 http://localhost:5173
npm run build         # 生产构建
npm run preview       # 构建后本地预览
npx tsc --noEmit      # 类型检查(不产物)
```

### 4.3 关键文件位置速查

| 想改什么 | 打开哪里 |
|---|---|
| 路由 / 加新页面 | `frontend/src/router/index.tsx` + `frontend/src/layout/AppShell.tsx` |
| 类型定义 | `frontend/src/types/*.ts` |
| Mock 后端行为 | `frontend/src/api/mock/engine.ts`(单文件 900 行) |
| Mock 路由分发 | `frontend/src/api/mock/index.ts` |
| 内置数据 | `frontend/src/api/mock/fixtures/*` |
| axios 客户端 | `frontend/src/api/client.ts` |
| 会话存储 | `frontend/src/store/useChatStore.ts` |
| xyflow 画布 | `frontend/src/canvas/FlowCanvas.tsx` |
| Markdown 渲染 | `frontend/src/components/MarkdownView.tsx` |
| 后端契约(SSOT) | `API_CONTRACT.md`(根) |
| 后端源码 | `backend/`(独立 Go 项目,S1 骨架待启动) |

### 4.4 添加新 API 的模板(前端侧)

```ts
// 1. 定义类型  frontend/src/types/foo.ts
export interface Foo { id: string; name: string }

// 2. API 客户端  frontend/src/api/foo.ts
import { client } from './client'
export const FooApi = {
  list: () => client.get<Foo[]>('/api/foo').then(r => r.data),
  ...
}

// 3. Mock 引擎  frontend/src/api/mock/engine.ts
export function listFoos(): Foo[] { ... }

// 4. Mock 路由  frontend/src/api/mock/index.ts
{ method: 'GET', match: /^\/api\/foo\/?$/, handle: () => engine.listFoos() }
```

### 4.5 切换到真后端

```bash
# frontend/.env.local
VITE_USE_MOCK=false
VITE_API_BASE=http://127.0.0.1:8001
```
重启 dev server 即可。前端业务代码零改动。

---

## 五、契约稳定性

以下 API 契约已经在 mock 里定死,后端实现必须严格对齐:

```
# Agents / Nodes / Templates / Skills(标准 REST CRUD)
GET/POST      /api/{resource}
GET/PUT/DEL   /api/{resource}/:id

# Tasks
GET  /api/tasks                                      → TaskSummary[]
POST /api/tasks           { brief, task_type, title?, template_id? } → TaskSnapshot
GET  /api/tasks/:id                                  → TaskSnapshot
POST /api/tasks/:id/resume  { answer }               → TaskSnapshot
POST /api/tasks/:id/spec    { spec }                 → TaskSnapshot

# Knowledge Base
GET/POST      /api/kb
GET/PUT/DEL   /api/kb/:id
POST          /api/kb/:id/docs
PUT/DEL       /api/kb/:id/docs/:docId
POST          /api/kb/search   { query, kb_ids }     → KbSearchHit[]

# Chat
POST /api/chat/reply  { message, mode, agent_id?, team_template_id?, tools, skills, kb_ids?, history? }
                                                     → ChatReplyPart[]
```

**关键字段枚举**:
- `TaskStatus = 'running' | 'waiting_human' | 'done'`
- `TaskType = '幻灯' | '文章'`
- `PendingInterrupt.stage = 'ask_clarification' | 'confirm_strategy' | 'human_final'`
- `NodeKind = 'compute' | 'interrupt' | 'counter' | 'router'`
- `KbDocType = 'markdown' | 'text' | 'link'`

---

## 六、和 `paradigm_langgraph` 的关系

| | paradigm_langgraph | paradigm_eino |
|---|---|---|
| 后端 | Python + LangGraph(可跑) | Go + Eino(待实现) |
| 前端 | static/index.html(vanilla JS,旧) | 独立 Vite 工程(本项目)|
| 契约 | 一致的 REST API |
| 状态 | 3 Agent / 9 节点已跑通 | 前端 MVP + Mock 后端 |

两者共享 API 契约,前端切 baseURL 即可对接任一后端。

---

## 七、变更日志

### 2026-08-04 · 任务画布节点点击 → 抽屉(NodeDetailDrawer)

**背景**:P1 第二项缺口 —— `/tasks/:id` 画布只能看不能点,用户想看某个节点的运行快照(输入/输出)只能切到「产物」Tab 全局翻。本次让画布节点可点,弹右侧抽屉看单节点详情。

**落地**:
- 新增 `frontend/src/pages/tasks/NodeDetailDrawer.tsx`(antd `Drawer`,right 720px):
  - 基础信息:实例 ID、类型(kind + tag)、NodeDef 显示名/描述、绑定 Agent、out_ports
  - 运行状态:done/skipped/pending 标签、步骤号、影响字段数(从 `step_history` 倒序找该节点最后一次运行)
  - 节点产物:按 `lastRun.after_keys` 决定展示哪些顶层字段(优先),无 after_keys 时回退到 `NODE_TYPE_AFTER_KEYS` 静态映射,与后端 `pushStep` 声明的字段一致
  - 字段渲染分发:`strategy_doc` / `enriched_framework` / `final_output` 走 `MarkdownView`;`review_report` 走 `ReviewReportView`(综合 verdict + 策略/质量维度 + summary 流式审核意见);`citations` 走可点击 PubMed/指南链接;`parsed_info` / `framework_skeleton` / `completeness` 走 `pre` JSON;`narrative_mode` / `revision_count` 走 Tag
  - 顶部「复制产物」:把节点元信息 + 字段 dump 成 markdown,`navigator.clipboard.writeText` 落剪贴板
- `frontend/src/canvas/FlowCanvas.tsx`:新增 `onNodeClick?: (nodeId: string) => void` 透传,接 `ReactFlow.onNodeClick`
- `frontend/src/pages/tasks/TaskDetail.tsx`:canvas Tab 加 `onNodeClick` → 打开 `NodeDetailDrawer`,画布下加一行小字提示

**兼容**:
- 前端 mock 节点跑 `plan_strategy` 只声明 `strategy_doc` 一个 after_keys,后端声明两个(`strategy_doc + narrative_mode`)—— 抽屉均按实际 `after_keys` 渲染,不做硬编码
- 多轮 revision:`step_history` 同一节点 id 可能出现多次(每次重跑都 push 一条),抽屉取最后一条

**未做**:
- 节点**输入**快照(进入节点时的 state):`StepHistoryItem` 只存 `after_keys` 缺 `before_keys` / `before_snapshot`,需要后端补字段后前端再做 diff
- 节点失败/重试按钮:暂不暴露,沿用流程内现有 HITL 入口

**验证**:`cd frontend && npm run typecheck && npm run build` 全绿。

### 2026-08-04 · 模板画布编辑器落地(完整新建 + Fork + 拖拽 + 保存)

**背景**:P1 缺口之一 —— `/templates` 此前只有只读预览,无法自定义工作流。本次完整交付编辑器,用户可从零新建、Fork 内置模板、拖拽节点、连接端口、保存到后端。

**落地**:
- 新增 `frontend/src/canvas/EditableCanvas.tsx`:基于 `FlowCanvas` 升级的可编辑画布,`nodesDraggable` / `nodesConnectable` / 边可删除;通过 `onNodesChange` 写回 `NodeInstance.x/y`,`onConnect` 创建 `EdgeInstance`,`onSelectionChange` 上抛选中态;`deleteKeyCode=['Backspace','Delete']` 支持键盘删边。
- 新增 `frontend/src/pages/templates/edit.tsx`:三栏布局 —— 左 NodeDef 面板(按 kind 分组,点 + 加节点)/ 中 EditableCanvas / 右属性面板(节点/边的元数据 + 删除)/ 顶 toolbar(name/description/tags/entry/保存取消)。
- 路由:新增 `/templates/new` 与 `/templates/:id/edit`,`/templates` 列表卡片加「Fork & 编辑」/「编辑」入口,预览弹窗 footer 加「编辑此模板」按钮。
- 内置模板处理:进入编辑页时若 `builtin=true` 自动 fork(克隆 + 新 id + 名字加"· 副本" + `builtin=false`),走 `update` 接口。后端 `updateTemplate` 锁 builtin,前端零特殊路径。
- `NodeInstance` 增可选 `label` 字段(显示名,落库前剥掉,只保留后端契约字段 `id/type/x/y`);entry 节点在画布上以"current"态显示。
- 保存校验:name 必填、nodes 非空、entry 必须指向现存节点。
- `useAppStore` 已有 `App` provider 套,`message` 用 `AntApp.useApp().message` 拿到 context-aware 版本。
- 删除节点时同步清理挂在它上面的入边/出边(避免悬空引用)。

**未改动**:后端契约、`/tasks` 用模板的 `template_id` 路径、3 个内置模板 fixture、FlowCanvas 只读版本、xyflow 版本。

**验证**:`cd frontend && npm run typecheck && npm run build` 全绿。

### 2026-07-30 · 接入真实 PubMed 文献检索(search_literature / verify_reference / enrich)

**背景**:上一条"只信任 KB"把假文献工具改成了诚实占位。用户确认 PubMed 免费开放(NCBI E-utilities,无需 key,注册 key 提速),要求把 `search_literature` / `verify_reference` 接成真实检索,任务流 enrich 也用 PubMed。遵循"不要 mock":检索失败/未配置一律如实说明,绝不伪造 PMID/期刊卷期。

**落地**:
- 新增 `backend/internal/pubmed/`:`client.go`(ESearch+EFetch,速率限制 3/10 req/s,重试退避,XML 解析抽标题/作者(≤3+et al)/期刊/年份/DOI/PMID→可点击 PubMed 链接)、`convert.go`(`PubmedHit`→`domain.KbSearchHit` + `HitSource` 适配 engine 的 `litSource`)、`client_test.go`(XML 解析夹具,不发网络)。
- chat:`buildToolCallPreviews` / `buildLLMTools` 接入真实 PubMed;新增 `searchLiteratureTool` / `verifyReferenceTool`(真调 PubMed,失败 bubble error 由模型如实转述);`formatPubmedHits` 渲染 markdown 可点击链接(标题→PubMed,DOI→doi.org)。
- 任务流:新增 `litSource` 接口;`retrieveCitationSources` 现在合并 KB + PubMed 来源(按 URL 去重),PubMed 失败只记日志不阻断;`BuildTaskGraph` / `applyEnrichContentLLM` 增 `litSource` 形参;`main.go` 构造 `pubmed.NewClient` 注入。
- 配置:`PUBMED_EMAIL`(必填才启用,NCBI 要求联系邮箱)/ `PUBMED_API_KEY`(可选提速),写入 `.env.example`;启动日志打印 `pubmed available`。
- 提示词:enricher 的"可引用来源"措辞改为"知识库 + PubMed"(后端 fixtures + 前端 builtins 镜像)。
- 前端 mock(浏览器内、离线):`search_literature` / `verify_reference` 保持诚实占位,提示"仅真实后端可用(需 PUBMED_EMAIL)",不伪造。
- 文档:API_CONTRACT.md tools 行为、CLAUDE.md Data authenticity 段同步。

**验证**:`go build`/`go vet`/`go test ./...` 全绿(含新 pubmed 单测);前端 `tsc -b --noEmit` 绿。

### 2026-07-30 · 修复 plan_strategy 把 JSON 信封当 markdown 直接展示

**症状**:策略确认书气泡里显示整段原始 JSON(`{ "strategy_doc": "## 策略确认书\n会议类型...", "narrative_mode": ...}`),且 `\n` 没换行 —— 用户看到的是转义字符串而非渲染后的 markdown。

**真因**:与 build_framework / enricher 同类的 prompt/parser 形状冲突。planner 的 system_prompt 声明输出 JSON 信封 `{"strategy_doc","narrative_mode",...}`,但 `parsePlanStrategyResponse` 只把整段原始文本当 markdown 存进 `strategy_doc`,没有解开信封。模型照 system_prompt 输出 JSON → 整个 JSON 字符串被存进 doc。

**修复**:
- `parsePlanStrategyResponse` 先剥 think 块,再优先解 JSON 信封抽 `strategy_doc` / `narrative_mode`(JSON 解析天然把 `\n` 转成真实换行);解不出信封时回退把整段当 markdown(兼容模型直出 markdown)。
- `renderPlanStrategyMessages` user prompt 对齐 system_prompt,给出 JSON 信封示例(含 `\\n` 转义说明)。
- 新增 `TestParsePlanStrategy_JSONEnvelope` / `_MarkdownFallback`。

### 2026-07-30 · 引用数据源真实性 + 可点击链接(只信任 KB)

**背景**:用户要求"对话引用的数据源/文献链接要求可以点击跳转,以确保数据真实性"。审查发现三处真实性缺口:chat 的 `search_literature` / `verify_reference` 工具轨迹是写死的假引用(`NEJM 2024;390:1234`、`PMID 38234567`);`search_kb` 虽真实但 KB 文档无 URL、`KbSearchHit` 无 url 字段;`MarkdownView` 链接不在新标签打开、chat 工具轨迹纯文本渲染;任务流 enricher 的 `citations[].source_url` 被丢弃。

**决策**:移除伪造文献工具,只信任真实 KB;四处落地可点击链接。

**改动**:
- **KB 文档加真实 url**:7 篇内置文档补 `URL`(ESC/ADA/AHA 指南 DOI、DailyMed 药品说明);前后端 fixtures 同步。
- **KbSearchHit.url**:domain + 前端 type 加 `url`,`kb.Search`/mock `searchKb` 回填 `doc.URL`。
- **去伪造文献工具**:`buildToolCallPreviews`(+ mock `buildMockToolCalls`)删除写死的 PMID/期刊假引用,改诚实说明并引导用 `search_kb`;`search_kb` 预览把命中标题渲染成 `[标题](url)`。
- **可点击渲染**:`MarkdownView` 加自定义 `a` 渲染器(`target=_blank` + 蓝色下划线);chat 工具轨迹 `output_preview` 改走 `MarkdownView`。
- **任务流保留 citations**:新增 `domain.Citation` + `TaskSnapshot.citations`(前端同步 type)。`enrich_content` 经 `retrieveCitationSources`(主题+章节标题 → `kb.Search`,只留带 URL 命中)注入 prompt 作为唯一可引用来源池;`citationsFromSources` 按"正文实际出现该 URL"回填,保证每条 citation 真实且被引用。`TaskDetail` / `InterruptPanel` 渲染可点击参考文献列表。
- **提示词对齐**:enricher 从旧 JSON 信封 + 假 verify 契约改为 markdown 链接引用(工具清空);reviewer 输入描述改为分析正文 markdown 链接;前后端 fixtures 同步。
- 新增 `TestEnrichContentStreamCapturesCitations`;修正流式测试新增的 `sources` 入参。
- 文档:API_CONTRACT(KbSearchHit.url / Citation / tools 行为)、CLAUDE.md(KB 检索 + 数据真实性段)。

**验证**:`go build`/`vet`/`test ./...` 全绿;前端 `typecheck`/`build` 通过。

### 2026-07-28 · 修复 build_framework 嵌套信封导致空 sections 失败(真因)

**症状**:build_framework 报 `parse: sections empty` → failed。日志显示 LLM 实际返回的是 `{"framework_skeleton": {"sections": [...]}}`(sections 有内容,还带 outline/bullets)。

**真因**(修正上一条对 think 块的误判):builder 的 system_prompt 权威声明的是 **嵌套信封** `{"framework_skeleton": {"sections": [...]}}`,但 `renderBuildFrameworkMessages` 的 user prompt 和 `parseFrameworkResponse` 只认扁平 `{"sections": [...]}`。system_prompt 优先级更高,模型照它输出,parser 在顶层取 `sections` 取不到 → 空。与 2026-07-24 那个 enricher user/system prompt 冲突 bug 同类。

**修复**:
- `parseFrameworkResponse` 同时容忍两种形状:顶层 `sections` 为空时回退取 `framework_skeleton.sections`;section 里的 outline/bullets 等额外字段 JSON 解析自动忽略。
- user prompt 对齐 system_prompt,改用嵌套信封示例(4 个填好的具体章节)。
- 新增 `TestParseFrameworkResponse_NestedEnvelope` / `_FlatShape`。

（上一条的 `<think>` 剥离仍保留 —— 它是另一层有效防御,只是不是本次的直接病因。）

### 2026-07-28 · 修复推理模型 <think> 块导致 build_framework 空 sections 失败

**症状**:跑"完整流程"专家团在 build_framework 报 `[NodeRunError] build_framework: parse: build_framework: sections empty` → 任务 failed。

**根因**:qwen/deepseek 等推理模型会输出 `<think>…</think>` 块,块内常含 schema 模板样的伪 JSON(如空的 `{"sections": []}`)。`extractJSON` 直接扫第一个平衡 `{...}`,误抓思考块里的空 JSON,导致 `sections` 为空;`runWithValidation` 带纠错重试一次仍是同样格式,两次都失败 → parse error → failed。这是全节点隐患,只是 build_framework 的空数组校验最先炸出来。

**修复**:
- `extractJSON` 在搜索前用 `thinkBlockRe` 剥离 `<think>…</think>`(根因修复,惠及所有 JSON 节点)。
- `parseEnrichContentResponse` / `reviewQualityStream` / `enrichContentStream` 的累积文本也先剥 think 块,防止思考过程漏进正文/Summary。
- 强化 build_framework prompt:JSON 示例从 `{"title": "章节标题", ...}` 占位改为 4 个填好的具体章节,并显式"sections 不能为空、不要思考过程"。
- 新增 `TestExtractJSON_StripsThinkBlock` / `TestExtractJSON_NoThinkBlockUnaffected`。

### 2026-07-28 · 任务流提速 + 审核流式化 + 去 mock 回落(失败即 failed)

**背景**:用户跑"完整流程"专家团反馈整体慢、且"审核"步骤像卡住。定位三处叠加:(1) `review_quality` 是纯阻塞 LLM 调用,`emitProgress` 在 return 后才广播,期间 30–60s 无任何事件 → 观感卡死;(2) review 强制 JSON,`runWithValidation` maxAttempts=2,解析失败就再打一次全量调用,延迟翻倍;(3) 全程无超时,provider 挂起会永久卡住;confirm 之后 build→enrich→review 一段无中断串行,用户静默等待。

**改动**:
- **LLM 超时**(`engine/stream.go` `llmTimeout()` + `steps.go`):每个 `applyXxxLLM` 入口 `context.WithTimeout`(默认 180s,env `PARADIGM_LLM_TIMEOUT_SEC` 覆盖),挂起时快速失败为 failed。
- **去 mock 回落**(`steps.go` + `graph.go`):5 个 `applyXxxLLM` 改为返回 `error`;provider 不可用 / 调用错 / 解析校验失败 / 空流,全部返回 error 冒泡到 executor 的 failed 分支,不再静默产出 mock 假装成功。纯 mock 的 `applyXxx` 函数保留(单测与数据形状参考),LLM 路径不再调用。
- **审核流式化**(`steps.go` `reviewQualityStream` + `prompts.go` `renderReviewQualityStreamMessages` / `parseReviewStreamText`):review prompt 改为先输出人类可读 markdown 审核意见、末尾哨兵行 `裁定: pass|revise|redo`(revise/redo 跟 `- ` 建议列表);流式逐帧 `sink("review_quality", delta)` 广播,像 enrich 一样逐字冒出;`ReviewReport` 加 `Summary` 字段存流式正文。解析不到裁定 → error → failed(不猜)。
- **节点开始即反馈**(`stream.go` `TaskEventPhase`/`PhaseSink` + `executor.go` `BroadcastPhase` + `graph.go` `emitPhase`):每个 compute 节点进入时广播一次"正在 XX…",前端立即显示 spinner 气泡,消除非流式节点的静默观感。
- **SSE 端点**(`api/tasks.go`):新增 `event: phase` 分支;终态判定从仅 `done` 扩展到 `done/failed/cancelled` 都发 `event: done` 关闭连接。
- **前端**(`pages/chat/index.tsx` + `store/useChatStore.ts` + `types/review.ts`):流式气泡从 enrich 专用泛化为按节点(`stream: Record<node, {bubbleId,content,round}>`),新增 review_quality 分支(归属审核专家);`phase` 事件渲染/刷新 spinner 气泡,产出或流式接管时 `removeMessage` 清除(store 新增 `removeMessage`,仅内存);`ReviewReport` 加 `summary?`。

**测试**:
- `enrich_stream_test.go`:`enrichContentStream` 签名去 feedback、返回 error;空流断言从"回落 mock"改为"返回 error 且不写内容"。
- 新增 `review_stream_test.go`:`parseReviewStreamText`(pass/revise/redo/全角冒号/无哨兵/revise 无建议 6 例)、`reviewQualityStream` 逐帧 sink + 裁定/建议/Summary 落库、空流返 error 不写 report。
- `go build` / `go vet` / `go test ./...` 全绿;前端 `npm run typecheck` / `npm run build` 全绿。

**取舍 / 明确不做**:四个内容节点是严格数据依赖串行(策略→骨架→填充→审核),**无并行空间**,未虚报并行提速;提速来自审核流式化(消除最大一段静默)+ phase 反馈 + 超时快速失败,总 LLM 调用次数不变。`revision_count ≤ 2` 回环护栏保留。**代价**:去 mock 后若未配置可用 LLM key,任务直接 failed(前端有 `❌ 任务执行失败` 气泡)。

### 2026-07-28 · 专家团任务流式化(SSE token 增量)+ 主助手 SSE 修复

**背景**:两处流式显示问题。(1) 主助手对话虽走 SSE,但后端在事件循环里对每个 event 调 `MessageOutput.GetMessage()`,该方法在 `IsStreaming=true` 时会 `concatMessageStream` 把整个 token 流抽干拼成完整消息再返回,导致一次性发一个 chunk,打字机效果失效。(2) 专家团任务不走 `/api/chat/reply`,而是走 `/api/tasks` + 2s 轮询,每个节点跑完才整块 append,天生无逐字效果。

**修复(1)· 主助手 SSE**:`backend/internal/api/chat.go` 的 `handleChatStream` 改为判断 `mv.IsStreaming`,是流则从 `mv.MessageStream` 逐帧 `Recv()`,每帧 assistant 增量发一个 `chunk`(新增 `streamMessageChunks`);非流走原 `Message` 整块。前端无需改动。

**修复(2)· 专家团流式(方案 B:只流式 `enrich_content`)**:
- **LLM 层**:`llm.Provider` 接口加 `Stream(ctx, msgs) (*schema.StreamReader[*schema.Message], error)`;`OpenaiProvider` 用 `cm.Stream`,`Unavailable` 返回 `ErrUnavailable`。
- **事件模型**:新增 `engine/stream.go` —— `TaskEvent{Kind: snapshot|token, Snapshot, Node, Delta}`、`TokenSink`(逐 token 回调)、`ProgressSink`(节点级快照广播)三者都靠 context 注入(graph 在 executor 之前编译,节点拿不到 executor 引用)。
- **Executor**:广播通道 `chan *domain.TaskSnapshot` → `chan *TaskEvent`(缓冲 4→32);`Broadcast` 保持快照语义,新增 `BroadcastToken`,共用私有 `emit`。`run()` 往 ctx 注入 token sink + progress sink。
- **节点级进度**:原先只在 interrupt/终态 `Broadcast`,SSE 订阅者收不到中间节点 → 气泡乱序。现在每个 compute 节点跑完调 `emitProgress(ctx)` 广播一次最新快照。
- **流式 enrich**:`enrich_content` 的 prompt 从"输出 JSON envelope"改回"直接输出 markdown 正文"(否则流式会把裸 JSON 逐字打给用户;丢弃的 citations/unresolved 本就 parse 完即弃,无损)。`applyEnrichContentLLM`:ctx 有 sink 走新的 `enrichContentStream`(`p.Stream` 逐帧 `Recv` → `sink("enrich_content", delta)` 广播 → 累积后 parse+validate 落库,失败回落 mock);无 sink 保留原 `runWithValidation` 路径。
- **SSE 端点**:`/tasks/{id}/stream` 消费 `*TaskEvent`,`token` 类发 `event: token` + `{node, delta}`,`snapshot` 类维持原样。
- **前端**(`frontend/src/pages/chat/index.tsx`):team 分支从 2s 轮询改为 SSE 优先(fetch + ReadableStream 解析 `event: snapshot|token|done`)。`token` 事件逐字拼进一个 streaming 气泡(归属 enricher 身份),`snapshot` 事件复用抽出的 `processSnapshot`(step→气泡增量);snapshot 里 enrich step 完成时用权威 `enriched_framework` 定稿气泡并落库。SSE 建连/中途失败 → 回落 2s 轮询(`startTaskPolling`),进度游标保留。轮询逻辑抽成 `processSnapshot` 供两条路径共用。

**测试**:
- 后端 `enrich_stream_test.go`:`TestEnrichContentStreamTokenSink`(5 帧输入 → sink 收 5 段增量、拼接 == 原文、snapshot 写入完整正文、step_history 记 enrich_content)、`TestEnrichContentStreamFallback`(空流回落 mock)。`mockProvider` 补 `Stream` 方法。
- 手测:真 LLM(qwen3.6-plus)下 SSE 端点确认每个 compute 节点都广播 snapshot(node 级进度),enrich 节点日志确认走"已填充内容(流式)"路径。逐 token 帧的实时抓取受 LLM 延迟 + 测试时限影响未在 curl 侧稳定复现,由单测确定性覆盖。
- `go build` / `go vet` / `go test ./...` 全绿;前端 `npm run typecheck` / `npm run build` 全绿。

**未改动**:其余 4 个结构化节点(parse_brief/plan/build/review)保持整块 `Complete` + JSON 校验(它们要结构校验、输出只是一两行摘要,流式无意义);主助手子智能体调用轨迹逻辑;`revision_count` ≤ 2 guard。

### 2026-07-24 · 修复 enricher 把 JSON 结构渲染进终稿的 bug

**症状**:用户跑一条"写一篇关于二甲双胍的糖尿病用药教育文章"任务,终稿 `final_output` 是一整段 `{ "enriched_framework": "## 一、背景...\\n..." }` JSON,而不是正文 markdown。

**根因**:上一版把 5 个 Agent 的 system_prompt 全部改成"严格 JSON 输出",但 `backend/internal/engine/prompts.go` 里 enricher 的 `renderEnrichContentMessages` 的 **user prompt 仍写着"只输出 markdown 正文,不要额外解释"**,与 system_prompt 硬冲。LLM 优先跟随 user 提示,吐 markdown 正常;但当模型倾向遵循 system 时,吐出 JSON 字符串——`parseEnrichContentResponse` 只做 `stripFence + strings.Contains("## ")`,而 JSON 里内嵌的 `"## 一、..."` 也含 `## `,语法校验通过,**整段 JSON 就这样落进 `EnrichedFramework`,直进终稿**。其他 4 个节点(parse_brief/plan/build/review)输出不上屏、只作分流,漏检没暴露。

**修复**:
- `renderEnrichContentMessages`:user prompt 明确 JSON 契约,与 system_prompt 对齐;要求 `{"enriched_framework": "...", "citations": [...], "unresolved": [...]}`。
- `parseEnrichContentResponse`:双路径 —— (1) 先解 JSON envelope 取 `enriched_framework` 字段;(2) 解不出则回退旧行为把整段当 markdown;(3) 若文本以 `{` 起头但取不到 `enriched_framework`,拒绝当 markdown 渲染(防御坏 JSON 混入)。
- 三条回归测试固化这三条路径:`TestParseEnrichContentResponse_JSONEnvelope / _MarkdownFallback / _RejectsMalformedJSON`,全绿。

**未改动**:5 个 Agent 的 system_prompt(JSON 契约仍是权威);中间件 `runWithValidation`;其他 4 个节点(它们的 user prompt + parser 与自己的 system_prompt 一致,没有冲突)。

**旧数据**:先前那条终稿是 JSON 字符串的任务保留不动,不专门写迁移脚本;下次触发的任务会正常。

### 2026-07-24 · JSON 校验中间件 + 单次自纠重试

**背景**:5 个 Agent 的 system_prompt 已经把输出契约写死(参见上一条变更),但 `backend/internal/engine/prompts.go` 里的 `parseXxxResponse` 只做语法/枚举合法性校验,业务约束(章节数、权重合计、pass 时 advices 必须为空 等)没落地。而且一旦解析失败就直接回落 mock,LLM 拿不到自纠机会。

**改动**:
- 新增 `backend/internal/engine/validate.go`,导出泛型中间件 `runWithValidation[T](ctx, provider, msgs, parse, validate, label) (*T, error)`:
  1. 调 provider.Complete
  2. parse → validate 两级校验
  3. 首轮失败:把 assistant 输出 + "上一次未通过校验,原因:xxx" 追加成一轮对话,重跑一次
  4. 二轮仍失败:返 error 让调用方回落 mock;上游网络错误则不做重试(重试无用)
- 为 5 个步骤各写一个业务 validator:
  - `validateParseBrief`:topic 非空、`enough=true` 与 `missing.length>2` 互斥
  - `validatePlanStrategy`:文档 ≥ 40 字符、narrative_mode 非空、doc 中必须出现 `%` 或 "权重"
  - `validateBuildFramework`:sections ∈ [3,6]、每个 title 非空、weight ∈ (0,1]、合计 ∈ [0.95,1.05]
  - `validateEnrichContent`:H2 标题 ≥ 3、正文 ≥ 300 汉字
  - `validateReviewQuality`:verdict/item.verdict 三档合法、`overall=pass ↔ advices=[]`、`overall≠pass ↔ advices 非空`
- 5 个 `apply*LLM` 全部改造:去掉裸调用,统一走 `runWithValidation`,fallback 消息统一为 "LLM 校验失败,已回落 mock"

**未改动**:mock 引擎(输出由 TS 类型强制,无需校验)、system prompt 内容、状态机、路由逻辑。

**Eino ADK vs 我们**:vendor 里的 `adk.AgentMiddleware` 是包裹整个 Agent 的 wrapper,需要接入 ChatModelAgent 才用得上;S2b 阶段直连 openai-compatible,中间件放在 apply*LLM 内部零框架成本。等 S3 迁到 ADK 时,把 `runWithValidation` 里的两级校验挂成 `AgentMiddleware.WrapModel` 即可。

**验证**:新增 `validate_test.go`(9 个用例):快乐路径 / 首轮违约二轮自纠 / 两轮全败回落 err / 上游错误不重试 / 5 个 validator 各自的边界。`go test ./...` 全绿;`go build ./... && go vet ./...` 干净。

### 2026-07-24 · 5 个内置 Agent 提示词补齐输入/输出契约

**背景**:原 `agent-clarifier / planner / builder / enricher / reviewer` 的 `system_prompt` 只是 3~5 行角色描述,只能给用户看,不能被真 LLM 消费。mock 引擎不调 LLM 所以一直能跑,但 Eino 后端接入真模型时会崩(reviewer 的 `verdict` 是引擎分流依据,一旦漂移 review_quality 三出口无法路由)。

**改动**:
- `frontend/src/api/mock/fixtures/builtins.ts` + `backend/internal/fixtures/agents.go` 同步重写 5 个 Agent 的 system_prompt,每个提示词包含:
  - **输入契约**:显式列出会读取哪些 state key(与 `engine.ts` 里的 `parsed_info / strategy_doc / narrative_mode / framework_skeleton / enriched_framework / review_report / revision_count` 对齐)
  - **输出契约**:严格 JSON schema,字段名钉死引擎消费点(reviewer 输出 `review_report.overall ∈ {pass, revise, redo}` 直接驱动 review_quality 三出口)
  - **约束**:数量/权重/长度/枚举值边界
  - **工具协议**(enricher):search_literature / verify_reference 的调用顺序 + 硬规则"未 verify 通过不得写引用"
- reviewer 补齐 `pass / revise / redo` 三档的量化阈值(配比误差 %、warn 计数),消除主观判定
- planner 补齐 `user_feedback` 重跑分支(与状态机"策略确认输入含'调整/修改'→回退 plan_strategy"对齐)

**未改动**:节点 fixtures、模板 fixtures、engine.ts 状态机、`agent-designer`(仍是通用助手,无固定契约需求)。

**验证**:`cd frontend && npm run typecheck` 零错 · `cd backend && go build ./...` 零错。builtin agents 通过 UPSERT 在下次后端启动时自动覆盖旧 SQLite 数据,前端 mock 也直接生效。

### 2026-07-20 · 初版进度文档

- 已交付:全部前端 MVP + 知识库模块
- 待办:后端 Eino Go 实现 + 模板编辑器 + 流式推送

### 2026-07-20 · 项目结构重组

- 前端整体收纳到 `frontend/`(源码/构建产物/依赖/env 一并搬入,零源码改动)
- 新建 `backend/` 目录,添加 `backend/README.md` 记录定位、分阶段路线与契约要点
- `.gitignore` 拆分:根只留跨端通用项,前端专属规则在 `frontend/.gitignore`
- 更新 `README.md` / `CLAUDE.md` / `PROGRESS.md` / `API_CONTRACT.md` / `TODO.md` 里的所有路径引用
- 验证:`cd frontend && npm run typecheck && npm run build` 通过

### 2026-07-20 · 后端 S1 骨架落地

**架构决策**(前置对齐):
- 智能体(Agent 实体)= Eino ADK `ChatModelAgent`(S2 引入)
- 专家团(WorkflowTemplate)与任务状态机 = `compose.Graph`(S2 / S5)
- Eino 版本锁定 `v0.9.0+`,继续用 `components/model/openai`(不引 AgenticModel)
- 两套 store 分离:Eino 的 CheckpointStore(黑盒快照) + 业务的 TaskSnapshotStore(列表/详情读取)

**S1 交付内容**(位于 `backend/`):
- Go module + chi + cors 依赖(不含 eino)
- `internal/domain/`:AgentDef / NodeDef / WorkflowTemplate / SkillDef 类型,JSON tag 与前端 TS 1:1 对齐
- `internal/store/`:泛型内存 store(接口稳定,S6 换 SQLite 无缝);ErrNotFound / ErrBuiltinLocked 错误类型
- `internal/api/`:chi 路由 + 4 套资源 CRUD handler(agents / nodes / templates / skills,共 20 端点)+ 统一 `{ detail }` 错误响应
- `internal/fixtures/`:6 Agents / 10 Nodes / 3 Templates / 5 Skills 内置数据(1:1 翻译自 `frontend/src/api/mock/fixtures/`)
- `backend/README.md` 更新:启动步骤、smoke test、联调预期、契约要点

**联调**:前端 `frontend/.env.local` 设 `VITE_USE_MOCK=false`,`/agents` `/templates` `/settings` 完整可用;`/tasks` `/chat` `/knowledge` 报 404 detail(S2+ 补齐)。

**未在本环境验证**:开发机未装 Go,无法本地 `go build`;交付时用户需先 `go mod tidy`。

### 2026-07-21 · 后端 S2a Task 状态机(Eino Graph + HITL,mock 内容)

**新增依赖**:`github.com/cloudwego/eino v0.9.12`(不引 adk / openai / ext,S2b 才引)

**S2a 交付内容**:
- `internal/domain/task.go`:TaskSnapshot / TaskSpec / PendingInterrupt / StepHistoryItem / ReviewReport / ClarifyQuestion / TaskSummary,严格对齐 `frontend/src/types/task.ts`
- `internal/store/snapshot_store.go`:`TaskSnapshotStore` 接口 + 内存实现(读写分离,Update 里就地改,返回克隆)
- `internal/store/checkpoint_store.go`:实现 Eino 的 `compose.CheckPointStore`(Get/Set,加锁)
- `internal/engine/`:
  - `keywords.go`:answer 关键词匹配("调整/修改" / "退回/修改")+ context.WithValue 传 taskID
  - `snapshot.go`:pushStep / addMessage / nowStr / AutoTitle / ExtractTopic 等 helper
  - `steps.go`:每个 stage 的 mock 输出(与前端 mock engine 输出完全对齐)
  - `graph.go`:核心 —— 编译 `compose.Graph`,10 节点 + 4 处 Branch,包含 2 处 loop(策略调整回退、审核 revision 回路)
  - `executor.go`:Executor.Start / Resume,异步 goroutine 跑图,捕获 InterruptInfo 存 InterruptID
- `internal/api/tasks.go`:5 端点(list / start / get / resume / spec)
- `internal/fixtures/tasks.go`:2 个演示任务(waiting_human 幻灯 + done 文章)与前端 mock 一致

**关键设计**:
- **异步推进**:POST /api/tasks 立即返回 running 状态,goroutine 后台跑 graph.Invoke。前端 2s 轮询 GET /:id 消费最新 snapshot。goroutine 命中 interrupt 就退出;`Executor.Resume` 起新 goroutine 用 `compose.ResumeWithData(ctx, interruptID, answer)` 继续。
- **Graph state 精简**:`TaskLocalState` 只放 `ResumeAnswer`,业务数据全在 TaskSnapshotStore(节点通过 `taskIDFromContext(ctx)` 定位)。避免 Eino 每次 run 重建 state 时业务数据丢失。
- **HITL 节点写法**:同一个 Lambda 首次跑触发 `compose.StatefulInterrupt`,resume 后 `GetInterruptState` 返 true 时再拿 answer(`GetResumeContext[string](ctx)`)推进。
- **类型注册**:`schema.RegisterName` 注册 InterruptPayload / InterruptState / TaskLocalState,gob 编码 checkpoint 依赖。
- **Loop 已验证**:v0.9 支持 Graph 环(`bump_revision → enrich_content` 和 `human_final → enrich_content` 双 loop),消除了 plan 里担心的死角。

**端到端验证**(smoke test):
- 3 处 HITL + revision loop 全部走通,`status=done` + `final_output` 非空
- Step history:12 步(含一次 human_final 退回、一次 revision 重跑 enrich→review→human_final)
- 演示任务(2 个)启动时装载正常,列表/详情可读

**联调更新**:`/workbench` `/tasks` `/tasks/:id` 完整可用,前端可跑完整流程。

### 2026-07-21 · 后端 S2b LLM 接入(5 compute 节点 + mock 降级)

**新增依赖**:`github.com/cloudwego/eino-ext/components/model/openai v0.1.13`(带来 `eino-ext/libs/acl/openai` + `meguminnnnnnnnn/go-openai` 间接依赖)

**S2b 交付内容**:
- `internal/llm/`(新增):
  - `provider.go`:`Provider` 接口(Complete / Available / Name)+ `Unavailable` 零值实现 + `FromEnv(ctx)` 读 4 个 env(LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / LLM_TEMPERATURE)
  - `openai.go`:`openaiProvider` 封 `eino-ext/components/model/openai.NewChatModel`,`Complete` 直调 `cm.Generate(ctx, msgs)`
- `internal/engine/prompts.go`(新增):5 组 `renderXxxMessages(snap, agents)` 渲染 system + user 消息;5 组 parser(`parseBriefResponse` / `parsePlanStrategyResponse` / `parseFrameworkResponse` / `parseEnrichContentResponse` / `parseReviewResponse`);`extractJSON` 兜底(剥 ```json fenced code、找第一个平衡 `{...}`);system prompt 通过 `nodeID → agentID` 固定映射从 `agentStore.Get` 拉最新 SystemPrompt
- `internal/engine/steps.go`(改):新增 `applyParseBriefLLM` / `applyPlanStrategyLLM` / `applyBuildFrameworkLLM` / `applyEnrichContentLLM` / `applyReviewQualityLLM`;provider Unavailable、Complete 失败、parse 失败**任一环节**都回落原 `applyXxx`,任务不中断
- `internal/engine/graph.go`(改):`BuildTaskGraph` 签名增加 `provider llm.Provider, agentStore agentSource` 参数;5 个 compute Lambda 换用 LLM 版本;新增 `mutSnapCtx` helper 让 mut 回调能拿到 ctx
- `cmd/server/main.go`(改):`llm.FromEnv(context.Background())` 装配 provider,启动日志打印 `llm provider: <name> (available=<bool>)`
- `.env.example`(改):新增 4 个 LLM env 说明,附 DeepSeek / OpenAI / 通义千问示例
- `backend/README.md`(改):当前进度节改为 S2b,新增"配置 LLM(可选)"章节,架构决策更新

**关键设计**:
- **LLM 抽象层**:`Provider` 接口只 3 个方法。以后加 mock / ark / 别的 provider 都在 `llm` 包内替换,graph 层不动
- **不引 `adk.Runner`**:S2b 直接调底层 `openai.ChatModel.Generate` —— ADK 有自己一套 checkpoint 语义,和 compose.Graph 的 interrupt 不兼容。ADK Agent + Runner 留给 S3(单 Agent chat)和 S5(team 编排)
- **mock 降级三重保护**:未配 API key → `Unavailable{}`;LLM 调用异常 → catch + fallback;LLM 输出解析失败 → parser err + fallback。任一失败都追加一条 "LLM 失败,已回落 mock" 到 messages,前端可见,任务照跑
- **system prompt 复用 fixtures**:`nodeToAgentID` 5 条固定映射,`agentStore.Get(...)` 实时拉。用户在 `/agents` 页面改了 SystemPrompt,下一次任务立即生效(不用重启)
- **prompt 强约束 JSON**:parse_brief / build_framework / review_quality 三个节点的 user prompt 里贴 JSON schema,parser 用 `extractJSON` 抠出来。plan_strategy / enrich_content 保持 markdown,parser 只做最小校验(叙事模式一行正则 / H2 标题检查)

**验证**(mock 模式):
- `go vet ./...` / `go build ./...` 零错
- 未设 `LLM_API_KEY` 启服务 → 启动日志 `llm provider: unavailable (available=false)`
- Python smoke test 端到端 done:9 步(happy path,未触发澄清与 revise)、messages 无 "LLM" 前缀,confirmed 走 mock 分支
- 前端行为完全等价 S2a,零改动

**联调预期**(LLM 模式,S2b 未在此环境实际调 LLM 验证 —— 需要用户设置真实 LLM_API_KEY 测试):
- 启动日志 `llm provider: openai(deepseek-chat) (available=true)`
- messages 会出现 `[parse_brief] LLM 已解析需求 (openai(deepseek-chat))` 之类
- `parsed_info` / `strategy_doc` / `enriched_framework` / `review_report` 是 LLM 真生成,不再是 "(mock)" 字样

> 后续开发请在文件底部追加变更条目。

### 2026-07-23 · 后端 S3 SQLite 持久化(聊天 / 设置 / CRUD / 任务全部落库)

**动机**:前端 zustand `persist(localStorage)` 与浏览器 origin 绑定,Vite dev server 换端口(`5173→5174`)就丢会话与 API key。改由后端 SQLite 存储,跨端口/重启保留。

**新增依赖**:`modernc.org/sqlite v1.54.0`(纯 Go,无 CGO,Windows 直接 `go build`;顺带把 `go.mod` 从 go1.22 拉到 go1.25)

**S3 交付内容**:

Backend:
- `internal/store/sqlite/`(新增,6 文件 ~700 行):
  - `db.go`:`Open(path)` — WAL / foreign_keys=ON / busy_timeout=5s,`MaxOpenConns=4`,自动跑 migrations。默认路径 `data/app.db`,支持 `PARADIGM_DB_PATH` 覆盖
  - `migrations.go`:一次性 init migration,建 7 张表(`entities` / `task_snapshots` / `task_checkpoints` / `chat_sessions` / `chat_messages` / `settings` / `schema_migrations`);`schema_migrations` 记录已跑版本,幂等
  - `entities.go`:`Entities[T store.Entity]` 泛型 —— 通用 KV 表(kind, id, builtin, data JSON),`domain` 结构体加字段不用改表;实现 `store.Store[T]` 接口,handler 层无感切换
  - `snapshots.go`:`TaskSnapshots` 实现 `store.TaskSnapshotStore`,`data` 列存 `TaskSnapshot` JSON,`created_at` / `status` 建索引
  - `checkpoints.go`:`Checkpoints` 实现 `compose.CheckPointStore`,BLOB 直存 Eino 序列化字节
  - `chat.go`:`Chat` 会话头 + 消息分表(消息 `idx` 排序,`FOREIGN KEY ON DELETE CASCADE`)
  - `settings.go`:通用 KV,`llm_prefs` 存前端整份 `{ activeConfigId, modelConfigs }` JSON
- `internal/domain/chat.go`(新增):`ChatSession` / `ChatMessage` / `ChatSessionSummary` / `ToolCallTrace` / `ChatMode`,对齐 `frontend/src/types/chat.ts`
- `internal/api/chat_sessions.go`(新增):7 端点 —— `GET/POST /api/chat/sessions`、`GET/PUT/DELETE /api/chat/sessions/:id`、`POST/DELETE /api/chat/sessions/:id/messages`。PUT patch 只在非零值时覆盖,避免部分更新丢字段
- `internal/api/settings.go`(改):新增 `GET/PUT /api/settings/llm_prefs`,把前端整份偏好设置存 SQLite,原 `POST /api/settings/llm` 保留兼容
- `internal/api/router.go` / `internal/api/chat.go`(改):`mountChat` 从传 `Provider` 值改为传 `*ConfigManager`,handler 每次 `Get()` 拿最新 —— 修复了 2026-07-23 那个"设置生效但对话仍走 mock"的 bug(chat handler 闭包捕获了启动时的 `Unavailable{}`,`/api/settings/llm` 更新的是 manager 里的引用,handler 手里那个不刷新)
- `cmd/server/main.go`(改):SQLite 替换所有 `NewMemory*` / `NewMemTaskSnapshotStore` / `NewMemCheckpointStore`;启动时:
  - 所有 fixtures 走 UPSERT(builtin 数据跟代码走,用户数据不动)
  - Demo 任务只在 `task_snapshots` 为空时种入(避免每次重启插入重复 demo)
  - `applyPersistedLLMPrefs` 读 `llm_prefs`,若 activeConfig 有 apiKey 则应用到 `ConfigManager` —— **服务重启后 LLM 立即可用,前端不用再点一次"设为当前使用"**
- `.gitignore`(改):忽略 `data/*.db*`(含 WAL/SHM 副本)

Frontend:
- `src/api/chatSessions.ts`(新增):`ChatSessionsApi.list / get / upsert / update / remove / appendMessages / clearMessages`
- `src/api/settings.ts`(新增):`SettingsApi.getLlmPrefs / putLlmPrefs / activateLlm`
- `src/store/useChatStore.ts`(重写):去掉 `persist(localStorage)`,新增 `loadAll` / `loadSession`,`createSession` 乐观更新 → 异步 POST,`appendMessage` 只把非流式消息落库,`persistFinalizedMessage` 流结束后统一 flush(避免 chunk 级高频写入)。附带一个 404-repair 兜底:若 append 时会话尚未持久化(创建-发消息竞态),先 upsert 会话再重试
- `src/store/useAppStore.ts`(重写):去掉 `persist(localStorage)`,新增 `loadFromBackend()`,add/update/delete/setActive 都会自动 `putLlmPrefs` + 若切换 active 还会 `activateLlm` 通知后端
- `src/main.tsx`(改):`installMockAdapter()` 后立即 `useAppStore.getState().loadFromBackend()` 恢复偏好
- `src/pages/chat/index.tsx`(改):`useEffect` 里调 `loadAll()`,SSE `done` 事件里调 `persistFinalizedMessage` 把流式内容落库
- `src/api/mock/engine.ts`(改):追加 mock 侧的 chat sessions + settings 内存 KV 实现(`listChatSessions` / `upsertChatSession` / `updateChatSession` / `deleteChatSession` / `appendChatMessages` / `clearChatMessages` / `getSetting` / `setSetting`);符合 CLAUDE.md "mock IS the contract" 约定
- `src/api/mock/index.ts`(改):注册 8 条新路由(chat sessions 7 条 + settings/llm_prefs 2 条 + settings/llm 保留 2 条 stub)

**关键设计**:
- **驱动选 modernc.org/sqlite,不用 mattn/go-sqlite3**:Windows 无需 gcc/MinGW,交叉编译零折腾。性能差异对 MVP 无感
- **通用 KV 表 vs 每种实体独立表**:六个 CRUD 实体(agents / nodes / templates / skills / kb / docs)共用一张 `entities` 表,`kind` 字段区分,`data` 存 JSON。理由:domain 结构频繁演进,列化 schema 每次都得写迁移,ROI 太低;List 全部在 Go 侧过滤,现在也是这样,没损失
- **Task 也走 JSON**:`TaskSnapshot` 里嵌 `map[string]any` / 指针字段,列化太麻烦。`thread_id` 主键 + `created_at` / `status` 二级索引够用了
- **消息分表**:chat_messages 独立行(不塞进 `chat_sessions.data`),消息可能长,分表方便流式追加与索引
- **fixtures seeding 策略**:`Seed()` 走 UPSERT。builtin=true 的实体跟代码走(改代码 → 重启 → 更新),用户创建的实体(不同 id)不受影响。Demo 任务只在表空时种入 —— 老用户重启不会又冒出 2 个 demo
- **单进程写锁**:SQLite 全库一把写锁,`MaxOpenConns=4` 够用。多进程后端时得换 Postgres,但当前不是问题
- **API keys 明文存 SQLite**:与之前浏览器 localStorage 相同的安全等级(单机 dev 工具)。生产得走 OS keychain / 后端 KMS,现在不做

**修复的其他 bug**:
- `router.go:57` 之前的 `deps.LLMConfigMgr.Get()` 传给 mountChat —— 启动时的 `Unavailable{}` 被 handler 闭包永久捕获。改传 `*ConfigManager`,handler 每次请求 `Get()` 拿最新。任务图的 5 个 `apply*LLM` 早就是这么写的,现在 chat 也一致了

**验证**:
- Backend `go build ./...` 零错
- Frontend `tsc -b --noEmit` + `vite build` 零错
- 端到端 smoke:创建会话/追加消息/清空/删除/PUT patch 保留 agent_id/`llm_prefs` GET+PUT 全通;重启后会话与任务保留,`llm_prefs` 自动应用到 `ConfigManager`,启动日志 `available=true`
- 换端口不再丢数据:前端 baseURL 指向 `http://127.0.0.1:8001`,不管 Vite 端口是 5173 还是 5174,数据源都是同一份 `data/app.db`

### 2026-07-23 · 后端 S4 Knowledge Base + search_kb 真接入

**动机**:S3 前 `/knowledge` 页面走 mock,`chat` 里 `search_kb` 工具是 `buildMockToolCalls` 硬编码的假回复;LLM 完全不知道有工具可用。S4 把 KB 端点和 `search_kb` 工具都做真了。

**S4 交付内容**:

Backend:
- `internal/domain/knowledge.go`(新增):`KnowledgeBase` / `KnowledgeDoc` / `KbDocType` / `KbSearchHit`,严格对齐 `frontend/src/types/knowledge.ts`
- `internal/fixtures/knowledge.go`(新增):3 个内置 KB(临床指南 / 用药清单 / 内部 SOP),共 7 篇 Markdown 文档,与前端 mock fixtures 1:1
- `internal/kb/search.go`(新增):
  - `tokenizeQuery`:切段(空白/中英标点)+ CJK 2-gram 滑窗,去重限 8 个,与前端 mock 算法一致
  - `Search`:title×3 / tag×2 / content×1 加权,每 doc 一条最佳片段(前后 40 字符 rune 上下文),按 score 降序 top 6
- `internal/api/knowledge.go`(新增):8 端点 — `GET/POST /api/kb`、`GET/PUT/DELETE /api/kb/:id`、`POST /api/kb/:id/docs`、`PUT/DELETE /api/kb/:id/docs/:docId`、`POST /api/kb/search`。子路由通过 `store.Update(id, false, patch)` 修 KB.Docs;`/kb/search` 必须挂在 `/kb/{id}` 之前,否则 chi 把 "search" 当成 id
- `internal/api/chat.go`(改):
  - 旧 `buildMockToolCalls` → 新 `buildToolCalls(query, tools, kbIDs, knowledge)`:`search_kb` 走真实 `kb.Search`,输出格式化为 `1. [KB名 / 文档标题] 片段 (score=N)` 供前端展示
  - 新增 `buildLLMTools` + `searchKBTool`(实现 `tool.InvokableTool`):`search_kb` 挂到 `ChatModelAgent.ToolsConfig.Tools`,LLM 触发 tool_call 时执行真实检索,返回 `{"hits": [...]}` JSON。非流式和 SSE 两条链路都挂
  - `mountChat` 签名新增 `knowledge store.Store[*domain.KnowledgeBase]` 参数;`handleChatReply` / `handleChatStream` 同步传递
- `internal/api/router.go`(改):`Deps` 加 `Knowledge` 字段;`mountKnowledge(r, deps.Knowledge)` 挂载
- `cmd/server/main.go`(改):`kbStore := sqlitestore.NewEntities[*domain.KnowledgeBase]` + `fixtures.KnowledgeBases()` seed;启动日志显示 `kbs=3`

Frontend:
- 零改动。`frontend/src/api/knowledge.ts` + `frontend/src/pages/knowledge/index.tsx` 早已按此契约写好,`VITE_USE_MOCK=false` 时直接联通

**关键设计**:
- **KB CRUD 走通用 KV `entities` 表**:kind="kb",data 存整个 `KnowledgeBase`(含 docs 数组)。docs 子路由通过 `store.Update` 的 patch 回调就地改 KB.Docs,一次事务,内置 KB 也允许追加/修改/删除文档(`lockBuiltin=false`),只有 KB 本体的 PUT/DELETE 锁 builtin
- **搜索算法字节位 vs rune 位**:`strings.Index` 返回 byte offset,`buildSnippet` 里 prefix/rest 先按 byte 切再转 rune 展开 40 字符窗口,避免中文截半
- **两条 tool 链路分离**:
  - `buildToolCalls` → 供前端 `tool_calls` trace 展示(即使 LLM 没真调工具也有内容看)
  - `buildLLMTools` → Eino ToolsConfig,LLM 决策要不要调
  这样即使 LLM 不主动调 `search_kb`(比如问答无关内部资料),前端也能看到"如果我调了会命中什么"
- **kb_ids 优先级**:LLM 传的 kb_ids 优先,回退到会话里挂载的默认 kb_ids;LLM 可以显式指定"只查用药清单库"
- **未接的两个工具**:`search_literature` / `verify_reference` 仍是 mock trace;LLM 端也不挂,避免它调了拿到假数据被误导。留给后续对接真实检索器(PubMed / Crossref)

**验证**:
- `go build ./...` / `go vet ./...` 零错
- 端到端 curl(临时 db):
  - `GET /api/kb` → 3 个 builtin KB
  - `GET /api/kb/kb-guidelines` → 3 篇文档
  - `POST /api/kb/search { query: "SGLT2i 心衰" }` → 3 条命中(SGLT2i 用药清单 score=3,ESC 心衰 score=2,ADA 糖尿病 score=1)
  - `POST /api/kb/search { query: "糖尿病", kb_ids: ["kb-guidelines"] }` → 1 条(ADA 2024,score=15)
  - `POST /api/kb { name: "测试库" }` → 返回 `id=kb-xxx builtin=false`
- Frontend `tsc -b --noEmit` + `vite build` 零错

**联调预期**:
- 启动日志 `agents=6 nodes=10 templates=3 skills=5 kbs=3 tasks=2`
- `/knowledge` 页面直接可用(左侧 KB 列表 / 右侧文档预览 / 顶部搜索)
- `/chat` 挂载知识库 + 勾 `search_kb` 后:
  - 前端 tool_calls trace 显示真实命中片段(即使 LLM 未主动调工具)
  - 若 LLM 决定调用(通过 system prompt 或用户明示),会返回 `{"hits":[...]}` JSON,LLM 消化后写进答复
