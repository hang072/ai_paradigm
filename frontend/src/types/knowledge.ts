/**
 * 知识库模型 —— 前端 mock 版。
 * KnowledgeBase 是一个逻辑分组(比如"临床指南"、"内部 SOP"),
 * 里面装若干 KnowledgeDoc(纯文本 / Markdown 段落 / 本地上传文件)。
 * search_kb 工具会在启用的知识库范围内做关键字命中,把片段回填到工具轨迹。
 */
export type KbDocType = 'markdown' | 'text' | 'link' | 'upload';

export interface KnowledgeDoc {
  id: string;
  title: string;
  /** 全文内容(markdown/text/upload 解析后的纯文本)或外链摘要 */
  content: string;
  type: KbDocType;
  /** 逗号分隔的标签,便于筛选 */
  tags: string[];
  /** 若 type==='link' 才有 */
  url?: string;
  /** 'manual' = 文本编辑器创建;'upload' = 本地文件上传 */
  source?: 'manual' | 'upload' | '';
  /** upload 才有: 原始文件名 */
  original_name?: string;
  /** upload 才有: 原始 Content-Type */
  mime_type?: string;
  /** upload 才有: 原始字节数 */
  size_bytes?: number;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  /** UI 展示色 */
  color: string;
  builtin?: boolean;
  /** 单 KB 上传配额(字节),后端默认 1 GiB */
  quota_bytes?: number;
  docs: KnowledgeDoc[];
  created_at: string;
  updated_at: string;
}

/** 检索命中片段 */
export interface KbSearchHit {
  kb_id: string;
  kb_name: string;
  doc_id: string;
  doc_title: string;
  /** 命中的 chunk 唯一 id("doc-xxx:N")。 */
  chunk_id?: string;
  /** 命中处上下文片段(chunk 原文)。 */
  snippet: string;
  /** chunk 位置: "第 3 页" / "## 心衰诊治" 等(阶段 5 续 3 新增)。 */
  location?: string;
  score: number;
  /** 命中文档的原始来源链接(来自 KnowledgeDoc.url),供引用可点击跳转 */
  url?: string;
}

/** 阶段 5 续 5: 文档结构化抽取结果(后端 sidecar 返)。 */
export interface DocStructureBlock {
  type: 'title' | 'text' | 'list' | 'table' | 'formula' | 'figure' | string;
  content?: string;
  latex?: string;
  caption?: string;
}

export interface DocStructurePage {
  page: number;
  blocks: DocStructureBlock[];
}

export interface DocStructure {
  doc_id: string;
  kb_id: string;
  pages_n: number;
  markdown: string;
  /** VLM 原始返的 pages/blocks JSON, 后端会做 json.Unmarshal。 pymupdf 时是 page_chunks 数组而非 {pages, blocks}, 需用 structure_schema 分支 */
  structure: { pages?: DocStructurePage[]; merged_tables?: DocStructureTable[] };
  /** P91: 后端填的 schema 标识 "qwen-vl" | "pymupdf" | "" (空 = 旧数据 Qwen-VL) */
  structure_schema?: 'qwen-vl' | 'pymupdf' | string;
  /** P85: pdfcpu 抽出的 embedded images, [{idx, filename, file_type, byte_size, width, height, page_nr, obj_nr}] */
  images: DocStructureImage[];
  updated_at: string;
}

export interface DocStructureTable {
  header: string[];
  rows: string[][];
  source_pages: number[];
}

/** P85: 抽出的图片元数据 — 二进制走 GET /api/kb/{id}/docs/{docId}/images/{filename}。 */
export interface DocStructureImage {
  idx: number;
  /** 相对路径文件名, 如 "image_001.jpg"。 前端拼 URL 走 handleGetDocImage。 */
  filename: string;
  file_type: string; // jpg / png / jpeg / webp / tif
  byte_size: number;
  width: number;
  height: number;
  page_nr: number; // 1-based
  obj_nr: number;
}
