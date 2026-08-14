# TODO 清单

> 与 [PROGRESS.md](./PROGRESS.md) 配套的可执行待办。
> 每一项都可以直接开工,无需再决策。
>
> **2026-08-11 收口说明**:S1–S4 + 阶段 1-5 全交付,后端 + 编辑器 + Planner + Artifact Store + 真 PubMed 已上线。剩余的待办都是真实 gap,不再包含已交付项。

---

## ✅ P0 · 后端 Eino Go 骨架(已交付 · 2026-08-11)

S1–S4 + 阶段 1-5 全部完成,后端位于 `backend/`。

- ✅ Go module + Eino v0.9.12 + eino-ext openai v0.1.13 + chi v5
- ✅ interrupt/resume(`compose.StatefulInterrupt` + `compose.ResumeWithData` + SQLite checkpoint,见 `engine/graph.go` / `engine/executor.go`)
- ✅ SQLite 持久化(`backend/data/app.db`,WAL,`modernc.org/sqlite` 无 CGO,5 migrations)
- ✅ 60+ REST 端点(agents / nodes / templates / skills / kb / chat / planner / settings / tasks)
- ✅ 真 LLM(OpenAI-compatible)+ 真 PubMed(NCBI E-utilities)
- ✅ 端到端冒烟(`backend/README.md` Python 脚本)

历史/细节见 [PROGRESS.md §七 变更日志](./PROGRESS.md#七变更日志) 与 [backend/README.md](./backend/README.md)。

---

## 🎯 P1 · 编辑器 & 知识库

### 模板编辑器
- [x] ✅ 三栏布局 / 拖拽建节点 / 端口连线 / 属性面板 / 保存到后端 / 内置模板自动 fork(2026-08-04)
- [x] ✅ 节点 `config` 6 个约定键编辑 + extras JSON(2026-08-11 阶段 2)
- [x] ✅ 模板 `parameter_schema` 编辑(string / number / enum / boolean)(2026-08-11 阶段 2)
- [x] ✅ 每次保存递增 `current_version`,`GET /versions` + `GET /versions/{v}`(2026-08-11 阶段 2.4)
- [ ] 边 condition 谓词编辑(目前 edge 只能选 port 字符串,无法写 `{{review.verdict}} == 'revise'` 这类表达式)

### 任务节点抽屉(`NodeDetailDrawer.tsx`)
- [x] ✅ 基础信息 / 运行状态 / 产物渲染 / 「复制产物」按钮(2026-08-04)
- [x] ✅ ArtifactPanel:所有 key + 版本 + unified diff(2026-08-11 阶段 4)
- [ ] 节点**输入**快照渲染:后端 `StepHistoryItem.before_snapshot` 已写入,前端需新增"diff 上次"对比区,展示进入该节点时的 state vs 离开时的 state(`backend/internal/engine/artifact_writer.go` + `snapshots.go:shallowSnapshot` 是数据源)

### 知识库增强
- [x] ✅ 文件上传:PDF → PyMuPDF sidecar 抽文本/图/表 → Markdown 入库(P91 2026-08-14,抽图率 100% 41/41,1-2.5s/份;DOCX/TXT 仍走旧 ledongthuc 路径)
- [x] ✅ 抽出 PDF 内嵌图片:PyMuPDF + vite `/api` proxy + 404 兜底页(P91 2026-08-14;真实样本 5 页医学 PDF 抽 2 张 11.4KB+18.9KB,vector PDF 抽不到的页返 404 符合预期)
- [ ] chunk + embedding 层(目前是关键字匹配,接 Eino 后可换 vector search)
- [ ] 检索结果高亮命中关键字(目前只截片段,前端不展示 `<mark>` 高亮)
- [ ] `litSource` 在任务流 verify_reference 链路补齐(目前 chat 路径已用真 PubMed,任务流 `retrieveCitationSources` 只接 search,verify 还没接)

---

## ⚡ P2 · 实时性

- [x] ✅ `GET /api/tasks/:id/stream` SSE(后端,2026-07-28)
- [x] ✅ `POST /api/chat/reply/stream` SSE(后端 + 前端 fetch + ReadableStream,2026-07-28)
- [x] ✅ Chat 团队路径消费 `/stream`(`pages/chat/index.tsx:688-762`)
- [ ] `frontend/src/store/useTasksStore.ts` 用 `EventSource` 替代 2s 轮询(`/tasks/:id` 仍 2s 轮询;`pollActiveTask` 是唯一改造点)

---

## 🔌 P3 · 三方集成(真接)

- [ ] Teambition v3 API:
  - [ ] OAuth 授权
  - [ ] 项目/任务同步(把生成的最终稿挂到 Teambition 任务附件)
- [ ] 钉钉会议 API:
  - [ ] 会议纪要拉取
  - [ ] 会议摘要作为 brief 输入

---

## 🧪 P4 · 工程质量

- [ ] **Vitest 单测覆盖**:
  - [ ] `frontend/src/api/mock/engine.ts`(状态机 7 阶段)
  - [ ] `useChatStore` / `useTasksStore` / `useAppStore`
  - [ ] `frontend/src/canvas/layout.ts`(dagre)
  - [ ] `backend/internal/engine/validate.go` 的 `runWithValidation` 错误注入路径
  - [ ] `backend/internal/engine/prompts.go` 的 `parseReviewStreamText` / `extractJSON` / `parseEnrichContentResponse`(已有 `validate_test.go` 覆盖部分)
  - [ ] `backend/internal/store/sqlite/task_artifacts.go` 复合 PK 行为
- [ ] **Playwright E2E**:
  - [ ] 新建任务 → 三次 interrupt → 定稿 全流程(真后端模式)
  - [ ] 知识库检索 → 挂载对话 → 工具轨迹
  - [ ] 模板编辑器:fork 内置 → 改 config → 保存 → 检查 `current_version`+1
- [ ] **Bundle 拆分**:
  - [ ] antd 单独 chunk
  - [ ] @xyflow/react 单独 chunk
  - [ ] react-markdown 按需 lazy load
  - [ ] 当前 ~1.84 MB · gzip ~594 KB,目标 < 1.4 MB

---

## ✅ 阶段 5 续 5 · P91 收口(2026-08-14)

**目标**: PDF 解析 + 抽图统一走 PyMuPDF Python sidecar,替代 P85 pdfcpu(0% 抽图率)+ Qwen-VL OCR(30-60s/PDF)双路径。

**交付**:
- [x] ✅ 新 sidecar `backend/sidecars/pymupdf-extract/`(FastAPI + uvicorn + pymupdf4llm 0.0.18 + pymupdf 1.24.10)
- [x] ✅ Go 客户端 `internal/embedding/pymupdf.go` + 启动时 `/health` fail-fast
- [x] ✅ 新 parser `internal/parser/pymupdf_parser.go` 替代 ledongthuc 旧路径
- [x] ✅ `embedding.PersistImages` 落盘到 `data/kb_images/{kb}/{doc}/image_NNN.{ext}`
- [x] ✅ 删旧 `internal/kbimages` 包 + pdfcpu 依赖
- [x] ✅ docker-compose 加 `pymupdf-sidecar` + 可选 `backend` service + `Dockerfile` multi-stage
- [x] ✅ vite proxy `/api → :8001` + router 404 友好页(用户地址栏直输场景)
- [x] ✅ 13 个测试: 12 unit (`TestPersistImages_*` 6 + `TestKbImages_*` 6) + 1 e2e (`TestPymupdfE2E`),全绿 11.9s

**验证**: 5 页医学 PDF "发发发" KB `kb-2f695723` / doc `doc-55bec705` 抽 2 张 PNG(image_001=11.4KB page 2 / image_002=18.9KB page 4),`GET /api/kb/.../images/...` 200 + `image/png`,vector 页 404 符合预期。详见 PROGRESS.md / CLAUDE.md / `backend/README.md` "P91" 节。

---

## 🐛 已知小 gap

- [x] ✅ `pages/settings/index.tsx` 文案:已改为"持久化到后端 (SQLite settings 表, key=llm_prefs)"(P92 2026-08-14)
- [x] ✅ 「测试连接」按钮:真连通性探测,走后端 `POST /api/settings/llm/test` (8s timeout),返 `available=true` 时弹成功,401/超时弹 `error` 原文(P92 2026-08-14)
- [x] ✅ 「今日待办」跳转:已修,workbench 链接 `/tasks/${t.thread_id}`(本次 P92 调研发现早已修)
- [x] ✅ 模板卡片「复制」:加 `<CopyOutlined>` 按钮,走后端 `POST /api/templates/{id}/fork`,立刻 message.success + 刷新列表。同时修复了"编辑 builtin 模板 fork 后保存 404" 的真 bug — performSave 改走 fork→update 路径(P92 2026-08-14)
- [x] ✅ mock `/api/chat/reply` 有 key 时:优先 fetch 真后端 `/api/chat/reply`,失败回落 `callDirectChatReply` → mock;让真后端拿到所有 chat trace(日志/限速/审计)(P92 2026-08-14)

---

## 📌 下一步建议顺序

1. **工程质量基线**(P4 Vitest + Playwright)— 真实 LLM 接入后无单测保护,改任何 compute node 都心惊胆战
2. **节点输入快照渲染**(P1 NodeDetailDrawer)— 数据已写入,纯前端展示,~半天工作量
3. **`useTasksStore` 改 EventSource**(P2)— `pollActiveTask` 是单一改造点,与 chat SSE 对齐,~1 天
4. **知识库文件上传 + chunk/embedding**(P1)— 用户强需求,但需要先决定 embedding 走哪个 provider
5. **三方集成**(P3)— Teambition / 钉钉,需要外部授权流程
6. **Bundle 拆分**(P4)— 性能优化,不阻塞功能
