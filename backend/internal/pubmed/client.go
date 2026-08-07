// Package pubmed 封装 NCBI E-utilities 检索,提供真实文献检索/核验能力。
//
// 使用方式:
//
//	client := pubmed.NewClient(pubmed.Config{Email: "user@example.com"})
//	hits, err := client.Search(ctx, "SGLT2 inhibitor heart failure", 5)
//
// 环境变量:
//   PUBMED_EMAIL    (必填,NCBI 要求告知用途)
//   PUBMED_API_KEY  (可选,有则提升速率限制到 10 req/s,无则 3 req/s)
package pubmed

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Config 创建 Client 的配置。
type Config struct {
	// Email 是必填的,NCBI 要求在请求中附带以便联系。
	Email string
	// APIKey 可选;有则 10 req/s,无则 3 req/s。
	APIKey string
	// MaxRetries EFetch 重试次数(默认 2)。
	MaxRetries int
}

// Client 是 PubMed E-utilities 客户端,线程安全。
type Client struct {
	email    string
	apiKey   string
	baseURL  string
	client   *http.Client
	mu       sync.Mutex
	ticker   *time.Ticker
	retries  int
}

// PubmedHit 对应一条 PubMed 检索结果,用于前端展示和引用溯源。
type PubmedHit struct {
	PMID    string `json:"pmid"`
	Title   string `json:"title"`
	Authors string `json:"authors,omitempty"`  // "Zhang W, Li Y, Wang X, et al"
	Journal string `json:"journal,omitempty"`
	Year    string `json:"year,omitempty"`
	DOI     string `json:"doi,omitempty"`
	URL     string `json:"url"`                // https://pubmed.ncbi.nlm.nih.gov/PMID/
}

// Search 检索 PubMed 返回最多 maxResults 条命中。
func (c *Client) Search(ctx context.Context, query string, maxResults int) ([]PubmedHit, error) {
	if strings.TrimSpace(query) == "" {
		return nil, nil
	}

	// 1) ESearch — 拿 PMID 列表
	pmids, err := c.esearch(ctx, query, maxResults)
	if err != nil {
		return nil, fmt.Errorf("pubmed esearch: %w", err)
	}
	if len(pmids) == 0 {
		return nil, nil
	}

	// 2) EFetch — 拿详情
	return c.efetch(ctx, pmids)
}

// Verify 按标题/PMID/DOI 在 PubMed 中核验是否存在。
// 返回 nil 表示未命中(未发表或信息不匹配)。
func (c *Client) Verify(ctx context.Context, title, pmid, doi string) (*PubmedHit, error) {
	var terms []string
	if pmid != "" {
		terms = append(terms, pmid+"[pmid]")
	}
	if doi != "" {
		terms = append(terms, doi+"[doi]")
	}
	if title != "" {
		// 取前 10 个词避免超长查询,加 [title] 后缀
		words := strings.Fields(title)
		if len(words) > 10 {
			words = words[:10]
		}
		terms = append(terms, strings.Join(words, " ")+"[title]")
	}
	if len(terms) == 0 {
		return nil, errors.New("verify: at least one of title/pmid/doi required")
	}

	query := strings.Join(terms, " AND ")
	pmids, err := c.esearch(ctx, query, 3)
	if err != nil {
		return nil, err
	}
	if len(pmids) == 0 {
		return nil, nil
	}

	hits, err := c.efetch(ctx, pmids[:1])
	if err != nil {
		return nil, err
	}
	if len(hits) == 0 {
		return nil, nil
	}
	return &hits[0], nil
}

// NewClient 创建 PubMed 客户端。email 为空时从 PUBMED_EMAIL 环境变量读取。
func NewClient(cfg Config) *Client {
	email := cfg.Email
	if email == "" {
		email = os.Getenv("PUBMED_EMAIL")
	}
	apiKey := cfg.APIKey
	if apiKey == "" {
		apiKey = os.Getenv("PUBMED_API_KEY")
	}
	rateLimit := 3 // req/s
	if apiKey != "" {
		rateLimit = 10
	}
	retries := cfg.MaxRetries
	if retries <= 0 {
		retries = 2
	}

	return &Client{
		email:   email,
		apiKey:  apiKey,
		baseURL: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
		ticker:  time.NewTicker(time.Second / time.Duration(rateLimit)),
		retries: retries,
	}
}

// ——— 内部实现 ———

// esearch 调用 ESearch 拿到 PMID 列表。
func (c *Client) esearch(ctx context.Context, query string, maxResults int) ([]string, error) {
	params := url.Values{
		"db":    {"pubmed"},
		"term":  {query},
		"retmax": {strconv.Itoa(maxResults)},
		"retmode": {"xml"},
		"usehistory": {"n"},
	}
	if c.email != "" {
		params.Set("email", c.email)
	}
	if c.apiKey != "" {
		params.Set("api_key", c.apiKey)
	}

	raw, err := c.get(ctx, c.baseURL+"/esearch.fcgi?"+params.Encode())
	if err != nil {
		return nil, err
	}

	var result struct {
		IDList []string `xml:"IdList>Id"`
	}
	if err := xml.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("esearch xml decode: %w", err)
	}
	return result.IDList, nil
}

// efetch 调用 EFetch 获取文献详情。
func (c *Client) efetch(ctx context.Context, pmids []string) ([]PubmedHit, error) {
	if len(pmids) == 0 {
		return nil, nil
	}

	params := url.Values{
		"db":      {"pubmed"},
		"id":      {strings.Join(pmids, ",")},
		"retmode": {"xml"},
		"rettype": {"abstract"},
	}
	if c.email != "" {
		params.Set("email", c.email)
	}
	if c.apiKey != "" {
		params.Set("api_key", c.apiKey)
	}

	raw, err := c.get(ctx, c.baseURL+"/efetch.fcgi?"+params.Encode())
	if err != nil {
		return nil, err
	}
	return c.parseEfetch(raw)
}

// parseEfetch 解析 EFetch 返回的 XML(拆出来便于单测,不发网络)。
func (c *Client) parseEfetch(raw []byte) ([]PubmedHit, error) {
	// 根元素 <PubmedArticleSet>,直接子元素 <PubmedArticle>。
	var result struct {
		XMLName  xml.Name `xml:"PubmedArticleSet"`
		Articles []struct {
			MedlineCitation struct {
				PMID    string `xml:"PMID"`
				Article struct {
					ArticleTitle string `xml:"ArticleTitle"`
					Journal      struct {
						Title           string `xml:"Title"`
						ISOAbbreviation string `xml:"ISOAbbreviation"`
						JournalIssue    struct {
							PubDate struct {
								Year string `xml:"Year"`
							} `xml:"PubDate"`
						} `xml:"JournalIssue"`
					} `xml:"Journal"`
					AuthorList []struct {
						LastName string `xml:"LastName"`
						ForeName string `xml:"ForeName"`
					} `xml:"AuthorList>Author"`
					ELocationID []struct {
						EIDType string `xml:"EIdType,attr"`
						Value   string `xml:",chardata"`
					} `xml:"ELocationID"`
				} `xml:"Article"`
			} `xml:"MedlineCitation"`
		} `xml:"PubmedArticle"`
	}

	if err := xml.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("efetch xml decode: %w", err)
	}

	hits := make([]PubmedHit, 0, len(result.Articles))
	for _, a := range result.Articles {
		hit := PubmedHit{
			PMID:  a.MedlineCitation.PMID,
			Title: a.MedlineCitation.Article.ArticleTitle,
			URL:   "https://pubmed.ncbi.nlm.nih.gov/" + a.MedlineCitation.PMID + "/",
		}

		// Journal
		j := a.MedlineCitation.Article.Journal
		if j.Title != "" {
			hit.Journal = j.Title
		} else if j.ISOAbbreviation != "" {
			hit.Journal = j.ISOAbbreviation
		}
		if j.JournalIssue.PubDate.Year != "" {
			hit.Year = j.JournalIssue.PubDate.Year
		}

		// Authors: 最多 3 个 + et al
		authors := a.MedlineCitation.Article.AuthorList
		if len(authors) > 0 {
			var names []string
			for i, auth := range authors {
				if i >= 3 {
					names = append(names, "et al")
					break
				}
				name := strings.TrimSpace(auth.LastName)
				if auth.ForeName != "" {
					name = auth.LastName + " " + string([]rune(auth.ForeName)[:1])
				}
				names = append(names, strings.TrimSpace(name))
			}
			hit.Authors = strings.Join(names, ", ")
		}

		// DOI
		for _, eid := range a.MedlineCitation.Article.ELocationID {
			if eid.EIDType == "doi" {
				hit.DOI = eid.Value
				break
			}
		}

		hits = append(hits, hit)
	}
	return hits, nil
}

// get 执行 HTTP GET + 速率限制 + 重试。
func (c *Client) get(ctx context.Context, urlStr string) ([]byte, error) {
	// 速率限制
	c.mu.Lock()
	select {
	case <-c.ticker.C:
	case <-ctx.Done():
		c.mu.Unlock()
		return nil, ctx.Err()
	}
	c.mu.Unlock()

	var lastErr error
	for i := 0; i <= c.retries; i++ {
		if i > 0 {
			// 退避: 500ms, 1s
			time.Sleep(time.Duration(i*500) * time.Millisecond)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "paradigm-eino/1.0 (mailto:"+c.email+")")

		resp, err := c.client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			lastErr = fmt.Errorf("pubmed rate limited (429)")
			time.Sleep(2 * time.Second)
			continue
		}
		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("pubmed HTTP %d: %s", resp.StatusCode, string(body[:min(len(body), 200)]))
			continue
		}
		return body, nil
	}
	return nil, lastErr
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// Available 返回客户端是否可用的快速判断(至少 email 已配)。
func (c *Client) Available() bool {
	return c.email != "" && c.client != nil
}