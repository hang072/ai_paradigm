package sqlite

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"paradigm_eino_backend/internal/store"
)

// Entities 是 store.Store[T] 的 SQLite 实现,底层用一张通用 KV 表 (entities)。
//
// 每种实体在同一张表里共享 schema, 用 kind 字段区分, data 列存 JSON。
// 好处:domain 结构体加字段不用迁移表。
type Entities[T store.Entity] struct {
	db       *sql.DB
	kind     string   // "agent" / "node" / "template" / "skill" / "kb" ...
	idPrefix string   // 用于 Create 时生成 id
	factory  func() T // 构造零值实体供 unmarshal (T 通常是 *domain.XxxDef)
	mu       sync.Mutex // 保护 Create 生成 id 的临界区; 其余走 sql
}

// NewEntities 构造。factory 返回一个 T 的零值 (用于 Scan 时 unmarshal 目标)。
//
// 用法示例:
//
//	agents := sqlite.NewEntities[*domain.AgentDef](db, "agent", domain.IDPrefixAgent,
//	    func() *domain.AgentDef { return &domain.AgentDef{} })
func NewEntities[T store.Entity](db *sql.DB, kind, idPrefix string, factory func() T) *Entities[T] {
	return &Entities[T]{db: db, kind: kind, idPrefix: idPrefix, factory: factory}
}

// Seed 直接写入 (供 fixtures 用), 不校验存在性; 走 UPSERT。
func (e *Entities[T]) Seed(t T) {
	t.Normalize()
	data, err := json.Marshal(t)
	if err != nil {
		panic(fmt.Errorf("sqlite entities seed marshal (%s/%s): %w", e.kind, t.GetID(), err))
	}
	now := time.Now().Unix()
	builtin := 0
	if t.IsBuiltin() {
		builtin = 1
	}
	_, err = e.db.Exec(`
INSERT INTO entities(kind, id, builtin, data, created_at, updated_at)
VALUES(?, ?, ?, ?, ?, ?)
ON CONFLICT(kind, id) DO UPDATE SET builtin=excluded.builtin, data=excluded.data, updated_at=excluded.updated_at
`, e.kind, t.GetID(), builtin, string(data), now, now)
	if err != nil {
		panic(fmt.Errorf("sqlite entities seed (%s/%s): %w", e.kind, t.GetID(), err))
	}
}

func (e *Entities[T]) List() []T {
	rows, err := e.db.Query(`SELECT data FROM entities WHERE kind=? ORDER BY id`, e.kind)
	if err != nil {
		panic(fmt.Errorf("sqlite entities list (%s): %w", e.kind, err))
	}
	defer rows.Close()

	out := []T{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			panic(err)
		}
		t := e.factory()
		if err := json.Unmarshal([]byte(raw), t); err != nil {
			panic(fmt.Errorf("sqlite entities unmarshal (%s): %w", e.kind, err))
		}
		out = append(out, t)
	}
	return out
}

func (e *Entities[T]) Get(id string) (T, bool) {
	var raw string
	err := e.db.QueryRow(`SELECT data FROM entities WHERE kind=? AND id=?`, e.kind, id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		var zero T
		return zero, false
	}
	if err != nil {
		panic(err)
	}
	t := e.factory()
	if err := json.Unmarshal([]byte(raw), t); err != nil {
		panic(err)
	}
	return t, true
}

func (e *Entities[T]) Create(t T) T {
	e.mu.Lock()
	defer e.mu.Unlock()

	if t.GetID() == "" {
		t.SetID(e.idPrefix + randomHex(4))
	}
	t.Normalize()
	data, err := json.Marshal(t)
	if err != nil {
		panic(err)
	}
	now := time.Now().Unix()
	builtin := 0
	if t.IsBuiltin() {
		builtin = 1
	}
	_, err = e.db.Exec(`
INSERT INTO entities(kind, id, builtin, data, created_at, updated_at)
VALUES(?, ?, ?, ?, ?, ?)
`, e.kind, t.GetID(), builtin, string(data), now, now)
	if err != nil {
		panic(fmt.Errorf("sqlite entities create (%s): %w", e.kind, err))
	}
	return t
}

func (e *Entities[T]) Update(id string, lockBuiltin bool, patch func(cur T) error) (T, error) {
	var zero T

	tx, err := e.db.Begin()
	if err != nil {
		return zero, err
	}
	defer tx.Rollback()

	var raw string
	var builtin int
	err = tx.QueryRow(`SELECT data, builtin FROM entities WHERE kind=? AND id=?`, e.kind, id).Scan(&raw, &builtin)
	if errors.Is(err, sql.ErrNoRows) {
		return zero, store.ErrNotFound
	}
	if err != nil {
		return zero, err
	}
	if lockBuiltin && builtin == 1 {
		return zero, store.ErrBuiltinLocked
	}

	cur := e.factory()
	if err := json.Unmarshal([]byte(raw), cur); err != nil {
		return zero, err
	}
	if err := patch(cur); err != nil {
		return zero, err
	}
	cur.Normalize()
	cur.SetID(id) // 强制 id 不变

	data, err := json.Marshal(cur)
	if err != nil {
		return zero, err
	}
	newBuiltin := 0
	if cur.IsBuiltin() {
		newBuiltin = 1
	}
	if _, err := tx.Exec(`UPDATE entities SET data=?, builtin=?, updated_at=? WHERE kind=? AND id=?`,
		string(data), newBuiltin, time.Now().Unix(), e.kind, id); err != nil {
		return zero, err
	}
	if err := tx.Commit(); err != nil {
		return zero, err
	}
	return cur, nil
}

func (e *Entities[T]) Delete(id string) error {
	var builtin int
	err := e.db.QueryRow(`SELECT builtin FROM entities WHERE kind=? AND id=?`, e.kind, id).Scan(&builtin)
	if errors.Is(err, sql.ErrNoRows) {
		return store.ErrNotFound
	}
	if err != nil {
		return err
	}
	if builtin == 1 {
		return store.ErrBuiltinLocked
	}
	_, err = e.db.Exec(`DELETE FROM entities WHERE kind=? AND id=?`, e.kind, id)
	return err
}
