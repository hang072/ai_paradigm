# Paradigm Eino Workbench · 进度文档

> 最新更新:2026-08-14
>
> 本文件记录项目开发进度、决策记录、待办清单,便于下次会话/后续开发者快速接续。
> 历史变更详见底部「七、变更日志」(自 2026-07-20 起,S1–S4 + 阶段 1-5 全交付)。

---

## 一、当前状态一句话

**前端 + 后端双端完整可跑。前端内置 mock 引擎兜底(零依赖演示),后端 Go + Eino + SQLite 支撑主流程(S1–S4 + 阶段 1-5 全交付,2026-08-11 收口)。**

| 指标 | 值 |
|---|---|
| tsc --noEmit | ✅ 通过 |
| vite build | ✅ 通过(~1.84 MB · gzip ~594 KB · ~3876 modules) |
| go build ./... | ✅ 通过 |
| go test ./... | ✅ 6 个 artifact_e2e + 解析/校验单测全过 |
| 主流程闭环 | ✅ 澄清 → 策略确认 → 框架 → 内容 → 审核回路 → 终稿反馈 → 定稿 |
| 页面数 | 12(含 /templates/new · /templates/:id/edit 完整编辑器) |
| Mock / 后端内置数据 | 6 Agents / 10 Nodes / 3 Templates / 5 Skills / 3 KB(7 文档)/ 2 示例任务 |
| 后端落地 | Go 1.25 + Eino v0.9.12 + eino-ext openai v0.1.13 + chi v5 + SQLite(modernc.org,无 CGO,WAL),60+ 端点 · 5 migrations · 10 节点 Eino Graph(静态)+ 动态 Planner 构图 |
| 真 LLM | OpenAI-compatible(DeepSeek / Kimi / 通义 / OpenAI / Ollama),`LLM_API_KEY` 未配时 chat 路径降级 mock,engine 路径 bubble 失败 → task 状态 `failed` |
| 真 PubMed | NCBI E-utilities,`PUBMED_EMAIL` 必填;未配时工具返回诚实"未启用",绝不伪造 PMID |

---

## 二、✅ 已完成事项

### 2.1 脚手架 & 基础设施

- Vite 5 + React 18 + TypeScript(strict)
- Ant Design 5 · zh-CN locale · 品牌配色(#2b57d6 主色 + #7c4dff 辅色)
- Zustand(全部 server-backed,2026-07-23 S3 起:`useChatStore` → `/api/chat/sessions`,`useAppStore` → `/api/settings/llm_prefs`,`useTasksStore` 内存 + 2s 轮询 `/api/tasks`)
- React Router 6(BrowserRouter,**12 条**路由含编辑器)
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
| `/templates` · `/templates/new` · `/templates/:id/edit` | 3 个内置模板 + 只读预览 + **完整编辑器**(3 栏 / fork 内置 / NodeConfigTable / ParameterSchemaTable / DAG 校验 / 版本化保存)— 2026-08-04 交付,2026-08-11 阶段 2/2.4 扩展 | ✅ |
| `/settings` | 3 Tab:模型接入(8 providers:deepseek / claude / openai / tongyi / zhipu / baidu / dianciyuann / custom,后端持久化到 SQLite `llm_prefs`)· 三方集成(预留)· 关于 | ✅ |

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

### P0 · 后端替换(已交付 · 2026-08-11)

全部交付,详见底部「七、变更日志」S1–S4 + 阶段 1-5。

- ✅ Eino Go 后端骨架(`/backend/`,Go 1.25 + Eino v0.9.12 + eino-ext openai v0.1.13 + chi v5)
- ✅ interrupt/resume 语义实现(走 `compose.StatefulInterrupt` + `compose.ResumeWithData` + SQLite checkpoint,见 `engine/graph.go` / `engine/executor.go`)
- ✅ Checkpointer:SQLite(`backend/data/app.db`,WAL,`modernc.org/sqlite` 无 CGO)
- ✅ 5 个 SQLite migrations(init / chat_attached_expert / chat_active_task_id / template_versions / task_artifacts)
- ✅ 60+ REST 端点(agents / nodes / templates / templates-versions / skills / kb / kb-docs / kb-search / chat / chat-sessions / planner / settings / tasks / tasks-stream / tasks-artifacts)
- ✅ 真 LLM(OpenAI-compatible)+ 真 PubMed(NCBI E-utilities)
- ✅ `VITE_USE_MOCK=false` 端到端冒烟:见 `backend/README.md` Smoke test

### P1 · 前端未完成的编辑器

- [x] **模板画布编辑器** (`pages/templates/edit.tsx` + `canvas/EditableCanvas.tsx`) — 2026-08-04 交付,2026-08-11 阶段 2 扩展
  - ✅ 三栏布局 / 拖拽建节点 / Handle 端口连接 / 属性面板 / 保存到后端
  - ✅ 内置模板进入时自动 fork(后端 builtin 锁,前端零特殊路径)
  - ✅ 节点/边均可键盘删除;删节点自动清理悬空边
  - ✅ 阶段 2:节点 `config` 6 个约定键(sytem_prompt_template / input_keys / output_keys / retrieve_kb / retrieve_pubmed / cite_rule)+ extras JSON 编辑
  - ✅ 阶段 2:模板 `parameter_schema` 编辑(string / number / enum / boolean)
  - ✅ 阶段 2.4:每次保存递增 `current_version`,旧版本留 `template_versions` 表,`GET /versions` + `GET /versions/{v}` 可查
- [x] **任务画布节点点击 → 抽屉** (`pages/tasks/NodeDetailDrawer.tsx`) — 2026-08-04 交付,2026-08-11 阶段 4 扩展
  - ✅ 基础信息 / 运行状态 / 产物(按 after_keys 渲染)/ 「复制产物」按钮
  - ✅ 字段渲染分发:`strategy_doc` / `enriched_framework` / `final_output` 走 `MarkdownView`;`review_report` 走 `ReviewReportView`;`citations` 走可点击链接列表;`parsed_info` / `framework_skeleton` / `completeness` 走 JSON pre;`narrative_mode` / `revision_count` 走 Tag
  - ✅ 阶段 4:ArtifactPanel 折叠面板,展示所有 `task.artifacts` key + 版本列表 + 任选 v1/v2 unified diff(后端 LCS 实现,见 `api/tasks.go:simpleUnifiedDiff`)
- [ ] **节点输入快照渲染** — 阶段 4 后端 `StepHistoryItem.before_snapshot` 已写入,前端 `NodeDetailDrawer` 尚未展示入口 state diff(只展示了出口)
- [ ] **知识库文件上传** — 目前只有粘贴 Markdown,缺 PDF / DOCX / TXT 导入
- [ ] **知识库分块/向量化** — 目前是关键字匹配,接入 embedding 层(chunk + vector search)

### P2 · 实时性 & 流式

- [x] **SSE 端点 `GET /api/tasks/:id/stream`**(后端,2026-07-28 交付) — `backend/internal/api/tasks.go:173-265`
- [x] **Chat 流式打字机** — `POST /api/chat/reply/stream` 返回 SSE,前端 `fetch + ReadableStream` 消费(2026-07-28 修复主助手,2026-07-28 团队 enrich 节点流式)
- [x] **任务侧 chat 路径已用 SSE** — `pages/chat/index.tsx:688-762` `startTaskUpdates` 消费 `/stream`(2026-07-28)
- [ ] **`useTasksStore` 改 EventSource 替代 2s 轮询** — 影响 `/tasks/:id` 页面日志刷新(chat 已用 SSE);`useTasksStore.pollActiveTask` 是单一改造点

### P3 · 三方集成(真接)

- [ ] Teambition API 联通(目前是 mock UI)
- [ ] 钉钉会议 API 联通

### P4 · 工程质量

- [ ] **单元测试**:Vitest + React Testing Library
- [ ] **E2E**:Playwright 覆盖 HITL 主流程
- [ ] Bundle 拆分(~1.84 MB 过大,建议 antd + xyflow + react-markdown 按需分 chunk)
- [ ] `search_literature` / `verify_reference` 已在 chat 路径接入真 PubMed(`backend/internal/pubmed/`);**任务流 enrich 仅集成 `search_literature` 等价的 `litSource.Search`**,待补 `verify_reference` 在任务流的链路

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

### 2026-08-14 · 阶段 5 续 5 P91 · PDF 解析统一走 PyMuPDF sidecar

**背景**:P85 抽图走 pdfcpu(0% 抽图率, CMYK colorspace 限制)+ 抽文走 Qwen-VL(30-60s/PDF),P91 改用 **PyMuPDF + pymupdf4llm** Python sidecar 一步抽 PDF 的文本 / 图 / 表 / 原始 page JSON。PoC 验证 14 份医学 PDF 抽图 41/41 = 100%, 1-2.5s/PDF。

**变更**:

- **新 sidecar** `backend/sidecars/pymupdf-extract/`(FastAPI + uvicorn)
  - `app.py` + `extract.py` · `POST /extract` 接 `{blob_b64}` 返 `{markdown, raw_json, pages_n, images[], tables_count, elapsed_ms}` · `GET /health`
  - `Dockerfile` · `requirements.txt`(fastapi 0.115.0 / uvicorn 0.30.6 / pymupdf4llm 0.0.18 / pymupdf 1.24.10)· `README.md`(接口契约 + 性能表 + 失败模式)
  - 单图 base64 编码后塞 JSON, Go 端解码落盘, sidecar 不接触 `data/kb_images`
  - 单 PDF 上限 64 MiB (跟后端上传硬上限对齐)
- **新 Go 客户端** `internal/embedding/pymupdf.go` · `PymupdfClient` 走 `net/http` + 1 次 transient 重试(照抄 vision.go 模式)。 启动时 ping `/health`, 失败 → fatal
- **新 parser** `internal/parser/pymupdf_parser.go` · `PymupdfParser` 接 `[]ImageBlob` 落 `ParseResult.Images`, `main.go` 调 `parser.SetPymupdfClient` 注入
- **`internal/embedding/kbimages.go`** · 把 P85 `internal/kbimages/` 包的 `ExtractedImage` / `DocImagesRoot` / `DocDir` / `CleanupDocDir` / `CleanupKBDir` / `ResolveImagePath` 全迁过来(签名不变, 前端 `DocStructureImage` 兼容), 新增 `PersistImages(kbID, docID, []ImageBlob, maxBytes) -> []ExtractedImage` 落盘
- **`internal/embedding/jobqueue.go`** · P85 那段 `if IsPDFName && kbimages.ExtractAndPersist(...)` 删了, 改走 `result.Images -> embedding.PersistImages`, 失败 / 0 图不阻断主流程
- **API handler** `internal/api/kb_reembed.go` / `kb_uploads.go` · 把 `kbimages.CleanupDocDir` / `kbimages.ResolveImagePath` 切到 `embedding.*` 同名函数
- **删**:
  - `internal/kbimages/` 整个目录(extractor.go + extractor_test.go)
  - `scripts/test-kbimages/` 旧 smoke 脚本
  - `go.mod` 的 `github.com/pdfcpu/pdfcpu v0.10.1`(`go mod tidy` 摘掉)
  - pdfview 保留(CLAUDE.md memory 要求, 给 parser 备用)
- **docker-compose** · 加 `pymupdf-sidecar` 服务(本地 build + 端口 8002 + healthcheck + start_period 20s), 同时加可选 `backend` service(profiles: ["backend"], `docker compose --profile backend up` 才启), 网络统一成 `paradigm-net`
- **新镜像** `backend/Dockerfile` · multi-stage golang:1.22-alpine → alpine:3.20 静态二进制, 非 root + 时区 Asia/Shanghai
- **新 .dockerignore** · 排除 `data/` `logs/` `*.db` 等, 防数据卷被拷进 builder
- **新测试**:
  - `internal/embedding/kbimages_test.go` · 12 个 case(PersistImages happy / empty / reembed 清旧 / maxBytes 跳过 / 未知 ext 跳过 / ResolveImagePath 8 子 case path traversal / normalizeExt 白名单 / isSafeSeg 字符集 / PersistImagesJSON 形状 / CleanupDocDir + KBDir 幂等)
  - `internal/embedding/pymupdf_e2e_test.go` · `TestE2E_PymupdfSidecar` 走 sidecar → ParseResult → PersistImages 落盘 → imagesJSON 形状; sidecar 不可达时 `t.Skip`
  - `DocImagesRoot` 由 const 改 var, 让测试能 `t.TempDir()` 隔离
- **文档**:
  - `backend/README.md` 加"P91 · PDF 解析走 PyMuPDF sidecar"段(P85 vs P91 对比表 + 启 sidecar 两种方式 + 配置 + 限制)
  - `backend/sidecars/pymupdf-extract/README.md` 已有
  - `PROGRESS.md` 本条
- **CLAUDE.md** 同步:`P85 PDF 抽图` 段补一句"已被 P91 替代, 走 PyMuPDF sidecar"

**全替决策**:
- sidecar 不可用 → `NewPymupdfClientFromEnv` 启动 fail-fast, **不静默降级到老 PdfParser**(ledongthuc 中文乱码)或 VLM
- 老 VLM OCR 仍保留给"扫描件无文本层"场景的兜底? 否 — P91 决策:扫描件近空 markdown 就近空, 不 fallback VLM(防止 P85 双路径复杂度回潮)

**验证**:
- `go build ./...` · `go vet ./...` · `go test ./...` 全绿
- `docker compose -f docker-compose.yml config --quiet` 通过
- PoC 14 份医学 PDF 抽图 100% (41/41), 1-2.5s/份
- 真实 5 页医学 PDF 上传 → sidecar 抽 2 张 (image_001=11.4KB page2 / image_002=18.9KB page4), 磁盘 + sidecar 元数据一致

**后续小修** (P91 上线后用户反馈):
- `frontend/vite.config.ts` 加 `proxy: { '/api': http://127.0.0.1:8001 }` —— 解决用户在浏览器直接 `localhost:5173/api/kb/.../images/...` 走 vite static server 返 404(axios 走 `VITE_API_BASE` 不受影响,这条只覆盖地址栏直输场景)
- `frontend/src/router/index.tsx` 加 `path: '*'` 兜底 → AntD `Result status=404` 友好页(替换默认 "💿 Hey developer")
- 测试 13 个 case: `TestPersistImages_*` (6) + `TestKbImages_*` (6) + `TestPymupdfE2E` (1) 全绿

**修改文件**:1 个 sidecar 全栈(4 文件) + 1 Dockerfile + 1 .dockerignore + 1 docker-compose.yml + 8 个 Go 文件 + 2 个测试 + 4 个文档 + 1 vite config + 1 router = 21 个文件

### 2026-08-14 · 阶段 5 续 5 P92 · 5 个小 gap 一锅端

**背景**:`TODO.md` 列了 5 个已知小 gap(纯前端文案错位 + 假"测试连接"按钮 + 模板卡片缺「复制」+ mock chat 直连 LLM)。Plan 调研时顺带发现第 4 个是个**真 bug**: 编辑 builtin 模板走 fork 后保存 404(走 PUT 但 fork 出来的是新 id, 后端对不存在 id 返 404)。第 3 个调研发现当前工作树已修。

**用户决策**(AskUserQuestion):
- Gap 2 = 真连通性探测(需后端加 `POST /api/settings/llm/test`)
- Gap 4 = 后端加 `POST /api/templates/{id}/fork` 端点
- Gap 5 = 这次也清理

**变更**:
- **后端**:
  - `internal/llm/provider.go`: `Provider` interface 加 `Probe(ctx) error`; 抽 `ResolveBaseURL(provider, override)` 公开 helper(7 个内置 vendor + override 优先); 新增 `NewProbeProvider(ctx, cfg)` 临时构造 provider(不污染 ConfigManager); `ConfigManager.Update` 重构走 `ResolveBaseURL`
  - `internal/llm/openai.go`: `OpenaiProvider.Probe` 发最小 chat 调用(OpenAI-compatible 各家都通, eino-ext Generate 透出 401/超时)
  - `internal/api/settings.go`: 新 `POST /api/settings/llm/test`, 8s 显式 ctx timeout, 早返 "API key 为空" 避免网络探测
  - `internal/api/templates.go`: 新 `POST /api/templates/{id}/fork`, 深拷 nodes/edges/tags/parameter_schema/description_required_inputs, builtin→false, store.Create 自动生成新 id, 自动写 v1
  - `internal/llm/provider_test.go`: 新增 `TestResolveBaseURL` (10 case) + `TestUnavailable_Probe` (no network)
  - `internal/engine/{enrich,review}_stream_test.go` + `validate_test.go`: 3 个 mock Provider 补 `Probe(ctx) error { return nil }` (新 interface 方法)
- **前端**:
  - `api/settings.ts`: 新增 `testLlmConnection(cfg)` 走 fetch 直连后端(避开 client 命中 mock adapter), `VITE_API_BASE` 缺省 127.0.0.1:8001
  - `api/templates.ts`: 新增 `TemplatesApi.fork(srcId)`
  - `pages/settings/index.tsx`: Gap 1 文案改 "持久化到后端 (SQLite settings 表, key=llm_prefs)"; Gap 2 `testConnection` 改 async 调 `testLlmConnection`, 返 `available=true` 弹成功 + 显示 name(`openai(qwen3.6-plus)`), 否则 `error` 原文进 message.error
  - `store/useAppStore.ts`: `ModelConfig` 加 `temperature?: number` (透传给 /llm/test)
  - `pages/templates/edit.tsx`: 导出 `forkTemplate`; 新增 `srcBuiltinId` state; **修复真 bug**: `performSave` 检测 `srcBuiltinId` 时先 `TemplatesApi.fork(srcBuiltinId)` 拿真后端副本, 再 `update` 新 id 写入用户改动, 清掉 `srcBuiltinId` 避免下次 save 重复 fork
  - `pages/templates/index.tsx`: actions 加「复制」按钮 (`CopyOutlined` 走 `TemplatesApi.fork(t.id)`)
  - `api/mock/engine.ts`: 新增 `forkTemplate(srcId)` 复刻后端 clone 逻辑
  - `api/mock/index.ts`: 改 `GET/POST /api/settings/llm` 返 `available: !!api_key`(让 Gap 2 mock 模式也不假); 新增 `POST /api/settings/llm/test` mock(用 'wrong' 模拟 401); 新增 `POST /api/templates/{id}/fork` mock 路由; **Gap 5** `/api/chat/reply` 有 apiKey 时优先 fetch 真后端, 失败回落 `callDirectChatReply` → mock

**E2E 验证** (backend 8001 + sidecar 8002 启):
- `POST /api/templates/tpl-article-simple/fork` → 返 `id=tpl-11104055 name=文章框架制作(简版) · 副本 builtin=False v=1` ✅
- `POST /api/settings/llm/test` 假 key `sk-wrong1234567890` → 返 `{"ok":false,"available":false,"error":"probe failed: error, status code: 401, status: 401 Unauthorized, ... Your api key: ****7890 is invalid"}` ✅ (真探到 deepseek 401)
- `POST /api/settings/llm/test` 空 key → 返 `{"ok":false,"available":false,"error":"API key 为空"}` ✅ (无网络请求)

**全替决策**:
- `/api/settings/llm/test` 8s 显式 timeout: 用户填错 key 不能卡 UI
- `Provider.Probe` 走 Generate 发最小 chat (system "ping" 单条), eino-ext 自带 HTTP client, 401/超时/网络错都透出
- 不在单测里跑真网络(只测 Unavailable/参数), E2E 手工验证

**修改文件**:后端 6 文件 (provider.go + openai.go + settings.go + templates.go + provider_test.go + 3 mock provider 补 Probe) + 前端 8 文件 (settings.ts + templates.ts + useAppStore.ts + settings/index.tsx + templates/edit.tsx + templates/index.tsx + mock/engine.ts + mock/index.ts) = 14 个文件

**后续若要做** (已从 TODO.md 移出, 不再 backlog):
- 边 condition 谓词编辑 (P1) — 模板编辑器"分支"能力
- 节点输入快照渲染 (P1) — `StepHistoryItem.before_snapshot` 已存, 纯前端展示
- `useTasksStore` 改 EventSource (P2) — `/tasks/:id` 2s 轮询替换
- Vitest + Playwright (P4) — 真 LLM 接入后无单测保护
- 模板 KB 上传补全 DOCX/TXT
- 任务流 verify_reference 接 PubMed

### 2026-08-14 · 阶段 5 续 5 P85 · PDF 内嵌图片提取

**背景**:Qwen-VL OCR 抽文本时, 文档里的真实 jpg/png 图被压平成 caption, 原文图片丢失。 用户问"为什么不见了" → 加 pdfcpu 抽 embedded images。

**变更**:
- **新依赖** `github.com/pdfcpu/pdfcpu v0.10.1` (纯 Go, 跨平台, 与 pdfview 并存)。 pdfview 仍负责"渲染 page 给 VLM 看", pdfcpu 负责"抽原图"。 init() 调 `api.DisableConfigDir()` 跳过 %APPDATA% 配置文件查找。
- **新包** `internal/kbimages`:`ExtractAndPersist(blob, kbID, docID, maxBytes)` 走 `api.Images()` 拿 `[]map[int]model.Image`, 按 (page, obj) 排序写到 `data/kb_images/{kb}/{doc}/image_NNN.{ext}`, 返 `[]ExtractedImage` 元数据。 `ResolveImagePath` 防 path traversal(白名单 [^a-zA-Z0-9_.-])。 `CleanupDocDir` / `CleanupKBDir` 删 doc / KB 时级联。
- **migration v9**:`kb_doc_structure.images_json TEXT` 列(JSON 数组, 旧数据 `''`)。 `UpdateImagesJSON` 单独更新列(避免整行 Upsert 覆盖 raw_json)。
- **新端点** `GET /api/kb/{id}/docs/{docId}/images/{name}`:校验 KB / doc / sidecar.images_json 都有该 filename, 再走 ResolveImagePath 读盘, Content-Type 走扩展名映射, Cache-Control 24h。
- **worker 集成**:`processOne` 在 parser 写完 sidecar 后, 若 `parser.IsPDFName` 为真且有 uploadBlob, 调 `kbimages.ExtractAndPersist(2min ctx, 10MB max)`, 把 imgs 写进 `UpdateImagesJSON`。
- **删 doc 级联**:`handleDeleteDoc` 在删 sidecar 后调 `kbimages.CleanupDocDir`。
- **前端**:`DocStructure` 加 `images: DocStructureImage[]`, `KnowledgeApi.getDocImageUrl` 拼 URL。 结构化弹窗的 figure block: 若 sidecar images 里有匹配(按 page_nr), 渲染可缩放的 `<a target=_blank><img>` 缩略图 + 像素/字节元数据; 没有就 fallback "[原图未提取]" + caption。
- **测试**:`internal/kbimages/extractor_test.go` 7 个 case(path traversal 8 子 case + normalizeExt 白名单 + 非 PDF 不 panic + 空 blob + cleanup 幂等 + isSafeSeg)。 `go build / vet / test` 全绿。
- **已知限制**:pdfcpu 对医学 PDF 常见的 CMYK / Indexed / ICCBased colorspace flate-lzw 图像无法 render 返二进制(本测试 kerrebroeck PDF: 14 XObjects 找到, 0 张抽出, log warn)。 DCTDecode 图像(常见 vector PDF + 嵌入 JPEG)能抽。 后续要扩, 需换 lib(如 pdfcpu 内部流解码 或 pdfium CGO)。
- **E2E**: upload test3.pdf → worker parse → kbimages extract (14 XObjects, 0 张成功) → sidecar.images_json='[]' → DELETE doc → 图片目录自动清。

### 2026-08-14 · 阶段 5 续 5 P84 · 单 doc 向量化 + 删 doc API + UI

**背景**:用户点 KB 列表每篇 doc 行内按钮, 单 doc 级别重灌(失败重试)/ 删除。 修复 worker panic 兜底。

**变更**:
- **新端点** `POST /api/kb/{id}/docs/{docId}/reembed` — 后端先调 `Milvus.DeleteByDocID` 清旧 chunks, 再 `EnqueueDoc` 入队重灌。 返 `{doc_id, status:"pending"}`。
- **新端点** `DELETE /api/kb/{id}/docs/{docId}` — 级联清 Milvus chunks(失败不阻断 + 警告) → 删 BLOB(幂等) → 删 sidecar(幂等) → 从 KB.Docs 摘除。 返 `{doc_id, kb_id, deleted:true}`。
- **`JobQueue.ReembedDoc(docID)`** — 包装 `DeleteByDocID + EnqueueDoc`, 30s ctx。
- **`InitKBStores(uploads, ds)`** — 新 package-level 注入, 单 doc delete handler 拿 pkgKbUploads / pkgDocStructures(同 `InitEmbedding` 模式)。
- **前端 KB 页**:`embedStatus` 字典驱动 row badge(待处理 / 解析中 / 就绪 / 失败),`ThunderboltOutlined` 重新向量化按钮(失败变红),`Popconfirm` 描述增加"会同时删除 Milvus 向量与原始文件"。 `openEmbedStatusStream` 返 EventSource, `parsing/ready/failed` 三事件, ready 后自动 `refresh()` 拉新 KB。
- **worker panic recover** (P86): 之前 `chunker.go:184` 调 `goldmark Segment.Value` 用 package-level 空 `var mdSrc = []byte(``)` 必 panic → worker 死 → 服务挂。 改 chunker 用 `[]byte(content)` 切片喂 `text.NewReader`, worker 主循环加 `defer recover()` 转 `EmbedFailed` 事件, 后续 jobs 继续处理。
- **API_CONTRACT.md** §2 KB 端点表加 2 行 + 注释。
- **测试**: `go build / go vet / go test ./...` 全绿(embedding / engine / parser / pubmed)。 E2E: 上一 markdown doc → 4s 嵌入就绪 → DELETE 返 200 → KB count -1 → blob 404 → search 不命中。

### 2026-08-11 · 阶段 6 · 借鉴 workbuddy 专家团的两项关键能力(契约 v1.1 → v1.2)

**背景**:对比 workbuddy 的 SoftwareCompany 专家团,识别出 paradigm_eino 两个可借鉴特征 — Agent 拟人化(花名 + 头像)和 Review 智能路由(按 fail 维度回流到不同上游节点)。这能让 UI 从"工具感"变成"团队感",并把"QA 智能分流"从 prompt 描述升级为图分支强校验。

**变更**:
- **改动 1 · Agent 拟人化**:`AgentDef` +2 字段 `display_name` / `avatar`,零 schema 变更(entities 表 JSON 透传)。6 个 builtin agent 填中文花名(许清楚/齐活林/贾架构/寇豆码/严把关/谷百通)+ 单 codepoint emoji(👂/🧭/🏛️/📝/🔍/💡)。前端新建 `AgentAvatar` 组件 + `useAgentMap` hook,改造 12 处 UI 点(chat 6 / agents 2 / drawer 1 / canvas 3)。chat 路径**不存**新字段到 SQLite(避免迁移),前端通过 `getAgent` 实时拉取。
- **改动 2 · Review 智能路由**:`ReviewReport` +1 字段 `target_node`,白名单 `{plan_strategy / build_framework / enrich_content / human_final}`,非法值降级不报错。LLM prompt 加"智能路由"决策规则,流式加 `回流到: <kind>` 哨兵行,共享 `parseReviewStreamText` 解析器签名改为 4-tuple。静态图 `graph.go reviewBranch` + 动态图 `graph_dynamic.go AddBranch` 都按 `target_node` 路由,`revision_count` 仍每次 +1 保留 `MAX_REVISION=2` 硬限。Planner system prompt 同步要求 spec 含 review_quality 时必带 4 个下游 kind,否则 `BuildGraphFromSpec` 拒收 + 走 `tpl-full` fallback。
- **文档**:`API_CONTRACT.md` 升 v1.2,加 §5.x 路由决策表 + §一 v1.2 拟人化说明。
- **测试**:`TestParseReviewStreamText` +4 用例(plan_strategy / build_framework / 缺省 / pass 忽略)、`TestValidateReviewQuality` +3 用例(合法 / 非法降级 / 缺省)、新建 `TestReviewQualityRegistry_RoundTrip`(含正常 / 缺省 / 非法降级三个 round-trip)。

**关键决策**:
- `target_node=plan_strategy` 经 `PreStrategy` → `plan_strategy` → `confirm_strategy` 链路,**保留用户重新确认策略的机会**(不绕过 confirm_strategy interrupt)
- `target_node=build_framework` 直接回 `build_framework` 节点(骨架是内部产物,不触发 confirm)
- `target_node=human_final` 不增 revision_count 不可控场景,选择"中断"让用户决定
- `chat_messages` 表不存新字段(选 B 方案):选 B 比选 A 简单,避免 migration v6 + 改 Scan/INSERT,前端 bubble 渲染时实时 `getAgent` 拉

**回退**:`target_node` 缺省 / 非法都降级为 `enrich_content`,与 v1.1 行为完全兼容;`display_name/avatar` 全 `omitempty`,旧数据 / 老客户端零影响。

**E2E 验证**:
- 后端:`go test ./internal/engine/ -run 'TestParseReviewStreamText|TestValidateReviewQuality|TestReviewQualityRegistry' -count=1` 全过
- 前端:`npx tsc --noEmit` 通过
- 手动:前端切真后端模式,启动任务,验证 review_report.target_node 标签显示 + 智能路由生效(动态图走 Planner 时不因 spec 缺 4 节点而启动失败)

**修改文件**:12 个后端 + 13 个前端 + 3 个测试 + 3 个文档 = 31 个文件

### 2026-08-11 · 阶段 5 · API_CONTRACT.md 增补(v1.0 → v1.1)

**背景**:阶段 1-4 给后端加了 6 个新端点、3 个 SQLite 表、~20 个新字段,但 `API_CONTRACT.md` 还停留在阶段 0 的版本。这次把所有阶段 1-4 的契约变更集中文档化,并标注 v1.1。

**落地**(`API_CONTRACT.md` 从 425 行扩到 618 行):

文档顶部加契约版本号说明 + v1.0 → v1.1 变更摘要。

| 章节 | 增补内容 |
|---|---|
| **一、Agents** | v1.1:5 字段已写(阶段 1) |
| **二、Nodes / Templates** | v1.1:WorkflowTemplate +4 字段(parameter_schema / description_required_inputs / current_version / versions);端点 +2:`GET /versions` 与 `GET /versions/{v}`;PUT 改"乐观锁 + 创建新版本" |
| **五、Tasks** | v1.1:TaskSnapshot +Artifacts 索引(ArtifactKeyRef 类型);StepHistoryItem +before_snapshot/after_snapshot 浅拷贝 |
| **六、Chat** | v1.1:新增 §6.2 阶段 3 动态 Planner — `POST /api/planner/compose` 端点 / PlannerComposeInput / PlannerComposeResponse 完整 schema / 5min LRU 缓存策略 / 前端 chat 切换行为 / mock 引擎兜底 |
| **七、Artifact 仓库(新章)** | 5 端点完整列表 + ArtifactRef / ArtifactRow / ArtifactDiff 三个类型 + 错误码 + SQLite 表结构 + 前端消费点(NodeDetailDrawer ArtifactPanel) |
| **八、模板版本(新章)** | 2 端点 + 错误码 + SQLite v4 迁移 |
| **十、测试建议** | 6 项原测试清单 + 4 项 v1.1 增补(参数 schema、版本号、artifact 写盘、Planner);引用阶段 4.10 E2E 集成测试 |

**未改动**:源码、SQLite schema、mock engine、e2e 测试。

**验证**:
- 后端 `go build ./...` / `go vet ./...` 零错(本次无代码变更,纯文档)
- `API_CONTRACT.md` 内部一致性:所有引用"阶段 1-4"的端点 / 字段 / 路径均与实际 `frontend/src/api/*.ts` 与 `backend/internal/api/*.go` 一致
- 文档 618 行,10 个主章节,与项目其它文档(README / CLAUDE.md / PROGRESS.md)形成完整体系

### 2026-08-11 · 阶段 4.10 · E2E 集成测试(artifact 写盘 + diff 端到端)

**背景**:阶段 4.6 改完 6 个 step 函数走 artifact store 后,需要端到端验证契约。直接起后端 + 配 LLM 跑通整流程门槛高(需要真实 LLM key),务实方案是用临时 SQLite + 直接调 store 层验证 5 个核心契约。

**落地**:
- `internal/engine/artifact_e2e_test.go`(新)6 个 e2e 测试:
  1. `TestE2E_ArtifactWrite_TwoRevisions` — 同 key 写 2 次,version 单调递增 1→2,ListKeys / ListVersions / GetVersion 全验证
  2. `TestE2E_ArtifactDiff_RealContent` — 真实 medical 内容(v1 短,v2 改写 + 新增"不良反应"段),验证 diff 头部 `--- v1\n+++ v2\n` + 含 +/- 行
  3. `TestE2E_ArtifactWrite_IndexSync` — `writeArtifactKey` 同步更新 `snap.Artifacts` 索引
  4. `TestE2E_ArtifactSnapshotSerialize_RoundTrip` — TaskSnapshot JSON 序列化 / 反序列化不丢 Artifacts 字段(模拟 SQLite JSON blob 读写)
  5. `TestE2E_ArtifactEmptySnapshots_NoCrash` — 空 task 不 crash,GetLatest 返回 `ErrArtifactNotFound`
  6. `TestE2E_HTTP_ArtifactEndpointsContract` — HTTP-level 契约(store 层的语义 = http 端点返回的语义)
- 临时 SQLite(`t.TempDir()`)+ 跑 migrations v1-v5,无外部依赖
- 嵌入 `simpleDiffForTest`(LCS + unified),与 `api/tasks.go:simpleUnifiedDiff` 等价,避免跨包 import 循环

**为什么不直接起 http server?** 起 server 涉及 chat / tasks / executor / 多个 fixtures 装配,工作量大但对 4.6 验证边际收益小(store 层契约 + JSON 序列化已能覆盖 90% 风险)。生产 e2e 留 hook 注释在 `TestE2E_HTTP_ArtifactEndpointsContract`,配 LLM key 时可继续拓展。

**验证**:
- `go test ./internal/engine/ -run TestE2E -v` 6 个测试全 PASS
- `go build ./...` / `go vet ./...` 零错
- diff 实际输出(已打印)显示 v1→v2 的真实行级变更:
  ```
  --- v1
  +++ v2
   ## 背景
  
  -二甲双胍是一线降糖药。
  +二甲双胍是 2 型糖尿病的一线降糖用药。
  
   ## 机制
  
  -抑制肝糖输出。
  +抑制肝糖输出 + 增加外周胰岛素敏感性。
  +
  +## 不良反应
  +
  +胃肠道反应为主,长期使用注意 B12 吸收。
  ```
- 前端:`npm run typecheck` 零错;`npm run build` 通过(3876 modules,1.84MB / gzip 594KB,无变化)

### 2026-08-11 · 阶段 4.6 · step 写盘路径走 artifact store(收口)

**背景**:阶段 4 引入了 `task_artifacts` 表 + `/artifacts/*` 端点 + LCS diff,但实际写盘路径没改:`enrich_content` 等节点写 `snapshot.EnrichedFramework` 时仍只覆盖顶层字段,旧版本永久丢失。阶段 4.6 真正把 6 个 step 函数改造成"写 snapshot + 写 artifact + 同步 Artifacts 索引 + 填 before/after 浅拷"。

**落地**:

后端:
- `internal/engine/artifact_writer.go`(新):`writeArtifactKey(taskArtifacts, snap, key, content, contentType, nodeID, agentID)` 统一写盘入口(nil-safe,自动 +1 version,自动更新 `snap.Artifacts[key]` 索引)
- `internal/engine/snapshot.go`:`pushStep` 保留(老 API),新增 `pushStepWithDiff(..., before, after)`;新增 `shallowSnapshot(snap, keys)` 抽指定字段成 map(用于 before/after 浅拷)
- `internal/engine/steps.go`:6 个写盘节点改造 —— `applyParseBriefLLM` / `applyPlanStrategyLLM` / `applyBuildFrameworkLLM` / `applyEnrichContentLLM` (含流式 `enrichContentStream`) / `applyReviewQualityLLM` (含流式 `reviewQualityStream`) / `applyFinalize`,每个都:
  1. `before := shallowSnapshot(s, keys)`
  2. 写 snapshot 字段
  3. 调 `writeArtifactKey` 写 artifact + 同步索引
  4. `after := shallowSnapshot(s, keys)`
  5. `pushStepWithDiff` 替换原 `pushStep`
- 6 个函数签名加 `*sqlitestore.TaskArtifacts` 形参,`BuildTaskGraph` + `DynamicGraphDeps` 也加,`main.go` 装配
- `enrich_stream_test.go` + `review_stream_test.go` 3 个测试调用补 `nil` taskArtifacts(走 nil-safe 路径)

前端:
- 阶段 4.4 已实现:NodeDetailDrawer 的 ArtifactPanel 渲染 `task.artifacts` 列表 + 版本 + diff
- 此阶段无需新代码——`TaskSnapshot.artifacts` 后端返回的字段自动被前端消费

**行为差异**:
- 旧:`enriched_framework` v1 → 触发 revise → 写 v2 时 v1 被覆盖,**永久丢失**
- 新:`enriched_framework` v1 → 触发 revise → v1 落 `task_artifacts` 表 → 写 v2 时 v1 保留 → NodeDetailDrawer 看 2 个版本,可选 diff

**验证**:
- 后端:`go build ./...` / `go vet ./...` 零错;`go test ./...` engine + pubmed 全绿(5 个 stream 测试补 nil 仍通过)
- 前端:`npm run typecheck` 零错;`npm run build` 通过(3876 modules,1.84MB / gzip 594KB,无变化)
- E2E(需手测 + LLM key):触发 enrich_content → SQLite `task_artifacts` 表 `enriched_framework` v1 落库 → 触发 revise → enrich 再跑 → v2 落库 → `GET /api/tasks/:id/artifacts/enriched_framework/diff?v1=1&v2=2` 返回真实 unified diff

### 2026-08-11 · 阶段 3.1 · 节点注册表 + GenericStep 框架

**背景**:阶段 3.2 的 `graph_dynamic.go` 用 switch-case 把 10 个 builtin type 路由到 `apply*LLM` 函数。新增 NodeDef 需要改 switch + 在 `apply*LLM` 旁加一个对应函数。阶段 3.1 把"节点类型 → 渲染器 / 校验器 / 副作用"显式建模为 `NodeKindSpec` 注册表,新增 builtin 节点只需在注册表里加一条,不再改 graph。

**落地**:

后端:
- `internal/engine/registry.go`(新):3 个接口(MessageRenderer / OutputValidator / SideEffect)+ `NodeKindSpec` 类型 + 5 个 builtin compute 节点的 renderer/validator 适配器(把既有 prompts.go 函数包成接口实现,无重写)+ `RegisterNodeKind` / `LookupNodeKind` / `ListRegisteredNodeKinds` + 10 个 kind 的 init() 占位 + `SetBuiltinSources(agents, kbs, lits)` 在 main.go 装配
- `internal/engine/generic_step.go`(新):`runGenericStep` 统一流水线 —— SideEffect → Renderer → Complete/Stream(contentType 决定)→ ParseAndValidate → Apply。`runBlockLLM` 走 Complete,`runStreamLLM` 走 Stream + 推 TokenSink
- `internal/engine/graph_dynamic.go`:`buildLambdaForInstance` 不再 switch compute case,改 `LookupNodeKind` 查注册表;interrupt / counter / finalize 仍用专用 lambda(它们是结构性的,不走 LLM)
- `internal/engine/steps.go`:补 4 个 `applyXxxFromResult` helper(把 LLM 解析结果写回 snapshot 的统一路径),保留给旧 `apply*LLM` 函数复用
- `cmd/server/main.go`:在 BuildTaskGraph 之前调 `engine.SetBuiltinSources(agentStore, kbStore, litSource)` 注入依赖

**未改动**:5 个 `apply*LLM` 函数本体(graph.go 仍直接用),SQLite schema,API 契约,前端 types

**验证**:
- 后端:`go build ./...` / `go vet ./...` 零错;`go test ./...` engine + pubmed 全绿
- 前端:`npm run typecheck` 零错;`npm run build` 通过(3876 modules,1.84MB / gzip 594KB,无变化)
- E2E(需手测):Planner 输出的 spec 引用 enrich_content → 走 `runGenericStep` → 走 enrichContentSideEffect(KB+PubMed)+ enrichContentRenderer(RenderExtras 含 sources)+ enrichContentValidator(校验 + 写盘);tpl-full 老路径走 graph.go 老 lambda,行为不变

### 2026-08-11 · 阶段 4 · 共享工件仓库(Artifact Store + 多版本 diff)

**背景**:enrich_content 多轮修订会覆盖 snapshot.enriched_framework,旧版本永久丢失,PROGRESS.md:165 提到的 `before_keys` 缺口也借此一并解决。阶段 4 把"每一步的产物"独立存为不可变 artifact,前端可读任意版本或对比 diff。

**落地**:

后端:
- `internal/store/sqlite/migrations.go` v5:新增 `task_artifacts(task_id, key, version, content, content_type, produced_by, produced_by_agent, created_at, metadata_json)`,复合主键
- `internal/store/sqlite/task_artifacts.go`(新):`TaskArtifacts` 实现 `WriteArtifact / GetLatest / GetVersion / ListKeys / ListVersions`;每写 +1 version,旧版保留
- `internal/domain/task.go`:`TaskSnapshot` 增 `Artifacts map[string]ArtifactKeyRef`(只存元数据,引用 URL);`StepHistoryItem` 增 `BeforeSnapshot / AfterSnapshot` 字段(节点入口/出口的浅拷贝,前端可 diff 节点前后变化);`ArtifactKeyRef` 类型(避免 store ↔ domain 循环依赖)
- `internal/api/tasks.go`:`TasksDeps` 增 `Artifacts` 字段;新增 5 个端点:
  - `GET /api/tasks/:id/artifacts` — 列出 key 与版本
  - `GET /api/tasks/:id/artifacts/:key` — 取 latest
  - `GET /api/tasks/:id/artifacts/:key/versions` — 列出所有 version
  - `GET /api/tasks/:id/artifacts/:key/versions/:v` — 取指定 version
  - `GET /api/tasks/:id/artifacts/:key/diff?v1=X&v2=Y` — 文本 diff(自实现 LCS + unified 格式,无第三方依赖)
- `cmd/server/main.go` 装配 `taskArtifacts` 注入 tasks handler

前端:
- `src/api/artifacts.ts`(新):5 个端点的 typed 客户端
- `src/types/task.ts`:`StepHistoryItem` 加 `before_snapshot / after_snapshot`;`TaskSnapshot` 加 `artifacts?` 字段
- `src/pages/tasks/NodeDetailDrawer.tsx`:在节点产物 section 之后,新增"工件历史"折叠面板 `ArtifactPanel` —— 列出 `task.artifacts` 所有 key,每个 key 可点开看版本列表 + 任意两版本 unified diff。默认对比"最旧 vs 最新"

**未改动**:`enrich_content` / `review_quality` 等步骤的写盘路径(仍写 snapshot 顶层字段,字段值的"持久版本化"留给 step 函数的下一轮迭代)。Artifact Store 已就位,新步骤(阶段 4+ 真正接入)只需把 snapshot 写盘改成 `artifactStore.WriteArtifact(taskID, key, content, contentType, nodeID, agentID, meta)` 即可,旧数据兼容。

**验证**:
- 后端:`go build ./...` / `go vet ./...` 零错;`go test ./...` engine + pubmed 全绿
- 前端:`npm run typecheck` 零错;`npm run build` 通过(3876 modules,1.84MB / gzip 594KB)
- E2E(需手测):enrich_content 跑 2 次修订后,GET `/api/tasks/:id/artifacts/enriched_framework` → 200 + 2 行;GET `?v1=1&v2=2` 返回 unified diff;NodeDetailDrawer 抽屉的"工件历史"折叠展示出来

### 2026-08-11 · 阶段 3 · 动态 Planner(LLM 编排 DAG + 动态构图)

**背景**:阶段 1+2 已就绪(`AgentDef` 结构化 + `parameter_schema` 可配),但 chat 团队路径仍"3 选 1 模板"。阶段 3 让系统能根据用户 brief 实时生成 `TaskSpec`,由后端动态构建 Eino Graph,跑出新编排。3 个内置模板降级为兜底。

**落地**:

后端:
- `internal/engine/graph_dynamic.go`(新) · `BuildGraphFromSpec(spec, deps)`:从 spec 反射构建 eino Graph。compute 节点按 type 路由到既有 `apply*LLM`(复用阶段 2b LLM 路径);interrupt 节点走 `StatefulInterrupt`;counter 走 `applyBumpRevision`;router 暂不支持(spec 校验直接拒)。边统一为单端口"advance"(老图的 pass/revise/redo 精细分支由 review_quality 内部 logic 决定)
- `internal/engine/executor.go`:新增 `NewExecutorWithDynamic`,把 graph 字段换成 `graphBuilder(spec)` lazy 模式 —— 首次 run 时根据 `snap.Spec` 选 `BuildGraphFromSpec` 或老 `BuildTaskGraph`。新策略:`isBuiltinClonedSpec` 判定 spec 是不是 tpl-full / tpl-slide-simple / tpl-article-simple 的克隆,是则走老图(branch 逻辑更完备);否则走动态
- `internal/planner/`(新包) · `planner.go`:`Planner.Compose(req) → ComposeResponse{Mode, Spec?, FallbackTemplateID?, Reason, LatencyMs}`。5 分钟 LRU 缓存;LLM 不可用 / 输出校验失败 → `Mode="static"` + `fallback_template_id="tpl-full"`,前端走老路径;校验通过 → `Mode="dynamic"` + 完整 spec。Spec 严格校验(node.type 必须注册、edge 端点存在、节点数 2-12、entry 必须有入边等)
- `internal/api/planner.go`(新) + `router.go`:`POST /api/planner/compose` 端点注册
- `cmd/server/main.go` 装配 `plannerSvc` 注入 router

前端:
- `src/api/planner.ts`(新):`PlannerApi.compose` typed 客户端
- `src/api/mock/engine.ts`:mock `composePlanner` 返回 static + tpl-full(浏览器无 LLM,等价老路径)
- `src/pages/chat/index.tsx` send 团队分支:首条消息先调 `PlannerApi.compose`,根据 `mode` 决定 `TasksApi.start({ spec })` 还是 `{ template_id }`。任务启动气泡展示 Planner 决策

**未改动**:5 个 compute 节点的 `apply*LLM` 函数、5 个 `render*` 提示词、节点 fixtures、AgentDef 字段(阶段 1 已就绪)、SQLite schema

**验证**:
- 后端:`go build ./...` / `go vet ./...` 零错;`go test ./...` engine + pubmed 全绿
- 前端:`npm run typecheck` 零错;`npm run build` 通过(3876 modules,1.84MB / gzip 593KB)
- E2E(需手测):用户输入 brief → mock 走 static 兜底 tpl-full(浏览器无 LLM);真后端 + LLM 启用时 → Planner 输出 spec → 任务跑通

### 2026-08-11 · 阶段 2 · 模板编辑器补全(右栏 + DAG 校验 + 版本化)

**背景**:2026-08-04 交付的编辑器只支持"加节点 / 连线 / 改 entry / 改 name",真正想编辑 Agent 绑定、NodeDef.config、parameter_schema 时只能去 `/nodes` 后台编辑。阶段 2 把这些能力收到编辑器内,顺手做 DAG 校验(可达性 / 环 / 端口 / entry)与模板版本化保存。

**落地**:

类型层:
- `frontend/src/types/template.ts` + `backend/internal/domain/template.go`:`WorkflowTemplate` +4 字段(`parameter_schema` / `description_required_inputs` / `current_version` / `versions`);新增 `ParameterSchemaEntry` 类型。Normalize 给 map / 切片补非 nil 默认值
- `frontend/src/types/node.ts`:同时给 `NodeDefConfigConventions` 工具类型(供编辑器 UI 区分约定键 vs 自由键)

编辑器右栏:
- `frontend/src/pages/templates/edit.tsx` 重写,新增:
  - `NodeConfigTable`:6 个约定键走友好 UI(system_prompt_template / input_keys / output_keys / retrieve_kb / retrieve_pubmed / cite_rule),其他键走 JSON 字符串行,可加可删
  - `ParameterSchemaTable`:模板级入参契约编辑器,字段为 type / required / description / default / enum_values
  - 节点属性面板:Agent 绑定从只读 Tag 升级为可改 Select(影响所有同 type 实例);config 折叠面板;删除节点按钮
  - 顶部元信息 Card:版本号 `v{n}` + 历史版本列表;两个折叠(parameter_schema / Planner 必填入参描述)
  - handleSave 接入 DAG 校验:有 error → Modal 弹错不让保存;有 warn → confirm 让用户决定
- 底部实时校验问题列表 Alert,与画布同步刷新

DAG 校验器(新文件 `frontend/src/pages/templates/validateTemplate.ts`):
- 4 类问题:entry 缺失 / entry 不在 nodes / 边端点缺失 / 边端口不在源 out_ports(BFS 可达性 warn / DFS 环检测 error)
- 环检测允许显式标注 `NodeDef.config.allow_cycle=true` 放行(`bump_revision→enrich_content` 这类合法环)
- 错误存在 → 不允许保存;仅警告 → 提示但允许

版本化保存(后端 + 前端):
- SQLite 迁移 v4 新表 `template_versions(template_id, version, data, created_at)`,复合主键
- 新文件 `backend/internal/store/sqlite/template_versions.go`:`SaveVersion` 自动 +1、`ListVersions` 降序、`GetVersion` 取快照
- `backend/internal/api/templates.go`:PUT 改为"乐观锁 + 创建新版本";GET 模板时回填完整 Versions;新增 `GET /templates/{id}/versions` 与 `GET /templates/{id}/versions/{v}` 端点
- `cmd/server/main.go`:装配 `templateVersions` 并注入 router
- 前端 mock engine 假装版本递增(不存历史,刷新即丢);后端真存

**未改动**:节点 fixtures、AgentDef、SQLite 旧表、其它端点;NodeDef.config 仍为自由字段(运行时无 schema 强制,阶段 3 GenericStep 才消费)。

**验证**:
- 后端:`go build ./...` / `go vet ./...` 零错;`go test ./...` 全绿
- 前端:`npm run typecheck` 零错;`npm run build` 通过(3876 modules,1.84MB / gzip 593KB,比阶段 1 多 70KB 来自新加的 Collapse / Table / Switch)
- E2E(需手测):进入 `/templates/tpl-full/edit` → 自动 fork → 改某节点 Agent 绑定 + config → 改 parameter_schema → 保存 → 后端 `GET /api/templates/{id}/versions` 返回 `[1, 2]`,`GET /api/templates/{id}/versions/1` 返回原 tpl-full

### 2026-08-11 · 阶段 1 · 结构化 Agent Profile(AgentDef 扩展)

**背景**:阶段 1 落地。`AgentDef` 当前只有 7 字段(对齐 paradigm_langgraph dataclass),没有 `persona / methodology / output_schema / guardrails`,导致 Planner 编排与 UI 展示都缺结构化抓手。本阶段把"散落在 system_prompt 里的契约"显式建模出来,作为后续动态 Planner(阶段 3)与模板编辑器(阶段 2)的输入。

**落地**:

类型扩展:
- `frontend/src/types/agent.ts`:`AgentDef` 新增 4 个可选字段(`persona / methodology / output_schema / guardrails`),全部 optional,旧数据兼容
- `backend/internal/domain/agent.go`:同步新增 4 字段,新增 `ArtifactOutputSpec` / `AgentGuardrails` 两个嵌套类型;`Normalize()` 给 `Methodology / OutputSchema / Guardrails.EscalateTo / Guardrails.RedLines` 补非 nil 空值(避免下游 `.Length` 断言 nil)
- `frontend/src/types/node.ts` / `backend/internal/domain/node.go`:`NodeDef.config` 仍为自由字段(阶段 3 才由 GenericStep 消费),新增 `NodeDefConfigConventions` 约定键类型 + Go 端 `NodeDefConfigConventionKeys` 白名单,给模板编辑器(阶段 2)做静态提示用

Fixtures 填齐(6 个 builtin agent,前后端镜像):
- clarifier:`Persona: 8 年医疗内容产品经验的资深需求澄清官`;`Methodology: 4 步`;`OutputSchema: {parsed_info, completeness, clarification_questions}`;`Guardrails: no_fabricate + escalate_to=planner`
- planner:`Persona: 医学学术内容策略师`;`Methodology: 5 步`;`OutputSchema: {strategy_doc, narrative_mode}`;`Guardrails: no_fabricate`
- builder:`Methodology: 3 步`;`OutputSchema: {framework_skeleton}`
- enricher:`Methodology: 4 步`;`OutputSchema: {enriched_framework, citations}`;`Guardrails: no_fabricate + require_citations + 3 条 red_lines`
- reviewer:`Methodology: 4 步(量化阈值)`;`OutputSchema: {review_report}`;`Guardrails: no_fabricate`
- designer:`Methodology: []`;`OutputSchema: {content}`;`Guardrails: {}`(通用助手无守门)

契约与同步:
- `API_CONTRACT.md` Agents 段:AgentDef schema 增 4 字段 + v1.1 兼容说明(Normalize 默认值、builtin UPSERT 行为)
- `API_CONTRACT.md` Nodes 段:NodeDef.config 增约定键表(6 个 builtin 约定键 + 含义),明示"运行时无 schema 强制"
- `frontend/src/api/mock/engine.ts` `createAgent`:补 4 字段默认值,与后端 `Normalize()` 等价

**未改动**:
- `system_prompt` 内容(契约只是显式化,系统提示词不变)
- 节点 fixtures、模板 fixtures、`engine.ts` 状态机、Go 步骤函数、SQLite schema
- `/api/agents` 端点(纯字段加法,无新端点)

**验证**:
- 后端:`go build ./...` / `go vet ./...` 零错;`go test ./...` 全绿(`engine` + `pubmed`)
- 前端:`npm run typecheck` 零错;`npm run build` 通过(3875 modules,1.63MB / gzip 526KB,体积无显著变化)
- builtin agent 走 UPSERT,重启后端时新字段自动落库;前端 mock 走 fixtures,刷新即生效

### 2026-08-11 · 阶段 0 清理(陈旧文档同步)

**背景**:开始阶段 1-4 演进前,先收口文档。`TODO.md` 中模板编辑器、任务画布抽屉、P2 SSE 三项已实际交付,`PROGRESS.md:165` 提到的 `before_keys` 缺口的解决方案也已锁定(走阶段 4 Artifact Store),需更新文档避免误导后续会话。

**落地**:
- `TODO.md`:
  - P1 模板编辑器:标注 2026-08-04 交付,补实际文件路径(`pages/templates/edit.tsx` + `canvas/EditableCanvas.tsx`),加"阶段 2 增量"子项(`config` / `agent_id` / `parameter_schema` 编辑、边 condition、版本化)
  - P1 任务画布节点点击:标注 2026-08-04 交付,补实际文件路径(`pages/tasks/NodeDetailDrawer.tsx`),加"阶段 4 增量"子项(节点输入快照)
  - P2 SSE:已完成项打勾,`useTasksStore` 仍走 2s 轮询(chat 已用 SSE)保持 open
- `PROGRESS.md`:
  - P2 段:4 项里 3 项打勾(SSE 端点 / Chat 流式 / 任务侧 chat SSE),1 项保留(`/tasks/:id` 仍轮询)
  - `PROGRESS.md:165`:`before_keys` 缺口方案指向阶段 4 Artifact Store
  - 新增「八、阶段 1-4 演进路线」表,4 阶段索引 + 阻塞关系
- `CLAUDE.md`:
  - "Chat modes" 段:补充当前实现(主助手单段 + 工具调用 + 专家团走任务流),`mode: 'team'` 标为老协议(后端保留兜底)
  - 加"目标态"段:Planner 服务实时生成 `TaskSpec`,动态构建 Eino Graph,内置模板降级为起步档位

**未改动**:任何源码、契约、fixtures。

**验证**:三份文档无内部矛盾,TODO.md 与 PROGRESS.md P1/P2 状态一致,CLAUDE.md Chat modes 段与 `pages/chat/index.tsx:826-891` 实现一致。

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

---

## 八、阶段 1-4 演进路线(专家团升级)

> 目标:从"3 选 1 静态模板"升级到"Planner 实时编排 DAG + 共享工件仓库"。详细方案见对话历史,这里只留索引。

| 阶段 | 主题 | 关键产物 | 阻塞关系 |
|---|---|---|---|
| **1** | 结构化 Agent Profile | `AgentDef` 增 `persona / methodology / output_schema / guardrails`;`NodeDef.config` 收紧为子结构;fixtures 全部填齐 | — |
| **2** | 模板编辑器补全 | `edit.tsx` 右栏支持 `config` / `agent_id` / `parameter_schema` 编辑;边 condition 谓词;DAG 校验;版本化保存 | 阶段 1 |
| **3** | 动态 Planner | `POST /api/planner/compose`;通用化 `GenericStep` + 节点注册表;`BuildTaskGraph` 改为从 spec 反射构建 | 阶段 1 |
| **4** | 共享工件仓库 | SQLite 新增 `task_artifacts` 表;`StepHistoryItem` 增 `before_snapshot`;前端 diff UI | 阶段 3 |

阶段 0(本文档清理)已完成:见最新变更日志。

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

### 2026-08-11 · 阶段 5 续 3 · KB 检索切换到 Milvus Lite 向量数据库

**目标**: search_kb 从 SQLite 关键词子串匹配 → 异步 chunk + OpenAI 兼容 embedding + Milvus Lite 向量 top-k。每条 hit 携带 chunk_id + 原文片段 + 位置信息(`第 N 页` / `## 标题` / `H1 标题`)。

**关键决策**:
- Milvus 是 hard dep: 启动时 `data/milvus.db` 创建失败 / LLM_API_KEY 缺失 → server 启动失败
- 粒度 = chunk 级,不是 doc 级(用户能点进具体段落)
- chunker 按结构切: markdown 标题 / PDF 页 / docx 段落
- embedding 后台异步(4 worker pool),不阻塞上传
- fixtures 已有 doc 启动时**不**自动向量化,UI 手动点"重新向量化"才入仓

**交付**:
- 后端: `internal/embedding/` 包(types / client / chunker / milvus / jobqueue / search),`internal/api/kb_reembed.go`(POST /reembed + GET embed-status/stream SSE),router Deps 加 Embedder/Milvus/JobQ,`InitEmbedding` 注入
- 前端: `KbSearchHit` 加 `chunk_id` + `location`,KB 卡片加 ⚡"重新向量化"按钮,`api/knowledge.ts` 加 `reembedKB` 方法
- mock 模式 hit 携带 `chunk_id="doc-xxx:0"` + `location="mock 命中位置"` 兜底
- `.env` / `.env.example` 加 `LLM_EMBEDDING_MODEL=text-embedding-3-small`

**依赖**: `github.com/yuin/goldmark v1.8.5`, `github.com/milvus-io/milvus-sdk-go/v2 v2.4.2`

**验证**: go build/vet/test 全绿, npm run typecheck/build 全绿。
