# Mock vs Real Backend · 操作手册

> 把 `paradigm_eino` 从「前端 mock」切到「真后端 (Eino Go + SQLite)」时,
> 需要知道的两边差异、已发现的 bug、跑通步骤。

## 1. 一句话总览

| | 前端 Mock | 真后端 |
|---|---|---|
| 触发 | `VITE_USE_MOCK=true` (默认) | `VITE_USE_MOCK=false` + `VITE_API_BASE=http://127.0.0.1:8001` |
| 代码 | `frontend/src/api/mock/engine.ts` (1258 行) | `backend/internal/api/*.go` + `engine/` + `store/sqlite/` |
| 路由 | `frontend/src/api/mock/index.ts` (269 行) | `backend/internal/api/router.go` |
| 持久化 | **内存**,刷新即丢(任务/会话/设置) | **SQLite** `backend/data/app.db` (WAL),重启保留 |
| 种子数据 | `frontend/src/api/mock/fixtures/*.ts` (常量) | `backend/internal/fixtures/*.go` (启动 UPSERT 到 entities 表) |
| PubMed | 占位,永远返回 `note: "未启用"` | `backend/internal/pubmed/` 真查 NCBI(需 `PUBMED_EMAIL`) |
| LLM | mock 引擎写死的字符串 | `backend/internal/llm/openai.go` 走 OpenAI-compatible(需 `LLM_API_KEY`) |

## 2. 跑通步骤(已 2026-08-04 验证)

### 2.1 启动后端

```bash
cd backend
[ -f .env ] || cp .env.example .env   # 第一次需要
go build -o server.exe ./cmd/server   # 或直接用现成的 server.exe
./server.exe
# 期望日志:listening on http://0.0.0.0:8001, agents=6 nodes=10 templates=3 skills=5 kbs=3 tasks=2
```

### 2.2 切前端

`frontend/.env.local`(已配好):

```
VITE_USE_MOCK=false
VITE_API_BASE=http://127.0.0.1:8001
```

```bash
cd frontend
npm run dev   # http://localhost:5173 (注意是 localhost,不是 127.0.0.1)
```

### 2.3 验证联通

打开 `http://localhost:5173/agents`,应该看到 6 个内置 agent。`/skills` 看到 5 个内置 skill。

新建一个 agent / skill → 重启后端 → 列表里仍在,说明持久化生效。

## 3. 关键差异表(业务侧必读)

### 3.1 内置项保护:后端更严

| 操作 | 前端 mock | 真后端 |
|---|---|---|
| PUT 内置 agent | 200 + 改坏 | **400 「内置 Agent 不可修改」** |
| DELETE 内置 agent | 200 + 删除 | **400 「内置 Agent 不可删除」** |
| PUT 内置 skill | 200 + 改坏(mock 无保护,见 engine.ts:597) | **400 「内置技能不可修改」** |
| DELETE 内置 skill | 200 + 删除 | **400 「内置技能不可删除」** |

前端 UI 已经按这个策略做了:agents 卡片对内置项灰显删除按钮(见 `pages/agents/index.tsx:142-156`)。Skills 页同款。

**实现位置:** `backend/internal/api/agents.go` 和 `skills.go` 的 PUT 处理器,第二个参数 `s.Update(id, true, ...)` 的 `lockBuiltin=true` 让 store 层真的拒绝。

### 3.2 持久化范围

| 资源 | 前端 mock | 真后端 |
|---|---|---|
| 任务快照 | 内存,刷新丢 | SQLite `task_snapshots` 表,重启保留 |
| 会话/消息 | 内存,刷新丢 | SQLite `chat_sessions` + `chat_messages` 表 |
| LLM 偏好 | 内存,刷新丢 | SQLite `settings` 表 |
| Agents / Skills / Templates / KB | 内存,刷新丢 | SQLite `entities` 单表(按 `kind` 字段区分) |

### 3.3 PubMed

| 场景 | 前端 mock | 真后端 |
|---|---|---|
| `search_literature` | 占位,返回 `note: "未启用"`,**不构造假 PMID** | 真查 NCBI E-utilities,需 `PUBMED_EMAIL`(NCBI 强制要求联系邮箱) |
| `verify_reference` | 同上占位 | 真反查 PMID/DOI/标题 |
| `PUBMED_EMAIL` 未配 | — | 启动日志 `pubmed: available=false`,运行期 enrich 阶段会跳过 PubMed 但不报错 |
| 任务 enrich 阶段 | mock 引用是 fixtures 里的假数据 | 真实 KB 文档 + 真实 PubMed 文献,`TaskSnapshot.citations` 按 URL 匹配回填 |

### 3.4 路由顺序

前端 mock 的 `frontend/src/api/mock/index.ts` 第 1~270 行,顺序敏感 — `/api/kb/search` 和 `/api/kb/:id/docs` 必须在 `/api/kb/:id` 之前注册。

后端用 chi 路由,具体路径用 `{id}` 占位,不存在顺序问题。**但要保证 frontend 端点名称和后端 handler 一致**(见 `API_CONTRACT.md`)。

## 4. 已知问题 & 修复历史

### 4.1 [2026-08-04 已修] 内置项 lockBuiltin 失效

**症状:** PUT `/api/agents/agent-clarifier` 改内置项 → 后端 200 → name 被改坏

**根因:** `backend/internal/api/agents.go:47` 和 `skills.go:47` 早期传的 `lockBuiltin=false`,等于是"前端 mock 不保护,后端也不保护",**前后矛盾**(返回的错误信息又是「内置不可修改」)。

**修复:** 两个 handler 的 PUT 改为 `s.Update(id, true, ...)`,SQLite store 的 `lockBuiltin` 检查(line 142)真的生效。

**复测命令:**

```bash
curl -sS -X PUT http://127.0.0.1:8001/api/agents/agent-clarifier \
  -H "Content-Type: application/json" \
  -d '{"id":"agent-clarifier","name":"hijack",...}' \
  -w "\nHTTP %{http_code}\n"
# 期望: HTTP 400,  {"detail":"内置 Agent 不可修改"}
```

### 4.2 [2026-08-04 已知] `builtin` JSON 字段序列化为 1/0

Go 的 `bool` 在 encoding/json 默认序列化是 `true/false`,但本仓库的 `domain.AgentDef.Builtin` 看起来是 `bool`(实测 schema 列是 `INTEGER`)。**当前 list 接口里 `builtin` 字段是 `true/false`,前端用真值判断没问题**(实测已通过)。如果未来在迁移到其他序列化方式,留意这点。

### 4.3 [2026-08-04 已知] Vite 不代理 `/api`

`vite.config.ts` 里的 `server.proxy` 只配了 `/zh/api`(LLM 文档站),**没配 `/api` 转发到后端 8001**。

**影响:** 直接 `curl http://localhost:5173/api/agents` 会拿到 `index.html`(Vite history fallback)。但 **前端 axios 走 `VITE_API_BASE=http://127.0.0.1:8001` 直连后端,不经过 Vite**,所以浏览器侧没问题。

**但如果哪天有外部脚本或 e2e 测试从 vite 端口拉数据,要么改 vite.config.ts 加 proxy,要么直接打 8001。**

### 4.4 [2026-08-04 已知] CORS 全开

`backend/internal/api/router.go:43-50` 配的是 `AllowedOrigins: ["*"]` + `AllowCredentials: false`,联调方便。**生产部署前需要收窄到具体 origin**(改 chi cors 配置即可)。

### 4.5 [2026-08-04 已知] LLM 不配 = 任务跑不动

`backend/.env` 里 `LLM_API_KEY` 留空时,启动日志会打 `llm provider: unavailable (available=false)`,**任务流到 enrich / review 阶段会 failed**(`engine/steps.go` 的 `applyXxxLLM` 在 provider 不可用时返回 error,task 进 `failed` 状态)。

**当前 demo 演示状态:** fixtures seed 的 2 个 demo task 是「已完成」的,展示界面没事;**新发起的任务会失败**直到配上 LLM。

最小配置(以 DeepSeek 为例):
```env
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```

## 5. 数据复位

清掉 SQLite 重启,fixtures 会重新 UPSERT(覆盖内置项,自定义项保留):

```bash
cd backend
rm -f data/app.db data/app.db-shm data/app.db-wal
./server.exe
```

完全重置(连 demo tasks 都不 seed):编辑 `backend/cmd/server/main.go` 看 fixtures seed 逻辑,默认 `task_snapshots` 为空时才会 seed 2 个 demo tasks,所以删 db 后会自动 seed。

## 6. 改 API 时的 checklist

1. **改 `API_CONTRACT.md`**(SSOT)— 字段、路径、方法都先在 contract 里定
2. **改 frontend 类型** `frontend/src/types/*.ts` — 保持双向对齐
3. **改 frontend API client** `frontend/src/api/*.ts` — axios 调用
4. **改 mock engine** `frontend/src/api/mock/engine.ts` — 让 mock 仍能跑
5. **改后端 handler** `backend/internal/api/*.go` — 真实现
6. **改后端 store** `backend/internal/store/sqlite/entities.go` — 字段持久化
7. **必要时改 schema** — 加新字段在 `backend/internal/store/sqlite/migrations.go` 里写新 migration
8. **两边跑**:`curl -sS http://127.0.0.1:8001/api/xxx` + 浏览器开 `localhost:5173/xxx` 双确认

## 7. 调试 cheat sheet

```bash
# 后端日志
tail -f backend/logs/paradigm-eino-$(date +%Y-%m-%d).log

# 后端 LLM 是否就绪
curl -sS http://127.0.0.1:8001/health

# 后端 pubmed 是否就绪
# 看启动日志那行 "pubmed: available=..."

# 前端连到哪个后端
# 浏览器 devtools network 面板查 XHR 的 Host 列,应该是 127.0.0.1:8001

# SQLite 直接查
cd backend && sqlite3 data/app.db "SELECT kind, id, builtin FROM entities WHERE kind IN ('agent','skill') ORDER BY kind, builtin DESC, id;"
```
