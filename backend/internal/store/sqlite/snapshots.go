package sqlite

import (
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/store"
)

// TaskSnapshots 是 store.TaskSnapshotStore 的 SQLite 实现。
//
// 与 CheckpointStore 平行:
//   - CheckpointStore 存 Eino 的字节状态 (compose 序列化)
//   - TaskSnapshots 存 domain.TaskSnapshot JSON, 供 HTTP handler 直接读
type TaskSnapshots struct {
	db *sql.DB
	mu sync.Mutex // 生成 ThreadID 时的并发防护
}

func NewTaskSnapshots(db *sql.DB) *TaskSnapshots {
	return &TaskSnapshots{db: db}
}

func (s *TaskSnapshots) Create(t *domain.TaskSnapshot) *domain.TaskSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()

	if t.ThreadID == "" {
		t.ThreadID = domain.IDPrefixTask + randomHex(4)
	}
	stored := t.Clone() // 存储的副本, 与调用方持有的指针解耦
	data, err := json.Marshal(stored)
	if err != nil {
		panic(err)
	}
	_, err = s.db.Exec(`
INSERT INTO task_snapshots(thread_id, status, created_at, updated_at, data)
VALUES(?, ?, ?, ?, ?)
ON CONFLICT(thread_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, data=excluded.data
`, stored.ThreadID, string(stored.Status), stored.CreatedAt, time.Now().Unix(), string(data))
	if err != nil {
		panic(err)
	}
	return stored.Clone()
}

func (s *TaskSnapshots) Get(id string) (*domain.TaskSnapshot, bool) {
	var raw string
	err := s.db.QueryRow(`SELECT data FROM task_snapshots WHERE thread_id=?`, id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false
	}
	if err != nil {
		panic(err)
	}
	t := &domain.TaskSnapshot{}
	if err := json.Unmarshal([]byte(raw), t); err != nil {
		panic(err)
	}
	return t, true
}

func (s *TaskSnapshots) List() []*domain.TaskSnapshot {
	rows, err := s.db.Query(`SELECT data FROM task_snapshots ORDER BY created_at DESC`)
	if err != nil {
		panic(err)
	}
	defer rows.Close()

	out := []*domain.TaskSnapshot{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			panic(err)
		}
		t := &domain.TaskSnapshot{}
		if err := json.Unmarshal([]byte(raw), t); err != nil {
			panic(err)
		}
		out = append(out, t)
	}
	// 保险:CreatedAt 是 YYYY-MM-DD HH:mm:ss 字符串, lex 排序恰好等价时间排序。
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out
}

// Update 读-改-写。事务内保证原子性。
func (s *TaskSnapshots) Update(id string, mut func(*domain.TaskSnapshot)) (*domain.TaskSnapshot, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var raw string
	err = tx.QueryRow(`SELECT data FROM task_snapshots WHERE thread_id=?`, id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrTaskNotFound
	}
	if err != nil {
		return nil, err
	}
	t := &domain.TaskSnapshot{}
	if err := json.Unmarshal([]byte(raw), t); err != nil {
		return nil, err
	}
	mut(t)
	data, err := json.Marshal(t)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`UPDATE task_snapshots SET status=?, updated_at=?, data=? WHERE thread_id=?`,
		string(t.Status), time.Now().Unix(), string(data), id); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return t.Clone(), nil
}
