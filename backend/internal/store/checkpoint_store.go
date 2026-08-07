package store

import (
	"context"
	"sync"

	"github.com/cloudwego/eino/compose"
)

// MemCheckpointStore 是 Eino compose.CheckPointStore 的内存实现。
//
// Eino 在 Graph 遇到 interrupt / 节点跑完时把状态序列化后写入,
// resume 时读回。key 就是我们的 taskID(通过 compose.WithCheckPointID 传入)。
//
// v0.9 官方测试(compose/checkpoint_test.go)也是同款 map[string][]byte 实现,
// 但没加锁。我们的 executor 会有并发(HTTP handler 起 goroutine 跑图),
// 所以加 RWMutex。
type MemCheckpointStore struct {
	mu sync.RWMutex
	m  map[string][]byte
}

// NewMemCheckpointStore 构造一个空的内存 checkpoint store。
func NewMemCheckpointStore() *MemCheckpointStore {
	return &MemCheckpointStore{m: make(map[string][]byte)}
}

// Get 实现 compose.CheckPointStore。
func (s *MemCheckpointStore) Get(_ context.Context, id string) ([]byte, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.m[id]
	if !ok {
		return nil, false, nil
	}
	// 返回副本,避免调用方修改内部字节。
	cp := make([]byte, len(v))
	copy(cp, v)
	return cp, true, nil
}

// Set 实现 compose.CheckPointStore。
func (s *MemCheckpointStore) Set(_ context.Context, id string, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]byte, len(data))
	copy(cp, data)
	s.m[id] = cp
	return nil
}

// 编译期断言:必须满足 compose.CheckPointStore 接口。
var _ compose.CheckPointStore = (*MemCheckpointStore)(nil)
