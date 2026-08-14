# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Fullstack multi-agent medical-content authoring workbench.

- **Frontend** — Vite + React 18 + TypeScript + Ant Design 5 + `@xyflow/react` 12 + Zustand 5. Ships a **built-in mock engine** (`frontend/src/api/mock/engine.ts`, ~900 lines) that satisfies the full REST contract in-memory, so the entire product flow (clarification → strategy confirmation → framework → content → review loop → human final → done) runs with **zero backend** by default. The mock also covers CRUD for agents/nodes/templates/skills/kbs, chat sessions, and LLM prefs.
- **Backend** — Go 1.22+ + CloudWeGo Eino v0.9.12 (compose.Graph + HITL + ADK) + go-chi/chi v5 + SQLite (`modernc.org/sqlite`, no CGO, WAL mode). Lives in `backend/` as an independent project. Implements the same contract with real LLM (OpenAI-compatible: DeepSeek / Kimi / Qwen / OpenAI / Ollama) and real PubMed (NCBI E-utilities). 60+ REST endpoints under `/api`; SSE on `POST /api/chat/reply` and `GET /api/tasks/:id/stream`; artifact store + template versioning + dynamic Planner.
- **Contract** — `API_CONTRACT.md` is the SSOT (v1.1, 2026-08-11); both ends are kept aligned.

Sister project `paradigm_langgraph` (Python + LangGraph) is an alternative backend implementation against the same contract; the frontend can point at either by flipping one env var.

## Repository layout

```
paradigm_eino/
├── frontend/                Vite + React + TS + AntD + xyflow (independent)
├── backend/                 Eino Go backend (independent, own README)
├── API_CONTRACT.md          shared REST contract, SSOT (v1.1, 2026-08-11)
├── PROGRESS.md              decision log, done/todo state, changelog
├── TODO.md                  P0–P4 backlog (P0 collapsed: backend delivered)
└── CLAUDE.md                this file — fullstack guide
```

This document covers both frontend and backend. For backend internals (engine wiring, SQLite migrations, planner logic, PubMed client), see `backend/README.md` and the package docstrings (`backend/internal/...`).

## Commands

### Frontend (`frontend/`)

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, mock by default
npm run build        # tsc -b && vite build
npm run preview      # serve dist/
npm run typecheck    # tsc -b --noEmit
```

No test runner or linter configured. Verify with `npm run typecheck` + `npm run build`.

To point at the real backend, create `frontend/.env.local`:

```
VITE_USE_MOCK=false
VITE_API_BASE=http://127.0.0.1:8001
```

### Backend (`backend/`)

```bash
cd backend
go mod tidy
go run ./cmd/server
# → http://0.0.0.0:8001
# 启动日志: agents=6 nodes=10 templates=3 skills=5 tasks=2 (2 demo)
#            llm provider: openai(deepseek-chat) (available=true|false)
#            pubmed: available=... (需 PUBMED_EMAIL)
```

LLM credentials live in `backend/.env` (or exported env vars); the frontend never forwards keys.

```bash
# DeepSeek
LLM_API_KEY=sk-... LLM_BASE_URL=https://api.deepseek.com/v1 LLM_MODEL=deepseek-chat
# Kimi
LLM_BASE_URL=https://api.moonshot.cn/v1 LLM_MODEL=moonshot-v1-8k
# 通义千问
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 LLM_MODEL=qwen-plus
# OpenAI (no BASE_URL)
LLM_MODEL=gpt-4o-mini
```

DB path override: `PARADIGM_DB_PATH=/path/to/app.db` (default `backend/data/app.db`). LLM timeout: `PARADIGM_LLM_TIMEOUT_SEC=180`.

### Verification matrix

```bash
# Frontend
cd frontend && npm run typecheck && npm run build

# Backend
cd backend && go build ./... && go vet ./... && go test ./...
# Includes backend/internal/engine/artifact_e2e_test.go (6 cases for the artifact store)
```

## Architecture

### Frontend

**Mock engine is the contract.** `frontend/src/api/mock/index.ts` is the authoritative route list, and `frontend/src/api/mock/engine.ts` is the reference behavior. The real backend matches the core and extends it (planner, artifacts, template versions, SSE, PubMed). The frontend has no per-route branching — it talks to whichever `VITE_API_BASE` points at. Some newer fields (e.g. `artifacts`, `versions`, `persona`, `methodology`, `parameter_schema`) are silently absent on the mock; the UI must render them as optional.

When adding an API:

1. Add types in `frontend/src/types/*.ts`
2. Add typed client in `frontend/src/api/{resource}.ts` (uses shared `client` from `frontend/src/api/client.ts`)
3. Add engine function in `frontend/src/api/mock/engine.ts`
4. Register route in `frontend/src/api/mock/index.ts` (order matters — put specific subpaths like `/api/kb/search` and `/api/kb/:id/docs` **before** the generic `/api/kb/:id`)
5. Mirror in `API_CONTRACT.md`

The mock adapter is installed unconditionally in `frontend/src/main.tsx` via `installMockAdapter()`; it inspects `VITE_USE_MOCK` internally. If unset / != `'false'`, it intercepts `/api/*` via a custom axios adapter (80ms fake delay); otherwise axios uses the default adapter and hits `VITE_API_BASE`.

`frontend/src/api/client.ts` is the global axios instance. Its response interceptor unwraps backend errors: non-2xx responses with `{ detail: "..." }` are re-thrown as `Error(detail)`.

**Routes** (12 + redirect): `/` → `/workbench`; `/workbench` `/chat` `/agents` `/tasks` `/tasks/:taskId` `/knowledge` `/skills` `/templates` `/templates/new` `/templates/:id/edit` `/settings`. See `frontend/src/router/index.tsx`.

**State** — Zustand. All three stores are server-backed (no `persist` middleware):
- `useAppStore` (multi-provider LLM config) → `SettingsApi` (`/api/settings/llm_prefs`).
- `useChatStore` (sessions + messages) → `ChatSessionsApi` (`/api/chat/sessions*`).
- `useTasksStore` (in-memory list + 2s polling). The `/tasks/:id` page polls `GET /api/tasks/:id` every 2s; the **chat page** uses SSE instead — see `pages/chat/index.tsx:688-762`.

**Canvas** — `frontend/src/canvas/FlowCanvas.tsx` (read-only, used by `/tasks/:id` + `/templates` preview) and `frontend/src/canvas/EditableCanvas.tsx` (full editor, used by `/templates/:id/edit`). `layout.ts` runs dagre LR auto-layout. `AgentNode` renders 4 kinds (`compute` / `interrupt` / `counter` / `router`) with status pulse (`done` / `current` / `pending` / `skipped` / `failed`). `LabeledEdge` colors ports `pass` / `revise` / `redo` / `next` / `confirm` / `adjust` / `end`.

**Template editor** (`pages/templates/edit.tsx`, ~1100 lines) — 3-pane (NodeDef palette / EditableCanvas / property panel). `NodeConfigTable` provides friendly UI for the 6 `NodeDefConfigConventions` keys (`system_prompt_template` / `input_keys` / `output_keys` / `retrieve_kb` / `retrieve_pubmed` / `cite_rule`); extras are free-form JSON. `ParameterSchemaTable` for the template-level `parameter_schema` (string / number / enum / boolean). Live DAG validation via `validateTemplate.ts` (entry check, edge endpoints, reachability BFS, cycle DFS with `allow_cycle` opt-in). Builtin templates are forked on entry to avoid PUT 400. After save the response shows the new `current_version` and updated `versions[]`.

**Node drawer** (`pages/tasks/NodeDetailDrawer.tsx`) — 720px right Drawer. Shows base info + run state + per-field renderers (`strategy_doc` / `enriched_framework` / `final_output` → `MarkdownView`; `review_report` → `ReviewReportView`; `citations` → clickable list; `parsed_info` / `framework_skeleton` / `completeness` → JSON pre; `narrative_mode` / `revision_count` → Tag). The `ArtifactPanel` collapsible section shows all `task.artifacts` keys + version list + arbitrary `v1` vs `v2` unified diff (from `ArtifactsApi.diff`).

### Task state machine

The core product flow is a state machine implemented identically in `frontend/src/api/mock/engine.ts` and in the backend as two parallel Eino graphs (`backend/internal/engine/graph.go` for the hardcoded 10-node static graph; `backend/internal/engine/graph_dynamic.go` for spec-driven dynamic graphs).

```
POST /api/tasks                     → running, parse_brief
                                    → 40% chance: interrupt(ask_clarification)
                                    → else: plan_strategy → interrupt(confirm_strategy)

POST /api/tasks/:id/resume  #1 (clarification answers)
                                    → plan_strategy → interrupt(confirm_strategy)

POST /api/tasks/:id/resume  #2 (strategy confirmation)
    answer contains "调整/修改"    → back to plan_strategy → interrupt again
    else                            → build_framework → enrich_content → review_quality
                                        verdict=pass                → interrupt(human_final)
                                        verdict=revise & revs<2     → revision++ → back to enrich_content
                                        verdict=revise & revs≥2     → force interrupt(human_final)

POST /api/tasks/:id/resume  #3 (final feedback)
    answer contains "退回/修改"    → revision++ → back to enrich_content
    else                            → finalize → done
```

Statuses: `TaskStatus = 'running' | 'waiting_human' | 'done' | 'failed' | 'cancelled'`. Interrupt stages: `PendingInterrupt.stage = 'ask_clarification' | 'confirm_strategy' | 'human_final'`. Node kinds: `NodeKind = 'compute' | 'interrupt' | 'counter' | 'router'`. Task types: `TaskType = '幻灯' | '文章'`. Built-in static graph has 10 nodes + 4 branch nodes.

SSE on `GET /api/tasks/:id/stream` (events `snapshot` / `token` / `phase` / `done`) is implemented in `backend/internal/api/tasks.go` and consumed in `frontend/src/pages/chat/index.tsx:688-762` (team-mode task path). `/tasks/:id` detail page still polls at 2s via `useTasksStore.pollActiveTask` — that's the single seam to convert to EventSource (TODO.md P2).

### Chat modes

`POST /api/chat/reply` (`frontend/src/api/chat.ts` + `backend/internal/api/chat.go`):
- **Main assistant single-segment return** — one agent (`agent-main`, system constant, not in entities), returns 1 `ChatReplyPart`. Sub-expert invocations appear in `tool_calls` as collapsed `Main Assistant → 委托 {agentName}` blocks.
- **Expert = agent** — `attached_expert.kind === 'agent'`: main assistant calls it as `invoke_expert` tool.
- **Team = task path** — `attached_expert.kind === 'team'`: first message → `POST /api/planner/compose`; `mode='dynamic'` → `TasksApi.start({ spec })`, `mode='static'` → `TasksApi.start({ template_id: fallback_template_id })`. Subsequent messages → `POST /api/tasks/:id/resume`.

Legacy `mode: 'team'` protocol (frontend no longer uses) is preserved at `backend/internal/api/chat.go` for third-party clients — logs a warning suggesting `/api/tasks`.

SSE on `POST /api/chat/reply` (events `start` / `chunk` / `done` / `finish` / `error`) when client sends `Accept: text/event-stream`. The mock engine's `/api/chat/reply` route checks `useAppStore.getState().activeConfig.apiKey`: if set, calls `callDirectChatReply` (browser→OpenAI-compatible fetch) and overlays the real LLM content; otherwise full mock.

### Planner / dynamic graph

`POST /api/planner/compose` (`backend/internal/planner/planner.go`) takes `{ brief, task_type?, template_hints?, available_agent_ids?, available_node_ids? }` and returns:

```ts
{ mode: 'dynamic' | 'static', spec?: TaskSpec, fallback_template_id?: string, reason?: string, latency_ms: number }
```

`dynamic` mode: LLM generates a `TaskSpec` (entry + 2-12 nodes + edges); backend `BuildGraphFromSpec` (in `engine/graph_dynamic.go`) compiles it into a `compose.Graph` with the same checkpoint store. `static` mode: `fallback_template_id='tpl-full'` (Planner wasn't able / safe to compose). 5-min LRU cache by `sha256(brief|task_type|hints|agentIDs|nodeIDs)[:16]`. The frontend's mock engine always returns `mode='static'` (no LLM in browser).

The 5 compute kinds (`parse_brief` / `plan_strategy` / `build_framework` / `enrich_content` / `review_quality`) are registered in `engine/registry.go` (`NodeKindSpec` with `MessageRenderer` + `OutputValidator` + `SideEffect`); 4 interrupt / counter / finalize kinds are hardcoded switch cases in `graph_dynamic.go`. `generic_step.go` is the unified executor for the 5 compute kinds.

### Artifact store

`backend/internal/store/sqlite/task_artifacts.go` persists every step output to a `task_artifacts(task_id, key, version, content, content_type, produced_by, produced_by_agent, created_at, metadata_json)` table (composite PK `(task_id, key, version)`, indexes `(task_id, created_at DESC)` + `(task_id, key, version DESC)`). `engine/artifact_writer.go` is the write seam called from inside each `applyXxxLLM`. Old versions are immutable. `TaskSnapshot.Artifacts` is just an index map (`{ key: ArtifactKeyRef{key, current_version, total_versions, latest_url} }`); full content lives in the table. 5 HTTP routes + 1 diff endpoint expose them.

Artifact keys used: `parsed_info` / `strategy_doc` / `framework_skeleton` / `enriched_framework` / `citations` / `review_report` / `final_output`. Diff is a hand-rolled LCS unified diff (no hunk header) in `api/tasks.go:simpleUnifiedDiff` (and a test mirror in `engine/artifact_e2e_test.go:simpleDiffForTest`).

### Knowledge base retrieval

`POST /api/kb/search { query, kb_ids }` returns `KbSearchHit[]`. Empty `kb_ids` = search across all KBs. Tokenize in `backend/internal/kb/search.go`: split by non-word (ASCII + CJK punctuation), keep segments ≥ 2 runes, add 2-rune sliding windows for CJK, cap 8 tokens. Score: title ×3 / tag ×2 / content ×1; best snippet per doc (±40 chars); top 6. Each hit carries `url` (the source doc's real `KnowledgeDoc.url`).

**Data authenticity (citations must be real + clickable).** `search_kb` is the internal-KB tool; `search_literature` / `verify_reference` are backed by **real PubMed** (NCBI E-utilities, `backend/internal/pubmed/`). `search_literature` runs esearch+efetch and returns real titles/authors/journal/year/DOI with clickable `https://pubmed.ncbi.nlm.nih.gov/PMID/` links; `verify_reference` reverse-looks-up by title/PMID/DOI. Both require `PUBMED_EMAIL` env (NCBI mandates a contact); when unset they return an honest "未启用" note and never fabricate PMIDs/journal cites. The **frontend mock engine cannot call PubMed** (browser, offline, resets on reload), so its `search_literature`/`verify_reference` traces stay honest placeholders pointing to the real backend. `search_kb` renders doc titles as markdown links (`[title](url)`). In the task flow, `enrich_content` retrieves a real source pool (via `retrieveCitationSources` → `kb.Search` **+ PubMed** `litSource.Search`, URL-only hits, deduped by URL), injects it into the enricher prompt as the sole citable pool, and persists `TaskSnapshot.citations` by matching source URLs that actually appear in the generated body (`citationsFromSources`). PubMed failures in enrich are logged and ignored (KB sources still used) — they never fail the task. `MarkdownView` renders all links with `target="_blank"`; `TaskDetail` / `InterruptPanel` show a clickable 参考文献 list from `citations`.

### Backend architecture (Go)

- **`cmd/server/main.go`** — entry: loads `.env` (via `llm.LoadDotEnv`), opens SQLite (`modernc.org/sqlite`, auto-migrate), wires stores, seeds fixtures, builds Eino static + dynamic graphs, creates `ConfigManager` for LLM, `pubmed.Client`, `planner.Planner`, chi router, starts `http.ListenAndServe` on `$PORT` (default 8001). Logs to `logs/paradigm-eino-YYYY-MM-DD.log` and stderr.
- **`internal/domain/`** — Go structs with JSON tags aligned to `frontend/src/types/*.ts`. Includes `Normalize()` helpers that fill defaults and replace `nil` slices/maps with empty values for stable JSON output.
- **`internal/store/`** — `store.Memory[T]` for tests; `sqlite.Entities[T]` is the actual shared KV store for 5 domain types (agent/node/template/skill/kb), keyed by `(kind, id)`. Fixtures UPSERT on every startup; `builtin=true` rows are read-only (PUT 400, DELETE 400). Chat + settings are on their own tables; tasks use `task_snapshots` (JSON blob keyed by `thread_id`); Eino checkpoints on `task_checkpoints` (BLOB). New tables: `template_versions` (migration v4) and `task_artifacts` (migration v5). 5 migrations tracked in `schema_migrations`.
- **`internal/engine/`** — `executor.go` owns the goroutine that drives `graph.Invoke`, handles `compose.ExtractInterruptInfo` → keep `waiting_human` + store `InterruptID`, handles `context.Canceled` → `cancelled`, otherwise `failed`. `steps.go` has both mock `applyXxx` (legacy, tests only) and LLM `applyXxxLLM` (active path). `enrichContentStream` / `reviewQualityStream` write to a `TokenSink` in ctx. `validate.go` wraps every LLM call with `runWithValidation` (max 2 attempts, error-injection recovery). `prompts.go` builds per-node messages and parses JSON / sentinel-line outputs.
- **`internal/api/`** — `router.go` mounts everything under `/api` in this order: agents → nodes → templates → skills → knowledge → chat → planner → chat_sessions → settings → tasks. CORS `*`. Custom `NotFound` / `MethodNotAllowed` return JSON `{detail}`.
- **`internal/llm/`** — `Provider` interface (`Complete/Stream/Available/Name`). `OpenaiProvider` wraps `eino-ext/components/model/openai.ChatModel`. `FromEnv` returns `Unavailable{}` when `LLM_API_KEY` is empty. `ConfigManager` holds the live config and is updated by `POST /api/settings/llm` or persisted `llm_prefs` on boot.
- **`internal/planner/`** — `Planner.Compose` with 5-min LRU cache; LLM-generated `TaskSpec` validated against builtin node ids; rejection on parse fail / non-2-12 nodes / unknown edges / etc.
- **`internal/pubmed/`** — `Client` with ESearch+EFetch XML parsing; 3 req/s without API key, 10 req/s with; retries on 429 / transient errors. `HitSource` adapter implements the engine's `litSource` interface (returns nil when unavailable). `client_test.go` parses a captured real PubMed EFetch response (PMID 37622657, 2023 ESC Guidelines).
- **`internal/kb/search.go`** — keyword scoring (top 6, title×3/tag×2/content×1, ±40 char snippet, CJK 2-gram windows).

### Settings & API keys

`/settings` lets users add multiple LLM provider configurations (8 built-in: deepseek / claude / openai / tongyi / zhipu / baidu / dianciyuann / custom). The active config is persisted to the backend's `settings` KV via `PUT /api/settings/llm_prefs`; on every mutation `useAppStore` also `POST /api/settings/llm` to push the live state. The real backend reads its own credentials from its own env — the frontend never forwards keys to `/api/chat/*`. The `apiKey` field in `useAppStore` is for **direct browser→LLM calls in mock mode** only (`/api/chat/reply` route in `api/mock/index.ts` checks it and routes to `callDirectChatReply`); in real-backend mode, the backend uses its own env. Note: `pages/settings/index.tsx:202` still has stale "存 localStorage" copy — see TODO.md known-gaps.

## Things to know before editing

- `frontend/src/api/mock/engine.ts` is intentionally one long file. Do not split it prematurely — it's the reference for direct comparison with `backend/internal/engine/`.
- Route order in `frontend/src/api/mock/index.ts` is significant (also in `backend/internal/api/router.go`). Add subpath routes before their parent regex.
- Task state transitions live in the engine, not in the store or the page. New stages / new interrupt kinds must go through the engine's step machinery.
- ID prefixes are conventional: `agent-*`, `node-*`, `tpl-*`, `task-*`, `skill-*`, `kb-*`, `doc-*`. Backend preserves these.
- `revision_count` caps at 2 revise cycles before force-interrupting to `human_final` — do not remove this guard, it prevents infinite review loops.
- **`ReviewReport.target_node` 智能路由**(阶段 6 workbuddy 借鉴):白名单 `{plan_strategy / build_framework / enrich_content / human_final}`,空 = 默认 `enrich_content`,非法值降级不报错。`target_node` 不影响 `verdict`;`verdict=pass` 时 `target_node` 可省略。静态图 (`graph.go reviewBranch`) 与动态图 (`graph_dynamic.go AddBranch`) 都按 `target_node` 路由;Planner system prompt 同步要求 spec 含 review_quality 时 4 个下游 kind 必须全在。
- Backend LLM steps (`backend/internal/engine/steps.go`) do **not** fall back to mock content on failure. Provider-unavailable / call error / timeout (`PARADIGM_LLM_TIMEOUT_SEC`, default 180s) / parse-validate failure all bubble an `error` from `applyXxxLLM` → task goes `failed` (`error_message` set). The pure-mock `applyXxx` functions are kept for tests only. `enrich_content` and `review_quality` stream token-by-token over SSE when a `TokenSink` is in ctx; compute nodes emit a `phase` event on entry so the frontend shows a spinner before output arrives.
- `engine.PendingStage` is a Go enum with exactly 3 values: `ask_clarification` / `confirm_strategy` / `human_final`. The frontend types it as `string` (comment-only) — both ends agree on these three literals.
- Chat `attached_expert` shape: `{ kind: 'agent' | 'team', id: string }` — single field replaces the legacy `mode` / `agent_id` / `team_template_id` triple (2026-07-23 migration). The mock engine also accepts the legacy triple for back-compat.
- `backend/internal/engine/generic_step.go` is the unified path for the 5 compute kinds. To add a new compute kind: register it in `registry.go` with `MessageRenderer` + `OutputValidator` + optional `SideEffect`, then reference its NodeDef id in templates / spec.
- **`AgentDef.display_name` / `avatar` 拟人化**(阶段 6 workbuddy 借鉴):`display_name` 中文花名(许清楚 / 齐活林 / ...),`avatar` 单 codepoint emoji。两字段 `omitempty`,旧数据反序列化零影响;后端 `Normalize()` 把 avatar 截断为 1 codepoint(避免 zWJ emoji 序列)。前端 `AgentAvatar` 组件统一渲染,fallback `display_name ?? name`。**chat 路径不存**新字段,前端 bubble 渲染时通过 `getAgent` 实时拉取(避免 migration v6)。
- Built-in templates have `Builtin: true` and are locked: PUT returns 400. To edit a builtin, the frontend editor (`pages/templates/edit.tsx`) automatically forks (copy with new id) on entry.
- Templates version on every PUT (migration v4); the response carries `current_version` and `versions[]`. Old versions stay in `template_versions(template_id, version, data, created_at)`.
- Tasks version their 7 artifact keys on every write (migration v5); `task_artifacts(task_id, key, version, content, ...)`. `total_versions` from `ListKeys` is the only true total — `artifact_writer.go` notes this in a comment.
- PubMed is opt-in: `PUBMED_EMAIL` is the only required env. `PUBMED_API_KEY` raises the rate limit from 3 to 10 req/s. Without `PUBMED_EMAIL`, `search_literature` / `verify_reference` return honest "未启用" notes and `retrieveCitationSources` skips the lit branch silently.
- Timestamps are strings `YYYY-MM-DD HH:mm:ss` in local time (not ISO 8601). Match this format when adding fields.
- Frontend legacy localStorage keys (`paradigm-eino-chat`, `paradigm-eino-app`, `paradigm.chat.v1`) are removed on first run by `main.tsx:cleanupLegacyLocalStorage` and `useChatStore.loadAll`. Don't reintroduce them.
- **Backend persistence**: all entities, tasks, snapshots, chat sessions, LLM prefs live in `backend/data/app.db` (SQLite, WAL, `modernc.org/sqlite` — no CGO). Fixtures UPSERT on startup; demo tasks only seed when `task_snapshots` is empty. DB path overridable via `PARADIGM_DB_PATH`. See `backend/internal/store/sqlite/migrations.go` for the 5-migration history (init → chat_attached_expert → chat_active_task_id → template_versions → task_artifacts).
- **P84 单 doc 操作**: `POST /api/kb/{id}/docs/{docId}/reembed`(单 doc 重灌,先清 Milvus 旧 chunks 再入队)和 `DELETE /api/kb/{id}/docs/{docId}`(级联清 Milvus + BLOB + sidecar + 从 KB 摘除)是两个新端点。 UI 在 KB 列表每篇 doc 行内给 `ThunderboltOutlined`(失败变红) + `Popconfirm` 删除。 SSE `parsing/ready/failed` 事件在 `openEmbedStatusStream` 监听。 `JobQueue.worker` 主循环带 `defer recover()` — goldmark `Segment.Value` 偶发 panic(短 markdown 切片越界)不会拖死整服务,转 `EmbedFailed` 事件继续。
- **P85 PDF 抽图(已被 P91 替代)**: `internal/kbimages` 包用 `pdfcpu` (v0.10.1) 抽 embedded images, 写盘到 `data/kb_images/{kb}/{doc}/image_NNN.{ext}`, sidecar `kb_doc_structure.images_json` (migration v9) 存元数据。 `GET /api/kb/{id}/docs/{docId}/images/{name}` 校验 sidecar 列出的 filename 才返二进制(防 path traversal)。 worker 在 VLM 解析后跑, 失败 / 0 图不阻断主流程。 **已知限制**:pdfcpu 对医学 PDF 常见 CMYK / Indexed / ICCBased colorspace flate-lzw 图像无法 render, 抽出率为 0; DCTDecode (vector PDF + 嵌入 JPEG) 通常能抽。 后续要扩, 需换 lib。**P91 收口**:pdfcpu 依赖已删, 旧 `internal/kbimages` 包删了, 工具函数迁到 `internal/embedding/kbimages.go`, 抽图改走 PyMuPDF Python sidecar(见下条)。
- **P91 PDF 解析统一走 PyMuPDF sidecar**: 替代 P85 的 pdfcpu + Qwen-VL 双路径。 `backend/sidecars/pymupdf-extract/` 起 FastAPI, `POST /extract` 接 `{blob_b64}` 返 `{markdown, raw_json, pages_n, images[], tables_count, elapsed_ms}`; `GET /health` 健康检查。 Go 客户端 `internal/embedding/pymupdf.go` 走 `net/http` + 1 次 transient 重试(照抄 vision.go 模式), 启动时 ping `/health`, 失败 → fatal(全替决策不静默降级)。 parser 切到 `internal/parser/pymupdf_parser.go`, `main.go` 调 `parser.SetPymupdfClient` 注入。 落盘走 `embedding.PersistImages(kbID, docID, []ImageBlob, maxBytes)`, JSON 形状跟 P85 `ExtractedImage` 完全一致, 前端 `DocStructureImage` / `imagesJSONContains` 零改动兼容。 抽图率 100% (41/41 PoC), 1-2.5s/PDF(vs VLM 30-60s)。 docker-compose 加 `pymupdf-sidecar` 服务(本地 build + 8002), 加可选 `backend` service(`--profile backend up`); 镜像 `backend/Dockerfile` multi-stage golang → alpine 非 root。 **已知限制**:扫描件无文本层返近空 markdown, **不 fallback VLM**; sidecar 不可用时 `go run ./cmd/server` 启动失败, 需先启 sidecar。

## Reference docs

- `README.md` — user-facing tour of the product and stack (fullstack, both modes).
- `API_CONTRACT.md` — full REST contract with type definitions; SSOT for both ends (v1.1, 2026-08-11).
- `PROGRESS.md` — decision log, done/todo state, recovery guide. Update the changelog at the bottom when finishing a substantive change.
- `TODO.md` — P0–P4 actionable backlog (only remaining gaps after the 2026-08-11 refresh).
- `backend/README.md` — backend-specific quickstart, LLM env (`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` / `LLM_TEMPERATURE` / `PARADIGM_LLM_TIMEOUT_SEC`), PubMed env (`PUBMED_EMAIL` / `PUBMED_API_KEY`), smoke test.
