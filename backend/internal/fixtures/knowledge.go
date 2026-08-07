package fixtures

import "paradigm_eino_backend/internal/domain"

// KnowledgeBases 返回 3 个内置知识库(7 篇文档)—— 对齐前端 mock fixtures/knowledge.ts。
func KnowledgeBases() []*domain.KnowledgeBase {
	const now = "2026-07-01 09:00:00"

	return []*domain.KnowledgeBase{
		{
			ID:          "kb-guidelines",
			Name:        "临床指南库",
			Description: "心内科 / 内分泌 / 神经内科主流学会指南节选(中文)。",
			Color:       "#2b57d6",
			Builtin:     true,
			CreatedAt:   now,
			UpdatedAt:   now,
			Docs: []*domain.KnowledgeDoc{
				{
					ID:        "doc-esc-hf-2023",
					Title:     "ESC 2023 心衰指南要点",
					Type:      domain.KbDocTypeMarkdown,
					Tags:      []string{"心衰", "ESC", "SGLT2i"},
					URL:       "https://doi.org/10.1093/eurheartj/ehad195",
					CreatedAt: now,
					UpdatedAt: now,
					Content: "## ESC 2023 心衰管理更新\n\n" +
						"- HFrEF 四联疗法保留:ACEI/ARNI + β 受体阻滞剂 + MRA + **SGLT2 抑制剂**。\n" +
						"- 达格列净 / 恩格列净在 HFmrEF、HFpEF 患者中同样推荐(I 类,B 级证据)。\n" +
						"- 起始时机:急性失代偿稳定后即启动,不必等出院。\n" +
						"- 剂量滴定:每 2 周复评一次,目标剂量或最大耐受剂量。",
				},
				{
					ID:        "doc-ada-2024",
					Title:     "ADA 2024 糖尿病诊疗标准",
					Type:      domain.KbDocTypeMarkdown,
					Tags:      []string{"糖尿病", "ADA", "GLP-1RA"},
					URL:       "https://diabetesjournals.org/care/issue/47/Supplement_1",
					CreatedAt: now,
					UpdatedAt: now,
					Content: "## ADA 2024 主要更新\n\n" +
						"- T2DM 合并 ASCVD/CKD/HF 优选 **GLP-1RA 或 SGLT2i**,不受 HbA1c 限制。\n" +
						"- 二甲双胍不再是唯一一线,视合并症制定个体化方案。\n" +
						"- CGM(动态血糖监测)推广至所有 T1DM 与部分 T2DM。",
				},
				{
					ID:        "doc-aha-stroke-2024",
					Title:     "AHA/ASA 2024 缺血性卒中一级预防",
					Type:      domain.KbDocTypeMarkdown,
					Tags:      []string{"卒中", "AHA", "一级预防"},
					URL:       "https://doi.org/10.1161/STR.0000000000000475",
					CreatedAt: now,
					UpdatedAt: now,
					Content: "## AHA/ASA 2024 一级预防要点\n\n" +
						"- 高血压控制目标 <130/80 mmHg。\n" +
						"- 房颤患者 CHA2DS2-VASc ≥ 2 建议抗凝(NOAC 优选)。\n" +
						"- 他汀 + 抗血小板双通道(高危患者)。",
				},
			},
		},
		{
			ID:          "kb-drug-checklist",
			Name:        "用药清单库",
			Description: "常见药物起始剂量、滴定节奏与监测节点速查。",
			Color:       "#16a34a",
			Builtin:     true,
			CreatedAt:   now,
			UpdatedAt:   now,
			Docs: []*domain.KnowledgeDoc{
				{
					ID:        "doc-sglt2i-usage",
					Title:     "SGLT2 抑制剂用药清单",
					Type:      domain.KbDocTypeMarkdown,
					Tags:      []string{"SGLT2i", "心衰", "糖尿病"},
					URL:       "https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=dapagliflozin",
					CreatedAt: now,
					UpdatedAt: now,
					Content: "## SGLT2i 用药清单\n\n" +
						"| 药物 | 起始剂量 | 目标剂量 | 主要监测 |\n|---|---|---|---|\n" +
						"| 达格列净 | 10 mg qd | 10 mg qd | eGFR、血酮 |\n" +
						"| 恩格列净 | 10 mg qd | 10 mg qd | eGFR、血酮 |\n" +
						"| 卡格列净 | 100 mg qd | 300 mg qd | eGFR、下肢截肢风险 |\n\n" +
						"**监测节点**:启动前基线 eGFR/尿蛋白;启动后 1、3、6 月复评。",
				},
				{
					ID:        "doc-glp1ra-usage",
					Title:     "GLP-1RA 用药清单",
					Type:      domain.KbDocTypeMarkdown,
					Tags:      []string{"GLP-1RA", "糖尿病", "减重"},
					URL:       "https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=semaglutide",
					CreatedAt: now,
					UpdatedAt: now,
					Content: "## GLP-1RA 用药清单\n\n" +
						"- 司美格鲁肽:起始 0.25 mg qw,每 4 周翻倍至 1.0~2.0 mg qw。\n" +
						"- 度拉糖肽:0.75 mg qw 起,可上调至 1.5~4.5 mg qw。\n" +
						"- **不良反应**:胃肠道反应最常见,滴定越缓越易耐受。\n" +
						"- **禁忌**:MTC 家族史、MEN2、胰腺炎史。",
				},
			},
		},
		{
			ID:          "kb-internal-sop",
			Name:        "内部 SOP 库",
			Description: "内容生产 SOP:选题—策略—框架—审核标准流程。",
			Color:       "#7c4dff",
			Builtin:     true,
			CreatedAt:   now,
			UpdatedAt:   now,
			Docs: []*domain.KnowledgeDoc{
				{
					ID:        "doc-slide-sop",
					Title:     "幻灯片制作 SOP",
					Type:      domain.KbDocTypeMarkdown,
					Tags:      []string{"SOP", "幻灯", "流程"},
					CreatedAt: now,
					UpdatedAt: now,
					Content: "## 幻灯片制作 SOP\n\n" +
						"1. **需求确认**:主题、受众、时长、场景四要素明确后方可进入策略。\n" +
						"2. **策略确认**:学术/商业配比 + 叙事模式必须书面签字。\n" +
						"3. **框架搭建**:章节权重误差 <5% 视为合格。\n" +
						"4. **内容填充**:关键论断须引用一次 PMID,找不到标 [待补充]。\n" +
						"5. **质量审核**:策略对齐 + 文献支撑 + 逻辑完整三维度全部 pass 方可交付。",
				},
				{
					ID:        "doc-review-sop",
					Title:     "质量审核评分标准",
					Type:      domain.KbDocTypeMarkdown,
					Tags:      []string{"SOP", "审核", "评分"},
					CreatedAt: now,
					UpdatedAt: now,
					Content: "## 质量审核评分标准\n\n" +
						"- **pass**:三维度均无 warn/fail。\n" +
						"- **revise**:任一维度 warn,回 enrich_content 一轮。\n" +
						"- **redo**:任一维度 fail,回 plan_strategy。\n" +
						"- 修订上限 2 次,超过强制通过并在日志中标记。",
				},
			},
		},
	}
}
