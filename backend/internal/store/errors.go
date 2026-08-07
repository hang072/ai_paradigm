// Package store 提供领域实体的存储层。
//
// S1 阶段:泛型内存 store,单进程内存 map + 读写锁。
// S6 阶段:换 SQLite 实现,接口不变。
package store

import "errors"

// ErrNotFound 由 Get / Update / Delete 在实体不存在时返回。
// handler 层将其映射为 404。
var ErrNotFound = errors.New("not found")

// ErrBuiltinLocked 由 Update / Delete 在实体是内置数据时返回。
// handler 层将其映射为 400。
var ErrBuiltinLocked = errors.New("builtin locked")
