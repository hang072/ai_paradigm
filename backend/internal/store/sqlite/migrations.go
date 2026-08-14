package sqlite

// migration 是一次 schema 变更, version 递增, name 供日志。
type migration struct {
	version int
	name    string
	sql     string
}

// migrations 顺序执行。已跑过的版本记录在 schema_migrations 表里, 幂等。
//
// 结构选择:
//   - CRUD 类 (agents / nodes / templates / skills / kb / docs) 一律 KV JSON:
//     domain 结构体加字段无需改表, MVP 迭代最省事。查询/过滤都在 Go 侧做, 现在也是这样。
//   - Tasks 也用 JSON payload, 因为 TaskSnapshot 里嵌了大量 map[string]any / 指针。
//     ThreadID 单独抽出来做主键, CreatedAt / Status 做索引方便 List 排序过滤。
//   - Chat 消息分表, 一条 message 一行 —— 会话消息可能长,不适合塞进 sessions.data JSON。
//   - Settings 是纯 KV。
var migrations = []migration{
	{
		version: 1,
		name:    "init",
		sql: `
CREATE TABLE entities (
    kind        TEXT NOT NULL,
    id          TEXT NOT NULL,
    builtin     INTEGER NOT NULL DEFAULT 0,
    data        TEXT NOT NULL,           -- JSON marshal 整个 domain 对象
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (kind, id)
);
CREATE INDEX idx_entities_kind ON entities(kind);

CREATE TABLE task_snapshots (
    thread_id   TEXT PRIMARY KEY,
    status      TEXT NOT NULL,
    created_at  TEXT NOT NULL,           -- 保留字符串, 与 domain.TaskSnapshot.CreatedAt 一致 (YYYY-MM-DD HH:mm:ss)
    updated_at  INTEGER NOT NULL,        -- unix 时间戳, 内部用
    data        TEXT NOT NULL            -- JSON 整个 TaskSnapshot
);
CREATE INDEX idx_task_snapshots_created ON task_snapshots(created_at DESC);
CREATE INDEX idx_task_snapshots_status ON task_snapshots(status);

CREATE TABLE task_checkpoints (
    task_id     TEXT PRIMARY KEY,
    data        BLOB NOT NULL,           -- Eino compose 序列化的字节
    updated_at  INTEGER NOT NULL
);

CREATE TABLE chat_sessions (
    id                TEXT PRIMARY KEY,
    title             TEXT NOT NULL,
    mode              TEXT NOT NULL,
    agent_id          TEXT,
    team_template_id  TEXT,
    tools             TEXT NOT NULL DEFAULT '[]',    -- JSON string[]
    skills            TEXT NOT NULL DEFAULT '[]',    -- JSON string[]
    kb_ids            TEXT NOT NULL DEFAULT '[]',    -- JSON string[]
    model             TEXT,
    created_at        TEXT NOT NULL,                 -- YYYY-MM-DD HH:mm:ss
    updated_at        TEXT NOT NULL
);
CREATE INDEX idx_chat_sessions_updated ON chat_sessions(updated_at DESC);

CREATE TABLE chat_messages (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL,
    idx          INTEGER NOT NULL,                   -- 消息在会话中的顺序 (0..n)
    role         TEXT NOT NULL,                      -- 'user'/'assistant'/'system'/'tool'
    agent_id     TEXT,
    agent_name   TEXT,
    agent_color  TEXT,
    content      TEXT NOT NULL,
    tool_calls   TEXT,                               -- JSON, 可空
    timestamp    TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, idx);

CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL   -- JSON
);
`,
	},
	{
		// 2026-07-23: chat 重构 —— 会话不再有 mode / agent_id / team_template_id,
		// 改为单列 attached_expert (JSON {kind, id}) 存挂载的子智能体。历史会话
		// 一律清空(数据可再生, 不做迁移)。
		version: 2,
		name:    "chat_attached_expert",
		sql: `
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_sessions;

CREATE TABLE chat_sessions (
    id                TEXT PRIMARY KEY,
    title             TEXT NOT NULL,
    attached_expert   TEXT,                          -- JSON {kind, id}, NULL = 未挂载
    tools             TEXT NOT NULL DEFAULT '[]',    -- JSON string[]
    skills            TEXT NOT NULL DEFAULT '[]',    -- JSON string[]
    kb_ids            TEXT NOT NULL DEFAULT '[]',    -- JSON string[]
    model             TEXT,
    created_at        TEXT NOT NULL,                 -- YYYY-MM-DD HH:mm:ss
    updated_at        TEXT NOT NULL
);
CREATE INDEX idx_chat_sessions_updated ON chat_sessions(updated_at DESC);

CREATE TABLE chat_messages (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL,
    idx          INTEGER NOT NULL,
    role         TEXT NOT NULL,
    agent_id     TEXT,
    agent_name   TEXT,
    agent_color  TEXT,
    content      TEXT NOT NULL,
    tool_calls   TEXT,
    timestamp    TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, idx);
`,
	},
	{
		// 2026-07-23 (later same day): 挂载 team 时 chat 通过 /api/tasks 起底层任务,
		// 需要在会话上记住 task 的 thread_id (供 done 后回溯 / 恢复 poll)。
		// 单列可空; 不需要 DROP 表, 只加列, 兼容 v2 数据。
		version: 3,
		name:    "chat_active_task_id",
		sql: `
ALTER TABLE chat_sessions ADD COLUMN active_task_id TEXT;
`,
	},
	{
		// 2026-08-11 · 阶段 2.4 · 模板版本化保存
		// 旧 PUT 行为是"全量覆盖"——丢失历史,无法 diff 也不能回滚。
		// 新表:每次 PUT 创建新版本(template_id + version 复合主键),
		// entities 表里那行保持最新(供 GET 单模板返回),版本历史放这里。
		version: 4,
		name:    "template_versions",
		sql: `
CREATE TABLE template_versions (
    template_id   TEXT NOT NULL,        -- 与 entities.id 对齐
    version       INTEGER NOT NULL,     -- 1, 2, 3, ...
    data          TEXT NOT NULL,        -- JSON 整个 WorkflowTemplate 当时快照
    created_at    TEXT NOT NULL,        -- YYYY-MM-DD HH:mm:ss
    PRIMARY KEY (template_id, version)
);
CREATE INDEX idx_template_versions_tpl ON template_versions(template_id, version DESC);
`,
	},
	{
		// 2026-08-11 · 阶段 4 · 共享工件仓库
		// 之前 enrich_content 多轮修订会覆盖 snapshot.enriched_framework,旧版
		// 永久丢失。新表 task_artifacts(task_id, key, version) 复合主键,每次
		// 写盘 +1 version,旧版保留,前端可读任意版本或 diff。
		version: 5,
		name:    "task_artifacts",
		sql: `
CREATE TABLE task_artifacts (
    task_id            TEXT NOT NULL,
    key                TEXT NOT NULL,           -- 'enriched_framework' / 'strategy_doc' / ...
    version            INTEGER NOT NULL,        -- 单调递增
    content            TEXT NOT NULL,           -- markdown / JSON 原文
    content_type       TEXT NOT NULL,           -- 'markdown' | 'json' | 'text'
    produced_by        TEXT,                    -- NodeDef.id(本阶段可空)
    produced_by_agent  TEXT,                    -- AgentDef.id(本阶段可空)
    created_at         TEXT NOT NULL,           -- YYYY-MM-DD HH:mm:ss
    metadata_json      TEXT,                    -- 自由 JSON:{token_count, citations_count, ...}
    PRIMARY KEY (task_id, key, version)
);
CREATE INDEX idx_task_artifacts_task ON task_artifacts(task_id, created_at DESC);
CREATE INDEX idx_task_artifacts_task_key ON task_artifacts(task_id, key, version DESC);
`,
	},
	{
		// 2026-08-11 · 阶段 5 · 知识库本地文档上传
		// 原始文件二进制 (md/pdf/docx) 单独存,与 KnowledgeDoc 一对一。
		// doc_id 与 entities(kind='kb') JSON 里 Docs[].id 对齐;删 doc 由
		// handler 显式调 UploadStore.Delete 同步,不走外键 CASCADE (BLOB 与
		// doc JSON 不在同事务,级联顺序与回滚会更绕)。
		// PK 已是 doc_id,SizeByKB 由 Go 侧把 docID 列表传进来算 SUM,无需额外索引。
		version: 6,
		name:    "kb_doc_uploads",
		sql: `
CREATE TABLE kb_doc_uploads (
    doc_id      TEXT PRIMARY KEY,        -- 与 KnowledgeDoc.id 对齐 (doc-* 前缀)
    mime        TEXT NOT NULL,           -- 上传时的 Content-Type
    name        TEXT NOT NULL,           -- 原始文件名 (用于"下载原始文件")
    size        INTEGER NOT NULL,        -- 字节数; 配额 = SUM(size) WHERE doc_id IN (kb 的所有 doc)
    blob        BLOB NOT NULL,           -- 原始文件二进制 (md / pdf / docx)
    created_at  TEXT NOT NULL            -- YYYY-MM-DD HH:mm:ss
);
`,
	},
	{
		// 2026-08-11 · 阶段 5 续 2 · KB 文档分片上传
		// 一个 session = 用户一次"批量上传"的全部文件。
		// chunks 落 kb_upload_chunks;commit 时由 handler 按文件聚合、解析、
		// 一次性 upsert 到 entities.kind='kb' + kb_doc_uploads(v6 表,保留)。
		// session 24h 未 commit → 后台 sweeper 标 aborted 并清 chunks。
		// FK CASCADE:chunks 跟随 session 删。
		version: 7,
		name:    "kb_upload_sessions",
		sql: `
CREATE TABLE kb_upload_sessions (
    id              TEXT PRIMARY KEY,        -- 16 hex 字符(8 字节 random)
    kb_id           TEXT NOT NULL,           -- 与 KnowledgeBase.id 对齐
    file_count      INTEGER NOT NULL,        -- 1..20
    total_size      INTEGER NOT NULL,        -- Σ file.size,commit 时再校验
    state           TEXT NOT NULL CHECK(state IN ('open','committed','aborted')),
    meta_json       TEXT,                    -- per_file 边界:[{name,size,ext,start_chunk,end_chunk}]
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL            -- created_at + 24h
);
CREATE INDEX idx_kb_upload_sessions_state ON kb_upload_sessions(state);
CREATE INDEX idx_kb_upload_sessions_expires ON kb_upload_sessions(expires_at);

CREATE TABLE kb_upload_chunks (
    session_id      TEXT NOT NULL,
    chunk_idx       INTEGER NOT NULL,        -- 0..N
    size            INTEGER NOT NULL,
    blob            BLOB NOT NULL,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (session_id, chunk_idx),
    FOREIGN KEY (session_id) REFERENCES kb_upload_sessions(id) ON DELETE CASCADE
);
`,
	},
	{
		// 2026-08-13 · 阶段 5 续 5 · KB 文档结构化抽取 sidecar
		// 之前 Qwen-VL 只返纯文本, 表格 / 公式 / 图都被压平。
		// 新表存 VLM 返的原始结构 JSON + 跨页表格合并后的 markdown,给前端"查看结构"用。
		// SQLite 没真外键, app 层保证 doc_id 在 kb_doc_uploads + KnowledgeDoc 里存在。
		version: 8,
		name:    "kb_doc_structure",
		sql: `
CREATE TABLE kb_doc_structure (
    doc_id     TEXT PRIMARY KEY,                 -- 与 KnowledgeDoc.id 对齐 (doc-* 前缀)
    kb_id      TEXT NOT NULL,                    -- 反查用, KB 删 doc 时级联清
    raw_json   TEXT NOT NULL,                    -- VLM 返的完整 pages/blocks JSON
    markdown   TEXT NOT NULL,                    -- 平铺 markdown (chunker / Content 用)
    pages_n    INTEGER NOT NULL,                 -- 页数
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_kb_doc_structure_kb ON kb_doc_structure(kb_id);
`,
	},
	{
		// 2026-08-14 · 阶段 5 续 5 P85 · 抽图元数据
		// 之前 DocStructure 只存 VLM 文本/表格, 文档里的真实图片(jpg/png)丢光。
		// 加 images_json 列(JSON 数组, 元素见 embedding.ExtractedImage),图片二进制
		// 走文件系统(data/kb_images/{kb_id}/{doc_id}/image_NNN.{ext})。
		// 旧数据 images_json='' 即可(等价空数组)。
		// P91: 抽图元数据形状不变, 旧 P85 pdfcpu 路径已删, 改由 pymupdf sidecar
		//       抽字节后走 embedding.PersistImages 落盘, JSON 形状依然兼容。
		version: 9,
		name:    "kb_doc_structure_images",
		sql: `
ALTER TABLE kb_doc_structure ADD COLUMN images_json TEXT NOT NULL DEFAULT '';
`,
	},
	{
		// 2026-08-14 · 阶段 5 续 5 P91 · 解析 schema 标识
		// P91 引入 pymupdf4llm sidecar, sidecar 返的 raw_json 是 pymupdf 的
		// {metadata, toc_items, page_boxes, text} 数组,跟老 Qwen-VL 的
		// {pages, blocks, merged_tables} 完全不一样。 前端要按 schema 分支渲染,
		// 所以加一列标识。 旧行 default 'qwen-vl' 保持兼容, 新行 (P91 processOne) 写 'pymupdf'。
		version: 10,
		name:    "kb_doc_structure_schema",
		sql: `
ALTER TABLE kb_doc_structure ADD COLUMN schema TEXT NOT NULL DEFAULT 'qwen-vl';
`,
	},
}
