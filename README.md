# AI 工作台 · Paradigm Eino Workbench

多智能体协同的医疗内容框架生成平台 · 全栈实现(Vite + React 前端 + CloudWeGo Eino Go 后端)。

参考 POC(`http://122.51.17.23:8081/`)的产品形态,基于 **React + Ant Design + @xyflow/react** 全新实现前端,后端用 **[CloudWeGo Eino](https://github.com/cloudwego/eino) v0.9** 编排多智能体 Graph。前端自带 Mock 引擎,默认不依赖后端即可跑通全流程;需要真实 LLM/PubMed 检索时启动 Go 后端即可,前端 axios 层零改动切 baseURL。

姊妹项目 `paradigm_langgraph`(Python + LangGraph)是同一契约的另一实现,前端可指向任一后端。

## 一、技术栈

| 层 | 技术 |
|---|---|
| 前端构建 | Vite 5 + TypeScript |
| 前端视图 | React 18 |
| 前端 UI | Ant Design 5(zh-CN)|
| 前端状态 | Zustand 5 |
| 前端路由 | React Router 6 |
| 前端画布 | @xyflow/react 12 + dagre 自动布局 |
| 前端 HTTP | axios + 自定义 mock adapter |
| 前端 Markdown | react-markdown + remark-gfm |
| 后端语言 | Go 1.22+(项目 go.mod 锁 1.25)|
| 后端框架 | CloudWeGo Eino v0.9.12 + eino-ext openai v0.1.13 |
| 后端路由 | go-chi/chi v5 + go-chi/cors |
| 后端存储 | SQLite(`modernc.org/sqlite`,无 CGO,WAL 模式)|
| 后端 LLM | OpenAI-compatible:DeepSeek / Kimi / 通义 / OpenAI / Ollama |
| 后端文献 | NCBI E-utilities(PubMed 真实检索)|

## 二、目录结构

```
paradigm_eino/
├── frontend/                          Vite + React + TS 前端
│   └── src/
│       ├── main.tsx / App.tsx / router/  入口 + 路由(9 条)
│       ├── layout/AppShell.tsx           顶栏 + 侧栏
│       ├── pages/
│       │   ├── workbench/                模块 A · 协同工作台(首页)
│       │   ├── chat/                     单助手对话 + 专家团(team 走 Planner → Task)
│       │   ├── agents/                   模块 B · 专家团 CRUD
│       │   ├── tasks/                    模块 C · 任务运行 + HITL(画布 / 抽屉 / 产物)
│       │   ├── templates/                模块 D · 模板库(列表 + 完整编辑器)
│       │   ├── knowledge/                知识库(CRUD + 跨库检索)
│       │   ├── skills/                   技能库
│       │   └── settings/                 模块 E · 模型接入 & 三方集成
│       ├── canvas/                       FlowCanvas(只读) + EditableCanvas(拖拽编辑器)
│       ├── api/                          REST 客户端 + mock adapter + 内存 engine
│       │   └── mock/
│       │       ├── engine.ts             任务状态机(单文件 900 行,作为后端实现参考)
│       │       ├── fixtures/             内置 6 Agents / 10 节点 / 3 模板 / 5 技能 / 3 KB(7 文档)
│       │       └── index.ts              axios 拦截路由(~40 条)
│       ├── store/                        Zustand:settings / chat / tasks(server-backed)
│       └── types/                        TS 类型(与后端 domain 一一对应)
├── backend/                          Eino Go 后端(独立项目,有自己的 README)
│   ├── cmd/server/main.go             入口:装载 fixtures + Eino graph + chi 服务
│   ├── internal/
│   │   ├── domain/                    领域类型(JSON tag 与 frontend/src/types 对齐)
│   │   ├── store/                     泛型 KV + SQLite 持久化
│   │   │   └── sqlite/                含 5 个 migration
│   │   ├── engine/                    ★ 任务状态机(Eino compose.Graph + HITL)
│   │   │                              + artifact_writer + generic_step + graph_dynamic + registry
│   │   ├── api/                       chi 路由 + handler(agents/nodes/templates/skills/
│   │   │                              kb/chat/planner/chat_sessions/settings/tasks)
│   │   ├── llm/                       OpenAI-compatible Provider 抽象 + .env 加载
│   │   ├── kb/                        关键词打分检索(title×3 / tag×2 / content×1)
│   │   ├── pubmed/                    真实 NCBI E-utilities 客户端
│   │   ├── planner/                   brief → TaskSpec 动态编排 + 5min LRU 缓存
│   │   └── fixtures/                  6 Agents / 10 Nodes / 3 Templates / 5 Skills / 3 KB / 2 演示 Task
│   ├── data/app.db                    SQLite(运行后生成,可被 PARADIGM_DB_PATH 覆盖)
│   └── .env.example                   PORT + LLM_* + PUBMED_EMAIL
├── API_CONTRACT.md                   前后端共同契约(SSOT, v1.1, 2026-08-11)
├── PROGRESS.md · TODO.md · CLAUDE.md
└── README.md
```

## 三、启动

### A · 仅前端(零依赖,默认 mock 引擎)

```bash
cd frontend
npm install
npm run dev          # → http://localhost:5173
```

主流程(澄清 → 策略确认 → 框架 → 内容 → 审核回路 → 终稿反馈 → 定稿)全在浏览器内模拟。`/chat` 路径在用户填了 `useAppStore` 里的 API key 后会自动直连 OpenAI-compatible LLM。

```bash
npm run build        # tsc -b && vite build
npm run preview      # 预览 dist/
npm run typecheck    # tsc -b --noEmit
```

### B · 前端 + 真后端

终端 1 — 启动后端(默认 mock,不调 LLM,任务图跑纯回退内容):

```bash
cd backend
go mod tidy
go run ./cmd/server
# → http://0.0.0.0:8001,启动日志显示
#   agents=6 nodes=10 templates=3 skills=5 tasks=2 (2 demo)
#   llm provider: unavailable   pubmed: unavailable (需 PUBMED_EMAIL)
```

启用真实 LLM,在 `backend/.env` 改(任意 OpenAI-compatible):

```bash
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```

终端 2 — 切换前端到真后端,创建 `frontend/.env.local`:

```
VITE_USE_MOCK=false
VITE_API_BASE=http://127.0.0.1:8001
```

```bash
cd frontend
npm run dev
```

`/tasks/:id/stream` 走 SSE(默认);SSE 失败回落 2s 轮询。`/api/tasks/:id/artifacts/*` 走 artifact store(版本化产物 + diff 端点)。详细见 `backend/README.md`。

## 四、默认行为(同时支持 mock 与真后端)

打开任意页面后:

1. **首页 `/workbench`**:系统健康度指标 + 2 个内置演示任务(一个等待策略确认、一个已完成)
2. **专家团 `/agents`**:6 个内置 Agent(需求理解、策略规划、框架搭建、内容填充、质量审核、通用助手)
3. **模板库 `/templates`**:3 个内置模板(幻灯 7 节点 / 文章 7 节点 / 完整 10 节点),点编辑进入完整编辑器
4. **任务运行 `/tasks`**:点「新建」→ 填 brief → 启动
   - 40% 概率触发澄清问题(3 道选择题)
   - 策略确认页展示 markdown 策略书 → 可确认 or 局部修改
   - 审核回路最多 2 轮 revise → 强制终稿
   - 终稿反馈:通过 → 定稿;退回 → 重新填充内容
5. **`/chat` 单助手**:主助手(`agent-main`)承接,支持挂载 0/1 个子专家;挂 team 模板时首条消息走 `POST /api/planner/compose` → 动态生成 TaskSpec,失败回落 `tpl-full`
6. **知识库 `/knowledge`**:3 个内置 KB(7 文档),顶部支持跨库 tokenize 检索
7. **设置 `/settings`**:多 provider 模型配置(DeepSeek / Claude / OpenAI / 通义 / 智谱 / 百度 / 典传院 / Custom),通过 `/api/settings/llm_prefs` 持久化到后端 SQLite

**数据持久化**:
- mock 模式:全部存内存,刷新重置
- 真后端模式:全部走 SQLite `data/app.db`,跨端口/重启保留
- 设置页的 API key 在 mock 模式存前端 store(浏览器本地);真后端模式由前端 store 推送到后端 settings 表

## 五、REST 契约(SSOT,完整版见 `API_CONTRACT.md`)

```
# 资源 CRUD
GET/POST      /api/{agents|nodes|templates|skills}
GET/PUT/DEL   /api/{agents|nodes|templates|skills}/:id

# 模板版本(2026-08-11 阶段 2.4)
GET           /api/templates/:id/versions
GET           /api/templates/:id/versions/:v

# 知识库
GET/POST      /api/kb                         GET/PUT/DEL /api/kb/:id
POST          /api/kb/:id/docs                 PUT/DEL /api/kb/:id/docs/:docId
POST          /api/kb/search                  { query, kb_ids }

# 任务(状态机)
GET           /api/tasks                      → TaskSummary[]
POST          /api/tasks                      { brief, task_type, title?, template_id?, spec? }
GET           /api/tasks/:id                  → TaskSnapshot
POST          /api/tasks/:id/resume           { answer }
POST          /api/tasks/:id/cancel
POST          /api/tasks/:id/spec             { spec }
GET           /api/tasks/:id/stream           (SSE: snapshot / token / phase / done)

# 任务产物(2026-08-11 阶段 4)
GET           /api/tasks/:id/artifacts
GET           /api/tasks/:id/artifacts/:key
GET           /api/tasks/:id/artifacts/:key/versions
GET           /api/tasks/:id/artifacts/:key/versions/:v
GET           /api/tasks/:id/artifacts/:key/diff?v1=X&v2=Y

# Planner(2026-08-11 阶段 3)
POST          /api/planner/compose            { brief, task_type?, template_hints?, ... } → { mode: 'dynamic'|'static', spec?, fallback_template_id? }

# Chat
POST          /api/chat/reply                 (SSE: start / chunk / done / finish / error)
GET/POST      /api/chat/sessions              CRUD + messages
POST/DEL      /api/chat/sessions/:id/messages

# Settings
GET/POST      /api/settings/llm               (实时 provider 状态)
GET/PUT       /api/settings/llm_prefs         (前端多 provider 配置 + active)
```

`TaskStatus = 'running' | 'waiting_human' | 'done' | 'failed' | 'cancelled'`
`PendingInterrupt.stage = 'ask_clarification' | 'confirm_strategy' | 'human_final'`
`NodeKind = 'compute' | 'interrupt' | 'counter' | 'router'`
`TaskType = '幻灯' | '文章'`
ID 前缀:`agent-*` / `node-*` / `tpl-*` / `task-*` / `skill-*` / `kb-*` / `doc-*`

## 六、文档索引

- [API_CONTRACT.md](./API_CONTRACT.md) — 完整 REST 契约(SSOT,v1.1,2026-08-11)
- [PROGRESS.md](./PROGRESS.md) — 决策日志 / 已完成事项 / 阶段 1-5 演进
- [TODO.md](./TODO.md) — 待办清单(已重排,只剩真实 gap)
- [CLAUDE.md](./CLAUDE.md) — 给 Claude Code 的 fullstack 指南
- [backend/README.md](./backend/README.md) — 后端启动 / LLM 接入 / PubMed / 端到端冒烟

## 七、和 `paradigm_langgraph` 的关系

同一个产品,两条后端路径:

| | paradigm_langgraph | paradigm_eino |
|---|---|---|
| 后端语言 | Python + LangGraph | Go + Eino v0.9(独立项目,`backend/`)|
| 前端 | static/index.html(vanilla JS) | 独立 Vite 工程(`frontend/`)|
| 契约 | 一致的 REST API(同一 `API_CONTRACT.md`)|
| 状态 | 3 Agent / 9 节点已跑通 | 6 Agent / 10 节点 / 3 模板 / 5 技能 / 3 KB + 完整编辑器 + Planner 动态构图 + Artifact Store + 真实 PubMed |

前端与后端强解耦,各自演进。前端切 baseURL 即可对接任一后端。
