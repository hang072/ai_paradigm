import { Tag } from 'antd';
import type { TaskStatus } from '../types/task';

const map: Record<TaskStatus, { color: string; text: string }> = {
  running: { color: 'processing', text: '运行中' },
  waiting_human: { color: 'warning', text: '等待人工' },
  done: { color: 'success', text: '已完成' },
  failed: { color: 'error', text: '失败' },
  cancelled: { color: 'default', text: '已打断' },
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const cfg = map[status];
  return <Tag color={cfg.color}>{cfg.text}</Tag>;
}
