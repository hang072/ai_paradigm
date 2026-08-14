import dayjs from 'dayjs';
import { nanoid } from 'nanoid';
import type { AgentDef } from '../../types/agent';
import type { NodeDef } from '../../types/node';
import type { WorkflowTemplate } from '../../types/template';
import type {
  ClarifyQuestion,
  PendingInterrupt,
  StepHistoryItem,
  TaskSnapshot,
  TaskSpec,
  TaskStatus,
  TaskSummary,
  TaskType,
} from '../../types/task';
import type { ReviewReport } from '../../types/review';
import { AGENT_FIXTURES, NODE_FIXTURES, TEMPLATE_FIXTURES } from './fixtures/builtins';
import { SKILL_FIXTURES } from './fixtures/skills';
import { KNOWLEDGE_FIXTURES } from './fixtures/knowledge';
import type { SkillDef } from '../../types/skill';
import type { KbSearchHit, KnowledgeBase, KnowledgeDoc } from '../../types/knowledge';

/**
 * Mock 后端引擎:内存 store + 简易状态机,让前端能自跑主流程。
 *
 * 核心状态机(任务生命周期):
 *   1. POST /api/tasks
 *      → new task,parse_brief → ask_clarification interrupt
 *   2. POST /api/tasks/{id}/resume (第 1 次:澄清答案)
 *      → plan_strategy → confirm_strategy interrupt
 *   3. POST /api/tasks/{id}/resume (第 2 次:确认策略)
 *      → 若答案含"调整" → 回 plan_strategy → 再 interrupt
 *      → 否则 → build_framework → enrich_content → review_quality → human_final interrupt
 *   4. POST /api/tasks/{id}/resume (第 3 次:终稿反馈)
 *      → "退回"含义:再 enrich_content 一轮 → human_final 再来一次(最多 2 次)
 *      → "通过"/其他 → finalize → done
 *
 * 每步 compute 耗时用 setTimeout 模拟 300~800ms,让前端能看到"运行中"动画。
 */

/* ============ 内存 store ============ */

const agents = new Map<string, AgentDef>();
const nodes = new Map<string, NodeDef>();
const templates = new Map<string, WorkflowTemplate>();
const tasks = new Map<string, TaskSnapshot>();
const skills = new Map<string, SkillDef>();
const kbs = new Map<string, KnowledgeBase>();

// 导出给 mock/index.ts 使用，用于 team 模式解析 agent 列表
export { agents, nodes, templates };

/** 后台推进定时器(thread_id → timer)。resume 前若还在推进,先清掉。*/
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** 初始化 fixtures */
function seed() {
  agents.clear();
  nodes.clear();
  templates.clear();
  tasks.clear();
  skills.clear();
  kbs.clear();
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  AGENT_FIXTURES.forEach((a) => agents.set(a.id, { ...a }));
  NODE_FIXTURES.forEach((n) => nodes.set(n.id, { ...n }));
  TEMPLATE_FIXTURES.forEach((t) => templates.set(t.id, structuredClone(t)));
  SKILL_FIXTURES.forEach((s) => skills.set(s.id, { ...s }));
  KNOWLEDGE_FIXTURES.forEach((k) => kbs.set(k.id, structuredClone(k)));

  // 造 2 个示例任务:一个 waiting_human、一个 done
  seedDemoTasks();
}

function seedDemoTasks() {
  const tpl = templates.get('tpl-full')!;
  const now = dayjs();

  // 示例 1:等待策略确认
  const t1: TaskSnapshot = {
    thread_id: 'demo-strategy-' + nanoid(6),
    title: '心脑血管疾病诊疗新进展 · 幻灯',
    brief: '为心内科医生做一份 40 分钟的心脑血管疾病诊疗新进展讲课,受众为主治医师。',
    task_type: '幻灯',
    created_at: now.subtract(12, 'minute').format('YYYY-MM-DD HH:mm:ss'),
    status: 'waiting_human',
    pending: {
      stage: 'confirm_strategy',
      prompt: '请确认以下策略,或输入调整意见:',
    },
    messages: [
      '[parse_brief] 已解析需求:主题=心脑血管新进展,受众=主治医师,时长=40min',
      '[ask_clarification] 需求充分,跳过澄清',
      '[plan_strategy] 已生成策略确认书',
    ],
    parsed_info: {
      topic: '心脑血管疾病诊疗新进展',
      audience: '心内科主治医师',
      duration: '40 分钟',
      goal: '知识更新',
      meeting_type: '院内学术会议',
    },
    strategy_doc:
      '## 策略确认书\n\n- **会议类型**:院内学术会议\n- **学术/商业配比**:90% / 10%\n- **叙事模式**:问题—证据—共识 三段式\n- **章节权重预估**:\n  - 背景与流行病学 · 15%\n  - 关键 RCT 与指南更新 · 45%\n  - 临床落地要点 · 30%\n  - 展望 · 10%',
    narrative_mode: '问题—证据—共识',
    revision_count: 0,
    step_history: [
      { step: 1, node_id: 'parse_brief', after_keys: ['parsed_info'], skipped: false },
      { step: 2, node_id: 'ask_clarification', after_keys: [], skipped: true },
      { step: 3, node_id: 'plan_strategy', after_keys: ['strategy_doc'], skipped: false },
    ],
    spec: cloneSpec(tpl),
  };
  tasks.set(t1.thread_id, t1);

  // 示例 2:已完成
  const t2: TaskSnapshot = {
    thread_id: 'demo-done-' + nanoid(6),
    title: '阿尔茨海默病 ANAVEX 临床指南 · 文章',
    brief: '撰写 ANAVEX 3-71 阿尔茨海默病 II 期研究的中文解读。',
    task_type: '文章',
    created_at: now.subtract(2, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    status: 'done',
    pending: null,
    messages: [
      '[parse_brief] 已解析需求',
      '[plan_strategy] 已生成策略',
      '[build_framework] 已搭建目录',
      '[enrich_content] 已填充内容,共 4 章节',
      '[review_quality] verdict=pass',
      '[human_final] 用户通过',
      '[finalize] 已定稿',
    ],
    parsed_info: {
      topic: 'ANAVEX 3-71 II 期 AD 研究解读',
      audience: '神经内科医师',
    },
    strategy_doc: '## 策略确认书(略)',
    narrative_mode: '研究背景—方法—结果—启示',
    enriched_framework:
      '## 一、研究背景\n\nAnavex 3-71 (Blarcamesine) 是一种 σ-1 受体激动剂...\n\n## 二、研究方法\n\n多中心、随机、双盲、安慰剂对照 II 期临床试验...\n\n## 三、主要结果\n\n主要终点 ADAS-Cog13 显示统计学显著改善...\n\n## 四、临床启示\n\n为早期 AD 患者的疾病修饰治疗提供了新的证据...',
    review_report: {
      overall: 'pass',
      strategy_items: [
        { dimension: '学术/商业配比', verdict: 'pass', note: '95/5,符合学术会议' },
        { dimension: '章节配比', verdict: 'pass', note: '与策略书对齐' },
      ],
      quality_items: [
        { dimension: '文献支撑', verdict: 'pass', note: '关键论断均引用 III 期数据' },
        { dimension: '结构合理性', verdict: 'pass', note: '四段式清晰' },
      ],
      advices: [],
    },
    revision_count: 0,
    final_output:
      '# ANAVEX 3-71 阿尔茨海默病 II 期研究解读\n\n> 中文解读版 · 神经内科医师版\n\n## 一、研究背景\n\n(此处为最终定稿全文,略)\n\n## 二、研究方法\n\n...\n\n## 三、主要结果\n\n...\n\n## 四、临床启示\n\n...',
    step_history: [
      { step: 1, node_id: 'parse_brief', after_keys: ['parsed_info'], skipped: false },
      { step: 2, node_id: 'plan_strategy', after_keys: ['strategy_doc'], skipped: false },
      { step: 3, node_id: 'build_framework', after_keys: ['framework_skeleton'], skipped: false },
      { step: 4, node_id: 'enrich_content', after_keys: ['enriched_framework'], skipped: false },
      { step: 5, node_id: 'review_quality', after_keys: ['review_report'], skipped: false },
      { step: 6, node_id: 'human_final', after_keys: [], skipped: false },
      { step: 7, node_id: 'finalize', after_keys: ['final_output'], skipped: false },
    ],
    spec: cloneSpec(tpl),
  };
  tasks.set(t2.thread_id, t2);
}

function cloneSpec(tpl: WorkflowTemplate): TaskSpec {
  return structuredClone({ entry: tpl.entry, nodes: tpl.nodes, edges: tpl.edges });
}

/* ============ Agent CRUD ============ */

export function listAgents(): AgentDef[] {
  return Array.from(agents.values());
}
export function getAgent(id: string): AgentDef | undefined {
  return agents.get(id);
}
export function createAgent(input: Partial<AgentDef> & { name: string }): AgentDef {
  // 阶段 1:对齐后端 domain.AgentDef.Normalize() —— 把所有 nil 切片/map 补成
  // 非 nil 空值,避免下游 .Tools.length / .Methodology.length 断言 nil 时炸。
  const a: AgentDef = {
    id: input.id ?? 'agent-' + nanoid(8),
    name: input.name,
    description: input.description ?? '',
    persona: input.persona ?? '',
    system_prompt: input.system_prompt ?? '',
    methodology: input.methodology ?? [],
    output_schema: input.output_schema ?? {},
    guardrails: input.guardrails ?? {
      no_fabricate: false,
      require_citations: false,
      escalate_to: [],
      red_lines: [],
    },
    tools: input.tools ?? [],
    llm_model: input.llm_model ?? 'default',
    recursion_limit: input.recursion_limit ?? 40,
    color: input.color ?? '#2b57d6',
    runtime: input.runtime ?? '云端',
    builtin: false,
  };
  agents.set(a.id, a);
  return a;
}
export function updateAgent(id: string, patch: Partial<AgentDef>): AgentDef {
  const cur = agents.get(id);
  if (!cur) throw new Error('agent not found');
  const next = { ...cur, ...patch, id: cur.id };
  agents.set(id, next);
  return next;
}
export function deleteAgent(id: string) {
  const cur = agents.get(id);
  if (cur?.builtin) throw new Error('内置 Agent 不可删除');
  agents.delete(id);
}

/* ============ Node CRUD ============ */

export function listNodes(): NodeDef[] {
  return Array.from(nodes.values());
}
export function getNode(id: string): NodeDef | undefined {
  return nodes.get(id);
}
export function createNode(input: Partial<NodeDef> & { name: string; kind: NodeDef['kind'] }): NodeDef {
  const n: NodeDef = {
    id: input.id ?? 'node-' + nanoid(6),
    name: input.name,
    kind: input.kind,
    agent_id: input.agent_id ?? null,
    description: input.description ?? '',
    config: input.config ?? {},
    out_ports: input.out_ports ?? ['next'],
    color: input.color ?? '#2b57d6',
  };
  nodes.set(n.id, n);
  return n;
}
export function updateNode(id: string, patch: Partial<NodeDef>): NodeDef {
  const cur = nodes.get(id);
  if (!cur) throw new Error('node not found');
  const next = { ...cur, ...patch, id: cur.id };
  nodes.set(id, next);
  return next;
}
export function deleteNode(id: string) {
  nodes.delete(id);
}

/* ============ Template CRUD ============ */

export function listTemplates(): WorkflowTemplate[] {
  return Array.from(templates.values());
}
export function getTemplate(id: string): WorkflowTemplate | undefined {
  return templates.get(id);
}
export function createTemplate(input: Partial<WorkflowTemplate> & { name: string }): WorkflowTemplate {
  // 阶段 2:parameter_schema / description_required_inputs 都要默认值,与后端
  // domain.WorkflowTemplate.Normalize() 对齐。前端 mock 不存历史版本,直接
  // current_version=1。
  const t: WorkflowTemplate = {
    id: input.id ?? 'tpl-' + nanoid(8),
    name: input.name,
    description: input.description ?? '',
    tags: input.tags ?? [],
    entry: input.entry ?? '',
    nodes: input.nodes ?? [],
    edges: input.edges ?? [],
    builtin: false,
    parameter_schema: input.parameter_schema ?? {},
    description_required_inputs: input.description_required_inputs ?? [],
    current_version: 1,
    versions: [1],
  };
  templates.set(t.id, t);
  return t;
}
export function updateTemplate(id: string, patch: Partial<WorkflowTemplate>): WorkflowTemplate {
  const cur = templates.get(id);
  if (!cur) throw new Error('template not found');
  if (cur.builtin) throw new Error('内置模板不可修改');
  // 阶段 2.4:mock 不存历史表,前端假装 +1 + 追加 versions。真实后端会
  // 走 template_versions 表。
  const prevVersions = cur.versions ?? [cur.current_version ?? 1];
  const nextVersion = (cur.current_version ?? prevVersions[0] ?? 0) + 1;
  const next: WorkflowTemplate = {
    ...cur,
    ...patch,
    id: cur.id,
    builtin: false,
    current_version: nextVersion,
    versions: [...prevVersions, nextVersion],
  };
  templates.set(id, next);
  return next;
}
export function deleteTemplate(id: string) {
  const cur = templates.get(id);
  if (cur?.builtin) throw new Error('内置模板不可删除');
  templates.delete(id);
}

/**
 * 阶段 3.3:mock 引擎的 Planner 兜底。
 * 浏览器没 LLM → 永远走 static 模式 + tpl-full 兜底。等同于老 chat 团队路径。
 * 真实后端会返回 dynamic + spec(若 LLM 可用 + 校验通过)。
 */
export function composePlanner(input: { brief: string; task_type?: string }): {
  mode: 'static';
  fallback_template_id: string;
  reason: string;
  latency_ms: number;
} {
  return {
    mode: 'static',
    fallback_template_id: 'tpl-full',
    reason: 'mock 引擎无 LLM,回退 tpl-full(真实后端可走 dynamic)',
    latency_ms: 0,
  };
}

/* ============ Task 状态机 ============ */

export function listTasks(): TaskSummary[] {
  return Array.from(tasks.values())
    .map((t) => ({
      thread_id: t.thread_id,
      title: t.title,
      created_at: t.created_at,
      task_type: t.task_type,
      status: t.status,
      stage: t.pending?.stage ?? '',
      revision_count: t.revision_count,
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function getTask(id: string): TaskSnapshot {
  const t = tasks.get(id);
  if (!t) throw new Error('task not found');
  return structuredClone(t);
}

/** 开始一个新任务 */
export function startTask(input: {
  brief: string;
  task_type?: TaskType;
  title?: string;
  template_id?: string | null;
  spec?: TaskSpec | null;
}): TaskSnapshot {
  const templateId = input.template_id ?? 'tpl-full';
  const tpl = templates.get(templateId);
  const spec: TaskSpec = input.spec ?? (tpl ? cloneSpec(tpl) : { entry: '', nodes: [], edges: [] });

  const t: TaskSnapshot = {
    thread_id: 'task-' + nanoid(8),
    title: input.title?.trim() || autoTitle(input.brief),
    brief: input.brief,
    task_type: input.task_type ?? '幻灯',
    created_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    status: 'running',
    pending: null,
    messages: [`[start] 已收到任务 brief`],
    revision_count: 0,
    step_history: [],
    spec,
  };
  tasks.set(t.thread_id, t);

  // 起步执行 parse_brief 后转到 ask_clarification 或 plan_strategy
  scheduleAdvance(t.thread_id, 400, () => stepParseBrief(t.thread_id));

  return structuredClone(t);
}

/** 从 interrupt 恢复 */
export function resumeTask(id: string, answer: string): TaskSnapshot {
  const t = tasks.get(id);
  if (!t) throw new Error('task not found');
  if (t.status !== 'waiting_human') return structuredClone(t);

  const stage = t.pending?.stage;
  t.pending = null;
  t.status = 'running';
  t.messages.push(`[human@${stage}] ${answer || '(空)'}`);

  if (stage === 'ask_clarification') {
    t.messages.push('[ask_clarification] 已收到澄清答复');
    scheduleAdvance(id, 500, () => stepPlanStrategy(id));
  } else if (stage === 'confirm_strategy') {
    if (answer.includes('调整') || answer.includes('修改')) {
      t.messages.push('[confirm_strategy] 用户请求调整,回退至策略规划');
      scheduleAdvance(id, 500, () => stepPlanStrategy(id));
    } else {
      t.messages.push('[confirm_strategy] 用户确认策略');
      scheduleAdvance(id, 600, () => stepBuildFramework(id));
    }
  } else if (stage === 'human_final') {
    if (answer.includes('退回') || answer.includes('修改')) {
      t.revision_count += 1;
      t.messages.push(`[human_final] 用户退回修改,第 ${t.revision_count} 次修订`);
      // 保留反馈供 enrich_content 使用(mock 仅追加日志)
      scheduleAdvance(id, 600, () => stepEnrichContent(id, answer));
    } else {
      t.messages.push('[human_final] 用户通过');
      scheduleAdvance(id, 400, () => stepFinalize(id));
    }
  }
  return structuredClone(t);
}

/** 运行中更新 spec */
export function updateSpec(id: string, spec: TaskSpec): TaskSnapshot {
  const t = tasks.get(id);
  if (!t) throw new Error('task not found');
  t.spec = structuredClone(spec);
  t.messages.push('[spec] 编排 spec 已更新');
  return structuredClone(t);
}

/**
 * 请求打断一个正在运行 / 等待人工的任务。
 * 幂等: 已终态 (done / failed / cancelled) → 直接返回当前 snapshot, 不改状态。
 * running: 清 pending timer, 状态改 cancelled。
 * waiting_human: 直接改 status = cancelled。
 */
export function cancelTask(id: string): TaskSnapshot {
  const t = tasks.get(id);
  if (!t) throw new Error('task not found');
  if (t.status === 'done' || t.status === 'failed' || t.status === 'cancelled') {
    return structuredClone(t);
  }
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  t.status = 'cancelled';
  t.pending = null;
  t.messages.push('[cancel] 用户手动打断');
  return structuredClone(t);
}

/* ---------- 内部推进步骤 ---------- */

function scheduleAdvance(id: string, delay: number, fn: () => void) {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    timers.delete(id);
    try {
      fn();
    } catch (e: any) {
      console.error('[mock] advance error', e);
      // 步骤抛错 → 落 failed 终态, 让前端能明确感知
      const t = tasks.get(id);
      if (t && t.status !== 'done' && t.status !== 'failed' && t.status !== 'cancelled') {
        t.status = 'failed';
        t.pending = null;
        t.error_message = e?.message ?? String(e);
        t.messages.push(`[error] ${e?.message ?? e}`);
      }
    }
  }, delay);
  timers.set(id, timer);
}

function pushStep(t: TaskSnapshot, node_id: string, after_keys: string[], skipped = false) {
  t.step_history.push({
    step: t.step_history.length + 1,
    node_id,
    after_keys,
    skipped,
  });
}

function stepParseBrief(id: string) {
  const t = tasks.get(id);
  if (!t) return;
  t.parsed_info = {
    topic: extractTopic(t.brief),
    audience: '(mock) 主治医师',
    duration: t.task_type === '幻灯' ? '40 分钟' : 'N/A',
    goal: '(mock) 学术更新',
  };
  t.completeness = { enough: Math.random() > 0.5, missing: [] };
  t.messages.push('[parse_brief] 已解析需求');
  pushStep(t, 'parse_brief', ['parsed_info']);

  if (!t.completeness.enough) {
    // 触发澄清 interrupt
    const questions: ClarifyQuestion[] = [
      { question: '本次讲课的核心目标听众是?', options: ['主治医师', '住院医师', '研究生', '不限'] },
      { question: '预期时长?', options: ['20 分钟', '40 分钟', '60 分钟', '90 分钟'] },
      { question: '侧重方向?', options: ['诊断', '治疗', '综合', '前沿进展'] },
    ];
    t.clarify_questions = questions;
    interrupt(t, {
      stage: 'ask_clarification',
      prompt: '需求信息不完整,请回答以下问题以精准推进',
      questions,
    });
    pushStep(t, 'ask_clarification', []);
  } else {
    t.messages.push('[ask_clarification] 需求充分,跳过澄清');
    pushStep(t, 'ask_clarification', [], true);
    scheduleAdvance(id, 500, () => stepPlanStrategy(id));
  }
}

function stepPlanStrategy(id: string, feedback?: string) {
  const t = tasks.get(id);
  if (!t) return;
  t.strategy_doc =
    '## 策略确认书(mock)\n\n' +
    `- **主题**:${t.parsed_info?.topic ?? '未知'}\n` +
    `- **类型**:${t.task_type}\n` +
    '- **会议类型**:院内学术会议\n' +
    '- **学术/商业配比**:90% / 10%\n' +
    '- **叙事模式**:问题—证据—共识\n' +
    '- **章节权重**:\n  - 背景 · 15%\n  - 关键证据 · 45%\n  - 落地要点 · 30%\n  - 展望 · 10%';
  t.narrative_mode = '问题—证据—共识';
  t.messages.push('[plan_strategy] 已生成策略确认书');
  pushStep(t, 'plan_strategy', ['strategy_doc', 'narrative_mode']);

  interrupt(t, {
    stage: 'confirm_strategy',
    prompt: '请确认以下策略,或输入调整意见:',
  });
  pushStep(t, 'confirm_strategy', []);
}

function stepBuildFramework(id: string, feedback?: string) {
  const t = tasks.get(id);
  if (!t) return;
  t.framework_skeleton = {
    sections: [
      { title: '一、背景与流行病学', weight: 0.15 },
      { title: '二、关键 RCT 与指南更新', weight: 0.45 },
      { title: '三、临床落地要点', weight: 0.3 },
      { title: '四、展望', weight: 0.1 },
    ],
  };
  t.messages.push('[build_framework] 已搭建 4 章节目录');
  pushStep(t, 'build_framework', ['framework_skeleton']);
  scheduleAdvance(id, 700, () => stepEnrichContent(id));
}

function stepEnrichContent(id: string, feedback = '') {
  const t = tasks.get(id);
  if (!t) return;
  const suffix = feedback ? `\n\n> 已根据反馈调整:${feedback.slice(0, 40)}...\n` : '';
  // 填充含 markdown 链接的示例正文(引用真实知识库文档 URL,与 KB fixtures 一致)。
  t.enriched_framework =
    `## 一、背景与流行病学\n\n` +
    `根据[ESC 2023 心衰指南要点](https://doi.org/10.1093/eurheartj/ehad195),HFrEF 四联疗法保留 ACEI/ARNI + β 受体阻滞剂 + MRA + SGLT2抑制剂。` +
    `[ADA 2024 糖尿病诊疗标准](https://diabetesjournals.org/care/issue/47/Supplement_1)推荐 T2DM 合并 ASCVD/CKD/HF 优选 GLP-1RA 或 SGLT2i。${suffix}\n\n` +
    `## 二、关键 RCT 与指南更新\n\n` +
    `[AHA/ASA 2024 缺血性卒中一级预防](https://doi.org/10.1161/STR.0000000000000475)推荐高血压控制目标 <130/80 mmHg。` +
    `[ESC 2023 心衰指南要点](https://doi.org/10.1093/eurheartj/ehad195)指出达格列净/恩格列净在 HFmrEF、HFpEF 患者中同样推荐。\n\n` +
    `## 三、临床落地要点\n\n` +
    `[SGLT2 抑制剂用药清单](https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=dapagliflozin)显示达格列净起始剂量 10 mg qd,目标剂量 10 mg qd。` +
    `[GLP-1RA 用药清单](https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=semaglutide)显示司美格鲁肽起始 0.25 mg qw,每 4 周翻倍。\n\n` +
    `## 参考文献\n\n` +
    `1. [ESC 2023 心衰指南要点](https://doi.org/10.1093/eurheartj/ehad195)\n` +
    `2. [ADA 2024 糖尿病诊疗标准](https://diabetesjournals.org/care/issue/47/Supplement_1)\n` +
    `3. [AHA/ASA 2024 缺血性卒中一级预防](https://doi.org/10.1161/STR.0000000000000475)\n` +
    `4. [SGLT2 抑制剂用药清单](https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=dapagliflozin)\n` +
    `5. [GLP-1RA 用药清单](https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=semaglutide)`;
  t.messages.push(`[enrich_content] 已填充内容 (revision=${t.revision_count})`);
  t.citations = [
    { ref_id: 'doc-esc-hf-2023', title: 'ESC 2023 心衰指南要点', source_url: 'https://doi.org/10.1093/eurheartj/ehad195' },
    { ref_id: 'doc-ada-2024', title: 'ADA 2024 糖尿病诊疗标准', source_url: 'https://diabetesjournals.org/care/issue/47/Supplement_1' },
    { ref_id: 'doc-aha-stroke-2024', title: 'AHA/ASA 2024 缺血性卒中一级预防', source_url: 'https://doi.org/10.1161/STR.0000000000000475' },
    { ref_id: 'doc-sglt2i-usage', title: 'SGLT2 抑制剂用药清单', source_url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=dapagliflozin' },
    { ref_id: 'doc-glp1ra-usage', title: 'GLP-1RA 用药清单', source_url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=semaglutide' },
  ];
  pushStep(t, 'enrich_content', ['enriched_framework']);
  scheduleAdvance(id, 700, () => stepReviewQuality(id));
}

function stepReviewQuality(id: string) {
  const t = tasks.get(id);
  if (!t) return;
  // 第 1 次 mock 稍微严格,让审核回路能触发:若 revision_count===0 有 40% 概率 revise
  let overall: ReviewReport['overall'] = 'pass';
  if (t.revision_count === 0 && Math.random() < 0.4) overall = 'revise';

  // 阶段 6 workbuddy 借鉴:智能路由 target_node
  // 模拟 reviewer 根据 fail 维度选 target_node:有 30% 概率路由到 plan_strategy
  // (策略问题),有 20% 概率路由到 build_framework(骨架问题),其余 50% 走默认 enrich_content
  let targetNode: ReviewReport['target_node'] = '';
  if (overall === 'revise') {
    const r = Math.random();
    if (r < 0.3) targetNode = 'plan_strategy';
    else if (r < 0.5) targetNode = 'build_framework';
    else targetNode = 'enrich_content';
  }

  t.review_report = {
    overall,
    strategy_items: [
      { dimension: '学术/商业配比', verdict: 'pass', note: '与策略书一致' },
      { dimension: '章节配比', verdict: 'pass', note: '误差 <5%' },
    ],
    quality_items: [
      {
        dimension: '文献支撑',
        verdict: overall === 'pass' ? 'pass' : 'warn',
        note: overall === 'pass' ? '关键论断均有引用' : '部分论断缺少引用',
      },
      { dimension: '结构合理性', verdict: 'pass', note: '四段式清晰' },
    ],
    advices:
      overall === 'pass'
        ? []
        : ['补充第二章关键 RCT 的原始文献引用', '第三章加入用药监测节点表格'],
    target_node: targetNode,
  };
  t.messages.push(`[review_quality] verdict=${overall}, target_node=${targetNode || 'enrich_content'}`);
  pushStep(t, 'review_quality', ['review_report']);

  if (overall === 'pass') {
    scheduleAdvance(id, 400, () => interruptHumanFinal(id));
  } else if (t.revision_count < 2) {
    routeAfterReview(id, targetNode);
  } else {
    t.messages.push('[route_after_review] 达到最大修订次数,强制通过');
    scheduleAdvance(id, 400, () => interruptHumanFinal(id));
  }
}

/**
 * 阶段 6:智能路由分发函数。根据 review_report.target_node 决定下一个 step。
 * (从 stepReviewQuality 抽出,避免堆 if/else)
 */
function routeAfterReview(id: string, targetNode: ReviewReport['target_node']) {
  const t = tasks.get(id);
  if (!t) return;
  t.revision_count += 1;
  t.messages.push(`[route_after_review] target_node=${targetNode || 'enrich_content'}, revision=${t.revision_count}`);
  pushStep(t, 'bump_revision', ['revision_count']);

  const advices = t.review_report?.advices.join('; ') ?? '';

  switch (targetNode) {
    case 'plan_strategy':
      // 回策略规划:模拟 reviewer 报告"策略问题"
      scheduleAdvance(id, 500, () => {
        t.messages.push('[route_after_review] 智能路由 → plan_strategy');
        stepPlanStrategy(id, `智能路由: ${advices}`);
      });
      return;
    case 'build_framework':
      // 回框架搭建:模拟 reviewer 报告"骨架问题"
      scheduleAdvance(id, 500, () => {
        t.messages.push('[route_after_review] 智能路由 → build_framework');
        stepBuildFramework(id, `智能路由: ${advices}`);
      });
      return;
    case 'human_final':
      scheduleAdvance(id, 400, () => interruptHumanFinal(id));
      return;
    case 'enrich_content':
    case '':
    default:
      scheduleAdvance(id, 600, () => stepEnrichContent(id, advices));
      return;
  }
}

function interruptHumanFinal(id: string) {
  const t = tasks.get(id);
  if (!t) return;
  interrupt(t, {
    stage: 'human_final',
    prompt: '终稿已生成,请确认或提出修改意见',
  });
  pushStep(t, 'human_final', []);
}

function stepFinalize(id: string) {
  const t = tasks.get(id);
  if (!t) return;
  t.final_output = t.enriched_framework
    ? `# ${t.title}\n\n> 最终定稿 · 类型:${t.task_type}\n\n${t.enriched_framework}`
    : `# ${t.title}\n\n(空)`;
  t.messages.push('[finalize] 已定稿');
  pushStep(t, 'finalize', ['final_output']);
  t.status = 'done';
}

function interrupt(t: TaskSnapshot, payload: PendingInterrupt) {
  t.status = 'waiting_human';
  t.pending = payload;
}

function extractTopic(brief: string): string {
  const cleaned = brief.replace(/[。,,.!?!?\n]/g, ' ').trim();
  return cleaned.slice(0, 24) || '未命名主题';
}

function autoTitle(brief: string): string {
  return extractTopic(brief) + ' · 任务';
}

// ---- 初始化 ----
seed();

/** 供外部诊断/重置(如需要) */
export function _resetMockStore() {
  seed();
}

/* ============ Skill CRUD ============ */

export function listSkills(): SkillDef[] {
  return Array.from(skills.values());
}
export function getSkill(id: string): SkillDef | undefined {
  return skills.get(id);
}
export function createSkill(input: Partial<SkillDef> & { name: string }): SkillDef {
  const s: SkillDef = {
    id: input.id ?? 'skill-' + nanoid(8),
    name: input.name,
    category: input.category ?? '通用',
    description: input.description ?? '',
    prompt_fragment: input.prompt_fragment ?? '',
    suggested_tools: input.suggested_tools ?? [],
    color: input.color ?? '#2b57d6',
    builtin: false,
  };
  skills.set(s.id, s);
  return s;
}
export function updateSkill(id: string, patch: Partial<SkillDef>): SkillDef {
  const cur = skills.get(id);
  if (!cur) throw new Error('skill not found');
  const next = { ...cur, ...patch, id: cur.id };
  skills.set(id, next);
  return next;
}
export function deleteSkill(id: string) {
  const cur = skills.get(id);
  if (cur?.builtin) throw new Error('内置技能不可删除');
  skills.delete(id);
}

/* ============ Knowledge Base CRUD & Search ============ */

function nowStr() {
  return dayjs().format('YYYY-MM-DD HH:mm:ss');
}

export function listKbs(): KnowledgeBase[] {
  return Array.from(kbs.values());
}
export function getKb(id: string): KnowledgeBase | undefined {
  return kbs.get(id);
}
export function createKb(input: Partial<KnowledgeBase> & { name: string }): KnowledgeBase {
  const kb: KnowledgeBase = {
    id: input.id ?? 'kb-' + nanoid(8),
    name: input.name,
    description: input.description ?? '',
    color: input.color ?? '#2b57d6',
    builtin: false,
    docs: input.docs ?? [],
    created_at: nowStr(),
    updated_at: nowStr(),
  };
  kbs.set(kb.id, kb);
  return kb;
}
export function updateKb(id: string, patch: Partial<KnowledgeBase>): KnowledgeBase {
  const cur = kbs.get(id);
  if (!cur) throw new Error('kb not found');
  const next: KnowledgeBase = {
    ...cur,
    ...patch,
    id: cur.id,
    docs: cur.docs, // 文档单独 CRUD
    updated_at: nowStr(),
  };
  kbs.set(id, next);
  return next;
}
export function deleteKb(id: string) {
  const cur = kbs.get(id);
  if (cur?.builtin) throw new Error('内置知识库不可删除');
  kbs.delete(id);
}

export function addKbDoc(
  kbId: string,
  input: Partial<KnowledgeDoc> & { title: string },
): KnowledgeDoc {
  const kb = kbs.get(kbId);
  if (!kb) throw new Error('kb not found');
  const doc: KnowledgeDoc = {
    id: input.id ?? 'doc-' + nanoid(8),
    title: input.title,
    content: input.content ?? '',
    type: input.type ?? 'markdown',
    tags: input.tags ?? [],
    url: input.url,
    created_at: nowStr(),
    updated_at: nowStr(),
  };
  kb.docs.push(doc);
  kb.updated_at = nowStr();
  return doc;
}

export function updateKbDoc(
  kbId: string,
  docId: string,
  patch: Partial<KnowledgeDoc>,
): KnowledgeDoc {
  const kb = kbs.get(kbId);
  if (!kb) throw new Error('kb not found');
  const i = kb.docs.findIndex((d) => d.id === docId);
  if (i < 0) throw new Error('doc not found');
  const next: KnowledgeDoc = {
    ...kb.docs[i],
    ...patch,
    id: kb.docs[i].id,
    updated_at: nowStr(),
  };
  kb.docs[i] = next;
  kb.updated_at = nowStr();
  return next;
}

export function removeKbDoc(kbId: string, docId: string) {
  const kb = kbs.get(kbId);
  if (!kb) throw new Error('kb not found');
  kb.docs = kb.docs.filter((d) => d.id !== docId);
  kb.updated_at = nowStr();
}

/**
 * 关键字命中检索:
 * - 拆分 query 为 2+ 字长的 token(中/英),对文档 title/content/tags 分别加权计分
 * - 每个 doc 只保留最佳一处片段(前后 40 字)
 * - 若未传 kbIds 或数组为空,搜全部
 */
export function searchKb(query: string, kbIds: string[] = []): KbSearchHit[] {
  const q = (query ?? '').trim();
  if (!q) return [];
  const tokens = tokenizeQuery(q);
  if (tokens.length === 0) return [];

  const scope = kbIds.length > 0 ? kbIds : Array.from(kbs.keys());
  const hits: KbSearchHit[] = [];

  for (const kbId of scope) {
    const kb = kbs.get(kbId);
    if (!kb) continue;
    for (const doc of kb.docs) {
      let score = 0;
      let bestPos = -1;
      let bestToken = '';
      for (const tk of tokens) {
        if (doc.title.toLowerCase().includes(tk)) score += 3;
        if (doc.tags.some((t) => t.toLowerCase().includes(tk))) score += 2;
        const pos = doc.content.toLowerCase().indexOf(tk);
        if (pos >= 0) {
          score += 1;
          if (bestPos < 0) {
            bestPos = pos;
            bestToken = tk;
          }
        }
      }
      if (score <= 0) continue;
      const snippet =
        bestPos >= 0
          ? buildSnippet(doc.content, bestPos, bestToken.length)
          : doc.content.slice(0, 80);
      hits.push({
        kb_id: kb.id,
        kb_name: kb.name,
        doc_id: doc.id,
        doc_title: doc.title,
        chunk_id: `${doc.id}:0`, // mock 模式只回 1 个 chunk
        snippet,
        location: 'mock 命中位置', // 占位,前端 UI 兼容
        score,
        url: doc.url,
      });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 6);
}

function tokenizeQuery(q: string): string[] {
  // 简单切词:按非字母数字切,同时把长中文 chunk 保留;过滤长度 <2
  const raw = q
    .toLowerCase()
    .split(/[\s,,.。;;:::!?!?()()\[\]【】《》""'']+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const uniq = new Set<string>();
  for (const w of raw) {
    if (w.length >= 2) uniq.add(w);
    // 对中文再滑窗补充 2/3 字 gram
    if (/[一-龥]/.test(w) && w.length > 2) {
      for (let i = 0; i + 2 <= w.length; i++) uniq.add(w.slice(i, i + 2));
    }
  }
  return Array.from(uniq).slice(0, 8);
}

function buildSnippet(content: string, pos: number, matchLen: number): string {
  const start = Math.max(0, pos - 40);
  const end = Math.min(content.length, pos + matchLen + 40);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return prefix + content.slice(start, end).replace(/\n+/g, ' ') + suffix;
}

/* ============ 对话 Mock ============ */

/** 主助手身份 —— 常量,不进 fixtures / entities 表,用户不可编辑。 */
export const MAIN_ASSISTANT = {
  id: 'agent-main',
  name: '主助手',
  color: '#6b7a90',
  description: '通用主助手,理解用户需求并按需调用挂载的专家/专家团。',
} as const;

export interface AttachedExpertInput {
  kind: 'agent' | 'team';
  id: string;
}

export interface ChatReplyInput {
  message: string;
  /** 挂载的子智能体; 空则纯通用助手。 */
  attached_expert?: AttachedExpertInput;
  tools: string[];
  skills: string[]; // skill id 列表
  /** 挂载的知识库 id 列表(供 search_kb 工具检索) */
  kb_ids?: string[];
  history?: { role: string; content: string }[];
}

export interface MockToolCallTrace {
  tool: string;
  input: Record<string, any>;
  output_preview: string;
  agent_id?: string;
  agent_name?: string;
  agent_color?: string;
}

export interface ChatReplyPart {
  agent_id: string;
  agent_name: string;
  agent_color: string;
  content: string;
  tool_calls: MockToolCallTrace[];
}

/**
 * 生成一段 mock 回复。
 *
 * 新语义:响应恒为长度 1 的数组(主助手一条)。若挂载了子智能体且被判定应调用,
 * 子调用轨迹以带 agent_* 身份的 tool_call 挂在主助手 part.tool_calls 里。
 *
 * 何时判定"应调用"(mock 启发式):
 *   把用户 message 与挂载对象(agent/团)的 name+description 分别 tokenize,
 *   有非空交集 → 调用; 无交集 → 主助手直接答。
 *   这个策略够真实(和真 LLM 的直觉大体一致),又足够简单。
 */
export function generateChatReply(input: ChatReplyInput): ChatReplyPart[] {
  const toolCalls: MockToolCallTrace[] = [];

  // 1) 主助手挂载的普通工具轨迹 (search_kb / literature / verify) 始终按用户勾选生成
  toolCalls.push(...buildMockToolCalls(input.message, input.tools, input.kb_ids ?? []));

  // 2) 决定是否触发子智能体调用
  const invocation = decideInvocation(input);

  if (invocation) {
    for (const sub of invocation.subAgents) {
      const subReply = pickReplyBody(sub, input.message);
      toolCalls.push({
        tool: 'invoke_expert',
        input: {
          kind: invocation.kind,
          target: invocation.targetLabel,
          message: input.message.slice(0, 40),
        },
        output_preview: subReply,
        agent_id: sub.id,
        agent_name: sub.name,
        agent_color: sub.color,
      });
    }
  }

  // 3) 主助手正文
  const content = buildMainAssistantContent(input, invocation);

  return [
    {
      agent_id: MAIN_ASSISTANT.id,
      agent_name: MAIN_ASSISTANT.name,
      agent_color: MAIN_ASSISTANT.color,
      content,
      tool_calls: toolCalls,
    },
  ];
}

interface InvocationPlan {
  kind: 'agent' | 'team';
  targetLabel: string; // 显示名: agent.name 或 template.name
  subAgents: AgentDef[]; // team 展开后的 agent 列表; agent 时长度 1
}

function decideInvocation(input: ChatReplyInput): InvocationPlan | null {
  const att = input.attached_expert;
  if (!att) return null;

  const messageTokens = tokenizeQuery(input.message);

  if (att.kind === 'agent') {
    const a = agents.get(att.id);
    if (!a) return null;
    const descTokens = tokenizeQuery(`${a.name} ${a.description}`);
    if (!shareToken(messageTokens, descTokens)) return null;
    return { kind: 'agent', targetLabel: a.name, subAgents: [a] };
  }

  // team
  const tpl = templates.get(att.id);
  if (!tpl) return null;
  const descTokens = tokenizeQuery(`${tpl.name} ${tpl.description}`);
  if (!shareToken(messageTokens, descTokens)) return null;

  const subAgents: AgentDef[] = [];
  const seen = new Set<string>();
  for (const inst of tpl.nodes) {
    const def = nodes.get(inst.type);
    if (!def || def.kind !== 'compute' || !def.agent_id) continue;
    const a = agents.get(def.agent_id);
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    subAgents.push(a);
  }
  if (subAgents.length === 0) return null;
  return { kind: 'team', targetLabel: tpl.name, subAgents };
}

function shareToken(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(b);
  for (const t of a) if (set.has(t)) return true;
  return false;
}

function buildMainAssistantContent(input: ChatReplyInput, inv: InvocationPlan | null): string {
  const topic = input.message.slice(0, 30);
  const skillNames = input.skills
    .map((sid) => skills.get(sid)?.name)
    .filter(Boolean) as string[];
  const skillLine = skillNames.length ? `\n\n> 已挂载技能:${skillNames.join('、')}` : '';
  const toolLine = input.tools.length ? `\n> 已启用工具:${input.tools.join('、')}` : '';

  if (!inv) {
    if (input.attached_expert) {
      // 挂载了但没触发调用 —— 主助手兜底直答
      return (
        `关于「${topic}...」——\n\n` +
        '这是一个 mock 回复。本轮判定当前话题与已挂载的子智能体关联度不高,主助手直接作答。\n\n' +
        '(切到真实后端后,由 LLM 决定是否调用挂载的专家。)' +
        skillLine +
        toolLine
      );
    }
    return (
      `**${MAIN_ASSISTANT.name}**\n\n` +
      `你的问题:「${topic}...」\n\n` +
      '(这是 mock 回复。当前会话未挂载子智能体,主助手作为通用 LLM 直接回答。切到真实后端后,由所选 LLM 生成实际内容。)' +
      skillLine +
      toolLine
    );
  }

  const label = inv.kind === 'agent' ? '专家' : '专家团';
  const bullet = inv.subAgents.map((a) => `- **${a.name}** · ${a.description || '(无描述)'}`).join('\n');
  return (
    `已就「${topic}...」请 ${label} **${inv.targetLabel}** 协助分析(见上方折叠块),要点汇总如下:\n\n` +
    `${bullet}\n\n` +
    '综合建议:请结合上述反馈决定下一步; 需要我进一步展开某一维度,或直接开始产出草稿吗?' +
    skillLine +
    toolLine
  );
}

function pickReplyBody(agent: AgentDef, userMessage: string): string {
  const topic = userMessage.slice(0, 30);
  // 按 agent 名做一些角色化输出模板
  if (agent.name.includes('需求')) {
    return (
      `我从你的问题「${topic}...」中提取出以下要素:\n\n` +
      '- **主题**:(mock 已识别)\n- **受众**:主治医师\n- **场景**:院内学术会议\n' +
      '- **时长/篇幅**:未指定\n\n是否需要我进一步确认这些要素?'
    );
  }
  if (agent.name.includes('策略') || agent.name.includes('规划')) {
    return (
      '基于你提供的信息,我建议采用以下策略:\n\n' +
      '- 学术/商业配比:90% / 10%\n- 叙事模式:**问题—证据—共识**\n' +
      '- 结构骨架:背景(15%)→ 关键证据(45%)→ 落地要点(30%)→ 展望(10%)'
    );
  }
  if (agent.name.includes('框架') || agent.name.includes('搭建')) {
    return (
      '目录草案:\n\n1. **一、背景与流行病学** · 权重 15%\n' +
      '2. **二、关键 RCT 与指南更新** · 权重 45%\n' +
      '3. **三、临床落地要点** · 权重 30%\n' +
      '4. **四、展望** · 权重 10%'
    );
  }
  if (agent.name.includes('填充') || agent.name.includes('内容')) {
    return (
      '关于「' +
      topic +
      '...」的核心内容要点:\n\n' +
      '- 相关流行病学数据表明疾病负担持续上升\n' +
      '- 近 3 年关键 RCT 证据集中在 SGLT2i / GLP-1RA 两大机制\n' +
      '- 落地要点:起始时机、剂量滴定、监测节点\n\n' +
      '(引用与详细内容会在完整草稿中给出)'
    );
  }
  if (agent.name.includes('审核') || agent.name.includes('质量')) {
    return (
      '审核结论:\n\n' +
      '| 维度 | Verdict | 说明 |\n|---|---|---|\n' +
      '| 策略对齐 | ✅ pass | 与策略确认书一致 |\n' +
      '| 文献支撑 | ⚠️ warn | 建议补充第二章 2 处关键引用 |\n' +
      '| 逻辑完整 | ✅ pass | 四段式清晰 |\n\n' +
      '**建议**:补充关键 RCT 的原始文献引用,即可通过。'
    );
  }
  // 默认
  return (
    `关于「${topic}...」,我的初步回答:\n\n` +
    '这是一个基于 mock 引擎的示例回复。切换到真实后端后,\n' +
    '这里会由 Eino Go 后端调用你选定的 LLM 生成实际内容。'
  );
}

function buildMockToolCalls(
  userMessage: string,
  tools: string[],
  kbIds: string[] = [],
): MockToolCallTrace[] {
  const calls: MockToolCallTrace[] = [];
  const query = userMessage.slice(0, 20);
  // search_literature / verify_reference 由真实后端接入 PubMed(net/http 调 NCBI E-utilities)。
  // mock 引擎跑在浏览器里、离线、刷新即重置,不做真实检索,也绝不伪造 PMID / 期刊卷期 ——
  // 只给诚实说明,指明这两个工具需切到真实后端(配置 PUBMED_EMAIL)才可用。
  if (tools.includes('search_literature')) {
    calls.push({
      tool: 'search_literature',
      input: { query },
      output_preview:
        '(PubMed 文献检索仅在真实后端可用:需切换到 Eino 后端并配置 PUBMED_EMAIL。mock 环境为确保数据真实性不伪造任何引用;可改用知识库检索 search_kb。)',
    });
  }
  if (tools.includes('verify_reference')) {
    calls.push({
      tool: 'verify_reference',
      input: { query },
      output_preview:
        '(PubMed 文献核验仅在真实后端可用:需切换到 Eino 后端并配置 PUBMED_EMAIL。mock 环境无法核验外部引用真伪;请以知识库 search_kb 命中的带链接文档为准。)',
    });
  }
  if (tools.includes('search_kb')) {
    const hits = searchKb(userMessage, kbIds);
    const preview =
      hits.length === 0
        ? kbIds.length === 0
          ? '(未挂载知识库,search_kb 未命中)'
          : `已检索 ${kbIds.length} 个知识库,未命中相关片段。`
        : hits
            .slice(0, 3)
            .map((h, i) => {
              const title = h.url ? `[${h.doc_title}](${h.url})` : h.doc_title;
              return `${i + 1}. ${h.kb_name} / ${title} — ${h.snippet}`;
            })
            .join('\n');
    calls.push({
      tool: 'search_kb',
      input: { query, kb_ids: kbIds },
      output_preview: preview,
    });
  }
  return calls;
}

/* ============ Chat sessions (mock 持久化到内存, 页面刷新丢) ============ */

import type { ChatMessage, ChatSession, AttachedExpert } from '../../types/chat';

interface MockSession extends ChatSession {}
const chatSessions = new Map<string, MockSession>();

export interface ChatSessionSummary {
  id: string;
  title: string;
  attached_expert?: AttachedExpert;
  active_task_id?: string;
  model?: string;
  created_at: string;
  updated_at: string;
}

export function listChatSessions(): ChatSessionSummary[] {
  const out: ChatSessionSummary[] = [];
  chatSessions.forEach((s) => {
    out.push({
      id: s.id,
      title: s.title,
      attached_expert: s.attached_expert,
      active_task_id: s.active_task_id,
      model: s.model,
      created_at: s.created_at,
      updated_at: s.updated_at,
    });
  });
  out.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return out;
}

export function getChatSession(id: string): ChatSession | undefined {
  const s = chatSessions.get(id);
  if (!s) return undefined;
  return structuredClone(s);
}

export function upsertChatSession(input: Partial<ChatSession> & { id: string }): ChatSession {
  const now = nowStr();
  const existing = chatSessions.get(input.id);
  const merged: ChatSession = {
    id: input.id,
    title: input.title ?? existing?.title ?? '新会话',
    attached_expert:
      'attached_expert' in input ? input.attached_expert : existing?.attached_expert,
    active_task_id:
      'active_task_id' in input ? input.active_task_id : existing?.active_task_id,
    tools: input.tools ?? existing?.tools ?? [],
    skills: input.skills ?? existing?.skills ?? [],
    kb_ids: input.kb_ids ?? existing?.kb_ids ?? [],
    model: input.model ?? existing?.model,
    messages: existing?.messages ?? [],
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  // 允许 body 一起带上 messages 用于迁移
  if (input.messages && input.messages.length > 0 && merged.messages.length === 0) {
    merged.messages = structuredClone(input.messages);
  }
  chatSessions.set(input.id, merged);
  return structuredClone(merged);
}

export function updateChatSession(id: string, patch: Partial<ChatSession>): ChatSession {
  const existing = chatSessions.get(id);
  if (!existing) {
    const e: any = new Error('会话不存在');
    e.status = 404;
    throw e;
  }
  const updated: ChatSession = {
    ...existing,
    ...('title' in patch && patch.title ? { title: patch.title } : {}),
    // attached_expert 允许显式置 undefined 卸载,故用 in 判定
    attached_expert:
      'attached_expert' in patch ? patch.attached_expert : existing.attached_expert,
    // active_task_id 同样允许显式置 undefined (任务结束后想手动清)
    active_task_id:
      'active_task_id' in patch ? patch.active_task_id : existing.active_task_id,
    tools: patch.tools ?? existing.tools,
    skills: patch.skills ?? existing.skills,
    kb_ids: patch.kb_ids ?? existing.kb_ids,
    model: 'model' in patch ? patch.model : existing.model,
    updated_at: nowStr(),
  };
  chatSessions.set(id, updated);
  return structuredClone(updated);
}

export function deleteChatSession(id: string) {
  if (!chatSessions.has(id)) {
    const e: any = new Error('会话不存在');
    e.status = 404;
    throw e;
  }
  chatSessions.delete(id);
}

export function appendChatMessages(id: string, msgs: ChatMessage[]): { ok: true; appended: number } {
  const existing = chatSessions.get(id);
  if (!existing) {
    const e: any = new Error('会话不存在');
    e.status = 404;
    throw e;
  }
  existing.messages = existing.messages.concat(structuredClone(msgs));
  existing.updated_at = nowStr();
  chatSessions.set(id, existing);
  return { ok: true, appended: msgs.length };
}

export function clearChatMessages(id: string) {
  const existing = chatSessions.get(id);
  if (!existing) {
    const e: any = new Error('会话不存在');
    e.status = 404;
    throw e;
  }
  existing.messages = [];
  existing.updated_at = nowStr();
  chatSessions.set(id, existing);
}

/* ============ Settings (mock 持久化到 sessionStorage 保命一次) ============ */

const settingsStore = new Map<string, any>();

export function getSetting(key: string): any {
  return settingsStore.has(key) ? structuredClone(settingsStore.get(key)) : null;
}

export function setSetting(key: string, value: any) {
  settingsStore.set(key, structuredClone(value));
}


