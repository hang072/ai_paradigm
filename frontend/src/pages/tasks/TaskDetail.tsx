import { useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Row,
  Space,
  Statistic,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import {
  CheckCircleFilled,
  ClockCircleFilled,
  ExclamationCircleFilled,
  ReloadOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import type { TaskSnapshot } from '../../types/task';
import type { NodeDef } from '../../types/node';
import type { AgentDef } from '../../types/agent';
import { StatusBadge } from '../../components/StatusBadge';
import { MarkdownView } from '../../components/MarkdownView';
import { FlowCanvas } from '../../canvas/FlowCanvas';
import { NodesApi } from '../../api/nodes';
import { AgentsApi } from '../../api/agents';
import { InterruptPanel } from './InterruptPanel';
import { NodeDetailDrawer } from './NodeDetailDrawer';
import { fromNow, ymdhms } from '../../utils/time';
import { useTasksStore } from '../../store/useTasksStore';

const { Title, Paragraph, Text } = Typography;

interface Props {
  task: TaskSnapshot;
}

export function TaskDetail({ task }: Props) {
  const [nodeDefs, setNodeDefs] = useState<NodeDef[]>([]);
  const [agentDefs, setAgentDefs] = useState<AgentDef[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const refresh = useTasksStore((s) => s.refreshDetail);

  useEffect(() => {
    Promise.all([NodesApi.list(), AgentsApi.list()]).then(([n, a]) => {
      setNodeDefs(n);
      setAgentDefs(a);
    });
  }, []);

  const doneIds = useMemo(() => {
    const s = new Set<string>();
    (task.step_history ?? []).forEach((h) => {
      if (!h.skipped) s.add(h.node_id);
    });
    return s;
  }, [task.step_history]);

  const skippedIds = useMemo(() => {
    const s = new Set<string>();
    (task.step_history ?? []).forEach((h) => {
      if (h.skipped) s.add(h.node_id);
    });
    return s;
  }, [task.step_history]);

  const currentId = task.pending?.stage;

  return (
    <div>
      <TaskHeader task={task} />
      <Tabs
        defaultActiveKey="canvas"
        type="card"
        size="small"
        style={{ overflow: 'visible' }}
        items={[
          { key: 'overview', label: '概览', children: <OverviewTab task={task} /> },
          {
            key: 'canvas',
            label: '画布',
            children: (
              <div style={{ marginTop: 8 }}>
                <FlowCanvas
                  entry={task.spec.entry}
                  nodes={task.spec.nodes}
                  edges={task.spec.edges}
                  nodeDefs={nodeDefs}
                  agentDefs={agentDefs}
                  doneIds={doneIds}
                  skippedIds={skippedIds}
                  currentId={currentId}
                  height={480}
                  onNodeClick={(id) => {
                    setSelectedNodeId(id);
                    setDrawerOpen(true);
                  }}
                />
                <Paragraph
                  type="secondary"
                  style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}
                >
                  提示:点击画布上的节点,可在右侧抽屉查看该节点的运行快照与产物。
                </Paragraph>
                <div
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    gap: 12,
                    fontSize: 12,
                    color: '#6b7a90',
                  }}
                >
                  <span>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        background: '#16a34a',
                        borderRadius: 2,
                        marginRight: 4,
                      }}
                    />
                    已完成
                  </span>
                  <span>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        background: '#2b57d6',
                        borderRadius: 2,
                        marginRight: 4,
                      }}
                    />
                    当前
                  </span>
                  <span>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        background: '#d9dce3',
                        borderRadius: 2,
                        marginRight: 4,
                      }}
                    />
                    未到 / 跳过
                  </span>
                </div>
              </div>
            ),
          },
          { key: 'output', label: '产物', children: <OutputTab task={task} /> },
          { key: 'log', label: '日志', children: <LogTab task={task} /> },
        ]}
      />

      {task.status === 'waiting_human' && (
        <InterruptPanel task={task} onDone={refresh} />
      )}

      <NodeDetailDrawer
        task={task}
        nodeDefs={nodeDefs}
        agentDefs={agentDefs}
        nodeId={selectedNodeId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}

function TaskHeader({ task }: { task: TaskSnapshot }) {
  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <div className="flex items-center gap-12">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Title level={5} style={{ margin: 0 }}>
            {task.title}
          </Title>
          <Space size={8} style={{ marginTop: 6 }} wrap>
            <Tag>{task.task_type}</Tag>
            <StatusBadge status={task.status} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              创建于 {ymdhms(task.created_at)} · {fromNow(task.created_at)}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              修订 {task.revision_count} 次
            </Text>
          </Space>
        </div>
        <Statistic
          title="已执行"
          value={(task.step_history ?? []).filter((s) => !s.skipped).length}
          suffix={`/ ${task.spec.nodes.length}`}
          valueStyle={{ fontSize: 16 }}
          prefix={<ThunderboltFilled style={{ color: '#e08600' }} />}
        />
      </div>
    </Card>
  );
}

function OverviewTab({ task }: { task: TaskSnapshot }) {
  return (
    <Card>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="Brief">{task.brief}</Descriptions.Item>
        <Descriptions.Item label="任务类型">{task.task_type}</Descriptions.Item>
        <Descriptions.Item label="状态">
          <StatusBadge status={task.status} />
          {task.pending && (
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              当前阶段:{task.pending.stage}
            </Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="修订次数">{task.revision_count}</Descriptions.Item>
        <Descriptions.Item label="解析要点">
          {task.parsed_info ? (
            <div>
              {Object.entries(task.parsed_info).map(([k, v]) => (
                <div key={k} style={{ fontSize: 12 }}>
                  <Text type="secondary">{k}</Text>:{' '}
                  <Text>{typeof v === 'string' ? v : JSON.stringify(v)}</Text>
                </div>
              ))}
            </div>
          ) : (
            <Text type="secondary">(尚未解析)</Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="叙事模式">
          {task.narrative_mode ?? <Text type="secondary">(未生成)</Text>}
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

function OutputTab({ task }: { task: TaskSnapshot }) {
  const empty = !task.strategy_doc && !task.enriched_framework && !task.final_output;
  if (empty) return <Empty description="暂无产物" />;
  return (
    <Row gutter={16}>
      <Col span={12}>
        <Card title="策略确认书" size="small" style={{ marginBottom: 12 }}>
          <MarkdownView text={task.strategy_doc} />
        </Card>
        <Card title="需求解析(parsed_info)" size="small">
          {task.parsed_info ? (
            <pre className="mono" style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(task.parsed_info, null, 2)}
            </pre>
          ) : (
            <Text type="secondary">(空)</Text>
          )}
        </Card>
      </Col>
      <Col span={12}>
        <Card
          title="框架草稿"
          size="small"
          style={{ marginBottom: 12 }}
          extra={
            task.enriched_framework && (
              <Button
                size="small"
                onClick={() => downloadText(`${task.title}_草稿.md`, task.enriched_framework!)}
              >
                下载 .md
              </Button>
            )
          }
        >
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            <MarkdownView text={task.enriched_framework} />
          </div>
        </Card>
        {task.citations && task.citations.length > 0 && (
          <Card title="参考文献(可点击溯源)" size="small" style={{ marginBottom: 12 }}>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.9 }}>
              {task.citations.map((c, i) => (
                <li key={c.ref_id || i}>
                  <a href={c.source_url} target="_blank" rel="noopener noreferrer">
                    {c.title}
                  </a>
                </li>
              ))}
            </ol>
          </Card>
        )}
        <Card
          title={
            <Space>
              <span>终稿</span>
              {task.status === 'done' && (
                <Tag color="success" icon={<CheckCircleFilled />}>
                  已定稿
                </Tag>
              )}
            </Space>
          }
          size="small"
          extra={
            task.final_output && (
              <Button
                size="small"
                type="primary"
                onClick={() => downloadText(`${task.title}_终稿.md`, task.final_output!)}
              >
                下载
              </Button>
            )
          }
        >
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            <MarkdownView text={task.final_output} />
          </div>
        </Card>
        {task.review_report && (
          <Card title="审核报告" size="small" style={{ marginTop: 12 }}>
            <Space>
              <Text>综合:</Text>
              <VerdictTag verdict={task.review_report.overall} />
            </Space>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ fontSize: 12 }}>
              <Text strong>策略对齐</Text>
              {(task.review_report.strategy_items ?? []).map((it, i) => (
                <div key={i}>
                  <VerdictTag verdict={it.verdict} /> {it.dimension}: {it.note}
                </div>
              ))}
              <Divider style={{ margin: '8px 0' }} />
              <Text strong>质量维度</Text>
              {(task.review_report.quality_items ?? []).map((it, i) => (
                <div key={i}>
                  <VerdictTag verdict={it.verdict} /> {it.dimension}: {it.note}
                </div>
              ))}
              {(task.review_report.advices ?? []).length > 0 && (
                <>
                  <Divider style={{ margin: '8px 0' }} />
                  <Text strong>建议</Text>
                  <ul style={{ paddingLeft: 16, margin: 0 }}>
                    {(task.review_report.advices ?? []).map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </Card>
        )}
      </Col>
    </Row>
  );
}

function VerdictTag({ verdict }: { verdict: string }) {
  const map: Record<string, { c: string; t: string; icon: React.ReactNode }> = {
    pass: { c: 'success', t: '通过', icon: <CheckCircleFilled /> },
    warn: { c: 'warning', t: '警告', icon: <ExclamationCircleFilled /> },
    fail: { c: 'error', t: '不合格', icon: <ExclamationCircleFilled /> },
    revise: { c: 'warning', t: '需修改', icon: <ExclamationCircleFilled /> },
    redo: { c: 'error', t: '重来', icon: <ExclamationCircleFilled /> },
  };
  const cfg = map[verdict] ?? { c: 'default', t: verdict, icon: null };
  return (
    <Tag color={cfg.c} icon={cfg.icon as any} style={{ margin: '2px 4px 2px 0' }}>
      {cfg.t}
    </Tag>
  );
}

function LogTab({ task }: { task: TaskSnapshot }) {
  return (
    <Card size="small">
      <Timeline
        items={(task.messages ?? []).map((m) => ({
          color: colorOf(m),
          children: <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{m}</span>,
        }))}
      />
      {(task.messages ?? []).length === 0 && <Empty description="暂无日志" />}
    </Card>
  );
}

function colorOf(msg: string): string {
  if (msg.includes('[human')) return 'gold';
  if (msg.includes('verdict=pass') || msg.includes('finalize')) return 'green';
  if (msg.includes('revise') || msg.includes('退回')) return 'orange';
  if (msg.includes('redo') || msg.includes('error')) return 'red';
  return 'blue';
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
