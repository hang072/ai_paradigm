import type { ReviewReport } from './review';
import type { NodeInstance, EdgeInstance } from './template';

export type TaskStatus = 'running' | 'waiting_human' | 'done' | 'failed' | 'cancelled';
export type TaskType = '幻灯' | '文章';

export interface ClarifyQuestion {
  question: string;
  options: string[];
}

export interface PendingInterrupt {
  stage: string; // "ask_clarification" | "confirm_strategy" | "human_final"
  prompt: string;
  questions?: ClarifyQuestion[];
}

export interface StepHistoryItem {
  step: number;
  node_id: string;
  after_keys: string[];
  skipped: boolean;
}

/** 内容填充阶段引用的一条真实来源(带可点击链接) */
export interface Citation {
  ref_id: string;
  title: string;
  source_url: string;
  used_in_section?: string;
}

export interface TaskSpec {
  entry: string;
  nodes: NodeInstance[];
  edges: EdgeInstance[];
}

export interface TaskSnapshot {
  thread_id: string;
  title: string;
  brief: string;
  task_type: TaskType;
  created_at: string;
  status: TaskStatus;
  pending: PendingInterrupt | null;
  messages: string[];
  // 阶段产物,未产生时为 undefined
  parsed_info?: Record<string, any>;
  completeness?: Record<string, any>;
  clarify_questions?: ClarifyQuestion[];
  strategy_doc?: string;
  narrative_mode?: string;
  framework_skeleton?: Record<string, any>;
  enriched_framework?: string;
  review_report?: ReviewReport;
  /** 内容填充采用的真实来源清单(带可点击 source_url) */
  citations?: Citation[];
  revision_count: number;
  final_output?: string;
  /** 终态为 failed 时的错误消息;其他状态为空。 */
  error_message?: string;
  step_history: StepHistoryItem[];
  spec: TaskSpec;
}

/** 列表页用的摘要 */
export interface TaskSummary {
  thread_id: string;
  title: string;
  created_at: string;
  task_type: TaskType;
  status: TaskStatus;
  stage: string;
  revision_count: number;
}
