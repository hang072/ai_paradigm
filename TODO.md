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
- [ ] 文件上传:PDF / DOCX / TXT → 转 Markdown 并入库
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

## 🐛 已知小 gap

- [ ] `pages/settings/index.tsx:202` 文案 "存 localStorage" 与后端持久化事实不符,改为 "存后端(SQLite `llm_prefs`)"
- [ ] `pages/settings/index.tsx:98` 「测试连接」按钮是假成功(`// TODO: 后端测试接口`),应实际 POST `/api/settings/llm` 拿 `available` 状态
- [ ] 首页「今日待办」的跳转链接只到 `/tasks`,未定位到具体 task(`/tasks/:id`)
- [ ] `pages/templates/index.tsx` 卡片「复制」按钮尚未实装(「编辑」按钮已跳 `/templates/:id/edit`,但没有"另存为新模板"流程,目前要走编辑器 fork)
- [ ] mock 引擎 `/api/chat/reply` 在用户填了 `useAppStore.apiKey` 时直接调 LLM,没有用真后端 `/api/chat/reply` 端点(可选:统一走后端,便于日志/速率限制)

---

## 📌 下一步建议顺序

1. **工程质量基线**(P4 Vitest + Playwright)— 真实 LLM 接入后无单测保护,改任何 compute node 都心惊胆战
2. **节点输入快照渲染**(P1 NodeDetailDrawer)— 数据已写入,纯前端展示,~半天工作量
3. **`useTasksStore` 改 EventSource**(P2)— `pollActiveTask` 是单一改造点,与 chat SSE 对齐,~1 天
4. **知识库文件上传 + chunk/embedding**(P1)— 用户强需求,但需要先决定 embedding 走哪个 provider
5. **三方集成**(P3)— Teambition / 钉钉,需要外部授权流程
6. **Bundle 拆分**(P4)— 性能优化,不阻塞功能
