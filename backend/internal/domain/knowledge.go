package domain

// KbDocType 文档类型 —— 与前端 KbDocType 对齐。
type KbDocType string

const (
	KbDocTypeMarkdown KbDocType = "markdown"
	KbDocTypeText     KbDocType = "text"
	KbDocTypeLink     KbDocType = "link"
	// KbDocTypeUpload 来自本地文件上传的文档 —— 原始二进制存 kb_doc_uploads
	// 表,Content 字段是解析后的纯文本,供 search_kb / enrich_content 引用。
	KbDocTypeUpload KbDocType = "upload"
)

// KbDefaultQuotaBytes 每个 KB 的默认上传配额(1 GiB)。
// 上传 handler 会在请求前检查 used + fileSize <= kb.QuotaBytes,
// 超出返 413。前端按此值显示进度条。
const KbDefaultQuotaBytes int64 = 1 << 30

// KnowledgeDoc 一篇文档。
// 对齐 frontend/src/types/knowledge.ts KnowledgeDoc。
type KnowledgeDoc struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Type      KbDocType `json:"type"`
	Tags      []string  `json:"tags"`
	URL       string    `json:"url,omitempty"`
	CreatedAt string    `json:"created_at"`
	UpdatedAt string    `json:"updated_at"`

	// 上传文档的元数据(Source == "upload" 才有意义)。
	// Source 为空或 "manual" 时均为文本编辑器创建,无原始二进制。
	Source       string `json:"source,omitempty"`        // "manual" | "upload" | ""
	OriginalName string `json:"original_name,omitempty"` // 上传时的原始文件名
	MimeType     string `json:"mime_type,omitempty"`     // 原始 Content-Type
	SizeBytes    int64  `json:"size_bytes,omitempty"`    // 原始字节数
}

// KnowledgeBase 知识库(逻辑分组)。
// 对齐 frontend/src/types/knowledge.ts KnowledgeBase。
type KnowledgeBase struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Color       string          `json:"color"`
	Builtin     bool            `json:"builtin,omitempty"`
	QuotaBytes  int64           `json:"quota_bytes,omitempty"` // 单 KB 上传配额,默认 KbDefaultQuotaBytes
	Docs        []*KnowledgeDoc `json:"docs"`
	CreatedAt   string          `json:"created_at"`
	UpdatedAt   string          `json:"updated_at"`
}

func (k *KnowledgeBase) GetID() string   { return k.ID }
func (k *KnowledgeBase) IsBuiltin() bool { return k.Builtin }
func (k *KnowledgeBase) SetID(id string) { k.ID = id }

// Normalize 保证切片非 nil,补默认颜色。
func (k *KnowledgeBase) Normalize() {
	if k.Docs == nil {
		k.Docs = []*KnowledgeDoc{}
	}
	for _, d := range k.Docs {
		if d == nil {
			continue
		}
		if d.Tags == nil {
			d.Tags = []string{}
		}
		if d.Type == "" {
			d.Type = KbDocTypeMarkdown
		}
	}
	if k.Color == "" {
		k.Color = "#2b57d6"
	}
	// 老数据 / 老 fixture 走 Normalize 时也补默认配额,让 quota 字段始终有值。
	if k.QuotaBytes <= 0 {
		k.QuotaBytes = KbDefaultQuotaBytes
	}
}

// KbSearchHit 检索命中片段。
// 对齐 frontend/src/types/knowledge.ts KbSearchHit。
type KbSearchHit struct {
	KBID     string  `json:"kb_id"`
	KBName   string  `json:"kb_name"`
	DocID    string  `json:"doc_id"`
	DocTitle string  `json:"doc_title"`
	Snippet  string  `json:"snippet"`
	Score    float64 `json:"score"`
	// URL 命中文档的原始来源链接(来自 KnowledgeDoc.URL),供引用可点击跳转;无则为空。
	URL string `json:"url,omitempty"`
}
