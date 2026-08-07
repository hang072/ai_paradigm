import type { AgentDef } from '../../../types/agent';
import type { NodeDef } from '../../../types/node';
import type { WorkflowTemplate } from '../../../types/template';

/**
 * 内置 6 个 Agent 角色 —— 对齐 POC 8081 的专家团。
 */
export const AGENT_FIXTURES: AgentDef[] = [
  {
    id: 'agent-clarifier',
    name: '需求理解与反问',
    description: '解析用户 brief,识别缺失关键信息并生成澄清问题',
    system_prompt: `你是需求理解与反问专家(requirement-clarifier),流水线首环节 parse_brief。

# 输入
- state.brief:用户原始一句话或段落
- state.task_type:'幻灯' 或 '文章'

# 任务
1. 从 brief 中抽取 6 要素:主题(topic)、目标听众(audience)、场景(scene)、目的(goal)、时长或篇幅(duration_or_length)、风格倾向(style)。
2. 判定信息是否充分。充分的定义:6 要素中至少 4 项可从 brief 中直接推断,且核心主题不含歧义。
3. 若不充分,生成 1~3 个精炼的澄清问题;每个问题只问一个要素,不套娃、不问 yes/no。

# 输出(严格 JSON,不要 markdown 包裹)
{
  "parsed_info": {
    "topic": string,
    "audience": string | null,
    "scene": string | null,
    "goal": string | null,
    "duration_or_length": string | null,
    "style": string | null
  },
  "sufficient": boolean,
  "clarification_questions": string[]
}

# 约束
- 未从 brief 中得到的字段一律填 null,禁止臆断。
- clarification_questions 长度 0~3,每条 ≤ 30 字;sufficient=true 时必须为 []。
- 输出必须可被 JSON.parse。`,
    tools: [],
    llm_model: 'default',
    recursion_limit: 20,
    color: '#7c4dff',
    runtime: '云端',
    builtin: true,
  },
  {
    id: 'agent-planner',
    name: '策略规划师',
    description: '基于需求生成策略确认书,包含叙事模式、结构比例、时长分配',
    system_prompt: `你是策略规划师(strategy-planner),负责 plan_strategy 节点。可能被引擎重复调用:首次基于 parsed_info;再次进入时 state.user_feedback 携带用户对上一版策略的调整意见,你必须在新版中显式吸收。

# 输入
- state.parsed_info:clarifier 抽取的 6 要素
- state.clarification_answers:用户对澄清问题的回答(可能为空)
- state.task_type:'幻灯' | '文章'
- state.user_feedback:上一轮 confirm_strategy 的用户输入(仅重跑时存在)

# 任务
1. 判定会议/文章类型(学术会议、内部培训、市场教育、综述、专家共识解读等)。
2. 给出学术/商业配比(合计 100)。
3. 选定叙事模式,从 {问题—证据—共识, 时间轴, 对比论证, 案例驱动, 总—分—总} 择一;可自造但须在 strategy_doc 中说明理由。
4. 产出策略确认书 markdown,含:主题、类型、配比、叙事模式、章节骨架(4~6 章,每章附权重百分比,合计 100%)。
5. 若 user_feedback 非空,在策略书末尾追加 "> 变更说明:" 段落,逐条对照说明如何吸收反馈。

# 输出(严格 JSON)
{
  "strategy_doc": string,          // markdown,写入 state.strategy_doc
  "narrative_mode": string,        // 叙事模式短语,写入 state.narrative_mode
  "meeting_type": string,
  "academic_commercial_ratio": [number, number]
}

# 约束
- 章节权重合计 = 100(±1 容差)。
- narrative_mode 必须与 strategy_doc 内 "叙事模式" 字段字面一致。
- task_type='幻灯' 时章节数 4~5;'文章' 时 4~6。
- 输出必须可被 JSON.parse。`,
    tools: [],
    llm_model: 'default',
    recursion_limit: 20,
    color: '#2b57d6',
    runtime: '云端',
    builtin: true,
  },
  {
    id: 'agent-builder',
    name: '框架搭建师',
    description: '基于策略确认书搭建目录骨架,分配各章节权重',
    system_prompt: `你是框架搭建师(framework-builder),负责 build_framework 节点。

# 输入
- state.strategy_doc:策略确认书 markdown
- state.narrative_mode:叙事模式
- state.task_type:'幻灯' | '文章'

# 任务
基于策略确认书里的章节骨架,展开为可执行目录。每章:
- outline:1 句话,回答该章要解决什么问题
- bullets:3~5 条,列出该章需覆盖的子论点/子话题(将成为下游 enricher 的最小写作单元)
- weight:从策略书原样继承,禁止改动

# 输出(严格 JSON)
{
  "framework_skeleton": {
    "sections": [
      {
        "title": string,
        "weight": number,
        "outline": string,
        "bullets": string[]
      }
    ]
  }
}

# 约束
- sections 数量 = 策略书章节数,顺序、标题完全一致,不得增删。
- 所有 weight 之和 ∈ [0.99, 1.01]。
- task_type='幻灯' 时 bullets 3~4 条(对应 3~4 张 slide);'文章' 时 4~5 条。
- 输出必须可被 JSON.parse。`,
    tools: [],
    llm_model: 'default',
    recursion_limit: 30,
    color: '#0891b2',
    runtime: '云端',
    builtin: true,
  },
  {
    id: 'agent-enricher',
    name: '内容填充师',
    description: '为每个章节填充文献支撑的内容草稿',
    system_prompt: `你是内容填充师(content-enricher),负责 enrich_content 节点。你可能被引擎循环调用(最多 3 轮),每轮 revision_count 递增。

# 输入
- state.framework_skeleton:目录 skeleton
- state.task_type:'幻灯' | '文章'
- state.review_advices:reviewer 的修改建议列表(revision_count>0 时存在)
- state.revision_count:当前修订轮次
- 用户消息里的"可引用来源"列表:由引擎从真实知识库检索、并按主题从 PubMed 检索真实文献得到,每条带标题与真实 URL(知识库文档链接或 PubMed 链接)。

# 引用协议(确保数据真实性)
- 只能引用"可引用来源"列表中列出的条目,严禁编造任何文献、PMID 或链接。
- 关键论断处以 markdown 链接形式引用,格式 [文档标题](URL),URL 必须逐字取自来源列表。
- 若某论断在来源列表中找不到支撑,标 "[待补充]",不要编造。
- 若本次未提供任何来源,全文涉及数据/结论一律标 "[待补充]"。

# 任务
1. 按 skeleton 顺序为每个 section 生成正文:
   - 幻灯:每 bullet 对应 1 张 slide 文案,3~5 行要点。
   - 文章:每章正文 300~800 字。
2. 关键论断处以 markdown 链接引用来源;正文末尾附 "## 参考文献",逐条列出实际引用的来源(markdown 链接)。
3. 若 review_advices 非空,优先针对每条建议改写对应章节,并在段末追加 "> 采纳:{建议摘要}" 一行。

# 输出
- 直接输出完整正文 markdown,不要用 JSON 包裹,不要加 code fence 围栏,便于逐字流式渲染。
- 每章以 "## " 二级标题起头。

# 硬约束(违反 = 任务失败)
- 严禁编造文献或链接:只能引用来源列表中的真实 URL。
- 严禁擅自增删章节或改动标题/顺序。`,
    tools: [],
    llm_model: 'default',
    recursion_limit: 40,
    color: '#16a34a',
    runtime: '云端',
    builtin: true,
  },
  {
    id: 'agent-reviewer',
    name: '质量审核员',
    description: '综合审核策略对齐度与内容质量,输出审核报告',
    system_prompt: `你是综合审核员(comprehensive-reviewer),负责 review_quality 节点。你的输出 overall 是引擎分流依据,直接驱动 review_quality 节点的三出口(pass/revise/redo),必须严格按下述规则输出,不得情感化拔高或降级。

# 输入
- state.strategy_doc:策略确认书
- state.enriched_framework:已填充正文(含 markdown 链接引用,如 [标题](URL))
- state.citations:enricher 实际引用的来源清单(带 source_url)
- state.revision_count:当前修订轮次

# 维度与档位
每条给出 verdict ∈ {pass, warn, fail} 与 note。

策略对齐(strategy_items):
- 学术/商业配比:与策略书误差 ≤ 5% → pass;5~15% → warn;> 15% → fail
- 章节配比:每章篇幅占比 vs 策略书权重误差 ≤ 10% → pass;10~20% → warn;> 20% → fail
- 叙事模式一致性:结构与 narrative_mode 匹配 → pass;偏离 → fail

内容质量(quality_items):
- 文献支撑:分析正文中实际出现的 markdown 链接([标题](URL)),检查每章 ≥ 2 处关键论断有真实来源链接 → pass;≥ 1 处缺链接 → warn;发现编造链接或正文含 "[待补充]" 超过 3 处 → fail
- 结构合理性:章节标题、正文对齐 skeleton → pass;偏离 → warn
- 时长/篇幅匹配:幻灯每章 bullets 3~4 或文章每章 300~800 字 → pass;偏离 ≤ 30% → warn;偏离 > 30% → fail

# 总评规则(严格)
- 任一 fail → overall="redo"
- 无 fail 且 ≥ 2 项 warn → overall="revise"
- 无 fail 且 ≤ 1 项 warn → overall="pass"

# 输出(严格 JSON)
{
  "review_report": {
    "overall": "pass" | "revise" | "redo",
    "strategy_items": [ { "dimension": string, "verdict": "pass"|"warn"|"fail", "note": string } ],
    "quality_items":  [ { "dimension": string, "verdict": "pass"|"warn"|"fail", "note": string } ],
    "advices": string[]
  }
}

# 约束
- verdict 三档不得输出其他值。
- overall 严格按上述规则计算。
- overall=pass 时 advices 必须为 [];其他情况每条 ≤ 60 字,动词开头(补充/替换/删除/改写/校对/引用),供下游 enricher 直接消费。
- 输出必须可被 JSON.parse。`,
    tools: ['search_kb'],
    llm_model: 'default',
    recursion_limit: 30,
    color: '#e08600',
    runtime: '云端',
    builtin: true,
  },
  {
    id: 'agent-designer',
    name: '设计专员',
    description: '通用助手:用于自定义任务与开放式对话',
    system_prompt: '你是通用助手,支持任意开放式对话与工具调用。',
    tools: [],
    llm_model: 'default',
    recursion_limit: 20,
    color: '#6b7a90',
    runtime: '本地 Mac mini',
    builtin: true,
  },
];

/**
 * 内置 10 个节点类型 —— 对齐 paradigm_langgraph 的 9 节点 + 一个计数器。
 */
export const NODE_FIXTURES: NodeDef[] = [
  {
    id: 'parse_brief',
    name: '解析需求',
    kind: 'compute',
    agent_id: 'agent-clarifier',
    description: 'Agent 1-1:解析 brief',
    config: {},
    out_ports: ['next'],
    color: '#7c4dff',
  },
  {
    id: 'ask_clarification',
    name: '澄清问题',
    kind: 'interrupt',
    agent_id: null,
    description: 'Agent 1-2:向用户提问',
    config: {},
    out_ports: ['next'],
    color: '#e08600',
  },
  {
    id: 'plan_strategy',
    name: '策略规划',
    kind: 'compute',
    agent_id: 'agent-planner',
    description: 'Agent 1-3:生成策略确认书',
    config: {},
    out_ports: ['next'],
    color: '#2b57d6',
  },
  {
    id: 'confirm_strategy',
    name: '策略确认',
    kind: 'interrupt',
    agent_id: null,
    description: 'Agent 1-4:用户确认或调整策略',
    config: {},
    out_ports: ['confirm', 'adjust'],
    color: '#e08600',
  },
  {
    id: 'build_framework',
    name: '框架搭建',
    kind: 'compute',
    agent_id: 'agent-builder',
    description: 'Agent 2-1:生成目录骨架',
    config: {},
    out_ports: ['next'],
    color: '#0891b2',
  },
  {
    id: 'enrich_content',
    name: '内容填充',
    kind: 'compute',
    agent_id: 'agent-enricher',
    description: 'Agent 2-2:填充章节内容',
    config: {},
    out_ports: ['next'],
    color: '#16a34a',
  },
  {
    id: 'review_quality',
    name: '质量审核',
    kind: 'compute',
    agent_id: 'agent-reviewer',
    description: 'Agent 3-1:综合审核',
    config: {},
    out_ports: ['pass', 'revise', 'redo'],
    color: '#e08600',
  },
  {
    id: 'bump_revision',
    name: '修订计数',
    kind: 'counter',
    agent_id: null,
    description: '递增 revision_count',
    config: { max: 2 },
    out_ports: ['next'],
    color: '#6b7a90',
  },
  {
    id: 'human_final',
    name: '终稿反馈',
    kind: 'interrupt',
    agent_id: null,
    description: 'Agent 3-2:用户通过或退回',
    config: {},
    out_ports: ['pass', 'revise'],
    color: '#e08600',
  },
  {
    id: 'finalize',
    name: '定稿',
    kind: 'compute',
    agent_id: null,
    description: '汇总产出最终 output',
    config: {},
    out_ports: ['end'],
    color: '#16a34a',
  },
];

/**
 * 3 个内置模板:
 *  - 幻灯 7 节点(不带审核回路)
 *  - 文章 7 节点(不带审核回路)
 *  - 完整 10 节点(含审核回路)
 */
export const TEMPLATE_FIXTURES: WorkflowTemplate[] = [
  {
    id: 'tpl-slide-simple',
    name: '幻灯片框架制作(简版)',
    description: 'Agent 1-2-3 · 7 节点 · 输出 Excel',
    tags: ['幻灯', 'Excel', '简版'],
    entry: 'parse_brief',
    builtin: true,
    nodes: [
      { id: 'parse_brief', type: 'parse_brief' },
      { id: 'ask_clarification', type: 'ask_clarification' },
      { id: 'plan_strategy', type: 'plan_strategy' },
      { id: 'confirm_strategy', type: 'confirm_strategy' },
      { id: 'build_framework', type: 'build_framework' },
      { id: 'enrich_content', type: 'enrich_content' },
      { id: 'human_final', type: 'human_final' },
    ],
    edges: [
      { from: 'parse_brief', to: 'ask_clarification', port: 'next' },
      { from: 'ask_clarification', to: 'plan_strategy', port: 'next' },
      { from: 'plan_strategy', to: 'confirm_strategy', port: 'next' },
      { from: 'confirm_strategy', to: 'build_framework', port: 'confirm' },
      { from: 'confirm_strategy', to: 'plan_strategy', port: 'adjust' },
      { from: 'build_framework', to: 'enrich_content', port: 'next' },
      { from: 'enrich_content', to: 'human_final', port: 'next' },
      { from: 'human_final', to: 'enrich_content', port: 'revise' },
    ],
  },
  {
    id: 'tpl-article-simple',
    name: '文章框架制作(简版)',
    description: 'Agent 1-2-3 · 7 节点 · 输出 Word',
    tags: ['文章', 'Word', '简版'],
    entry: 'parse_brief',
    builtin: true,
    nodes: [
      { id: 'parse_brief', type: 'parse_brief' },
      { id: 'ask_clarification', type: 'ask_clarification' },
      { id: 'plan_strategy', type: 'plan_strategy' },
      { id: 'confirm_strategy', type: 'confirm_strategy' },
      { id: 'build_framework', type: 'build_framework' },
      { id: 'enrich_content', type: 'enrich_content' },
      { id: 'human_final', type: 'human_final' },
    ],
    edges: [
      { from: 'parse_brief', to: 'ask_clarification', port: 'next' },
      { from: 'ask_clarification', to: 'plan_strategy', port: 'next' },
      { from: 'plan_strategy', to: 'confirm_strategy', port: 'next' },
      { from: 'confirm_strategy', to: 'build_framework', port: 'confirm' },
      { from: 'confirm_strategy', to: 'plan_strategy', port: 'adjust' },
      { from: 'build_framework', to: 'enrich_content', port: 'next' },
      { from: 'enrich_content', to: 'human_final', port: 'next' },
      { from: 'human_final', to: 'enrich_content', port: 'revise' },
    ],
  },
  {
    id: 'tpl-full',
    name: '完整流程(含审核回路)',
    description: 'Agent 1-2-3 · 10 节点 · 含 3 Agent 审核回路',
    tags: ['完整', '审核回路'],
    entry: 'parse_brief',
    builtin: true,
    nodes: [
      { id: 'parse_brief', type: 'parse_brief' },
      { id: 'ask_clarification', type: 'ask_clarification' },
      { id: 'plan_strategy', type: 'plan_strategy' },
      { id: 'confirm_strategy', type: 'confirm_strategy' },
      { id: 'build_framework', type: 'build_framework' },
      { id: 'enrich_content', type: 'enrich_content' },
      { id: 'review_quality', type: 'review_quality' },
      { id: 'bump_revision', type: 'bump_revision' },
      { id: 'human_final', type: 'human_final' },
      { id: 'finalize', type: 'finalize' },
    ],
    edges: [
      { from: 'parse_brief', to: 'ask_clarification', port: 'next' },
      { from: 'ask_clarification', to: 'plan_strategy', port: 'next' },
      { from: 'plan_strategy', to: 'confirm_strategy', port: 'next' },
      { from: 'confirm_strategy', to: 'build_framework', port: 'confirm' },
      { from: 'confirm_strategy', to: 'plan_strategy', port: 'adjust' },
      { from: 'build_framework', to: 'enrich_content', port: 'next' },
      { from: 'enrich_content', to: 'review_quality', port: 'next' },
      { from: 'review_quality', to: 'human_final', port: 'pass' },
      { from: 'review_quality', to: 'bump_revision', port: 'revise' },
      { from: 'review_quality', to: 'plan_strategy', port: 'redo' },
      { from: 'bump_revision', to: 'enrich_content', port: 'next' },
      { from: 'human_final', to: 'finalize', port: 'pass' },
      { from: 'human_final', to: 'enrich_content', port: 'revise' },
    ],
  },
];
