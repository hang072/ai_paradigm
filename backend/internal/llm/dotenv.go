// Package llm 提供 LLM Provider 抽象。
// 本文件是一个极简 .env 加载器:只支持 KEY=VALUE 行,忽略注释和空行,不引任何第三方依赖。
// 只在环境变量当前为空时才写入,不覆盖已存在的 env(命令行 export 优先)。
package llm

import (
	"bufio"
	"os"
	"strings"
)

// LoadDotEnv 尝试从 path(相对当前工作目录)读取 .env 并注入进程环境。
// path 不存在直接返回 nil,不作为错误。已存在的 env 变量不被覆盖。
func LoadDotEnv(path string) error {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		val := strings.TrimSpace(line[eq+1:])
		// 剥两侧引号(如果有)
		if len(val) >= 2 {
			if (val[0] == '"' && val[len(val)-1] == '"') ||
				(val[0] == '\'' && val[len(val)-1] == '\'') {
				val = val[1 : len(val)-1]
			}
		}
		if _, ok := os.LookupEnv(key); ok {
			continue // 命令行/系统 env 优先
		}
		_ = os.Setenv(key, val)
	}
	return scanner.Err()
}
