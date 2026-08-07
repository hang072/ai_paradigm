import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Tag } from 'antd';
import {
  ApartmentOutlined,
  BranchesOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  RobotOutlined,
} from '@ant-design/icons';

/**
 * 自定义节点数据字段(通过 data 传入):
 * - label, kind, color, agentName, outPorts
 * - state: 'done' | 'current' | 'pending' | 'skipped' | 'failed'
 */
export interface FlowNodeData {
  label: string;
  kind: 'compute' | 'interrupt' | 'router' | 'counter';
  color: string;
  agentName?: string;
  outPorts: string[];
  state: 'done' | 'current' | 'pending' | 'skipped' | 'failed';
  [key: string]: unknown;
}

const kindIcon: Record<FlowNodeData['kind'], React.ReactNode> = {
  compute: <RobotOutlined />,
  interrupt: <ClockCircleOutlined />,
  router: <BranchesOutlined />,
  counter: <ApartmentOutlined />,
};

const kindLabel: Record<FlowNodeData['kind'], string> = {
  compute: 'Compute',
  interrupt: 'HITL',
  router: 'Router',
  counter: 'Counter',
};

const stateStyle: Record<
  FlowNodeData['state'],
  { border: string; bg: string; opacity: number; pulseCls: string }
> = {
  done: { border: '#16a34a', bg: '#f2fbf5', opacity: 1, pulseCls: '' },
  current: { border: '#2b57d6', bg: '#eef3ff', opacity: 1, pulseCls: 'node-pulse' },
  pending: { border: '#d9dce3', bg: '#fff', opacity: 0.85, pulseCls: '' },
  skipped: { border: '#d9dce3', bg: '#f7f8fa', opacity: 0.6, pulseCls: '' },
  failed: { border: '#dc2626', bg: '#fff2f2', opacity: 1, pulseCls: '' },
};

export function AgentNode({ data }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const s = stateStyle[d.state];
  return (
    <div
      className={s.pulseCls}
      style={{
        minWidth: 180,
        border: `2px solid ${s.border}`,
        background: s.bg,
        borderRadius: 10,
        padding: 10,
        opacity: s.opacity,
        boxShadow: '0 2px 4px rgba(0,0,0,.04)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: d.color }} />
      <div className="flex items-center gap-8">
        <span style={{ color: d.color, fontSize: 16 }}>{kindIcon[d.kind]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</div>
          {d.agentName && (
            <div style={{ fontSize: 11, color: '#6b7a90' }}>{d.agentName}</div>
          )}
        </div>
        <Tag color="default" style={{ margin: 0, fontSize: 10 }}>
          {kindLabel[d.kind]}
        </Tag>
      </div>
      {d.state === 'current' && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: '#2b57d6',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <PlayCircleOutlined /> 当前节点
        </div>
      )}
      {/* 多端口:出端口横向平铺 */}
      {d.outPorts.length === 1 ? (
        <Handle
          type="source"
          position={Position.Right}
          style={{ background: d.color }}
          id={d.outPorts[0]}
        />
      ) : (
        d.outPorts.map((port, idx) => {
          const top = 30 + idx * 22;
          return (
            <Handle
              key={port}
              type="source"
              position={Position.Right}
              id={port}
              style={{ top, background: portColor(port) }}
            />
          );
        })
      )}
      {d.outPorts.length > 1 && (
        <div
          style={{
            marginTop: 8,
            fontSize: 10,
            color: '#6b7a90',
            borderTop: '1px dashed #e3e8f0',
            paddingTop: 6,
          }}
        >
          {d.outPorts.map((p) => (
            <div key={p} style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <span style={{ color: portColor(p) }}>●</span> {p}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function portColor(port: string): string {
  const m: Record<string, string> = {
    pass: '#16a34a',
    confirm: '#16a34a',
    revise: '#e08600',
    adjust: '#e08600',
    redo: '#dc2626',
    next: '#2b57d6',
    end: '#6b7a90',
  };
  return m[port] ?? '#6b7a90';
}
