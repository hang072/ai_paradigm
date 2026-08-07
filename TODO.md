# TODO 清单

> 与 [PROGRESS.md](./PROGRESS.md) 配套的可执行待办。
> 每一项都可以直接开工,无需再决策。

---

## 🔥 P0 · 后端 Eino Go 骨架

> 位置已定:`D:\DH\Project\paradigm_eino\backend\`(独立 Go 项目,与 `frontend/` 平级)。设计要点见 `backend/README.md`。

- [ ] 在 `backend/` 下 `go mod init` 建立 Go module
- [ ] 定义领域结构体(镜像 `frontend/src/types/*.ts`)
- [ ] **调研并实现 interrupt/resume** — Eino 无原生 interrupt。**推荐方案**:外层状态机(Go 手工控制 stage 转移 + snapshot 持久化)+ 内层 Eino Chain(每个 stage 内部 LLM/工具编排)
- [ ] Checkpointer / Store:先内存(`sync.Map`),后 SQLite(`modernc.org/sqlite` 纯 Go)
- [ ] Prompt 常量、领域数据(SLIDE_MODES / STRATEGY_MATRIX / CLARIFY_TRIGGERS)在 backend 侧独立定义,不引用 langgraph
- [ ] 工具实现:`search_literature` / `verify_reference`(mock 文献库)/ `search_kb`(调用内部 KB 检索)
- [ ] 实现 API handlers(严格对齐 `frontend/src/api/mock/index.ts` 的契约):
  - [ ] `/api/agents` CRUD
  - [ ] `/api/nodes` CRUD
  - [ ] `/api/templates` CRUD
  - [ ] `/api/skills` CRUD
  - [ ] `/api/kb` + `/api/kb/:id/docs` + `/api/kb/search`
  - [ ] `/api/tasks` + `/tasks/:id/resume` + `/tasks/:id/spec`
  - [ ] `/api/chat/reply`
- [ ] 端到端验证:`frontend/.env.local` 设 `VITE_USE_MOCK=false` 全流程跑通

---

## 🎯 P1 · 前端未完成的编辑器

### 模板编辑器(`frontend/src/pages/templates/TemplateEditor.tsx`)
- [ ] 全屏 xyflow 画布
- [ ] 左侧节点面板(拖拽新增)
- [ ] 右侧属性面板(选中节点后配 agent / config / out_ports)
- [ ] 端口拖拽连线
- [ ] 保存 spec → `PUT /api/templates/:id`
- [ ] 内置模板阻止编辑(现在后端已做)

### 任务画布节点点击
- [ ] `frontend/src/pages/tasks/TaskCanvas.tsx` 支持 onNodeClick
- [ ] 抽屉展示该节点的 input/output snapshot
- [ ] 从 `TaskSnapshot.step_history` 取该 step 的 `after_keys` 对应值

### 知识库增强
- [ ] 文件上传:PDF / DOCX / TXT → 转 Markdown 并入库
- [ ] chunk + embedding 层(接 Eino 后端)
- [ ] 检索结果高亮命中关键字(目前只截片段)

---

## ⚡ P2 · 实时性

- [ ] SSE 端点 `GET /api/tasks/:id/events`(后端)
- [ ] `frontend/src/store/useTasksStore.ts` 用 EventSource 替代 2s 轮询
- [ ] Chat 流式:`POST /api/chat/reply/stream` 返回 SSE
- [ ] `frontend/src/pages/chat/index.tsx` 用 fetch + ReadableStream 消费

---

## 🔌 P3 · 三方集成

- [ ] Teambition v3 API 联通:
  - [ ] OAuth 授权
  - [ ] 项目/任务同步(把生成的幻灯挂到 Teambition 任务附件)
- [ ] 钉钉会议 API:
  - [ ] 会议纪要拉取
  - [ ] 会议摘要作为 brief 输入

---

## 🧪 P4 · 工程质量

- [ ] Vitest 单测覆盖:
  - [ ] `frontend/src/api/mock/engine.ts`(状态机)
  - [ ] `useChatStore` / `useTasksStore`
  - [ ] `frontend/src/canvas/layout.ts`(dagre)
- [ ] Playwright E2E:
  - [ ] 新建任务 → 三次 interrupt → 定稿 全流程
  - [ ] 知识库检索 → 挂载对话 → 工具轨迹
- [ ] Bundle 拆分:
  - [ ] antd 单独 chunk
  - [ ] @xyflow/react 单独 chunk
  - [ ] react-markdown 按需 lazy load
- [ ] 补全工具 mock 真检索:
  - [ ] `search_literature` 连 mock 文献库 domain_data
  - [ ] `verify_reference` 真核验(mock 时至少匹配 fixture)

---

## 🐛 已知小 gap

- [ ] Chat 会话持久化到 localStorage,页面刷新保留;任务 / KB 是内存,刷新会重置(mock 阶段预期行为,真后端修复)
- [ ] `pages/templates` 卡片操作里的「复制」「编辑」按钮功能未接(前端 `frontend/src/pages/templates/`)
- [ ] 首页「今日待办」的跳转链接只到 `/tasks`,未定位到具体 task
- [ ] settings 页「测试连接」按钮是假成功,应实际打真 API

---

## 📌 下一步建议顺序

1. **先做后端 Eino 骨架**(P0)— 最大风险项是 interrupt 语义映射,越早验证越好
2. **模板编辑器**(P1)— 前端体验大补丁,和后端并行
3. **SSE 流式**(P2)— 后端骨架就绪后立即接
4. 剩余按需
