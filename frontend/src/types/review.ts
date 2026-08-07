export interface ReviewItem {
  dimension: string;
  verdict: string; // "pass" | "warn" | "fail" | ...
  note: string;
}

export interface ReviewReport {
  overall: 'pass' | 'revise' | 'redo';
  strategy_items: ReviewItem[];
  quality_items: ReviewItem[];
  advices: string[];
  // 流式审核生成的人类可读 markdown 正文;非流式路径可能为空。
  summary?: string;
}
