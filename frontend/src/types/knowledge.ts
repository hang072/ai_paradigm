/**
 * 知识库模型 —— 前端 mock 版。
 * KnowledgeBase 是一个逻辑分组(比如"临床指南"、"内部 SOP"),
 * 里面装若干 KnowledgeDoc(纯文本 / Markdown 段落)。
 * search_kb 工具会在启用的知识库范围内做关键字命中,把片段回填到工具轨迹。
 */
export type KbDocType = 'markdown' | 'text' | 'link';

export interface KnowledgeDoc {
  id: string;
  title: string;
  /** 全文内容(markdown/text)或外链摘要 */
  content: string;
  type: KbDocType;
  /** 逗号分隔的标签,便于筛选 */
  tags: string[];
  /** 若 type==='link' 才有 */
  url?: string;
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
  /** 命中处上下文片段,已高亮关键字前后各若干字符 */
  snippet: string;
  score: number;
  /** 命中文档的原始来源链接(来自 KnowledgeDoc.url),供引用可点击跳转 */
  url?: string;
}
