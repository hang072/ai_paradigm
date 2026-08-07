package pubmed

import (
	"encoding/xml"
	"testing"
)

// TestEfetchXMLParsing 验证 EFetch XML 解析能正确抽取标题/作者/期刊/年份/DOI。
// 用一段裁剪过的真实 PubMed EFetch 响应作为夹具,不发网络请求。
func TestEfetchXMLParsing(t *testing.T) {
	const sample = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>37622657</PMID>
      <Article>
        <Journal>
          <ISOAbbreviation>Eur Heart J</ISOAbbreviation>
          <Title>European Heart Journal</Title>
          <JournalIssue>
            <PubDate><Year>2023</Year></PubDate>
          </JournalIssue>
        </Journal>
        <ArticleTitle>2023 ESC Guidelines for the management of cardiomyopathies.</ArticleTitle>
        <AuthorList>
          <Author><LastName>Arbelo</LastName><ForeName>Elena</ForeName></Author>
          <Author><LastName>Protonotarios</LastName><ForeName>Alexandros</ForeName></Author>
          <Author><LastName>Gimeno</LastName><ForeName>Juan</ForeName></Author>
          <Author><LastName>Extra</LastName><ForeName>Person</ForeName></Author>
        </AuthorList>
        <ELocationID EIdType="doi" ValidYN="Y">10.1093/eurheartj/ehad194</ELocationID>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`

	c := &Client{}
	hits, err := c.parseEfetch([]byte(sample))
	if err != nil {
		t.Fatalf("parseEfetch error: %v", err)
	}
	if len(hits) != 1 {
		t.Fatalf("want 1 hit, got %d", len(hits))
	}
	h := hits[0]
	if h.PMID != "37622657" {
		t.Errorf("PMID = %q", h.PMID)
	}
	if h.Title == "" {
		t.Errorf("Title empty")
	}
	if h.Journal != "European Heart Journal" {
		t.Errorf("Journal = %q", h.Journal)
	}
	if h.Year != "2023" {
		t.Errorf("Year = %q", h.Year)
	}
	if h.DOI != "10.1093/eurheartj/ehad194" {
		t.Errorf("DOI = %q", h.DOI)
	}
	if h.URL != "https://pubmed.ncbi.nlm.nih.gov/37622657/" {
		t.Errorf("URL = %q", h.URL)
	}
	// 作者应截断到 3 个 + "et al"
	wantAuthors := "Arbelo E, Protonotarios A, Gimeno J, et al"
	if h.Authors != wantAuthors {
		t.Errorf("Authors = %q, want %q", h.Authors, wantAuthors)
	}
}

// TestEfetchEmptyXML 验证空/无文章的 XML 返回空切片而非报错。
func TestEfetchEmptyXML(t *testing.T) {
	c := &Client{}
	hits, err := c.parseEfetch([]byte(`<PubmedArticleSet></PubmedArticleSet>`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(hits) != 0 {
		t.Fatalf("want 0 hits, got %d", len(hits))
	}
}

// TestToKbSearchHits 验证 PubMed → KbSearchHit 转换保留 URL 与标题。
func TestToKbSearchHits(t *testing.T) {
	in := []PubmedHit{{
		PMID:  "123",
		Title: "Test Article",
		URL:   "https://pubmed.ncbi.nlm.nih.gov/123/",
		DOI:   "10.1/x",
	}}
	out := ToKbSearchHits(in)
	if len(out) != 1 {
		t.Fatalf("want 1, got %d", len(out))
	}
	if out[0].URL != in[0].URL {
		t.Errorf("URL not preserved: %q", out[0].URL)
	}
	if out[0].DocTitle != "Test Article" {
		t.Errorf("Title not preserved: %q", out[0].DocTitle)
	}
	if out[0].KBName != "PubMed" {
		t.Errorf("KBName = %q", out[0].KBName)
	}
}

// 确保 xml 包被引用(fixture 里手写 XML 已足够,这里只是防止 import 漂移)。
var _ = xml.Unmarshal