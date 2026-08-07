// Package kb 提供知识库检索的核心算法。
//
// 与前端 mock (frontend/src/api/mock/engine.ts searchKb) 保持一致:
// tokenize(空白/标点切分 + 2-3 gram CJK 滑窗) → title×3 / tag×2 / content×1 加权
// → 每 doc 最佳片段(前后 40 字上下文)→ score 排序 top 6。
package kb

import (
	"sort"
	"strings"
	"unicode"

	"paradigm_eino_backend/internal/domain"
)

const (
	// TopK 是 Search 返回的最大命中数。
	TopK = 6
	// SnippetContextChars 是命中位置前后展开的字符数(rune 计)。
	SnippetContextChars = 40
)

// Search 在给定 KB 列表中检索 query,返回按 score 降序排列的命中片段。
//
// - kbs 是要搜索的 KB 集合(通常来自 store.List() + kbIDs 过滤)
// - query 为空或 tokenize 后为空时返回 nil
// - 每个 doc 至多贡献一条 hit(取最佳片段)
func Search(kbs []*domain.KnowledgeBase, query string) []domain.KbSearchHit {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil
	}
	tokens := tokenizeQuery(q)
	if len(tokens) == 0 {
		return nil
	}

	var hits []domain.KbSearchHit
	for _, kb := range kbs {
		if kb == nil {
			continue
		}
		for _, doc := range kb.Docs {
			if doc == nil {
				continue
			}
			hit, ok := scoreDoc(kb, doc, tokens)
			if !ok {
				continue
			}
			hits = append(hits, hit)
		}
	}

	sort.SliceStable(hits, func(i, j int) bool {
		return hits[i].Score > hits[j].Score
	})
	if len(hits) > TopK {
		hits = hits[:TopK]
	}
	return hits
}

// scoreDoc 返回 doc 匹配 tokens 的 hit。若 score<=0 返回 (_, false)。
func scoreDoc(kb *domain.KnowledgeBase, doc *domain.KnowledgeDoc, tokens []string) (domain.KbSearchHit, bool) {
	title := strings.ToLower(doc.Title)
	content := strings.ToLower(doc.Content)

	var score float64
	bestPos := -1
	bestTokenLen := 0

	for _, tk := range tokens {
		if strings.Contains(title, tk) {
			score += 3
		}
		for _, tag := range doc.Tags {
			if strings.Contains(strings.ToLower(tag), tk) {
				score += 2
				break
			}
		}
		if pos := strings.Index(content, tk); pos >= 0 {
			score++
			if bestPos < 0 {
				bestPos = pos
				bestTokenLen = len(tk)
			}
		}
	}

	if score <= 0 {
		return domain.KbSearchHit{}, false
	}

	var snippet string
	if bestPos >= 0 {
		snippet = buildSnippet(doc.Content, bestPos, bestTokenLen)
	} else {
		// 命中在 title/tag,但 content 未命中,截取正文前 80 字符
		snippet = truncateRunes(doc.Content, 80)
	}

	return domain.KbSearchHit{
		KBID:     kb.ID,
		KBName:   kb.Name,
		DocID:    doc.ID,
		DocTitle: doc.Title,
		Snippet:  snippet,
		Score:    score,
		URL:      doc.URL,
	}, true
}

// tokenizeQuery 切分 query:
//   - 按非字母数字非中文切段,过滤长度 <2 的段
//   - 对包含中文且长度 >2 的段,再滑窗补 2-字符 gram
//   - 结果去重,最多 8 个
func tokenizeQuery(q string) []string {
	q = strings.ToLower(q)
	segments := splitByNonWord(q)

	uniq := make(map[string]struct{}, 8)
	order := make([]string, 0, 8)
	add := func(s string) {
		if _, ok := uniq[s]; ok {
			return
		}
		uniq[s] = struct{}{}
		order = append(order, s)
	}

	for _, seg := range segments {
		if runeLen(seg) < 2 {
			continue
		}
		add(seg)
		if containsCJK(seg) && runeLen(seg) > 2 {
			// 2-字符滑窗
			rs := []rune(seg)
			for i := 0; i+2 <= len(rs); i++ {
				add(string(rs[i : i+2]))
			}
		}
		if len(order) >= 8 {
			break
		}
	}
	if len(order) > 8 {
		order = order[:8]
	}
	return order
}

// splitByNonWord 按空白/常见标点切段(中英文标点都包含),返回非空段。
func splitByNonWord(s string) []string {
	fields := strings.FieldsFunc(s, func(r rune) bool {
		if unicode.IsSpace(r) {
			return true
		}
		// ASCII 常见标点
		switch r {
		case ',', '.', ';', ':', '!', '?', '(', ')', '[', ']', '{', '}',
			'/', '\\', '|', '-', '_', '"', '\'':
			return true
		}
		// 中文常见标点(fullwidth)
		switch r {
		case '，', // ,
			'。', // 。
			'；', // ;
			'：', // :
			'！', // !
			'？', // ?
			'（', // (
			'）', // )
			'【', // 【
			'】', // 】
			'《', // 《
			'》', // 》
			'“', // "
			'”', // "
			'‘', // '
			'’': // '
			return true
		}
		return false
	})
	// 去空
	out := fields[:0]
	for _, f := range fields {
		if f != "" {
			out = append(out, f)
		}
	}
	return out
}

// buildSnippet 在 content 中围绕 pos 抽取上下文(前后 40 字符,rune 计)。
func buildSnippet(content string, pos, matchLen int) string {
	// pos / matchLen 是 byte 索引 —— strings.Index 返回的是 byte offset
	if pos < 0 {
		pos = 0
	}
	// 转 rune 处理,避免中文截半
	prefix := content[:pos]
	match := ""
	rest := ""
	if pos+matchLen <= len(content) {
		match = content[pos : pos+matchLen]
		rest = content[pos+matchLen:]
	} else {
		match = content[pos:]
	}

	prefixRunes := []rune(prefix)
	restRunes := []rune(rest)

	var leftEllipsis, rightEllipsis string
	if len(prefixRunes) > SnippetContextChars {
		prefixRunes = prefixRunes[len(prefixRunes)-SnippetContextChars:]
		leftEllipsis = "…"
	}
	if len(restRunes) > SnippetContextChars {
		restRunes = restRunes[:SnippetContextChars]
		rightEllipsis = "…"
	}

	body := string(prefixRunes) + match + string(restRunes)
	body = strings.ReplaceAll(body, "\n", " ")
	return leftEllipsis + body + rightEllipsis
}

func truncateRunes(s string, n int) string {
	rs := []rune(s)
	if len(rs) <= n {
		return s
	}
	return string(rs[:n]) + "…"
}

func runeLen(s string) int {
	return len([]rune(s))
}

func containsCJK(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}
