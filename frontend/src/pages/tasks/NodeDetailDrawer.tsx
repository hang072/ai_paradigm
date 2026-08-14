import { useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import {
  BranchesOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import type { TaskSnapshot, StepHistoryItem, Citation } from '../../types/task';
import type { NodeDef } from '../../types/node';
import type { AgentDef } from '../../types/agent';
import type { ReviewReport } from '../../types/review';
import { MarkdownView } from '../../components/MarkdownView';
import AgentAvatar from '../../components/AgentAvatar';
import { fromNow } from '../../utils/time';
import { ArtifactsApi } from '../../api/artifacts';

const { Title, Text, Paragraph } = Typography;

/** 节点 type → after_keys 字段名的优先映射,作为 fallback 渲染(同 backend/internal/engine/steps.go pushStep 的字段)。 */
const NODE_TYPE_AFTER_KEYS: Record<string, string[]> = {
  parse_brief: ['parsed_info', 'completeness', 'clarify_questions'],
  plan_strategy: ['strategy_doc', 'narrative_mode'],
  build_framework: ['framework_skeleton'],
  enrich_content: ['enriched_framework', 'citations'],
  review_quality: ['review_report'],
  bump_revision: ['revision_count'],
  human_final: [],
  finalize: ['final_output'],
  ask_clarification: ['clarify_questions'],
  confirm_strategy: [],
};

const NODE_KIND_LABEL: Record<NodeDef['kind'], string> = {
  compute: 'Compute',
  interrupt: 'HITL',
  counter: 'Counter',
  router: 'Router',
};

const NODE_KIND_COLOR: Record<NodeDef['kind'], string> = {
  compute: 'blue',
  interrupt: 'gold',
  counter: 'purple',
  router: 'cyan',
};

export interface NodeDetailDrawerProps {
  task: TaskSnapshot;
  nodeDefs: NodeDef[];
  agentDefs: AgentDef[];
  /** 当前选中节点 id(可来自画布点击) */
  nodeId: string | null;
  open: boolean;
  onClose: () => void;
}

/**
 * 任务画布节点点击后展示该节点的运行快照:
 *  - 基础信息:节点定义 / Agent 绑定 / 在 step_history 中的位置 / done/skipped 状态
 *  - 产物:根据 node.type + 该节点在 step_history 中声明的 after_keys,从 task 顶层字段渲染
 *  - 多轮 revision:取该节点最后一次运行
 */
export function NodeDetailDrawer(props: NodeDetailDrawerProps) {
  const { task, nodeDefs, agentDefs, nodeId, open, onClose } = props;
  const { message } = AntApp.useApp();

  const nodeDef = useMemo(
    () => (nodeId ? task.spec.nodes.find((n) => n.id === nodeId) : null),
    [task, nodeId],
  );
  const defMeta = useMemo(
    () => (nodeDef ? nodeDefs.find((d) => d.id === nodeDef.type) : null),
    [nodeDefs, nodeDef],
  );
  const agent = useMemo(
    () => (defMeta?.agent_id ? agentDefs.find((a) => a.id === defMeta.agent_id) : null),
    [agentDefs, defMeta],
  );

  /** 该节点在 step_history 里最后一次运行的记录(用于判定 done/skipped 状态)。 */
  const lastRun = useMemo<StepHistoryItem | null>(() => {
    if (!nodeId) return null;
    const list = task.step_history ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].node_id === nodeId) return list[i];
    }
    return null;
  }, [nodeId, task.step_history]);

  /** 决定要展示哪些产物字段:优先用 lastRun.after_keys,缺失则用 NODE_TYPE_AFTER_KEYS。 */
  const afterKeys = useMemo<string[]>(() => {
    if (!lastRun) return [];
    if (lastRun.after_keys.length > 0) return lastRun.after_keys;
    return NODE_TYPE_AFTER_KEYS[nodeDef?.type ?? ''] ?? [];
  }, [lastRun, nodeDef]);

  const runState = !lastRun
    ? 'pending'
    : lastRun.skipped
      ? 'skipped'
      : 'done';

  const runStateMeta: Record<string, { color: string; label: string }> = {
    pending: { color: 'default', label: '未执行' },
    done: { color: 'success', label: '已完成' },
    skipped: { color: 'default', label: '已跳过' },
  };

  const copyAll = () => {
    if (!nodeId) return;
    const dump = buildDump({
      task,
      nodeId,
      defMeta,
      agent,
      lastRun,
      afterKeys,
    });
    navigator.clipboard
      .writeText(dump)
      .then(() => message.success('已复制节点产物到剪贴板'))
      .catch(() => message.error('复制失败,请检查浏览器权限'));
  };

  return (
    <Drawer
      title={
        nodeDef ? (
          <Space>
            <Tag color={defMeta ? NODE_KIND_COLOR[defMeta.kind] : 'default'}>
              {defMeta ? NODE_KIND_LABEL[defMeta.kind] : 'Unknown'}
            </Tag>
            <span>{defMeta?.name ?? nodeDef.type}</span>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {nodeDef.id}
            </Text>
          </Space>
        ) : (
          '节点详情'
        )
      }
      placement="right"
      width={720}
      open={open}
      onClose={onClose}
      destroyOnClose
      extra={
        <Button
          icon={<CopyOutlined />}
          size="small"
          onClick={copyAll}
          disabled={!nodeDef}
        >
          复制产物
        </Button>
      }
    >
      {!nodeDef ? (
        <Empty description="未选中节点" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 基础信息 */}
          <section>
            <Title level={5} style={{ marginTop: 0 }}>
              基础信息
            </Title>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="实例 ID">{nodeDef.id}</Descriptions.Item>
              <Descriptions.Item label="类型">
                <Tag color={defMeta ? NODE_KIND_COLOR[defMeta.kind] : 'default'}>
                  {defMeta ? NODE_KIND_LABEL[defMeta.kind] : nodeDef.type}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="显示名" span={2}>
                {defMeta?.name ?? '(未配置 NodeDef)'}
              </Descriptions.Item>
              {defMeta?.description && (
                <Descriptions.Item label="描述" span={2}>
                  <Paragraph
                    type="secondary"
                    style={{ margin: 0, fontSize: 12 }}
                    ellipsis={{ rows: 3, expandable: true }}
                  >
                    {defMeta.description}
                  </Paragraph>
                </Descriptions.Item>
              )}
              <Descriptions.Item label="绑定 Agent" span={2}>
                {agent ? (
                  <Space>
                    <AgentAvatar agent={agent} size={20} />
                    <Tag color="blue">{agent.display_name ?? agent.name}</Tag>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {agent.id}
                    </Text>
                  </Space>
                ) : (
                  <Text type="secondary">(未绑定 Agent)</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="输出端口" span={2}>
                {(defMeta?.out_ports ?? ['next']).map((p) => (
                  <Tag key={p} color="blue" style={{ marginRight: 4 }}>
                    {p}
                  </Tag>
                ))}
              </Descriptions.Item>
            </Descriptions>
          </section>

          {/* 运行状态 */}
          <section>
            <Title level={5} style={{ marginTop: 0 }}>
              运行状态
            </Title>
            <Space size={16} wrap>
              <Tag color={runStateMeta[runState].color} style={{ fontSize: 13 }}>
                {runStateMeta[runState].label}
              </Tag>
              {lastRun && (
                <>
                  <Statistic
                    title="步骤号"
                    value={lastRun.step}
                    prefix={<ThunderboltFilled style={{ color: '#e08600' }} />}
                    valueStyle={{ fontSize: 14 }}
                  />
                  <Statistic
                    title="影响字段"
                    value={lastRun.after_keys.length}
                    suffix="个"
                    valueStyle={{ fontSize: 14 }}
                  />
                </>
              )}
            </Space>
            {!lastRun && (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 8 }}
                message="该节点尚未执行,暂无运行记录。"
              />
            )}
          </section>

          {/* 产物区 */}
          <section>
            <Title level={5} style={{ marginTop: 0 }}>
              节点产物
            </Title>
            {afterKeys.length === 0 ? (
              <Empty
                description={
                  lastRun
                    ? '该节点未声明产生任何 state 字段(纯 gate / counter 节点)。'
                    : '该节点尚未执行,无产物。'
                }
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {afterKeys.map((k) => renderField(task, k))}
              </div>
            )}
          </section>

          {/* 阶段 4:工件历史(共享工件仓库) */}
          {task.artifacts && Object.keys(task.artifacts).length > 0 && (
            <section style={{ marginTop: 16 }}>
              <Title level={5} style={{ marginTop: 0 }}>
                工件历史(Artifact Store)
              </Title>
              <ArtifactPanel task={task} />
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

/**
 * 阶段 4:工件面板 —— 列出 task.artifacts 的所有 key,每个 key 可点开看
 * 版本列表 + 任意两版本 unified diff。
 */
function ArtifactPanel({ task }: { task: TaskSnapshot }) {
  const entries = Object.values(task.artifacts ?? {});
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map((ref) => (
        <Card
          key={ref.key}
          size="small"
          title={
            <Space>
              <Text strong>{ref.key}</Text>
              <Tag>v{ref.current_version} / {ref.total_versions} 版</Tag>
            </Space>
          }
          extra={
            <Button size="small" onClick={() => setOpenKey(openKey === ref.key ? null : ref.key)}>
              {openKey === ref.key ? '收起' : '查看历史'}
            </Button>
          }
        >
          {openKey === ref.key && <ArtifactVersions taskID={task.thread_id} keyName={ref.key} />}
        </Card>
      ))}
    </div>
  );
}

function ArtifactVersions({ taskID, keyName }: { taskID: string; keyName: string }) {
  const [versions, setVersions] = useState<number[]>([]);
  const [v1, setV1] = useState<number | null>(null);
  const [v2, setV2] = useState<number | null>(null);
  const [diff, setDiff] = useState<string>('');
  useEffect(() => {
    ArtifactsApi.versions(taskID, keyName)
      .then((vs) => {
        setVersions(vs);
        if (vs.length >= 2) {
          setV1(vs[vs.length - 1]);
          setV2(vs[0]);
        } else if (vs.length === 1) {
          setV1(vs[0]);
        }
      })
      .catch(() => setVersions([]));
  }, [taskID, keyName]);
  useEffect(() => {
    if (v1 == null || v2 == null || v1 === v2) {
      setDiff('');
      return;
    }
    ArtifactsApi.diff(taskID, keyName, v1, v2)
      .then((d) => setDiff(d.unified))
      .catch(() => setDiff('(diff 失败)'));
  }, [taskID, keyName, v1, v2]);
  if (versions.length === 0) {
    return <Text type="secondary">暂无版本</Text>;
  }
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Space>
        <Text>对比:</Text>
        <Select
          size="small"
          style={{ minWidth: 100 }}
          value={v1 ?? undefined}
          onChange={setV1}
          options={versions.map((v) => ({ value: v, label: `v${v}` }))}
          placeholder="旧版"
        />
        <Text>→</Text>
        <Select
          size="small"
          style={{ minWidth: 100 }}
          value={v2 ?? undefined}
          onChange={setV2}
          options={versions.map((v) => ({ value: v, label: `v${v}` }))}
          placeholder="新版"
        />
      </Space>
      {diff ? (
        <pre
          style={{
            background: '#fafafa',
            border: '1px solid #eee',
            padding: 8,
            borderRadius: 4,
            fontSize: 12,
            maxHeight: 400,
            overflow: 'auto',
            whiteSpace: 'pre',
          }}
        >
          {diff}
        </pre>
      ) : (
        <Text type="secondary">{v1 === v2 ? '选两个不同版本可看 diff' : '加载 diff…'}</Text>
      )}
    </Space>
  );
}

/* ---------------- helpers ---------------- */

function renderField(task: TaskSnapshot, key: string) {
  // 特殊:review_report / citations 走格式化渲染,其他按值类型判断
  if (key === 'review_report') {
    const v = task.review_report;
    return v ? (
      <FieldCard key={key} title="review_report" icon="📋">
        <ReviewReportView report={v} />
      </FieldCard>
    ) : (
      <FieldMissing key={key} title="review_report" />
    );
  }
  if (key === 'citations') {
    const v = task.citations ?? [];
    return v.length > 0 ? (
      <FieldCard key={key} title={`citations (${v.length})`} icon="🔗">
        <CitationsView citations={v} />
      </FieldCard>
    ) : (
      <FieldMissing key={key} title="citations" />
    );
  }
  if (key === 'enriched_framework') {
    const v = task.enriched_framework;
    return v ? (
      <FieldCard key={key} title="enriched_framework" icon="📝">
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          <MarkdownView text={v} />
        </div>
      </FieldCard>
    ) : (
      <FieldMissing key={key} title="enriched_framework" />
    );
  }
  if (key === 'strategy_doc') {
    const v = task.strategy_doc;
    return v ? (
      <FieldCard key={key} title="strategy_doc" icon="📜">
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          <MarkdownView text={v} />
        </div>
      </FieldCard>
    ) : (
      <FieldMissing key={key} title="strategy_doc" />
    );
  }
  if (key === 'narrative_mode') {
    const v = task.narrative_mode;
    return v ? (
      <FieldCard key={key} title="narrative_mode" icon="🎭">
        <Tag color="purple">{v}</Tag>
      </FieldCard>
    ) : (
      <FieldMissing key={key} title="narrative_mode" />
    );
  }
  if (key === 'final_output') {
    const v = task.final_output;
    return v ? (
      <FieldCard key={key} title="final_output" icon="📦">
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          <MarkdownView text={v} />
        </div>
      </FieldCard>
    ) : (
      <FieldMissing key={key} title="final_output" />
    );
  }
  if (key === 'revision_count') {
    return (
      <FieldCard key={key} title="revision_count" icon="🔁">
        <Tag color="orange">修订 {task.revision_count} 次</Tag>
      </FieldCard>
    );
  }
  if (key === 'parsed_info' || key === 'completeness' || key === 'framework_skeleton') {
    const v = (task as any)[key];
    return v != null ? (
      <FieldCard key={key} title={key} icon="🧩">
        <pre className="mono" style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(v, null, 2)}
        </pre>
      </FieldCard>
    ) : (
      <FieldMissing key={key} title={key} />
    );
  }
  if (key === 'clarify_questions') {
    const v = task.clarify_questions ?? [];
    return v.length > 0 ? (
      <FieldCard key={key} title={`clarify_questions (${v.length})`} icon="❓">
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
          {v.map((q, i) => (
            <li key={i} style={{ marginBottom: 4 }}>
              {q.question}
              {q.options?.length > 0 && (
                <div style={{ marginTop: 2, fontSize: 12 }}>
                  {q.options.map((o) => (
                    <Tag key={o} style={{ marginBottom: 2 }}>
                      {o}
                    </Tag>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      </FieldCard>
    ) : (
      <FieldMissing key={key} title="clarify_questions" />
    );
  }
  // 兜底:任意顶层字段
  const v = (task as any)[key];
  if (v == null) return <FieldMissing key={key} title={key} />;
  return (
    <FieldCard key={key} title={key} icon="•">
      <pre className="mono" style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
        {typeof v === 'string' ? v : JSON.stringify(v, null, 2)}
      </pre>
    </FieldCard>
  );
}

function FieldCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid #e3e8f0',
        borderRadius: 8,
        background: '#fafbfc',
        padding: 12,
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: '#6b7a90',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>{icon}</span>
        <span style={{ fontFamily: 'monospace' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function FieldMissing({ title }: { title: string }) {
  return (
    <FieldCard title={title} icon="∅">
      <Text type="secondary" style={{ fontSize: 12 }}>
        (空)
      </Text>
    </FieldCard>
  );
}

function ReviewReportView({ report }: { report: ReviewReport }) {
  const verdictColor: Record<string, string> = {
    pass: 'success',
    warn: 'warning',
    fail: 'error',
    revise: 'warning',
    redo: 'error',
  };
  // 阶段 6:智能路由 target_node 标签(仅在 overall=revise/redo 且 target_node 非空时显示)
  const showTarget = !!report.target_node && report.overall !== 'pass';
  const targetLabels: Record<string, string> = {
    plan_strategy: '策略规划',
    build_framework: '框架搭建',
    enrich_content: '内容填充',
    human_final: '人工介入',
  };
  return (
    <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Space size={4} wrap>
        <Text strong>综合</Text>
        <Tag color={verdictColor[report.overall] ?? 'default'}>{report.overall}</Tag>
        {showTarget && (
          <Tag color="green" icon={<BranchesOutlined />}>
            回流到: {targetLabels[report.target_node!] ?? report.target_node}
          </Tag>
        )}
      </Space>
      {report.summary && (
        <div>
          <Text type="secondary" style={{ fontSize: 11 }}>
            <ClockCircleOutlined /> 审核意见
          </Text>
          <div
            style={{
              marginTop: 4,
              padding: 8,
              background: '#fff',
              border: '1px dashed #e3e8f0',
              borderRadius: 6,
              maxHeight: 200,
              overflow: 'auto',
            }}
          >
            <MarkdownView text={report.summary} />
          </div>
        </div>
      )}
      {report.strategy_items && report.strategy_items.length > 0 && (
        <div>
          <Text strong>策略对齐</Text>
          {report.strategy_items.map((it, i) => (
            <div key={i} style={{ marginTop: 2 }}>
              <Tag color={verdictColor[it.verdict] ?? 'default'}>{it.verdict}</Tag>
              <Text>{it.dimension}</Text>: <Text type="secondary">{it.note}</Text>
            </div>
          ))}
        </div>
      )}
      {report.quality_items && report.quality_items.length > 0 && (
        <div>
          <Text strong>质量维度</Text>
          {report.quality_items.map((it, i) => (
            <div key={i} style={{ marginTop: 2 }}>
              <Tag color={verdictColor[it.verdict] ?? 'default'}>{it.verdict}</Tag>
              <Text>{it.dimension}</Text>: <Text type="secondary">{it.note}</Text>
            </div>
          ))}
        </div>
      )}
      {report.advices && report.advices.length > 0 && (
        <div>
          <Text strong>建议</Text>
          <ul style={{ margin: '2px 0 0 16px', padding: 0 }}>
            {report.advices.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CitationsView({ citations }: { citations: Citation[] }) {
  return (
    <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.9 }}>
      {citations.map((c, i) => (
        <li key={c.ref_id || i}>
          <a href={c.source_url} target="_blank" rel="noopener noreferrer">
            {c.title}
          </a>
          {c.used_in_section && (
            <Text type="secondary" style={{ marginLeft: 6, fontSize: 11 }}>
              · 引用自《{c.used_in_section}》
            </Text>
          )}
        </li>
      ))}
    </ol>
  );
}

function buildDump(params: {
  task: TaskSnapshot;
  nodeId: string;
  defMeta: NodeDef | null | undefined;
  agent: AgentDef | null | undefined;
  lastRun: StepHistoryItem | null;
  afterKeys: string[];
}): string {
  const { task, nodeId, defMeta, agent, lastRun, afterKeys } = params;
  const lines: string[] = [];
  lines.push(`# 节点产物 · ${nodeId}`);
  lines.push('');
  lines.push(`- 名称: ${defMeta?.name ?? '(未知)'}`);
  lines.push(`- 类型: ${defMeta?.kind ?? '?'}`);
  if (agent) lines.push(`- Agent: ${agent.name} (${agent.id})`);
  if (lastRun) {
    lines.push(`- 步骤号: ${lastRun.step}`);
    lines.push(`- 状态: ${lastRun.skipped ? '已跳过' : '已完成'}`);
    lines.push(`- 影响字段: ${lastRun.after_keys.join(', ') || '(无)'}`);
  }
  lines.push(`- 任务创建: ${task.created_at} (${fromNow(task.created_at)})`);
  lines.push('');
  afterKeys.forEach((k) => {
    const v = (task as any)[k];
    lines.push(`## ${k}`);
    lines.push('');
    if (v == null) {
      lines.push('(空)');
    } else if (typeof v === 'string') {
      lines.push(v);
    } else {
      lines.push('```json');
      lines.push(JSON.stringify(v, null, 2));
      lines.push('```');
    }
    lines.push('');
  });
  return lines.join('\n');
}
