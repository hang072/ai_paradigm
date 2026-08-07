package sqlite

import (
	"crypto/rand"
	"encoding/hex"
)

// randomHex 返回 n 字节随机数据的小写十六进制表示 (长度 2n)。
// 与 internal/store/store.go 里的同名函数保持一致 —— 那边是 package-private, 这里独立再放一份避免循环依赖。
func randomHex(n int) string {
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}
