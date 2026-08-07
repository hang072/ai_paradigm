package store

import (
	"errors"
	"sort"
	"sync"

	"paradigm_eino_backend/internal/domain"
)

// TaskSnapshotStore 是任务快照的读写接口。
//
// 与 Eino CheckpointStore 平行存在:
//   - CheckpointStore 存 []byte,给 Eino 的 Graph 用(存 interrupt 上下文、图状态)
//   - TaskSnapshotStore 存 *TaskSnapshot,给 HTTP handler 直接读(GET /api/tasks / GET /api/tasks/:id)
//
// 二者用同一个 task_id 作为 key,内容互补。
type TaskSnapshotStore interface {
	// Create 写入新快照;若 t.ThreadID 为空,自动生成 "task-xxxx" id。
	// 返回克隆的副本(调用方持有独立拷贝)。
	Create(t *domain.TaskSnapshot) *domain.TaskSnapshot

	// Get 按 id 取快照;返回克隆副本;不存在返回 (nil, false)。
	Get(id string) (*domain.TaskSnapshot, bool)

	// List 返回所有快照;每个元素都是克隆副本;按 CreatedAt 降序。
	List() []*domain.TaskSnapshot

	// Update 就地修改快照。mut 回调在写锁内被调用,拿到的 *TaskSnapshot 是真实存储对象。
	//
	// ⚠️ 约束:mut 里只做字段赋值,不要再调本 store 的其他方法(会死锁)。
	// 结束时返回克隆副本给调用方。
	Update(id string, mut func(*domain.TaskSnapshot)) (*domain.TaskSnapshot, error)
}

// ErrTaskNotFound 由 Update 在 id 不存在时返回。
var ErrTaskNotFound = errors.New("task not found")

// MemTaskSnapshotStore 是 TaskSnapshotStore 的内存实现。
type MemTaskSnapshotStore struct {
	mu    sync.RWMutex
	items map[string]*domain.TaskSnapshot
}

// NewMemTaskSnapshotStore 构造。
func NewMemTaskSnapshotStore() *MemTaskSnapshotStore {
	return &MemTaskSnapshotStore{items: make(map[string]*domain.TaskSnapshot)}
}

// Create 添加新快照。
func (s *MemTaskSnapshotStore) Create(t *domain.TaskSnapshot) *domain.TaskSnapshot {
	if t.ThreadID == "" {
		t.ThreadID = domain.IDPrefixTask + randomHex(4)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// 存入的是我们持有的引用(不深拷贝),后续 Update 会就地改。
	// 但 Create 时先克隆一份,避免调用方保留同一个指针再改。
	stored := t.Clone()
	s.items[stored.ThreadID] = stored
	// 返回再克隆一份给调用方。
	return stored.Clone()
}

// Get 取快照(克隆)。
func (s *MemTaskSnapshotStore) Get(id string) (*domain.TaskSnapshot, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.items[id]
	if !ok {
		return nil, false
	}
	return v.Clone(), true
}

// List 全部快照,按 CreatedAt 降序。
func (s *MemTaskSnapshotStore) List() []*domain.TaskSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*domain.TaskSnapshot, 0, len(s.items))
	for _, v := range s.items {
		out = append(out, v.Clone())
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
}

// Update 就地修改,mut 结束后返回克隆。
func (s *MemTaskSnapshotStore) Update(id string, mut func(*domain.TaskSnapshot)) (*domain.TaskSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.items[id]
	if !ok {
		return nil, ErrTaskNotFound
	}
	mut(v)
	return v.Clone(), nil
}
