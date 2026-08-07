package sqlite

import (
	"database/sql"
	"errors"
)

// Settings 是一个 key -> JSON string 的 KV 表。
//
// 目前存 llm_config (前端整个 { activeConfigId, modelConfigs } JSON)。
type Settings struct {
	db *sql.DB
}

func NewSettings(db *sql.DB) *Settings {
	return &Settings{db: db}
}

// Get 返回 raw JSON string; 不存在返回 ("", false, nil)。
func (s *Settings) Get(key string) (string, bool, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key=?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

// Set 覆盖写入 JSON string。
func (s *Settings) Set(key, value string) error {
	_, err := s.db.Exec(`
INSERT INTO settings(key, value) VALUES(?, ?)
ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}
