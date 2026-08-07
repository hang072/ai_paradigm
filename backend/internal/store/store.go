package store

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
)

// Entity 是可存储对象的最小契约。
//
// 用指针接收者实现,因为 SetID 需要写回。所有 domain 实体都实现了。
type Entity interface {
	GetID() string
	IsBuiltin() bool
	SetID(id string)
	Normalize()
}

// Store 是通用的实体存储层接口。
type Store[T Entity] interface {
	// Seed 直接放入(用于装 fixtures),不校验 id 是否已存在(覆盖)。
	Seed(t T)
	List() []T
	Get(id string) (T, bool)
	// Create:若 t 的 id 为空,自动生成 idPrefix+hex(4B);否则用调用方给的 id。
	Create(t T) T
	// Update:定位到已有实体,把 patch 后的字段覆盖回去。
	// - 若不存在返回 ErrNotFound
	// - 若实体 IsBuiltin() 且 lockBuiltin=true,返回 ErrBuiltinLocked
	// patch 是"就地修改"回调:handler 层负责把请求 body 映射为字段变更。
	Update(id string, lockBuiltin bool, patch func(cur T) error) (T, error)
	// Delete:若不存在返回 ErrNotFound;若 IsBuiltin() 返回 ErrBuiltinLocked。
	Delete(id string) error
}

// Memory 是 Store 的内存实现。
type Memory[T Entity] struct {
	mu       sync.RWMutex
	items    map[string]T
	idPrefix string
}

// NewMemory 构造内存 store。idPrefix 用于自动生成 id(如 "agent-")。
func NewMemory[T Entity](idPrefix string) *Memory[T] {
	return &Memory[T]{
		items:    make(map[string]T),
		idPrefix: idPrefix,
	}
}

func (m *Memory[T]) Seed(t T) {
	t.Normalize()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.items[t.GetID()] = t
}

func (m *Memory[T]) List() []T {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]T, 0, len(m.items))
	for _, v := range m.items {
		out = append(out, v)
	}
	return out
}

func (m *Memory[T]) Get(id string) (T, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	v, ok := m.items[id]
	return v, ok
}

func (m *Memory[T]) Create(t T) T {
	if t.GetID() == "" {
		t.SetID(m.idPrefix + randomHex(4))
	}
	t.Normalize()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.items[t.GetID()] = t
	return t
}

func (m *Memory[T]) Update(id string, lockBuiltin bool, patch func(cur T) error) (T, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cur, ok := m.items[id]
	var zero T
	if !ok {
		return zero, ErrNotFound
	}
	if lockBuiltin && cur.IsBuiltin() {
		return zero, ErrBuiltinLocked
	}
	if err := patch(cur); err != nil {
		return zero, err
	}
	cur.Normalize()
	// 强制 id 不变。
	cur.SetID(id)
	m.items[id] = cur
	return cur, nil
}

func (m *Memory[T]) Delete(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cur, ok := m.items[id]
	if !ok {
		return ErrNotFound
	}
	if cur.IsBuiltin() {
		return ErrBuiltinLocked
	}
	delete(m.items, id)
	return nil
}

// randomHex 返回 n 字节随机数据的小写十六进制表示(长度为 2n)。
func randomHex(n int) string {
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}
