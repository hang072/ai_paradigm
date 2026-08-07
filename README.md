# AI 工作台 · Paradigm Eino Workbench

多智能体协同的医疗内容框架生成平台 · 前端 MVP。

参考 POC(`http://122.51.17.23:8081/`)的产品形态,基于 **React + Ant Design + @xyflow/react** 全新实现。后端未来将迁移到 [CloudWeGo Eino](https://github.com/cloudwego/eino) (Go);当前版本前端自带 Mock 引擎,零后端即可跑通全流程。

## 一、技术栈

| | |
|---|---|
| 构建 | Vite 5 + TypeScript |
| 视图 | React 18 |
| UI 库 | Ant Design 5(zh-CN)|
| 状态 | Zustand |
| 路由 | React Router 6 |
| 画布 | @xyflow/react(=React Flow) + dagre 自动布局 |
| HTTP | axios + 自定义 mock adapter |
| Markdown | react-markdown + remark-gfm |

## 二、目录结构

```
paradigm_eino/
├── frontend/                        本项目前端(Vite + React)
│   └── src/
│       ├── main.tsx / App.tsx / router/  入口 + 路由
│       ├── layout/AppShell.tsx           顶栏 + 侧栏
│       ├── pages/
│       │   ├── workbench/                模块 A · 协同工作台(首页)
│       │   ├── agents/                   模块 B · 专家团(智能体 CRUD)
│       │   ├── tasks/                    模块 C · 任务运行 + 人工质控(重头戏)
│       │   ├── templates/                模块 D · 模板库(卡片 + 画布预览)
│       │   └── settings/                 模块 E · 模型接入 & 三方集成
│       ├── canvas/                       xyflow 通用画布(节点/自动布局)
│       ├── api/                          REST 客户端 + mock adapter + 内存 engine
│       │   └── mock/
│       │       ├── engine.ts             任务状态机(核心)
│       │       ├── fixtures/builtins.ts  内置 6 Agents / 10 节点 / 3 模板
│       │       └── index.ts              axios 拦截路由
│       ├── store/                        Zustand:全局配置 + 任务详情/轮询
│       └── types/                        TS 类型层
├── backend/                         独立 Eino Go 后端(S1 骨架待启动)
├── API_CONTRACT.md                  前后端共同契约(SSOT)
├── PROGRESS.md · TODO.md · CLAUDE.md
└── README.md
```

## 三、启动

```bash
# 前端(默认使用 mock 引擎,零后端可跑)
cd frontend
npm install
npm run dev
# → http://localhost:5173

# 生产构建
npm run build
npm run preview
```

后端启动指引参见 `backend/README.md`(尚未创建骨架)。

## 四、Mock 引擎行为

进入页面后:
1. **首页**:看到系统健康度指标 + 2 个内置演示任务(一个等待策略确认、一个已完成)
2. **专家团**:6 个内置 Agent 角色(需求理解、策略规划、框架搭建、内容填充、质量审核、通用助手)
3. **模板库**:3 个内置模板(幻灯 7 节点 / 文章 7 节点 / 完整 10 节点)
4. **任务运行**:点「新建」→ 填 brief → 启动
   - 40% 概率触发澄清问题(3 道选择题)
   - 策略确认页展示 markdown 策略书 → 可确认 or 局部修改
   - 40% 概率触发一次审核回路(revise)
   - 终稿反馈:通过 → 定稿;退回 → 重新填充内容
5. **设置**:填 DeepSeek / Claude API Key 存 localStorage,刷新保留

**Mock 数据仅存内存,页面刷新会重置。** 这是有意的:mock 用于验证前端流程,持久化交给真后端。

## 五、切换到真后端

未来 Eino Go 后端就位后:

1. 创建 `frontend/.env.local`:
   ```
   VITE_USE_MOCK=false
   VITE_API_BASE=http://127.0.0.1:8001
   ```
2. `cd frontend && npm run dev` 重启即可

后端契约(与当前 `paradigm_langgraph/app.py` 一致):

```
GET/POST/PUT/DELETE  /api/agents[/:id]
GET/POST/PUT/DELETE  /api/nodes[/:id]
GET/POST/PUT/DELETE  /api/templates[/:id]
GET                  /api/tasks
POST                 /api/tasks                { brief, task_type, title?, template_id? }
GET                  /api/tasks/:id
POST                 /api/tasks/:id/resume     { answer }
POST                 /api/tasks/:id/spec       { spec }
```

前端 axios 层只需切 baseURL,业务代码无需改动。

## 六、下一步

具体进度与待办清单见:
- [PROGRESS.md](./PROGRESS.md) — 已完成事项、决策记录、恢复开发指南
- [TODO.md](./TODO.md) — 可执行待办(按 P0/P1/P2/P3 分级)
- [API_CONTRACT.md](./API_CONTRACT.md) — 后端(Eino Go)实现契约

## 七、和 `paradigm_langgraph` 的关系

同一个产品,两条路径:

| | paradigm_langgraph | paradigm_eino |
|---|---|---|
| 后端语言 | Python + LangGraph | Go + Eino(独立项目,`backend/` 目录)|
| 前端 | static/index.html(vanilla JS) | 独立 Vite 工程(`frontend/`)|
| 契约 | 一致的 REST API |
| 状态 | 3 Agent / 9 节点已跑通 | 前端 MVP · Mock 后端 |

前端与后端强解耦,可各自演进。
