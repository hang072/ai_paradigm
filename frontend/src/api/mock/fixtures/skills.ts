import type { SkillDef } from '../../../types/skill';

/**
 * 内置技能包 —— 挂载到对话中会把 prompt_fragment 追加到 system prompt。
 * 与 Agent 的区别:Agent 是长期存在的角色;Skill 是即插即用的能力模块。
 */
export const SKILL_FIXTURES: SkillDef[] = [
  {
    id: 'skill-literature',
    name: '文献检索与解读',
    category: '文献',
    description: '检索知识库文献 · 提取核心结论 · 标注可点击来源链接',
    prompt_fragment:
      '当涉及医学论断时,主动调用 search_kb 在挂载的知识库中检索,\n' +
      '每条论断都要以 markdown 链接 [文档标题](URL) 引用命中的真实来源;找不到就标 [待补充],严禁编造。',
    suggested_tools: ['search_kb'],
    color: '#0891b2',
    builtin: true,
  },
  {
    id: 'skill-slide-outline',
    name: '幻灯片大纲生成',
    category: '写作',
    description: '按目标受众/时长生成幻灯片目录 · 分配章节权重',
    prompt_fragment:
      '若用户请求幻灯片相关内容,先输出四段式目录(背景/证据/落地/展望),\n' +
      '并为每章估算时长与页数配比。',
    suggested_tools: [],
    color: '#7c4dff',
    builtin: true,
  },
  {
    id: 'skill-article-draft',
    name: '医学文章写作',
    category: '写作',
    description: '以研究背景—方法—结果—启示四段式撰写学术文章',
    prompt_fragment:
      '以研究背景—方法—结果—启示的四段式撰写。方法节须交代研究类型、\n' +
      '样本量、随机化方式;结果节须给出主要终点与关键 P 值/HR。',
    suggested_tools: ['search_kb'],
    color: '#2b57d6',
    builtin: true,
  },
  {
    id: 'skill-critical-review',
    name: '批判性审阅',
    category: '分析',
    description: '从策略对齐/文献支撑/逻辑完整三维度审阅内容',
    prompt_fragment:
      '你的角色是批判性审阅者。对用户提交的内容,分三维度给出 verdict:\n' +
      '- 策略对齐(pass/warn/fail)\n- 文献支撑(pass/warn/fail)\n- 逻辑完整(pass/warn/fail)\n' +
      '每个维度给出 note 与 advice。',
    suggested_tools: ['search_kb'],
    color: '#e08600',
    builtin: true,
  },
  {
    id: 'skill-data-analysis',
    name: '临床数据解读',
    category: '分析',
    description: '解读 RCT/meta 分析的主要终点、亚组、异质性',
    prompt_fragment:
      '解读临床试验数据时,依次说明:主要终点、次要终点、亚组分析、\n' +
      '安全性信号、异质性(I² 与来源);对阴性结果不做过度解读。',
    suggested_tools: ['search_kb'],
    color: '#16a34a',
    builtin: true,
  },
];
