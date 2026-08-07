package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/cloudwego/eino/compose"
)

// Checkpoints 是 compose.CheckPointStore 的 SQLite 实现。
//
// 简单 KV: task_id -> data (BLOB)。Eino 只关心 Get/Set 语义, 与内存实现完全一致。
type Checkpoints struct {
	db *sql.DB
}

func NewCheckpoints(db *sql.DB) *Checkpoints {
	return &Checkpoints{db: db}
}

func (c *Checkpoints) Get(_ context.Context, id string) ([]byte, bool, error) {
	var data []byte
	err := c.db.QueryRow(`SELECT data FROM task_checkpoints WHERE task_id=?`, id).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	// 返回副本, 与 MemCheckpointStore 行为一致
	cp := make([]byte, len(data))
	copy(cp, data)
	return cp, true, nil
}

func (c *Checkpoints) Set(_ context.Context, id string, data []byte) error {
	_, err := c.db.Exec(`
INSERT INTO task_checkpoints(task_id, data, updated_at) VALUES(?, ?, ?)
ON CONFLICT(task_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
`, id, data, time.Now().Unix())
	return err
}

// 编译期断言
var _ compose.CheckPointStore = (*Checkpoints)(nil)
