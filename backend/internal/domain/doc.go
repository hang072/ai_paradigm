// Package domain 定义与前端 TS 类型 1:1 对应的领域结构体。
//
// 每个类型:
//   - 字段名走 Go 惯例(PascalCase),JSON tag 保持 snake_case
//   - 实现 store.Entity 接口(GetID / IsBuiltin)
//   - 提供 ID 前缀常量,给 store 生成新 id 时用
package domain

// ID 前缀常量 —— 与前端 fixture 一致,便于跨端排错。
const (
	IDPrefixAgent    = "agent-"
	IDPrefixNode     = "node-"
	IDPrefixTemplate = "tpl-"
	IDPrefixSkill    = "skill-"
	IDPrefixTask     = "task-"
	IDPrefixKB       = "kb-"
	IDPrefixDoc      = "doc-"
)
