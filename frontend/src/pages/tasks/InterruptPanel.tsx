import { useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Form,
  Input,
  Radio,
  Space,
  Tag,
  Typography,
} from 'antd';
import { CheckCircleFilled, EditOutlined, PauseOutlined } from '@ant-design/icons';
import { TasksApi } from '../../api/tasks';
import type { PendingInterrupt, TaskSnapshot } from '../../types/task';
import { MarkdownView } from '../../components/MarkdownView';

const { Title, Text } = Typography;

interface Props {
  task: TaskSnapshot;
  onDone: () => void;
}

/**
 * HITL 浮动面板:根据 pending.stage 分三种形态。
 * - ask_clarification: 多选问答
 * - confirm_strategy: 展示 strategy_doc,确认 or 调整
 * - human_final: 展示 final_output/enriched_framework,通过 or 退回
 */
export function InterruptPanel({ task, onDone }: Props) {
  const { message } = AntApp.useApp();
  const p = task.pending;
  if (!p) return null;

  return (
    <Card
      style={{
        position: 'sticky',
        bottom: 0,
        marginTop: 12,
        borderTop: '3px solid #e08600',
      }}
      title={
        <Space>
          <PauseOutlined style={{ color: '#e08600' }} />
          <span>流程暂停 · 等待您的回复</span>
          <Tag color="warning">{stageLabel(p.stage)}</Tag>
        </Space>
      }
    >
      {p.stage === 'ask_clarification' && (
        <ClarifyForm task={task} pending={p} onDone={onDone} />
      )}
      {p.stage === 'confirm_strategy' && (
        <ConfirmStrategyForm task={task} pending={p} onDone={onDone} />
      )}
      {p.stage === 'human_final' && (
        <HumanFinalForm task={task} pending={p} onDone={onDone} />
      )}
      {!['ask_clarification', 'confirm_strategy', 'human_final'].includes(p.stage) && (
        <GenericForm task={task} pending={p} onDone={onDone} />
      )}
    </Card>
  );

  function stageLabel(s: string) {
    return (
      { ask_clarification: '澄清问题', confirm_strategy: '策略确认', human_final: '终稿反馈' }[s] ??
      s
    );
  }
}

function ClarifyForm({
  task,
  pending,
  onDone,
}: {
  task: TaskSnapshot;
  pending: PendingInterrupt;
  onDone: () => void;
}) {
  const { message } = AntApp.useApp();
  const [answers, setAnswers] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const questions = pending.questions ?? [];

  const submit = async () => {
    if (answers.length < questions.length || answers.some((a) => !a)) {
      message.warning('请完成所有选择后提交');
      return;
    }
    setSubmitting(true);
    try {
      const payload = questions.map((q, i) => `Q${i + 1}: ${q.question} → ${answers[i]}`).join('\n');
      await TasksApi.resume(task.thread_id, payload);
      message.success('已提交澄清答复');
      onDone();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Text type="secondary">{pending.prompt}</Text>
      <div style={{ marginTop: 12 }}>
        {questions.map((q, idx) => (
          <div key={idx} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {idx + 1}. {q.question}
            </div>
            <Radio.Group
              onChange={(e) => {
                const next = [...answers];
                next[idx] = e.target.value;
                setAnswers(next);
              }}
              value={answers[idx]}
            >
              {q.options.map((o) => (
                <Radio key={o} value={o} style={{ marginRight: 12 }}>
                  {o}
                </Radio>
              ))}
            </Radio.Group>
          </div>
        ))}
      </div>
      <Button type="primary" loading={submitting} onClick={submit}>
        提交回答
      </Button>
    </div>
  );
}

function ConfirmStrategyForm({
  task,
  pending,
  onDone,
}: {
  task: TaskSnapshot;
  pending: PendingInterrupt;
  onDone: () => void;
}) {
  const { message } = AntApp.useApp();
  const [action, setAction] = useState<'confirm' | 'adjust'>('confirm');
  const [adjustText, setAdjustText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (action === 'adjust' && !adjustText.trim()) {
      message.warning('请填写调整意见');
      return;
    }
    setSubmitting(true);
    try {
      const answer =
        action === 'confirm' ? '确认' : `调整:${adjustText}`;
      await TasksApi.resume(task.thread_id, answer);
      message.success(action === 'confirm' ? '已确认策略,即将开始搭建框架' : '已提交调整意见');
      onDone();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Text type="secondary">{pending.prompt}</Text>
      <Card size="small" style={{ marginTop: 12, background: '#f8faff' }}>
        <MarkdownView text={task.strategy_doc} />
      </Card>
      <div style={{ marginTop: 12 }}>
        <Radio.Group value={action} onChange={(e) => setAction(e.target.value)}>
          <Radio value="confirm">
            <CheckCircleFilled style={{ color: '#16a34a' }} /> 确认策略
          </Radio>
          <Radio value="adjust">
            <EditOutlined /> 局部修改
          </Radio>
        </Radio.Group>
      </div>
      {action === 'adjust' && (
        <Input.TextArea
          rows={3}
          value={adjustText}
          onChange={(e) => setAdjustText(e.target.value)}
          placeholder="请在此详细写明退回修改意见…"
          style={{ marginTop: 8 }}
        />
      )}
      <div style={{ marginTop: 12 }}>
        <Button type="primary" loading={submitting} onClick={submit}>
          {action === 'confirm' ? '✓ 确认并继续' : '提交调整意见'}
        </Button>
      </div>
    </div>
  );
}

function HumanFinalForm({
  task,
  pending,
  onDone,
}: {
  task: TaskSnapshot;
  pending: PendingInterrupt;
  onDone: () => void;
}) {
  const { message } = AntApp.useApp();
  const [action, setAction] = useState<'pass' | 'revise'>('pass');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (action === 'revise' && !feedback.trim()) {
      message.warning('请填写退回修改的原因');
      return;
    }
    setSubmitting(true);
    try {
      const answer = action === 'pass' ? '通过' : `退回修改:${feedback}`;
      await TasksApi.resume(task.thread_id, answer);
      message.success(action === 'pass' ? '任务已通过,正在定稿…' : '已退回修改');
      onDone();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Text type="secondary">{pending.prompt}</Text>
      <Card size="small" style={{ marginTop: 12, background: '#f8faff', maxHeight: 300, overflow: 'auto' }}>
        <MarkdownView text={task.enriched_framework ?? task.final_output} />
      </Card>
      {task.citations && task.citations.length > 0 && (
        <Card size="small" title="参考文献(可点击溯源)" style={{ marginTop: 8 }}>
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
      <div style={{ marginTop: 12 }}>
        <Radio.Group value={action} onChange={(e) => setAction(e.target.value)}>
          <Radio value="pass">
            <CheckCircleFilled style={{ color: '#16a34a' }} /> 通过
          </Radio>
          <Radio value="revise">
            <EditOutlined /> 退回修改
          </Radio>
        </Radio.Group>
      </div>
      {action === 'revise' && (
        <Input.TextArea
          rows={3}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="请在此详细写明退回意见与需要整改的地方…"
          style={{ marginTop: 8 }}
        />
      )}
      <div style={{ marginTop: 12 }}>
        <Button type="primary" loading={submitting} onClick={submit}>
          {action === 'pass' ? '✓ 通过并定稿' : '退回修改'}
        </Button>
      </div>
    </div>
  );
}

function GenericForm({
  task,
  pending,
  onDone,
}: {
  task: TaskSnapshot;
  pending: PendingInterrupt;
  onDone: () => void;
}) {
  const { message } = AntApp.useApp();
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await TasksApi.resume(task.thread_id, answer);
      onDone();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div>
      <Text type="secondary">{pending.prompt}</Text>
      <Input.TextArea
        rows={3}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        style={{ marginTop: 8 }}
      />
      <div style={{ marginTop: 12 }}>
        <Button type="primary" loading={submitting} onClick={submit}>
          提交
        </Button>
      </div>
    </div>
  );
}
