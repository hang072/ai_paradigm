package pubmed

import (
	"context"

	"paradigm_eino_backend/internal/domain"
)

// HitSource 把 *Client 适配为返回 domain.KbSearchHit 的来源,供 engine 的 litSource 使用,
// 避免 engine 直接耦合 pubmed.PubmedHit 类型。nil client 返回空结果不报错。
type HitSource struct {
	Client *Client
}

// Search 检索 PubMed 并转为 domain.KbSearchHit。client 不可用时返回 nil, nil。
func (s HitSource) Search(ctx context.Context, query string, maxResults int) ([]domain.KbSearchHit, error) {
	if s.Client == nil || !s.Client.Available() {
		return nil, nil
	}
	hits, err := s.Client.Search(ctx, query, maxResults)
	if err != nil {
		return nil, err
	}
	return ToKbSearchHits(hits), nil
}

// ToKbSearchHits 把 PubMed 检索结果转换为领域通用的 KbSearchHit 切片,
// 以便 enrich_content 等节点统一处理为"可引用来源池"。
func ToKbSearchHits(hits []PubmedHit) []domain.KbSearchHit {
	if len(hits) == 0 {
		return nil
	}
	out := make([]domain.KbSearchHit, 0, len(hits))
	for _, h := range hits {
		out = append(out, domain.KbSearchHit{
			KBID:     "pubmed",
			KBName:   "PubMed",
			DocID:    h.PMID,
			DocTitle: h.Title,
			Snippet:  snippetFromHit(h),
			Score:    0, // PubMed 不提供相关性分数
			URL:      h.URL,
		})
	}
	return out
}

// snippetFromHit 从 PubmedHit 构造一段概括文本,用作 KbSearchHit.Snippet。
func snippetFromHit(h PubmedHit) string {
	parts := make([]string, 0, 3)
	if h.Authors != "" {
		parts = append(parts, h.Authors)
	}
	if h.Journal != "" {
		parts = append(parts, h.Journal)
	}
	if h.Year != "" {
		parts = append(parts, h.Year)
	}
	s := "PubMed 收录文献"
	if len(parts) > 0 {
		s += " (" + join(parts, ", ") + ")"
	}
	if h.DOI != "" {
		s += " DOI: " + h.DOI
	}
	return s
}

func join(ss []string, sep string) string {
	if len(ss) == 0 {
		return ""
	}
	out := ss[0]
	for _, s := range ss[1:] {
		out += sep + s
	}
	return out
}