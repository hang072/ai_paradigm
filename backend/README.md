# Paradigm Eino Backend

独立的 Go 后端项目,基于 [CloudWeGo Eino](https://github.com/cloudwego/eino) v0.9 实现多智能体编排。

## 定位

- 与 `../frontend/` 平级、独立演进
- 严格实现 `../API_CONTRACT.md` 定义的 REST 契约
- 不依赖其他任何后端项目;`../frontend/src/api/mock/engine.ts` 只作为**行为参考**,不作为源码来源

## 目录结构

```
backend/
├── go.mod                  依赖:chi + cors + eino v0.9.12
├── .env.example            PORT=8001
├── cmd/server/main.go      入口:装载 fixtures、编译 task graph、起 chi 服务
└── internal/
    ├── domain/             领域类型,JSON tag 与 frontend/src/types/*.ts 完全对齐
    ├── store/              泛型内存 store + TaskSnapshotStore + MemCheckpointStore
    ├── engine/             ★ Task 状态机(compose.Graph + HITL)、Executor(异步 goroutine 驱动)
    ├── api/                chi 路由 + 5 类 handler(agents/nodes/templates/skills/tasks)
    └── fixtures/           6 Agents / 10 Nodes / 3 Templates / 5 Skills / 2 演示 Tasks
```

## 当前进度 · S4(Knowledge Base + search_kb 真接入)

已实现:
- ✅ `GET/POST/PUT/DELETE /api/agents[/:id]`
- ✅ `GET/POST/PUT/DELETE /api/nodes[/:id]`
- ✅ `GET/POST/PUT/DELETE /api/templates[/:id]`
- ✅ `GET/POST/PUT/DELETE /api/skills[/:id]`
- ✅ `GET /api/tasks` · `POST /api/tasks` · `GET /api/tasks/:id` · `POST /api/tasks/:id/resume` · `POST /api/tasks/:id/spec`
- ✅ **完整 Task 状态机**:parse_brief → (可能澄清)→ 策略确认(可回退)→ 内容 → 审核回路(revise ×2)→ 终稿反馈(可退回)→ 定稿
- ✅ **3 处 HITL**:`ask_clarification` / `confirm_strategy` / `human_final`,基于 Eino `compose.Interrupt` + `ResumeWithData`
- ✅ **5 个 compute 节点接入 LLM**:`parse_brief` / `plan_strategy` / `build_framework` / `enrich_content` / `review_quality`
- ✅ **OpenAI-compatible 单通道**:DeepSeek / Kimi / Qwen / OpenAI / Ollama 一份代码通吃
- ✅ **mock 降级**:`LLM_API_KEY` 未配置、provider 调用失败、LLM 输出解析失败,均自动回落到 S2a 的 mock 输出,任务不中断
- ✅ **SQLite 持久化**(S3):`data/app.db`,聊天/任务/设置/CRUD 全部落库
- ✅ **Chat single & team**(S2b + S3):`POST /api/chat/reply`(SSE 流式)
- ✅ **Knowledge Base + search**(S4):`GET/POST/PUT/DELETE /api/kb[/:id]`、`POST/PUT/DELETE /api/kb/:id/docs[/:docId]`、`POST /api/kb/search`
- ✅ **search_kb 工具真接**(S4):chat 中挂载 `search_kb` 时,一是 tool_calls trace 展示真实命中片段,二是通过 Eino `tool.InvokableTool` 挂到 `ChatModelAgent.ToolsConfig`,LLM 可主动触发 tool_call → 返回结构化 JSON
- ✅ 6 Agents / 10 Nodes / 3 Templates / 5 Skills / **3 KB(7 文档)**+ 2 演示任务
- ✅ 异步推进:POST 立即返回 running 状态,goroutine 后台跑到下一个 interrupt 或 done;前端 2s 轮询消费

**S4 前 `search_kb` 只是前端展示 mock;S4 后 LLM 真能通过工具查内部资料。**

未实现:
- ⏳ **S5**:Chat team 模式让 template 编译为 Graph(现在是遍历节点顺序调用)
- ⏳ **S6**:SSE 流式,替换前端 2s 轮询(chat 已经 SSE,任务仍轮询)
- ⏳ **工具生态**:`search_literature` / `verify_reference` 仍是 mock trace

## 启动

前置:**Go 1.22+**

```bash
cd backend
go mod tidy           # 首次拉依赖
go run ./cmd/server
```

### 配置 LLM(可选)

未设 `LLM_API_KEY` 时,任务图跑纯 mock,行为等价 S2a。要启用 LLM,复制 `.env.example` 或直接 export:

```bash
# DeepSeek 示例(最省)
export LLM_API_KEY=sk-xxx
export LLM_BASE_URL=https://api.deepseek.com/v1
export LLM_MODEL=deepseek-chat

# OpenAI 示例(不用 BASE_URL)
export LLM_API_KEY=sk-xxx
export LLM_MODEL=gpt-4o-mini

# 通义千问示例
export LLM_API_KEY=sk-xxx
export LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
export LLM_MODEL=qwen-plus

go run ./cmd/server
```

看到:
```
paradigm_eino backend listening on http://0.0.0.0:8001
  agents=6 nodes=10 templates=3 skills=5 tasks=2 (2 demo)
  llm provider: openai(deepseek-chat) (available=true)
  pymupdf sidecar: http://localhost:8002 (available=true)
```

启动日志的 `available=true` 意味着 5 个 compute 节点会真调 LLM。单个节点若调用失败或 LLM 输出解析失败,**只会该节点回落 mock**(messages 里会有一条 "LLM 失败,已回落 mock"),整个任务仍能推到 done。

### P91 · PDF 解析走 PyMuPDF sidecar

`.pdf` 上传不再走 P85 的 pdfcpu + Qwen-VL 双路径,统一由 **PyMuPDF Python sidecar** 一步抽文本 / 图 / 表 / 原始 page JSON:

| 指标 | P85 (pdfcpu + VLM) | P91 (pymupdf sidecar) |
|---|---|---|
| 抽图率 | 0% (CMYK 限制) | 100% (41/41 PoC) |
| 单 PDF 耗时 | 30-60s (VLM) | 1-2.5s |
| 依赖 | pdfcpu + Qwen-VL OCR | pymupdf + pymupdf4llm (Python 3.11) |

#### 启 sidecar

**方式一 · docker compose(推荐)**

```bash
cd backend
docker compose -f docker-compose.yml up -d pymupdf-sidecar
# 健康检查: curl http://localhost:8002/health
```

**方式二 · 本地 uvicorn**

```bash
cd backend/sidecars/pymupdf-extract
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8002
```

#### 后端配置

`PYMUPDF_SIDECAR_URL` 默认 `http://localhost:8002`,`PYMUPDF_SIDECAR_TIMEOUT_SEC` 默认 `120`。后端启动时 ping `/health`,失败 → 启动报错(全替决策,不静默降级)。`.pdf` 上传时走 `PymupdfParser` 一步抽完;非 PDF 走原 parser(.md / .docx / 老 .pdf fallback)。

#### 已知限制

- 扫描件 (无文本层) 会返近空 markdown,**不再 fallback VLM**(P91 全替决策)
- 单 PDF 上限 64 MiB (跟后端上传硬上限对齐)
- sidecar 不可用时 `go run ./cmd/server` 启动失败 — 先启 sidecar 再启后端

接口契约详见 `sidecars/pymupdf-extract/README.md`。

## 与前端联调

创建 `frontend/.env.local`:
```
VITE_USE_MOCK=false
VITE_API_BASE=http://127.0.0.1:8001
```

重启前端 dev server(`cd frontend && npm run dev`),访问 http://localhost:5173:

| 页面 | 预期 |
|---|---|
| `/workbench` | ✅ 显示 2 个演示任务 + 系统健康度 |
| `/tasks` | ✅ 完整走通:新建 → 澄清(可能触发)→ 策略确认 → 内容 → 审核回路 → 终稿反馈 → 定稿 |
| `/agents` `/templates` `/settings` | ✅ CRUD 完全可用 |
| `/chat` | ✅ single/team 均可用,`search_kb` 挂载后 LLM 真能查 |
| `/knowledge` | ✅ KB CRUD + 顶部搜索都可用 |

## 架构:Task 状态机

Executor 层驱动 `compose.Graph.Invoke`:
- **POST /api/tasks** → 创建 snapshot(status=running)→ 起 goroutine 跑 graph → 立即返回
- **goroutine 里 graph.Invoke** → 依次跑 Lambda 节点 → 遇到 interrupt 节点 return `compose.StatefulInterrupt` → 提取 InterruptID 存入 snapshot
- **POST /:id/resume** → 用 `compose.ResumeWithData(ctx, interruptID, answer)` 再次 Invoke,checkpoint 恢复继续跑
- **前端每 2s GET /api/tasks/:id** → 直接读 TaskSnapshotStore,拿到 goroutine 更新的最新状态

两套 store 分离:
- `MemCheckpointStore`:Eino 用,存 Graph 的执行位置和 interrupt 上下文(黑盒 bytes)
- `TaskSnapshotStore`:业务用,存 `*TaskSnapshot`(前端直接消费的 JSON)

Task Graph 拓扑(10 节点 + 4 处 Branch):
```
START → parse_brief
      → should_clarify? → ask_clarification (interrupt) → pre_strategy_passthrough
                       → pre_strategy_passthrough                    ↓
                                                              plan_strategy
                                                                    ↓
                                                       confirm_strategy (interrupt)
                                                       ├─ "调整" → plan_strategy (loop)
                                                       └─ 确认  → build_framework
                                                                    ↓
                                                              enrich_content ←──┐
                                                                    ↓            │
                                                              review_quality     │
                                                              ├─ revise<2 → bump_revision
                                                              └─ pass/强制 → human_final (interrupt)
                                                                    ├─ "退回" → enrich_content (loop)
                                                                    └─ 通过  → finalize → END
```

## Smoke test(端到端 Task 状态机)

```bash
# 装依赖并起服务
go mod tidy
go run ./cmd/server &

# 用 python 完整走完流程(避开 windows shell UTF-8 传参问题)
python -c "
import json, time, urllib.request

BASE = 'http://127.0.0.1:8001'
def post(p, o):
    r = urllib.request.Request(BASE+p, json.dumps(o, ensure_ascii=False).encode('utf-8'),
        {'Content-Type':'application/json; charset=utf-8'}, method='POST')
    return json.loads(urllib.request.urlopen(r).read().decode('utf-8'))
def get(p): return json.loads(urllib.request.urlopen(BASE+p).read().decode('utf-8'))

snap = post('/api/tasks', {'brief':'心衰讲课','task_type':'幻灯'}); tid = snap['thread_id']
for _ in range(6):
    time.sleep(1); snap = get(f'/api/tasks/{tid}')
    if snap['status']=='done': break
    stage = snap['pending']['stage'] if snap['pending'] else None
    answer = {'ask_clarification':'主治/40/综合','confirm_strategy':'确认','human_final':'通过'}[stage]
    post(f'/api/tasks/{tid}/resume', {'answer':answer})
print('status=', snap['status'], 'revision=', snap['revision_count'], 'steps=', len(snap['step_history']))
"
```

预期输出 `status= done revision= 0 steps= 8`(或 9,取决于随机 review verdict)。

## 契约要点(必读)

- `TaskStatus = 'running' | 'waiting_human' | 'done'`
- `PendingInterrupt.stage = 'ask_clarification' | 'confirm_strategy' | 'human_final'`
- 时间戳字符串 `YYYY-MM-DD HH:mm:ss`(本地时区,非 ISO 8601)
- 错误响应 `{"detail": "..."}`
- ID 前缀:`agent-*` / `node-*` / `tpl-*` / `task-*` / `skill-*` / `kb-*` / `doc-*`

完整契约见 `../API_CONTRACT.md`。

## 架构关键决策

- **智能体(Agent 实体)= Eino ADK `ChatModelAgent`**(S3/S5 引入 —— S2b 里 5 个 compute 节点为了不破坏 compose.Graph 中断/恢复,直接调底层 `openai.ChatModel.Generate`,不走 Agent/Runner)
- **专家团(WorkflowTemplate)与任务状态机 = `compose.Graph`**(S2a 已实现任务状态机,S5 编 template)
- **Eino 版本 v0.9.12** + `eino-ext/components/model/openai v0.1.13`
- **异步推进**:HTTP handler 立即返回,goroutine 后台跑 graph,前端轮询消费 snapshot
- **HITL**:`compose.StatefulInterrupt(ctx, InterruptPayload, InterruptState)` 触发中断,`compose.ResumeWithData(ctx, id, answer)` 恢复
- **两套 store**:Eino CheckpointStore(执行位置)+ TaskSnapshotStore(业务快照),同 taskID 作 key
- **LLM 抽象**:`internal/llm/Provider` 接口,`FromEnv` 未配 API key 返回 `Unavailable{}`,所有节点透明回落 mock
- **prompt 复用 fixtures 里的 agent.SystemPrompt**:用户在 `/agents` 页面改了 SystemPrompt,下一次任务立即生效(agentStore.Get 实时拉)
