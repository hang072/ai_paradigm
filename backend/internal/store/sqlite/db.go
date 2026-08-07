// Package sqlite 提供 paradigm_eino 后端的 SQLite 持久化实现。
//
// 设计要点:
//   - 用 modernc.org/sqlite (纯 Go, 无 CGO), Windows 直接 go build 通过。
//   - WAL 模式 + foreign_keys=ON, 单进程后端下并发够用。
//   - 一个 *sql.DB 全局共享, 所有 Store 实现都从这里取。
//   - Migrations 用简单的顺序执行 SQL, 不引额外框架 —— MVP 阶段这样最直白。
package sqlite

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite" // driver name: "sqlite"
)

// Open 打开(或创建) SQLite 数据库并跑 migrations。
//
// path 通常是 "backend/data/app.db"。父目录不存在时自动创建。
func Open(path string) (*sql.DB, error) {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("mkdir data dir %s: %w", dir, err)
		}
	}

	// 连接串: WAL / foreign_keys / busy_timeout(15s)
	// modernc.org/sqlite 用 _pragma= 传初始化 PRAGMA。
	// busy_timeout 从 5s 提到 15s: 长事务 (task snapshot 更新 + 消息批量插入)
	// 场景下 5s 会超时抛 SQLITE_BUSY, 前端表现为 500。
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(15000)&_pragma=synchronous(NORMAL)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite %s: %w", path, err)
	}

	// SQLite 写锁全库唯一。单进程后端下, MaxOpenConns=1 是 modernc.org/sqlite
	// 社区推荐做法: 所有写操作在 Go 层排队, 消除 SQLITE_BUSY(5)。
	// 读操作虽然也走同一连接会稍慢, 但 MVP 单用户场景吞吐完全够用;
	// 出现瓶颈时再切成 "1 写连接 + N 读连接" 的 sqlx 分池方案。
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite %s: %w", path, err)
	}

	if err := migrate(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	log.Printf("[sqlite] opened %s (WAL, foreign_keys=ON)", path)
	return db, nil
}

// migrate 顺序执行 migrations 列表, 用 schema_migrations 表记录已跑的版本。
func migrate(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);`); err != nil {
		return err
	}

	applied := map[int]bool{}
	rows, err := db.Query(`SELECT version FROM schema_migrations`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return err
		}
		applied[v] = true
	}
	rows.Close()

	for _, m := range migrations {
		if applied[m.version] {
			continue
		}
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(m.sql); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migration %d (%s): %w", m.version, m.name, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES(?, strftime('%s','now'))`, m.version); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		log.Printf("[sqlite] migration %d applied: %s", m.version, m.name)
	}

	return nil
}
