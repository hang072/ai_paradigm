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
}
