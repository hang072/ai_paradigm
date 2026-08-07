import { useEffect, useState } from 'react';
import { Card, Col, Empty, Progress, Row, Space, Statistic, Tag, Typography } from 'antd';
import {
  ApiOutlined,
  ClockCircleOutlined,
  ExperimentOutlined,
  RocketOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Link } from 'react-router-dom';
import { TasksApi } from '../../api/tasks';
import type { TaskSummary } from '../../types/task';
import { StatusBadge } from '../../components/StatusBadge';
import { fromNow } from '../../utils/time';

const { Title, Text } = Typography;

export default function WorkbenchPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    TasksApi.list()
      .then(setTasks)
      .finally(() => setLoading(false));
  }, []);

  const waiting = tasks.filter((t) => t.status === 'waiting_human');
  const running = tasks.filter((t) => t.status === 'running');
  const done = tasks.filter((t) => t.status === 'done');

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        协同主控工作台
      </Title>
      <Text type="secondary">医疗内容框架生成 · 多智能体协同 · 云 / 本地 Mac mini 运行时</Text>

      {/* 系统健康度指标 */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="主控总线"
              value="联机正常"
              valueStyle={{ color: '#16a34a', fontSize: 18 }}
              prefix={<ApiOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="活跃运行时"
              value={2}
              suffix="/ 3"
              valueStyle={{ fontSize: 18 }}
              prefix={<ThunderboltOutlined />}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              云端 · Mac mini
            </Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="平均延迟"
              value={182}
              suffix="ms"
              valueStyle={{ fontSize: 18 }}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div style={{ fontSize: 12, color: '#6b7a90', marginBottom: 6 }}>系统就绪率</div>
            <Progress percent={96} size="small" status="active" />
          </Card>
        </Col>
      </Row>

      {/* 今日待办 */}
      <Card
        title={
          <Space>
            <ExperimentOutlined />
            <span>今日待办 · 等待人工确认</span>
            <Tag color="warning">{waiting.length}</Tag>
          </Space>
        }
        style={{ marginTop: 16 }}
        loading={loading}
      >
        {waiting.length === 0 ? (
          <Empty description="没有等待人工的任务" imageStyle={{ height: 60 }} />
        ) : (
          <Row gutter={[16, 16]}>
            {waiting.map((t) => (
              <Col span={12} key={t.thread_id}>
                <Card size="small" hoverable>
                  <div className="flex justify-between items-center">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{t.title}</div>
                      <Space size={8}>
                        <Tag>{t.task_type}</Tag>
                        <StatusBadge status={t.status} />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {fromNow(t.created_at)}
                        </Text>
                      </Space>
                    </div>
                    <Link to={`/tasks/${t.thread_id}`}>
                      <RocketOutlined style={{ fontSize: 20, color: '#2b57d6' }} />
                    </Link>
                  </div>
                  {t.stage && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#6b7a90' }}>
                      当前阶段:{stageLabel(t.stage)}
                    </div>
                  )}
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>

      {/* 近期活动 */}
      <Card title="近期任务" style={{ marginTop: 16 }} loading={loading}>
        <Row gutter={[16, 16]}>
          {tasks.slice(0, 6).map((t) => (
            <Col span={8} key={t.thread_id}>
              <Card size="small">
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{t.title}</div>
                <Space size={8}>
                  <Tag>{t.task_type}</Tag>
                  <StatusBadge status={t.status} />
                </Space>
                <div style={{ marginTop: 8, fontSize: 12, color: '#6b7a90' }}>
                  {fromNow(t.created_at)} · 修订 {t.revision_count} 次
                </div>
                <Link
                  to={`/tasks/${t.thread_id}`}
                  style={{ marginTop: 8, display: 'inline-block', fontSize: 12 }}
                >
                  查看详情 →
                </Link>
              </Card>
            </Col>
          ))}
          {tasks.length === 0 && !loading && <Empty description="暂无任务" />}
        </Row>
        <div style={{ marginTop: 12, fontSize: 12, color: '#6b7a90' }}>
          共 {tasks.length} 个任务(运行中 {running.length} · 等待 {waiting.length} · 完成 {done.length})
        </div>
      </Card>
    </div>
  );
}

function stageLabel(stage: string): string {
  const map: Record<string, string> = {
    ask_clarification: '澄清问题',
    confirm_strategy: '策略确认',
    human_final: '终稿反馈',
  };
  return map[stage] ?? stage;
}
