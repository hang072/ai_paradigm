# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Frontend MVP of a multi-agent medical-content authoring workbench. Vite + React 18 + TypeScript + Ant Design 5 + `@xyflow/react`. The backend (CloudWeGo Eino, Go) is not yet implemented — the frontend ships a **built-in mock engine** that satisfies the full REST contract in-memory so the entire product flow (clarification → strategy confirmation → framework → content → review loop → human final → done) runs with zero backend.

Sister project `paradigm_langgraph` (Python + LangGraph) is the reference backend implementation; both share the same REST contract, and this frontend can point at either by flipping one env var.

## Repository layout

```
paradigm_eino/
├── frontend/           this frontend (Vite + React + TS + AntD + xyflow)
├── backend/            independent Eino Go backend — skeleton not yet created (see backend/README.md)
├── API_CONTRACT.md     shared REST contract, SSOT for both ends
├── PROGRESS.md         decision log, done/todo state, changelog
├── TODO.md             P0–P3 backlog
└── CLAUDE.md           this file — scoped to the frontend
```

**This document primarily describes the frontend.** The backend is an independent project that only shares `API_CONTRACT.md`; it has its own conventions and will get its own guidance file once the skeleton lands.

## Commands

All commands run from the `frontend/` directory:

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, uses mock adapter by default
npm run build        # tsc -b && vite build
npm run preview      # serve dist/
npm run typecheck    # tsc -b --noEmit
```

There is no test runner or linter configured. When verifying changes, run `npm run typecheck` and `npm run build` from `frontend/`.

To point at a real backend, create `frontend/.env.local`:

```
VITE_USE_MOCK=false
VITE_API_BASE=http://127.0.0.1:8001
```

## Architecture

### The mock backend IS the contract

`frontend/src/api/mock/index.ts` is the authoritative route list, and `frontend/src/api/mock/engine.ts` (~900 lines, single file) is the reference behavior. The real Eino backend under `backend/` must match both exactly; the frontend has no per-route branching between mock and real. When adding an API:

1. Add types in `frontend/src/types/*.ts`
2. Add typed client in `frontend/src/api/{resource}.ts` (uses shared `client` from `frontend/src/api/client.ts`)
3. Add engine function in `frontend/src/api/mock/engine.ts`
4. Register route in `frontend/src/api/mock/index.ts` (order matters — put specific subpaths like `/api/kb/search` and `/api/kb/:id/docs` **before** the generic `/api/kb/:id`)
5. Mirror in `API_CONTRACT.md` (at repo root)

The mock adapter is installed unconditionally in `frontend/src/main.tsx` via `installMockAdapter()`; it inspects `VITE_USE_MOCK` internally and either intercepts `/api/*` requests via a custom axios adapter (with an 80ms fake delay) or is a no-op that lets requests hit `VITE_API_BASE`.

`frontend/src/api/client.ts` — global axios instance. Its response interceptor unwraps backend errors: non-2xx responses with `{ detail: "..." }` are re-thrown as `Error(detail)`, so business code just does `try/catch e.message`.

### Task state machine

The core product flow is a state machine implemented in `frontend/src/api/mock/engine.ts`. Understanding it is prerequisite to touching anything under `frontend/src/pages/tasks`:

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

Statuses: `TaskStatus = 'running' | 'waiting_human' | 'done'`. Interrupt stages: `PendingInterrupt.stage = 'ask_clarification' | 'confirm_strategy' | 'human_final'`. Node kinds: `NodeKind = 'compute' | 'interrupt' | 'counter' | 'router'`. Task types: `TaskType = '幻灯' | '文章'`.

Task detail pages poll `GET /api/tasks/:id` every 2s via `useTasksStore.pollActiveTask` while the task is not `done`. If you replace polling with SSE/WS, that store is the single seam.

### Chat modes

`POST /api/chat/reply` (`frontend/src/api/chat.ts`) has two modes:
- `mode: 'single'` — one agent (`agent_id`), returns one `ChatReplyPart`.
- `mode: 'team'` — takes `team_template_id`, walks that `WorkflowTemplate`'s `nodes`, collects `kind==='compute' && agent_id!=null` in order (de-duplicated), and returns one part per agent. The frontend replaces the first part into the placeholder bubble and appends the rest.

"Expert team" is deliberately **a WorkflowTemplate**, not a separate concept — this was a semantic correction mid-project. Do not reintroduce a distinct "team" entity.

### Knowledge base retrieval

`POST /api/kb/search { query, kb_ids }` returns `KbSearchHit[]`. Empty `kb_ids` means search across all KBs. Scoring in the mock: tokenize (punct-split, plus 2–3-gram sliding window for CJK), then title ×3 / tag ×2 / content ×1; keep the best snippet per doc (±40 chars of context); top 6 by score. Each hit carries `url` (the source doc's real `KnowledgeDoc.url`) so citations can link back. The real backend can swap in embeddings but must keep this response shape.

**Data authenticity (citations must be real + clickable).** Only real sources may be cited — internal KB documents and real PubMed literature. `search_kb` is the internal-KB tool; `search_literature` / `verify_reference` are backed by **real PubMed** (NCBI E-utilities, `backend/internal/pubmed/`). `search_literature` runs esearch+efetch and returns real titles/authors/journal/year/DOI with clickable `https://pubmed.ncbi.nlm.nih.gov/PMID/` links; `verify_reference` reverse-looks-up by title/PMID/DOI. Both require `PUBMED_EMAIL` env (NCBI mandates a contact); when unset they return an honest "未启用" note and never fabricate PMIDs/journal cites. The **frontend mock engine cannot call PubMed** (browser, offline, resets on reload), so its `search_literature`/`verify_reference` traces stay honest placeholders pointing to the real backend. `search_kb` renders doc titles as markdown links (`[title](url)`). In the task flow, `enrich_content` retrieves a real source pool (via `retrieveCitationSources` → `kb.Search` **+ PubMed** `litSource.Search`, URL-only hits, deduped by URL), injects it into the enricher prompt as the sole citable pool, and persists `TaskSnapshot.citations` by matching source URLs that actually appear in the generated body (`citationsFromSources`) — so every citation is real and was actually used. PubMed failures in enrich are logged and ignored (KB sources still used) — they never fail the task. `MarkdownView` renders all links with `target="_blank"`; `TaskDetail` / `InterruptPanel` show a clickable 参考文献 list from `citations`. The enricher/reviewer agent prompts were realigned from the old JSON-envelope + fake-verify contract to markdown-link citations.

### Frontend layers

- `frontend/src/router/index.tsx` + `frontend/src/layout/AppShell.tsx` — 7 routes: `/workbench`, `/chat`, `/tasks`, `/tasks/:id`, `/agents`, `/knowledge`, `/templates`, `/settings`.
- `frontend/src/store/` — Zustand. `useChatStore` and `useAppStore` are **server-backed** (they call `/api/chat/sessions` and `/api/settings/llm_prefs` respectively, both persisted in the backend's SQLite `data/app.db`). `useTasksStore` is in-memory (task list is polled from the backend). This changed on 2026-07-23; previously `useChatStore` and `useAppStore` persisted to `localStorage`, which lost data whenever Vite dev server switched ports.
- Backend persistence: `backend/data/app.db` (SQLite, WAL mode, `modernc.org/sqlite` — no CGO). All entities, tasks, snapshots, checkpoints, chat sessions, and LLM prefs live here. Fixtures with `builtin: true` are UPSERT'd on every startup; demo tasks are only seeded when `task_snapshots` is empty. Path is overridable via `PARADIGM_DB_PATH`. See `backend/internal/store/sqlite/` for the implementation and `internal/store/sqlite/migrations.go` for schema.
- The frontend's mock adapter also mirrors the chat sessions + settings routes (in-memory only — mock resets on page reload, as before).
- `frontend/src/canvas/FlowCanvas.tsx` — shared `@xyflow/react` wrapper. `layout.ts` runs dagre LR auto-layout. Custom `AgentNode` renders 4 kinds with status pulse (`done` / `running` / `pending` / `failed`); `LabeledEdge` colors ports `pass` / `revise` / `redo`. `frontend/src/pages/templates` uses this canvas in read-only preview mode; a full editor (drag/connect/property panel) is not yet built.
- `frontend/src/types/` — TS types mirror backend dataclasses. Keep them aligned when the contract changes.
- `frontend/src/api/mock/fixtures/` — seed data: 6 agents, 10 nodes, 3 templates, 5 skills, 3 KBs (7 docs), 2 example tasks. `builtin: true` entities cannot be deleted; mutating them via PUT returns 400 from the engine. Backend fixtures live in `backend/internal/fixtures/`; on startup they UPSERT into SQLite (`entities` table), and the 2 demo tasks are only seeded when `task_snapshots` is empty.

### Settings & API keys

`/settings` stores DeepSeek / Claude API keys in `localStorage`. These are frontend-only — the real backend must read its own credentials from its own env; the frontend never forwards keys.

## Things to know before editing

- `frontend/src/api/mock/engine.ts` is intentionally one long file. Do not split it prematurely — it's the reference for the future Go port and being one file helps direct comparison.
- Route order in `frontend/src/api/mock/index.ts` is significant. Add subpath routes before their parent regex.
- Task state transitions live in the engine, not in the store or the page. New stages / new interrupt kinds must go through the engine's step machinery.
- ID prefixes are conventional: `agent-*`, `node-*`, `tpl-*`, `task-*`, `skill-*`, `kb-*`, `doc-*`. Backend should preserve these.
- `revision_count` caps at 2 revise cycles before force-interrupting to `human_final` — do not remove this guard, it prevents infinite review loops.
- Backend LLM steps (`backend/internal/engine/steps.go`) do **not** fall back to mock content on failure. Provider-unavailable / call error / timeout (`PARADIGM_LLM_TIMEOUT_SEC`, default 180s) / parse-validate failure all bubble an `error` from `applyXxxLLM` → task goes `failed` (`error_message` set). The pure-mock `applyXxx` functions are kept for tests only. `enrich_content` and `review_quality` stream token-by-token over SSE when a `TokenSink` is in ctx; compute nodes emit a `phase` event on entry so the frontend shows a spinner before output arrives.
- Timestamps are strings `YYYY-MM-DD HH:mm:ss` in local time (not ISO 8601). Match this format when adding fields.

## Reference docs

- `README.md` — user-facing tour of the product and stack.
- `API_CONTRACT.md` — full REST contract with type definitions; single source of truth for the Eino backend team.
- `PROGRESS.md` — decision log, done/todo state, recovery guide for future sessions. Update the changelog at the bottom when finishing a substantive change.
- `TODO.md` — P0–P3 actionable backlog.
