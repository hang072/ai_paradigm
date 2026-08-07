/**
 * Skill 定义:可挂载到对话中的技能包(prompt 片段 + 建议工具组合)。
 * 与 Agent 的区别:Agent 是长期存在的角色,Skill 是即插即用的能力模块。
 */
export interface SkillDef {
  id: string;
  name: string;
  category: string; // "文献" | "分析" | "写作" | "医学"
  description: string;
  /** 插入到 system prompt 的片段 */
  prompt_fragment: string;
  /** 建议启用的工具 */
  suggested_tools: string[];
  /** 展示色 */
  color: string;
  builtin: boolean;
}
