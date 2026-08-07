import type { KnowledgeBase } from '../../../types/knowledge';

/**
 * 内置知识库 —— 3 个:临床指南、用药清单、内部 SOP。
 * 每个 KB 装 2~3 篇文档,方便对话中的 search_kb 工具做关键字命中。
 */
const now = '2026-07-01 09:00:00';

export const KNOWLEDGE_FIXTURES: KnowledgeBase[] = [
  {
    id: 'kb-guidelines',
    name: '临床指南库',
    description: '心内科 / 内分泌 / 神经内科主流学会指南节选(中文)。',
    color: '#2b57d6',
    builtin: true,
    created_at: now,
    updated_at: now,
    docs: [
      {
        id: 'doc-esc-hf-2023',
        title: 'ESC 2023 心衰指南要点',
        type: 'markdown',
        tags: ['心衰', 'ESC', 'SGLT2i'],
        url: 'https://doi.org/10.1093/eurheartj/ehad195',
        created_at: now,
        updated_at: now,
        content:
          '## ESC 2023 心衰管理更新\n\n' +
          '- HFrEF 四联疗法保留:ACEI/ARNI + β 受体阻滞剂 + MRA + **SGLT2 抑制剂**。\n' +
          '- 达格列净 / 恩格列净在 HFmrEF、HFpEF 患者中同样推荐(I 类,B 级证据)。\n' +
          '- 起始时机:急性失代偿稳定后即启动,不必等出院。\n' +
          '- 剂量滴定:每 2 周复评一次,目标剂量或最大耐受剂量。',
      },
      {
        id: 'doc-ada-2024',
        title: 'ADA 2024 糖尿病诊疗标准',
        type: 'markdown',
        tags: ['糖尿病', 'ADA', 'GLP-1RA'],
        url: 'https://diabetesjournals.org/care/issue/47/Supplement_1',
        created_at: now,
        updated_at: now,
        content:
          '## ADA 2024 主要更新\n\n' +
          '- T2DM 合并 ASCVD/CKD/HF 优选 **GLP-1RA 或 SGLT2i**,不受 HbA1c 限制。\n' +
          '- 二甲双胍不再是唯一一线,视合并症制定个体化方案。\n' +
          '- CGM(动态血糖监测)推广至所有 T1DM 与部分 T2DM。',
      },
      {
        id: 'doc-aha-stroke-2024',
        title: 'AHA/ASA 2024 缺血性卒中一级预防',
        type: 'markdown',
        tags: ['卒中', 'AHA', '一级预防'],
        url: 'https://doi.org/10.1161/STR.0000000000000475',
        created_at: now,
        updated_at: now,
        content:
          '## AHA/ASA 2024 一级预防要点\n\n' +
          '- 高血压控制目标 <130/80 mmHg。\n' +
          '- 房颤患者 CHA2DS2-VASc ≥ 2 建议抗凝(NOAC 优选)。\n' +
          '- 他汀 + 抗血小板双通道(高危患者)。',
      },
    ],
  },
  {
    id: 'kb-drug-checklist',
    name: '用药清单库',
    description: '常见药物起始剂量、滴定节奏与监测节点速查。',
    color: '#16a34a',
    builtin: true,
    created_at: now,
    updated_at: now,
    docs: [
      {
        id: 'doc-sglt2i-usage',
        title: 'SGLT2 抑制剂用药清单',
        type: 'markdown',
        tags: ['SGLT2i', '心衰', '糖尿病'],
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=dapagliflozin',
        created_at: now,
        updated_at: now,
        content:
          '## SGLT2i 用药清单\n\n' +
          '| 药物 | 起始剂量 | 目标剂量 | 主要监测 |\n|---|---|---|---|\n' +
          '| 达格列净 | 10 mg qd | 10 mg qd | eGFR、血酮 |\n' +
          '| 恩格列净 | 10 mg qd | 10 mg qd | eGFR、血酮 |\n' +
          '| 卡格列净 | 100 mg qd | 300 mg qd | eGFR、下肢截肢风险 |\n\n' +
          '**监测节点**:启动前基线 eGFR/尿蛋白;启动后 1、3、6 月复评。',
      },
      {
        id: 'doc-glp1ra-usage',
        title: 'GLP-1RA 用药清单',
        type: 'markdown',
        tags: ['GLP-1RA', '糖尿病', '减重'],
        url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=semaglutide',
        created_at: now,
        updated_at: now,
        content:
          '## GLP-1RA 用药清单\n\n' +
          '- 司美格鲁肽:起始 0.25 mg qw,每 4 周翻倍至 1.0~2.0 mg qw。\n' +
          '- 度拉糖肽:0.75 mg qw 起,可上调至 1.5~4.5 mg qw。\n' +
          '- **不良反应**:胃肠道反应最常见,滴定越缓越易耐受。\n' +
          '- **禁忌**:MTC 家族史、MEN2、胰腺炎史。',
      },
    ],
  },
  {
    id: 'kb-internal-sop',
    name: '内部 SOP 库',
    description: '内容生产 SOP:选题—策略—框架—审核标准流程。',
    color: '#7c4dff',
    builtin: true,
    created_at: now,
    updated_at: now,
    docs: [
      {
        id: 'doc-slide-sop',
        title: '幻灯片制作 SOP',
        type: 'markdown',
        tags: ['SOP', '幻灯', '流程'],
        created_at: now,
        updated_at: now,
        content:
          '## 幻灯片制作 SOP\n\n' +
          '1. **需求确认**:主题、受众、时长、场景四要素明确后方可进入策略。\n' +
          '2. **策略确认**:学术/商业配比 + 叙事模式必须书面签字。\n' +
          '3. **框架搭建**:章节权重误差 <5% 视为合格。\n' +
          '4. **内容填充**:关键论断须引用一次 PMID,找不到标 [待补充]。\n' +
          '5. **质量审核**:策略对齐 + 文献支撑 + 逻辑完整三维度全部 pass 方可交付。',
      },
      {
        id: 'doc-review-sop',
        title: '质量审核评分标准',
        type: 'markdown',
        tags: ['SOP', '审核', '评分'],
        created_at: now,
        updated_at: now,
        content:
          '## 质量审核评分标准\n\n' +
          '- **pass**:三维度均无 warn/fail。\n' +
          '- **revise**:任一维度 warn,回 enrich_content 一轮。\n' +
          '- **redo**:任一维度 fail,回 plan_strategy。\n' +
          '- 修订上限 2 次,超过强制通过并在日志中标记。',
      },
    ],
  },
];
