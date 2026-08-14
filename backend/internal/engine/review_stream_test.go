package engine

import (
	"context"
	"strings"
	"testing"

	"github.com/cloudwego/eino/schema"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/store"
)

// TestParseReviewStreamText 覆盖哨兵裁定行的解析分支。
func TestParseReviewStreamText(t *testing.T) {
	cases := []struct {
		name         string
		text         string
		wantVerdict  string
		wantAdvices  int
		wantTarget   string
		wantErr      bool
	}{
		{
			name:        "pass 无建议",
			text:        "## 策略契合度\n合格。\n\n裁定: pass",
			wantVerdict: "pass",
			wantAdvices: 0,
		},
		{
			name:        "revise 带建议",
			text:        "## 文献支撑\n第二章缺引用。\n\n裁定: revise\n- 补充第二章 RCT 引用\n- 第三章加监测表",
			wantVerdict: "revise",
			wantAdvices: 2,
		},
		{
			name:        "全角冒号 redo",
			text:        "## 方向\n偏题。\n\n裁定：redo\n- 重新对齐策略书",
			wantVerdict: "redo",
			wantAdvices: 1,
		},
		{
			name:    "无哨兵行报错",
			text:    "## 点评\n还不错,没有明确裁定。",
			wantErr: true,
		},
		{
			name:    "revise 无建议报错",
			text:    "## 点评\n有问题。\n\n裁定: revise",
			wantErr: true,
		},
		// ─── 阶段 6 workbuddy 借鉴:target_node 解析(可选"回流到:"哨兵行)────────
		{
			name:        "revise + 回流到: plan_strategy",
			text:        "## 策略\n配比偏离。\n\n裁定: revise\n回流到: plan_strategy\n- 调整配比至 70/30",
			wantVerdict: "revise",
			wantAdvices: 1,
			wantTarget:  "plan_strategy",
		},
		{
			name:        "revise + 回流到: build_framework",
			text:        "## 骨架\n与 skeleton 不符。\n\n裁定: revise\n回流到: build_framework\n- 重建 4.2 子节",
			wantVerdict: "revise",
			wantAdvices: 1,
			wantTarget:  "build_framework",
		},
		{
			name:        "revise 缺省 target_node 为空",
			text:        "## 内容\n有些小问题。\n\n裁定: revise\n- 改一改",
			wantVerdict: "revise",
			wantAdvices: 1,
			wantTarget:  "",
		},
		{
			name:        "pass 不带 target_node(下游分支不看)",
			text:        "## 综合\n合格。\n\n裁定: pass",
			wantVerdict: "pass",
			wantAdvices: 0,
			wantTarget:  "",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			verdict, advices, target, err := parseReviewStreamText(c.text)
			if c.wantErr {
				if err == nil {
					t.Fatalf("期望 error, 得到 nil (verdict=%q)", verdict)
				}
				return
			}
			if err != nil {
				t.Fatalf("意外 error: %v", err)
			}
			if verdict != c.wantVerdict {
				t.Fatalf("verdict=%q, 期望 %q", verdict, c.wantVerdict)
			}
			if len(advices) != c.wantAdvices {
				t.Fatalf("advices=%d 条, 期望 %d 条", len(advices), c.wantAdvices)
			}
			if target != c.wantTarget {
				t.Fatalf("target_node=%q, 期望 %q", target, c.wantTarget)
			}
		})
	}
}

// TestReviewQualityStreamTokenSink 验证:reviewQualityStream 逐帧把审核意见推给
// TokenSink,并把裁定/建议/Summary 写进 snapshot.review_report。
func TestReviewQualityStreamTokenSink(t *testing.T) {
	snapStore := store.NewMemTaskSnapshotStore()
	created := snapStore.Create(&domain.TaskSnapshot{
		Title: "t", Brief: "心衰", TaskType: domain.TaskTypeArticle,
		Status: domain.TaskStatusRunning, StepHistory: []domain.StepHistoryItem{},
		Spec: domain.TaskSpec{},
	})
	taskID := created.ThreadID

	report := "## 策略契合度\n配比一致。\n\n## 文献支撑\n第二章缺引用。\n\n裁定: revise\n- 补充第二章 RCT 引用\n- 第三章加监测表"
	n := len(report) / 4
	var frames []string
	for i := 0; i < len(report); i += n {
		end := i + n
		if end > len(report) {
			end = len(report)
		}
		frames = append(frames, report[i:end])
	}
	p := &streamMockProvider{frames: frames}

	var got []string
	sink := func(node, delta string) {
		if node == "review_quality" {
			got = append(got, delta)
		}
	}

	verdict, err := reviewQualityStream(context.Background(), taskID, snapStore,
		[]*schema.Message{{Role: schema.User, Content: "审核"}}, p, sink, nil)
	if err != nil {
		t.Fatalf("reviewQualityStream 返回错误: %v", err)
	}
	if verdict != "revise" {
		t.Fatalf("verdict=%q, 期望 revise", verdict)
	}
	if len(got) != len(frames) {
		t.Fatalf("sink 收到 %d 帧, 期望 %d 帧", len(got), len(frames))
	}
	if strings.Join(got, "") != report {
		t.Fatal("拼接增量与原文不一致")
	}
	final, _ := snapStore.Get(taskID)
	if final.ReviewReport == nil {
		t.Fatal("review_report 未写入")
	}
	if final.ReviewReport.Overall != "revise" {
		t.Fatalf("overall=%q, 期望 revise", final.ReviewReport.Overall)
	}
	if len(final.ReviewReport.Advices) != 2 {
		t.Fatalf("advices=%d 条, 期望 2 条", len(final.ReviewReport.Advices))
	}
	if final.ReviewReport.Summary != report {
		t.Fatal("Summary 未保存完整审核正文")
	}
}

// TestReviewQualityStreamEmptyErrors 验证:空输出返回 error,不写 review_report。
func TestReviewQualityStreamEmptyErrors(t *testing.T) {
	snapStore := store.NewMemTaskSnapshotStore()
	created := snapStore.Create(&domain.TaskSnapshot{
		Title: "t", Brief: "x", TaskType: domain.TaskTypeArticle,
		Status: domain.TaskStatusRunning, StepHistory: []domain.StepHistoryItem{},
		Spec: domain.TaskSpec{},
	})
	taskID := created.ThreadID

	p := &streamMockProvider{frames: []string{"", ""}}
	_, err := reviewQualityStream(context.Background(), taskID, snapStore,
		[]*schema.Message{{Role: schema.User, Content: "审核"}}, p, func(_, _ string) {}, nil)
	verifyEmptyReviewError(t, err, snapStore, taskID)
}

func verifyEmptyReviewError(t *testing.T, err error, snapStore store.TaskSnapshotStore, taskID string) {
	t.Helper()
	if err == nil {
		t.Fatal("空输出应返回 error, 得到 nil")
	}
	final, _ := snapStore.Get(taskID)
	if final.ReviewReport != nil {
		t.Fatal("空输出不应写入 review_report")
	}
}
