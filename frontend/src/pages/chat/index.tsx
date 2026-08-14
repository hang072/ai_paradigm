import { useEffect, useMemo, useRef, useState } from 'react';
import AgentAvatar from '../../components/AgentAvatar';
import { useAgentMap } from '../../hooks/useAgentMap';
import {
  App as AntApp,
  Avatar,
  Button,
  Card,
  Checkbox,
  Divider,
  Empty,
  Input,
  List,
  Popconfirm,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ApartmentOutlined,
  BookOutlined,
  CaretRightOutlined,
  ClearOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  MessageOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
  TeamOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { client } from '../../api/client';
import { AgentsApi } from '../../api/agents';
import { SkillsApi } from '../../api/skills';
import { TemplatesApi } from '../../api/templates';
import { NodesApi } from '../../api/nodes';
import { ChatApi } from '../../api/chat';
import { KnowledgeApi } from '../../api/knowledge';
import { PlannerApi } from '../../api/planner';
import { TasksApi } from '../../api/tasks';
import type { AgentDef } from '../../types/agent';
import type { SkillDef } from '../../types/skill';
import type { WorkflowTemplate } from '../../types/template';
import type { NodeDef } from '../../types/node';
import type { KnowledgeBase } from '../../types/knowledge';
import type { AttachedExpert, ChatMessage, ChatSession, ToolCallTrace } from '../../types/chat';
import type { TaskSnapshot, TaskType } from '../../types/task';
import { useChatStore, makeMessage, persistFinalizedMessage } from '../../store/useChatStore';
import { MarkdownView } from '../../components/MarkdownView';
import { fromNow } from '../../utils/time';

const { Text } = Typography;

const KNOWN_TOOLS = [
  { value: 'search_literature', label: '文献检索' },
  { value: 'verify_reference', label: '文献核验' },
  { value: 'search_kb', label: '知识库检索' },
];

const MAIN_AVATAR_COLOR = '#6b7a90';

/** 编码 attached_expert 为 Select 的 string value; null → '' */
function encodeExpertValue(exp?: AttachedExpert | null): string {
  if (!exp) return '';
  return `${exp.kind}:${exp.id}`;
}
function decodeExpertValue(v: string): AttachedExpert | undefined {
  if (!v) return undefined;
  const i = v.indexOf(':');
  if (i < 0) return undefined;
  const kind = v.slice(0, i);
  const id = v.slice(i + 1);
  if (kind !== 'agent' && kind !== 'team') return undefined;
  return { kind, id };
}

/* ============ 团 → /tasks 起任务相关的纯函数辅助 ============ */

/**
 * 根据模板 id 和用户第一句话推断任务类型。
 * - 内置 tpl-slide-simple/tpl-article-simple 直接映射
 * - tpl-full 等看用户措辞
 */
function inferTaskType(templateId: string, message: string): TaskType {
  if (templateId === 'tpl-slide-simple') return '幻灯';
  if (templateId === 'tpl-article-simple') return '文章';
  if (/幻灯|PPT|讲座|slides?/i.test(message)) return '幻灯';
  return '文章';
}

/** 从 task snapshot 里拿指定 step 对应的 agent 元信息 (name / color / display_name / avatar)。 */
function stepToAgentInfo(
  nodeInstanceId: string,
  snap: TaskSnapshot,
  nodesById: Map<string, NodeDef>,
  agentsById: Map<string, AgentDef>,
): { id: string; name: string; color: string; display_name?: string; avatar?: string } | null {
  const inst = snap.spec.nodes.find((n) => n.id === nodeInstanceId);
  if (!inst) return null;
  const def = nodesById.get(inst.type);
  if (!def || !def.agent_id) return null;
  const a = agentsById.get(def.agent_id);
  if (!a) return null;
  return { id: a.id, name: a.name, color: a.color, display_name: a.display_name, avatar: a.avatar };
}

/** 节点 id → 中文步骤名, 用于气泡正文 ("需求解析完成"、"策略确认书已生成" …) */
const NODE_LABELS: Record<string, string> = {
  parse_brief: '需求解析',
  plan_strategy: '策略规划',
  build_framework: '框架搭建',
  enrich_content: '内容填充',
  review_quality: '质量审核',
  finalize: '定稿',
  bump_revision: '进入修订轮次',
  ask_clarification: '澄清',
  confirm_strategy: '策略确认',
  human_final: '终稿反馈',
};

function nodeLabel(nodeInstanceId: string, snap: TaskSnapshot, nodesById: Map<string, NodeDef>): string {
  // 先按 instance id 猜 (通常同名), 兜底走 NodeDef.name
  if (NODE_LABELS[nodeInstanceId]) return NODE_LABELS[nodeInstanceId];
  const inst = snap.spec.nodes.find((n) => n.id === nodeInstanceId);
  if (inst) {
    if (NODE_LABELS[inst.type]) return NODE_LABELS[inst.type];
    const def = nodesById.get(inst.type);
    if (def) return def.name;
  }
  return nodeInstanceId;
}

/** 从 snapshot 里拿指定 step 产出的 markdown 摘要。 */
function stepProductPreview(nodeInstanceId: string, snap: TaskSnapshot): string {
  // 用 instance id 或 type id 作为 switch key (fixtures 里 instance id 通常同名)
  const key = snap.spec.nodes.find((n) => n.id === nodeInstanceId)?.type ?? nodeInstanceId;
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
  switch (key) {
    case 'parse_brief':
      return snap.parsed_info
        ? '```json\n' + clip(JSON.stringify(snap.parsed_info, null, 2), 300) + '\n```'
        : '(需求解析完成, 无结构化产物)';
    case 'plan_strategy':
      return snap.strategy_doc ? clip(snap.strategy_doc, 500) : '(策略确认书生成中)';
    case 'build_framework':
      if (!snap.framework_skeleton?.sections) return '(骨架已生成)';
      return (snap.framework_skeleton.sections as any[])
        .map((s: any) => `- ${s.title}${s.weight ? ` · ${Math.round(s.weight * 100)}%` : ''}`)
        .join('\n');
    case 'enrich_content':
      return (
        `> 修订次数: ${snap.revision_count}\n\n` +
        (snap.enriched_framework ? clip(snap.enriched_framework, 500) : '(内容填充中)')
      );
    case 'review_quality':
      if (!snap.review_report) return '(审核报告生成中)';
      const r = snap.review_report;
      const lines = [`**总评**: ${r.overall}`];
      if (r.advices?.length) {
        lines.push('**改进建议**:');
        r.advices.slice(0, 3).forEach((a) => lines.push(`- ${a}`));
      }
      return lines.join('\n');
    case 'finalize':
      return snap.final_output ? clip(snap.final_output, 800) : '(定稿中)';
    default:
      return `已完成 ${key}`;
  }
}

/** interrupt payload → 主助手气泡正文 (含 questions 选项)。 */
/**
 * interrupt payload → 主助手气泡正文。
 *
 * 三个阶段各自附带关键产物,避免用户在"没看到内容"的情况下被问要不要确认:
 *   - ask_clarification  → 选择题(pending.questions)
 *   - confirm_strategy   → 策略书全文 (snap.strategy_doc)
 *   - human_final        → 终稿全文 (snap.enriched_framework) + 上一轮 review 建议
 */
function interruptToContent(
  pending: NonNullable<TaskSnapshot['pending']>,
  snap: TaskSnapshot,
): string {
  const lines = [`**${pending.prompt}**`];

  // ask_clarification: 列出选择题
  if (pending.questions && pending.questions.length > 0) {
    lines.push('');
    pending.questions.forEach((q, i) => {
      lines.push(`${i + 1}. ${q.question}`);
      if (q.options && q.options.length > 0) {
        q.options.forEach((opt) => lines.push(`   - ${opt}`));
      }
    });
  }

  // confirm_strategy: 展示策略书全文, 用户看到内容才好确认
  if (pending.stage === 'confirm_strategy' && snap.strategy_doc) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(snap.strategy_doc);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('*确认请回复"确认";要调整请说明具体意见(如"章节权重再多给背景")。*');
    return lines.join('\n');
  }

  // human_final: 展示终稿 + 审核建议(若有), 让人类看到内容才能决定通过 / 退回
  if (pending.stage === 'human_final') {
    if (snap.review_report && snap.review_report.advices?.length) {
      lines.push('');
      lines.push('**审核建议:**');
      snap.review_report.advices.forEach((a) => lines.push(`- ${a}`));
    }
    if (snap.enriched_framework) {
      lines.push('');
      lines.push('---');
      lines.push('');
      lines.push(snap.enriched_framework);
      lines.push('');
      lines.push('---');
    }
    lines.push('');
    lines.push('*通过请回复"通过";退回修改请说明修改意见。*');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('*你的回复将作为答复推进任务。*');
  return lines.join('\n');
}

/**
 * 判断某 session 里绑定的任务是否处于终态 —— 通过消息里稳定 id 前缀推断,
 * 不需要再请求一次 /api/tasks/:id (poll 已经把终态转成消息了)。
 * 终态: done / failed / cancelled / lost。
 */
function isTaskTerminal(session: ChatSession): boolean {
  const taskId = session.active_task_id;
  if (!taskId) return false;
  return session.messages.some(
    (m) =>
      m.id === 'msg-done-' + taskId ||
      m.id === 'msg-failed-' + taskId ||
      m.id === 'msg-cancelled-' + taskId ||
      m.id === 'msg-lost-' + taskId,
  );
}

/** 输入栏 placeholder 分态。 */
function inputPlaceholder(session: ChatSession): string {
  if (
    session.attached_expert?.kind === 'team' &&
    session.active_task_id &&
    !isTaskTerminal(session)
  ) {
    return '回复以推进任务(策略确认 / 澄清答复 / 终稿反馈)';
  }
  return '和主助手对话——已挂载的专家/专家团由主助手按需调用';
}

export default function ChatPage() {
  const { message } = AntApp.useApp();
  const {
    sessions,
    activeId,
    loadAll,
    createSession,
    selectSession,
    updateSession,
    appendMessage,
    patchMessage,
    removeMessage,
    removeSession,
  } = useChatStore();

  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [nodes, setNodes] = useState<NodeDef[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  /**
   * 每个 session 最近一次 poll 观察到的 task status。
   * 用途:busy 判定要在 waiting_human 时放行 —— 用户必须能"发送"来 resume。
   * isTaskTerminal 只识别终态 (done/failed/cancelled/lost),
   * 无法区分 running vs waiting_human, 所以单独存。
   */
  const [taskStatuses, setTaskStatuses] = useState<
    Record<string, TaskSnapshot['status']>
  >({});

  useEffect(() => {
    AgentsApi.list().then(setAgents);
    SkillsApi.list().then(setSkills);
    TemplatesApi.list().then(setTemplates);
    NodesApi.list().then(setNodes);
    KnowledgeApi.list().then(setKbs);
    // 从后端拉会话列表 (SQLite 持久化); 首次会顺便清理旧格式会话。
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeId && sessions.length > 0) {
      selectSession(sessions[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  const newChat = () => {
    // 新会话默认不挂载任何子智能体 —— 纯主助手模式
    void createSession({ tools: [], skills: [] });
  };

  // 流式响应状态保存在 ref 里,避免重渲染丢失
  const streamRef = useRef<{
    reader?: ReadableStreamDefaultReader;
    closed?: boolean;
  }>({});

  useEffect(() => {
    return () => {
      if (streamRef.current.reader) {
        streamRef.current.reader.cancel();
        streamRef.current.closed = true;
      }
    };
  }, []);

  /* ============ 团任务 polling ============
   * 挂载 team + 已起任务时, 定时 2s 拉一次 task snapshot, 把新增 step_history /
   * pending / done 转成主助手消息 append 到会话里。
   *
   * pollRef 按 sessionId 维护 (支持切换会话时保持互不干扰, 用户回来仍能看进度)。
   * 每个 entry 记录:
   *   - timer: setInterval 句柄, 清理时 clearInterval
   *   - taskId: 关联的任务 id
   *   - lastStepIdx: 上次已经 append 过的 step_history 长度 (增量比对基准)
   *   - lastStatus: 上一次的 status, 用于监测 running → waiting_human / done 转换
   *   - pendingKey: 最近一次已 append 的 interrupt 的稳定 key, 避免重复 append
   */
  /* ============ 团任务进度推送 ============
   * 优先走 SSE (GET /api/tasks/:id/stream), 拿两类事件:
   *   - event: snapshot  → 完整 TaskSnapshot, 复用 processSnapshot 转气泡
   *   - event: token     → { node, delta }, enrich_content 节点的流式增量,
   *                         逐字拼进一个 streaming 气泡, 形成打字机效果
   * SSE 建连失败 / 中途断开 → 回落到 2s 轮询 (startTaskPolling), 进度游标保留。
   *
   * connRef 按 sessionId 维护 (切换会话互不干扰)。每个 entry:
   *   - taskId: 关联任务 id
   *   - lastStepIdx / lastStatus / pendingKey: 增量转气泡的游标 (SSE 与 poll 共用)
   *   - abort: SSE 的 AbortController; timer: poll 的 setInterval 句柄 (互斥, 二选一)
   *   - stream: 各流式节点 (enrich_content / review_quality) 的气泡实时状态
   *   - phaseBubbles: 各节点的"正在 XX…" spinner 气泡 id
   */
  type TaskConnState = {
    taskId: string;
    lastStepIdx: number;
    lastStatus: TaskSnapshot['status'] | null;
    pendingKey: string | null;
    abort?: AbortController;
    timer?: number;
    consecutiveErrors: number;
    // 流式气泡:按节点 (enrich_content / review_quality) 维护逐字拼接状态。
    stream: Record<string, { bubbleId: string | null; content: string; round: number }>;
    // 阶段 spinner 气泡:节点进入时显示"正在 XX…", 该节点产出到达时移除。按节点维护 id。
    phaseBubbles: Record<string, string>;
  };
  const connRef = useRef<Map<string, TaskConnState>>(new Map());

  // 支持流式的节点 → 中文名 (气泡归属对应专家, 读起来像"专家在写")。
  const STREAM_NODES = ['enrich_content', 'review_quality'] as const;

  // 某流式节点的执行者身份 —— 找该节点绑定的 agent。
  const streamAgentInfo = (node: string): { id: string; name: string; color: string; display_name?: string; avatar?: string } | null => {
    const inst = nodes.find((n) => n.id === node);
    if (!inst?.agent_id) return null;
    const a = agents.find((x) => x.id === inst.agent_id);
    return a ? { id: a.id, name: a.name, color: a.color, display_name: a.display_name, avatar: a.avatar } : null;
  };
  const MAIN_INFO = { id: 'agent-main', name: '主助手', color: '#6b7a90', display_name: '主助手', avatar: '主' };

  useEffect(() => {
    // 组件卸载 → 断开所有连接 (SSE abort + poll clear)
    return () => {
      connRef.current.forEach((st) => {
        if (st.abort) st.abort.abort();
        if (st.timer) clearInterval(st.timer);
      });
      connRef.current.clear();
    };
  }, []);

  const stopTaskUpdates = (sessionId: string) => {
    const st = connRef.current.get(sessionId);
    if (st) {
      if (st.abort) st.abort.abort();
      if (st.timer) clearInterval(st.timer);
      connRef.current.delete(sessionId);
    }
    setTaskStatuses((prev) => {
      if (!(sessionId in prev)) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  };

  /**
   * 把一份 snapshot 转成气泡增量 append —— SSE 与 poll 共用。
   * st 携带增量游标 (lastStepIdx / lastStatus / pendingKey) 与流式 enrich 状态。
   */
  const processSnapshot = (
    snap: TaskSnapshot,
    st: TaskConnState,
    sessionId: string,
    taskId: string,
  ) => {
    const nodesById = new Map(nodes.map((n) => [n.id, n]));
    const agentsById = new Map(agents.map((a) => [a.id, a]));

    // 1) step_history 增量 → 每个未 skip 的 compute 节点 append 一条消息
    const stepHistory = snap.step_history ?? [];
    const stepsToShow = stepHistory.slice(st.lastStepIdx);
    for (const step of stepsToShow) {
      if (step.skipped) continue;
      const inst = snap.spec.nodes.find((n) => n.id === step.node_id);
      const def = inst ? nodesById.get(inst.type) : undefined;
      if (!def || def.kind !== 'compute') continue;

      // 流式节点 (enrich_content / review_quality) 已由 token 气泡实时呈现 →
      // 收尾并跳过这条 step 摘要, 避免"打字机全文"和"完成了 XX(折叠预览)"两条重复气泡。
      const nodeType = inst?.type ?? step.node_id;
      // 无论是否流式, 该节点产出已到 → 清掉它的 phase spinner 气泡。
      clearPhaseBubble(st, sessionId, nodeType);
      const ss = st.stream[nodeType];
      if ((STREAM_NODES as readonly string[]).includes(nodeType) && ss?.bubbleId) {
        finalizeStreamBubble(st, sessionId, snap, nodeType);
        continue;
      }

      const agentInfo = stepToAgentInfo(step.node_id, snap, nodesById, agentsById);
      const label = nodeLabel(step.node_id, snap, nodesById);
      const preview = stepProductPreview(step.node_id, snap);
      const trace: ToolCallTrace = {
        tool: 'graph_step',
        input: { node: step.node_id, step: step.step },
        output_preview: preview,
        ...(agentInfo && {
          agent_id: agentInfo.id,
          agent_name: agentInfo.name,
          agent_color: agentInfo.color,
        }),
      };
      const content = agentInfo
        ? `${agentInfo.display_name ?? agentInfo.name} 完成了 **${label}**`
        : `**${label}** 已完成`;
      const msg: ChatMessage = {
        ...makeMessage('assistant', content, {
          agent_id: 'agent-main',
          agent_name: '主助手',
          agent_color: '#6b7a90',
          tool_calls: [trace],
        }),
        id: 'msg-step-' + taskId + '-' + step.step,
      };
      appendMessage(sessionId, msg);
    }
    st.lastStepIdx = stepHistory.length;

    // 2) pending 状态转换 → append 一条 interrupt 消息 (稳定 key 防重复)
    if (snap.status === 'waiting_human' && snap.pending) {
      const key = `${snap.pending.stage}:${stepHistory.length}`;
      if (st.pendingKey !== key) {
        st.pendingKey = key;
        const content = interruptToContent(snap.pending, snap);
        const msg: ChatMessage = {
          ...makeMessage('assistant', content, {
            agent_id: 'agent-main',
            agent_name: '主助手',
            agent_color: '#6b7a90',
          }),
          id: 'msg-pending-' + taskId + '-' + key,
        };
        appendMessage(sessionId, msg);
      }
    } else {
      st.pendingKey = null;
    }

    // 3a) done → append 终稿 + 停推送
    if (snap.status === 'done' && st.lastStatus !== 'done') {
      const doneContent =
        `✅ 任务已完成。以下是最终产物:\n\n` + (snap.final_output ?? '(无 final_output)');
      const msg: ChatMessage = {
        ...makeMessage('assistant', doneContent, {
          agent_id: 'agent-main',
          agent_name: '主助手',
          agent_color: '#6b7a90',
        }),
        id: 'msg-done-' + taskId,
      };
      appendMessage(sessionId, msg);
      stopTaskUpdates(sessionId);
    }

    // 3b) failed → append 错误 + 停推送
    if (snap.status === 'failed' && st.lastStatus !== 'failed') {
      const msg: ChatMessage = {
        ...makeMessage('assistant', `❌ 任务执行失败: ${snap.error_message ?? '未知错误'}`, {
          agent_id: 'agent-main',
          agent_name: '主助手',
          agent_color: '#6b7a90',
        }),
        id: 'msg-failed-' + taskId,
      };
      appendMessage(sessionId, msg);
      stopTaskUpdates(sessionId);
    }

    // 3c) cancelled → append 打断 + 停推送
    if (snap.status === 'cancelled' && st.lastStatus !== 'cancelled') {
      const msg: ChatMessage = {
        ...makeMessage('assistant', '⏹ 任务已被打断', {
          agent_id: 'agent-main',
          agent_name: '主助手',
          agent_color: '#6b7a90',
        }),
        id: 'msg-cancelled-' + taskId,
      };
      appendMessage(sessionId, msg);
      stopTaskUpdates(sessionId);
    }

    st.lastStatus = snap.status;
    setTaskStatuses((prev) =>
      prev[sessionId] === snap.status ? prev : { ...prev, [sessionId]: snap.status },
    );
  };

  /** 取某节点的流式状态 (惰性初始化)。 */
  const streamStateFor = (st: TaskConnState, node: string) => {
    if (!st.stream[node]) st.stream[node] = { bubbleId: null, content: '', round: 0 };
    return st.stream[node];
  };

  /** 流式 token → 逐字拼进对应节点的 streaming 气泡 (enrich_content / review_quality)。 */
  const handleStreamToken = (
    st: TaskConnState,
    sessionId: string,
    taskId: string,
    node: string,
    delta: string,
  ) => {
    if (!(STREAM_NODES as readonly string[]).includes(node) || !delta) return;
    // 首个 token 到达 → 移除该节点的 phase spinner, 换成真正的流式气泡。
    clearPhaseBubble(st, sessionId, node);
    const ss = streamStateFor(st, node);
    if (!ss.bubbleId) {
      ss.bubbleId = `msg-${node}-${taskId}-${ss.round}`;
      ss.content = '';
      const info = streamAgentInfo(node) ?? MAIN_INFO;
      appendMessage(sessionId, {
        ...makeMessage('assistant', '', {
          agent_id: info.id,
          agent_name: info.name,
          agent_color: info.color,
          streaming: true,
        }),
        id: ss.bubbleId,
      });
    }
    ss.content += delta;
    patchMessage(sessionId, ss.bubbleId, { content: ss.content, streaming: true });
  };

  /**
   * 流式节点完成 → 定稿 streaming 气泡并落库; 优先用 snapshot 的权威正文。
   * enrich_content 用 enriched_framework;review_quality 用 review_report.summary。
   */
  const finalizeStreamBubble = (
    st: TaskConnState,
    sessionId: string,
    snap: TaskSnapshot,
    node: string,
  ) => {
    const ss = st.stream[node];
    if (!ss?.bubbleId) return;
    const bubbleId = ss.bubbleId;
    const authoritative =
      node === 'enrich_content'
        ? snap.enriched_framework
        : snap.review_report?.summary;
    const finalContent = authoritative || ss.content;
    const info = streamAgentInfo(node) ?? MAIN_INFO;
    patchMessage(sessionId, bubbleId, { content: finalContent, streaming: false });
    void persistFinalizedMessage(sessionId, {
      id: bubbleId,
      role: 'assistant',
      agent_id: info.id,
      agent_name: info.name,
      agent_color: info.color,
      content: finalContent,
      tool_calls: [],
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });
    ss.bubbleId = null;
    ss.content = '';
    ss.round += 1;
  };

  /** phase 事件 → 显示 (或刷新) 该节点的"正在 XX…" spinner 气泡。 */
  const handlePhase = (
    st: TaskConnState,
    sessionId: string,
    taskId: string,
    node: string,
    label: string,
  ) => {
    // 已有流式气泡在写 → 不再显示 spinner。
    if (st.stream[node]?.bubbleId) return;
    const id = st.phaseBubbles[node] ?? `msg-phase-${taskId}-${node}`;
    st.phaseBubbles[node] = id;
    const info = streamAgentInfo(node) ?? MAIN_INFO;
    // streaming: true 让气泡显示打字动画; content 为空时 UI 显示 spinner。
    appendMessage(sessionId, {
      ...makeMessage('assistant', `_${label}_`, {
        agent_id: info.id,
        agent_name: info.name,
        agent_color: info.color,
        streaming: true,
      }),
      id,
    });
    patchMessage(sessionId, id, { content: `_${label}_`, streaming: true });
  };

  /** 清除某节点的 phase spinner 气泡 (产出到达 / 流式气泡接管时)。 */
  const clearPhaseBubble = (st: TaskConnState, sessionId: string, node: string) => {
    const id = st.phaseBubbles[node];
    if (!id) return;
    removeMessage(sessionId, id);
    delete st.phaseBubbles[node];
  };

  /** 2s 轮询 —— SSE 不可用时的回落。复用传入的 st 保留进度游标。 */
  const startTaskPolling = (sessionId: string, taskId: string, st: TaskConnState) => {
    if (st.timer) clearInterval(st.timer);
    const tick = async () => {
      let snap: TaskSnapshot;
      try {
        snap = await TasksApi.get(taskId);
        st.consecutiveErrors = 0;
      } catch (e) {
        st.consecutiveErrors += 1;
        console.error(`[chat] poll task failed (${st.consecutiveErrors}/5):`, e);
        if (st.consecutiveErrors >= 5) {
          const msg: ChatMessage = {
            ...makeMessage('assistant', '❌ 任务失联,已停止轮询。可切换会话或刷新页面重试。', {
              agent_id: 'agent-main',
              agent_name: '主助手',
              agent_color: '#6b7a90',
            }),
            id: 'msg-lost-' + taskId,
          };
          appendMessage(sessionId, msg);
          stopTaskUpdates(sessionId);
        }
        return;
      }
      processSnapshot(snap, st, sessionId, taskId);
    };
    void tick();
    st.timer = window.setInterval(() => void tick(), 2000);
  };

  /** SSE 优先的进度推送入口。 */
  const startTaskUpdates = (sessionId: string, taskId: string) => {
    // 幂等:同会话已连同任务 → skip
    const existing = connRef.current.get(sessionId);
    if (existing && existing.taskId === taskId) return;
    stopTaskUpdates(sessionId);

    const st: TaskConnState = {
      taskId,
      lastStepIdx: 0,
      lastStatus: null,
      pendingKey: null,
      consecutiveErrors: 0,
      stream: {},
      phaseBubbles: {},
    };
    connRef.current.set(sessionId, st);

    const controller = new AbortController();
    st.abort = controller;
    const base = client.defaults.baseURL ?? '';

    const handleEvent = (ev: string, data: string) => {
      try {
        if (ev === 'snapshot') {
          processSnapshot(JSON.parse(data) as TaskSnapshot, st, sessionId, taskId);
        } else if (ev === 'token') {
          const { node, delta } = JSON.parse(data) as { node: string; delta: string };
          handleStreamToken(st, sessionId, taskId, node, delta);
        } else if (ev === 'phase') {
          const { node, label } = JSON.parse(data) as { node: string; label: string };
          handlePhase(st, sessionId, taskId, node, label);
        }
        // event: done —— 无需额外处理, 终态 snapshot 已在上面收尾
      } catch (err) {
        console.warn('[chat] parse task SSE event failed:', err);
      }
    };

    fetch(`${base}/api/tasks/${taskId}/stream`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    })
      .then(async (resp) => {
        if (!resp.ok || !resp.body) throw new Error(`stream HTTP ${resp.status}`);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const processBlock = (): boolean => {
          const idx = buffer.indexOf('\n\n');
          if (idx === -1) return false;
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let ev = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) ev = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          handleEvent(ev, data);
          return true;
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          while (processBlock()) {}
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return; // 用户切换会话 / 打断 → 静默
        console.warn('[chat] task SSE failed, fallback to polling:', err);
        st.abort = undefined; // 转轮询, 清掉 abort 标记
        startTaskPolling(sessionId, taskId, st);
      });
  };

  // 切换 session / 加载完成后, 若该 session 有 active_task_id 且未完成 → 恢复推送
  useEffect(() => {
    if (!active) return;
    const taskId = active.active_task_id;
    if (!taskId) {
      stopTaskUpdates(active.id);
      return;
    }
    if (isTaskTerminal(active)) {
      stopTaskUpdates(active.id);
      return;
    }
    startTaskUpdates(active.id, taskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.active_task_id, agents.length, nodes.length]);

  /* ============ 打断:统一入口 ============
   * abort 按钮的 onClick, 依据当前情形派发:
   *   - team 任务未终态  → 调 TasksApi.cancel, SSE 会推来 cancelled 快照并 append msg-cancelled-*
   *   - 非-team SSE 流中  → abortRef.abort() 断开 fetch, patch placeholder 追加"对话已被打断"
   *   - 其他              → no-op (按钮此时不该显示)
   */
  const abortRef = useRef<AbortController | null>(null);
  const streamingRefs = useRef<{
    placeholderId: string;
    content: string;
    sessionId: string;
  } | null>(null);

  const abort = () => {
    const s = active;
    if (!s) return;
    // 1) team 任务未终态 → 后端 cancel
    if (s.attached_expert?.kind === 'team' && s.active_task_id && !isTaskTerminal(s)) {
      void TasksApi.cancel(s.active_task_id).catch((err) => {
        console.error('[chat] cancel task failed:', err);
      });
      // SSE 下一次推送会拿到 cancelled 状态并 append msg-cancelled-*, 停推送
      return;
    }
    // 2) 非-team SSE 流中 → abort fetch + patch placeholder
    const ctl = abortRef.current;
    if (ctl) ctl.abort();
    const sref = streamingRefs.current;
    if (sref) {
      patchMessage(sref.sessionId, sref.placeholderId, {
        content: sref.content + (sref.content ? '\n\n' : '') + '⏹ *对话已被打断*',
        streaming: false,
      });
      streamingRefs.current = null;
    }
    if (streamRef.current.reader) {
      try {
        streamRef.current.reader.cancel();
      } catch {
        /* ignore */
      }
    }
    streamRef.current.closed = true;
    setSending(false);
  };

  const send = async () => {
    if (!input.trim() || !active) return;
    const userMsg = makeMessage('user', input.trim());
    appendMessage(active.id, userMsg);
    setInput('');
    setSending(true);

    // ============ team 分支: 走 /api/tasks, 不走 /api/chat/reply ============
    if (active.attached_expert?.kind === 'team') {
      try {
        if (!active.active_task_id) {
          // A. 首条消息 → 先调 Planner 拿 spec(或回退到模板),再起任务
          const templateId = active.attached_expert.id;
          const teamName =
            templates.find((t) => t.id === templateId)?.name ?? '专家团';
          const taskType = inferTaskType(templateId, userMsg.content);

          // 阶段 3.4:调 Planner 实时编排
          let plannerResp: Awaited<ReturnType<typeof PlannerApi.compose>>;
          try {
            plannerResp = await PlannerApi.compose({
              brief: userMsg.content,
              task_type: taskType,
              template_hints: [templateId],
            });
          } catch (pe: any) {
            // Planner 端点本身失败 → 老路径(template_id)
            plannerResp = {
              mode: 'static',
              fallback_template_id: templateId,
              reason: 'Planner 调用失败:' + pe.message,
              latency_ms: 0,
            };
          }

          let snap: TaskSnapshot;
          let usedSpec: 'dynamic' | 'static' = plannerResp.mode;
          if (plannerResp.mode === 'dynamic' && plannerResp.spec) {
            snap = await TasksApi.start({
              brief: userMsg.content,
              spec: plannerResp.spec,
              task_type: taskType,
            });
          } else {
            // static 兜底:用 Planner 指定的 template,或当前 attached
            const tplId =
              plannerResp.fallback_template_id || templateId;
            snap = await TasksApi.start({
              brief: userMsg.content,
              template_id: tplId,
              task_type: taskType,
            });
          }
          await updateSession(active.id, { active_task_id: snap.thread_id });

          // 任务启动气泡 — 把 Planner 决定也展示给用户
          const plannerNote =
            usedSpec === 'dynamic'
              ? `Planner 实时编排了 ${plannerResp.spec?.nodes?.length ?? 0} 个节点`
              : `Planner 不可用,沿用模板 ${plannerResp.fallback_template_id}(${plannerResp.reason ?? ''})`;
          const startMsg: ChatMessage = {
            ...makeMessage(
              'assistant',
              `已把需求交给「${teamName}」,任务已启动。${plannerNote}。稍后我会同步各专家的产出。`,
              {
                agent_id: 'agent-main',
                agent_name: '主助手',
                agent_color: '#6b7a90',
                tool_calls: [
                  {
                    tool: 'task_start',
                    input: {
                      template_id: templateId,
                      planner_mode: usedSpec,
                      task_id: snap.thread_id,
                    },
                    output_preview: `任务 ${snap.thread_id} 已排队`,
                  },
                ],
              },
            ),
            id: 'msg-taskstart-' + snap.thread_id,
          };
          appendMessage(active.id, startMsg);
          startTaskUpdates(active.id, snap.thread_id);
        } else {
          // B. 任务进行中 → 一律作为 resume answer;
          //    SSE 会推来 step_history 增量 / 流式 token 并 append 主助手消息。
          await TasksApi.resume(active.active_task_id, userMsg.content);
          // 乐观更新: resume 后任务立即回到 running, 无需等下一 tick,
          // 否则用户会看到按钮短暂闪回"发送"再变"打断"
          setTaskStatuses((prev) => ({ ...prev, [active.id]: 'running' }));
        }
      } catch (e: any) {
        const errMsg: ChatMessage = makeMessage(
          'assistant',
          `❌ 任务操作失败: ${e.message}`,
          {
            agent_id: 'agent-main',
            agent_name: '主助手',
            agent_color: '#6b7a90',
          },
        );
        appendMessage(active.id, errMsg);
      } finally {
        setSending(false);
      }
      return;
    }
    // ============ 非 team: 保持原有 SSE 流式逻辑 ============

    const placeholderId = 'msg-pending-' + Date.now();
    const placeholder = {
      ...makeMessage('assistant', '', { streaming: true }),
      id: placeholderId,
    };
    appendMessage(active.id, placeholder);

    // 建立 AbortController 以供打断按钮使用; 同步 streamingRefs 供 abort 时拿到最新 content
    const controller = new AbortController();
    abortRef.current = controller;
    streamingRefs.current = {
      placeholderId,
      content: '',
      sessionId: active.id,
    };

    const reqBody = {
      message: userMsg.content,
      attached_expert: active.attached_expert,
      tools: active.tools,
      skills: active.skills,
      kb_ids: active.kb_ids ?? [],
      history: active.messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    };

    try {
      const response = await fetch(`${client.defaults.baseURL}/api/chat/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(reqBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        let msg = `HTTP ${response.status} ${response.statusText}`;
        try {
          const err = (await response.json()) as any;
          msg = err.detail || err.message || msg;
        } catch (_) {
          /* ignore */
        }
        patchMessage(active.id, placeholderId, {
          content: `❌ ${msg}`,
          streaming: false,
        });
        streamingRefs.current = null;
        abortRef.current = null;
        setSending(false);
        return;
      }

      if (!response.body) {
        // 没有响应体,回落非流式
        const parts = await ChatApi.reply(reqBody);
        const first = parts[0];
        if (first) {
          patchMessage(active.id, placeholderId, {
            agent_id: first.agent_id,
            agent_name: first.agent_name,
            agent_color: first.agent_color,
            content: first.content,
            tool_calls: first.tool_calls,
            streaming: false,
          });
        } else {
          patchMessage(active.id, placeholderId, {
            content: '(未获得回复)',
            streaming: false,
          });
        }
        streamingRefs.current = null;
        abortRef.current = null;
        setSending(false);
        return;
      }

      // 单一 placeholder 全程使用 —— 新架构每次用户发送对应一条主助手气泡。
      let currentAgentId = '';
      let currentAgentName = '';
      let currentAgentColor = '';
      let currentContent = '';
      let currentToolCalls: ToolCallTrace[] = [];

      streamRef.current.closed = false;
      const reader = response.body.getReader();
      streamRef.current.reader = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      const processLine = () => {
        const eventEnd = buffer.indexOf('\n\n');
        if (eventEnd === -1) return false;

        const eventBlock = buffer.slice(0, eventEnd).trim();
        buffer = buffer.slice(eventEnd + 2);

        let eventType = 'message';
        let data = '';
        for (const line of eventBlock.split('\n')) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim();
          else if (line.startsWith('data:')) data = line.slice(5).trim();
        }

        try {
          switch (eventType) {
            case 'start': {
              const parsed = JSON.parse(data);
              currentAgentId = parsed.agent_id;
              currentAgentName = parsed.agent_name;
              currentAgentColor = parsed.agent_color;
              currentToolCalls = parsed.tool_calls ?? [];
              patchMessage(active.id, placeholderId, {
                agent_id: currentAgentId,
                agent_name: currentAgentName,
                agent_color: currentAgentColor,
                content: currentContent,
                tool_calls: currentToolCalls,
                streaming: true,
              });
              break;
            }
            case 'chunk': {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                currentContent += parsed.content;
                if (streamingRefs.current) streamingRefs.current.content = currentContent;
                patchMessage(active.id, placeholderId, {
                  content: currentContent,
                  streaming: true,
                });
              }
              // 后端也可能通过 chunk 补发 tool_calls (子调用完成时)
              if (parsed.tool_calls) {
                currentToolCalls = parsed.tool_calls;
                patchMessage(active.id, placeholderId, { tool_calls: currentToolCalls });
              }
              break;
            }
            case 'done':
            case 'finish': {
              patchMessage(active.id, placeholderId, {
                agent_id: currentAgentId,
                agent_name: currentAgentName,
                agent_color: currentAgentColor,
                content: currentContent,
                tool_calls: currentToolCalls,
                streaming: false,
              });
              void persistFinalizedMessage(active.id, {
                id: placeholderId,
                role: 'assistant',
                agent_id: currentAgentId,
                agent_name: currentAgentName,
                agent_color: currentAgentColor,
                content: currentContent,
                tool_calls: currentToolCalls,
                timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
              });
              streamRef.current.closed = true;
              streamingRefs.current = null;
              abortRef.current = null;
              setSending(false);
              break;
            }
            case 'error': {
              const parsed = JSON.parse(data);
              const msg = parsed.detail || '未知错误';
              patchMessage(active.id, placeholderId, {
                content: currentContent + `\n\n❌ ${msg}`,
                tool_calls: currentToolCalls,
                streaming: false,
              });
              streamRef.current.closed = true;
              streamingRefs.current = null;
              abortRef.current = null;
              setSending(false);
              break;
            }
          }
        } catch (err) {
          console.warn('[chat] parse SSE event failed:', err);
        }
        return true;
      };

      const pump = () => {
        if (streamRef.current.closed) return;
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              if (!streamRef.current.closed) setSending(false);
              return;
            }
            buffer += decoder.decode(value, { stream: true });
            while (processLine()) {}
            pump();
          })
          .catch((err) => {
            // AbortError: 用户手动打断 (abort() 已经 patch 过 placeholder 了) → 静默退出
            if (err?.name === 'AbortError' || streamRef.current.closed) {
              setSending(false);
              return;
            }
            console.error('[chat] stream read error:', err);
            patchMessage(active.id, placeholderId, {
              content: currentContent + `\n\n❌ 流读取错误: ${err.message}`,
              streaming: false,
            });
            streamingRefs.current = null;
            abortRef.current = null;
            setSending(false);
          });
      };

      pump();
    } catch (e: any) {
      // 打断触发的 fetch AbortError → abort() 已 patch, 不重复
      if (e?.name === 'AbortError') {
        setSending(false);
        return;
      }
      patchMessage(active.id, placeholderId, {
        content: `❌ 请求失败: ${e.message}`,
        streaming: false,
      });
      streamingRefs.current = null;
      abortRef.current = null;
      setSending(false);
    }
  };

  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: '240px 1fr 340px', gap: 12, height: '100%' }}
    >
      <SessionListPane
        sessions={sessions}
        activeId={activeId}
        agents={agents}
        templates={templates}
        onSelect={selectSession}
        onNew={newChat}
        onDelete={(id) => {
          removeSession(id);
          message.success('已删除会话');
        }}
      />

      <div className="flex-col" style={{ display: 'flex', minHeight: 0 }}>
        {!active ? (
          <Card style={{ flex: 1 }}>
            <Empty description="创建一个新会话开始对话">
              <Button type="primary" icon={<PlusOutlined />} onClick={newChat}>
                新建会话
              </Button>
            </Empty>
          </Card>
        ) : (
          <>
            <MessageStream
              session={active}
              agents={agents}
              skills={skills}
              templates={templates}
              kbs={kbs}
            />
            <InputBar
              value={input}
              onChange={setInput}
              onSend={send}
              onAbort={abort}
              busy={
                sending ||
                (active.attached_expert?.kind === 'team' &&
                  !!active.active_task_id &&
                  !isTaskTerminal(active) &&
                  // waiting_human 时要放行输入,让用户能 resume 回答专家团的追问
                  taskStatuses[active.id] !== 'waiting_human')
              }
              placeholder={inputPlaceholder(active)}
            />
          </>
        )}
      </div>

      <ConfigPane
        session={active}
        agents={agents}
        skills={skills}
        templates={templates}
        nodes={nodes}
        kbs={kbs}
        onChange={(patch) => active && updateSession(active.id, patch)}
      />
    </div>
  );
}

/* ------ 左侧:会话列表 ------ */

function SessionListPane(props: {
  sessions: ChatSession[];
  activeId: string | null;
  agents: AgentDef[];
  templates: WorkflowTemplate[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const { sessions, activeId, agents, templates, onSelect, onNew, onDelete } = props;
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const templateMap = new Map(templates.map((t) => [t.id, t]));

  return (
    <Card
      bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', height: '100%' }}
      title={
        <Space>
          <MessageOutlined />
          <span>会话</span>
          <Tag>{sessions.length}</Tag>
        </Space>
      }
      extra={
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={onNew}>
          新建
        </Button>
      }
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ overflow: 'auto', flex: 1 }}>
        {sessions.length === 0 ? (
          <Empty description="暂无会话" style={{ marginTop: 40 }} imageStyle={{ height: 40 }} />
        ) : (
          <List
            size="small"
            dataSource={sessions}
            renderItem={(s) => {
              const active = s.id === activeId;
              const exp = s.attached_expert;
              let expLabel = '通用';
              let expColor = 'default';
              if (exp) {
                if (exp.kind === 'agent') {
                  const ag = agentMap.get(exp.id);
                  expLabel = ag?.display_name ?? ag?.name ?? '专家';
                  expColor = 'blue';
                } else {
                  expLabel = templateMap.get(exp.id)?.name ?? '专家团';
                  expColor = 'purple';
                }
              }
              return (
                <List.Item
                  onClick={() => onSelect(s.id)}
                  style={{
                    cursor: 'pointer',
                    padding: '10px 12px',
                    background: active ? '#eef3ff' : undefined,
                    borderLeft: active ? '3px solid #2b57d6' : '3px solid transparent',
                  }}
                  actions={[
                    <Popconfirm
                      key="del"
                      title="删除该会话?"
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        onDelete(s.id);
                      }}
                      onCancel={(e) => e?.stopPropagation()}
                    >
                      <DeleteOutlined
                        style={{ color: '#dc2626' }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>,
                  ]}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {s.title}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <Tag color={expColor} style={{ margin: 0 }}>
                        {expLabel}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                        {fromNow(s.updated_at)}
                      </Text>
                    </div>
                  </div>
                </List.Item>
              );
            }}
          />
        )}
      </div>
    </Card>
  );
}

/* ------ 中间:消息流 ------ */

function MessageStream({
  session,
  agents,
  skills,
  templates,
  kbs,
}: {
  session: ChatSession;
  agents: AgentDef[];
  skills: SkillDef[];
  templates: WorkflowTemplate[];
  kbs: KnowledgeBase[];
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  const lastMessage = session.messages[session.messages.length - 1];
  const lastContent = lastMessage?.content ?? '';

  useEffect(() => {
    if (boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [session.messages.length, session.id, lastContent]);

  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const skillMap = new Map(skills.map((s) => [s.id, s]));
  const templateMap = new Map(templates.map((t) => [t.id, t]));
  const kbMap = new Map(kbs.map((k) => [k.id, k]));
  const activeKbs = (session.kb_ids ?? [])
    .map((id) => kbMap.get(id))
    .filter(Boolean) as KnowledgeBase[];

  const exp = session.attached_expert;
  let expTag: React.ReactNode = null;
  if (exp) {
    if (exp.kind === 'agent') {
      const a = agentMap.get(exp.id);
      expTag = (
        <Tag color="blue" icon={<RobotOutlined />}>
          专家:{a?.name ?? '(未知)'}
        </Tag>
      );
    } else {
      const t = templateMap.get(exp.id);
      expTag = (
        <Tag color="purple" icon={<ApartmentOutlined />}>
          专家团:{t?.name ?? '(未知)'}
        </Tag>
      );
    }
  }

  return (
    <Card
      bodyStyle={{
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      title={
        <Space size={8} wrap>
          <RobotOutlined />
          <span>主助手</span>
          {expTag ?? (
            <Tag color="default">未挂载子智能体</Tag>
          )}
          {session.active_task_id && (() => {
            const tid = session.active_task_id;
            const has = (prefix: string) => session.messages.some((m) => m.id === prefix + tid);
            if (has('msg-done-')) return <Tag color="success">任务已完成</Tag>;
            if (has('msg-failed-')) return <Tag color="error">任务失败</Tag>;
            if (has('msg-cancelled-')) return <Tag>任务已打断</Tag>;
            if (has('msg-lost-')) return <Tag color="default">任务失联</Tag>;
            return <Tag color="processing">任务进行中</Tag>;
          })()}
          {session.skills.length > 0 && (
            <Tooltip title={session.skills.map((sid) => skillMap.get(sid)?.name).join('、')}>
              <Tag icon={<ExperimentOutlined />} color="geekblue">
                {session.skills.length} 项技能
              </Tag>
            </Tooltip>
          )}
          {session.tools.length > 0 && (
            <Tooltip title={session.tools.join('、')}>
              <Tag icon={<ToolOutlined />} color="cyan">
                {session.tools.length} 项工具
              </Tag>
            </Tooltip>
          )}
          {activeKbs.length > 0 && (
            <Tooltip title={activeKbs.map((k) => k.name).join('、')}>
              <Tag icon={<BookOutlined />} color="gold">
                {activeKbs.length} 个知识库
              </Tag>
            </Tooltip>
          )}
        </Space>
      }
    >
      <div ref={boxRef} style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {session.messages.length === 0 && (
          <Empty
            description={
              <div>
                <div>发送第一条消息开始对话</div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {exp
                    ? '主助手会按需调用你挂载的子智能体'
                    : '通用主助手模式,可在右侧挂载专家或专家团'}
                </Text>
              </div>
            }
            style={{ marginTop: 40 }}
          />
        )}
        {session.messages.map((m) => (
          <MessageBubble key={m.id} msg={m} />
        ))}
      </div>
    </Card>
  );
}

/* ------ 消息气泡 ------ */

function MessageBubble({ msg }: { msg: import('../../types/chat').ChatMessage }) {
  const isUser = msg.role === 'user';
  // 助手气泡统一用主助手颜色 —— 子智能体调用在 tool_calls 折叠块里体现
  const color = isUser ? '#2b57d6' : msg.agent_color ?? MAIN_AVATAR_COLOR;
  // displayName 优先 agent_display_name(若有,后端 chat 走 getAgent 实时填;无则落回 agent_name)
  const rawName = isUser ? '我' : msg.agent_name ?? '主助手';
  // 阶段 6:displayName/avatar 从 agents store 实时拉(chat 路径不存盘,选 B)
  const agentMap = useAgentMap();
  const liveAgent = !isUser && msg.agent_id ? agentMap.get(msg.agent_id) : undefined;
  const displayName = liveAgent?.display_name ?? rawName;
  const avatar = liveAgent?.avatar;

  // 拆分工具调用:带 agent_id 的是"子智能体调用",否则是普通工具
  const subInvocations = (msg.tool_calls ?? []).filter((tc) => !!tc.agent_id);
  const plainTools = (msg.tool_calls ?? []).filter((tc) => !tc.agent_id);

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        marginBottom: 14,
        flexDirection: isUser ? 'row-reverse' : 'row',
      }}
    >
      {isUser ? (
        <Avatar style={{ background: color, flexShrink: 0 }} size={32}>
          我
        </Avatar>
      ) : (
        <AgentAvatar
          agent={liveAgent}
          name={msg.agent_name}
          color={color}
          size={32}
          style={{ flexShrink: 0 }}
        />
      )}
      <div style={{ maxWidth: '78%', minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            color: '#6b7a90',
            marginBottom: 4,
            textAlign: isUser ? 'right' : 'left',
          }}
        >
          {displayName} · {msg.timestamp.slice(11, 16)}
        </div>
        <div
          style={{
            background: isUser ? '#eef3ff' : '#fff',
            border: `1px solid ${isUser ? '#c7d3f4' : '#e3e8f0'}`,
            padding: '10px 14px',
            borderRadius: 12,
            borderTopLeftRadius: isUser ? 12 : 4,
            borderTopRightRadius: isUser ? 4 : 12,
          }}
        >
          {/* 子智能体调用块 —— 放在正文前面, 视觉上像是"上文先请了专家" */}
          {subInvocations.map((tc, i) => (
            <SubInvocationBlock key={`sub-${i}`} tc={tc} />
          ))}

          {msg.content || !msg.streaming ? (
            <MarkdownView text={msg.content} />
          ) : (
            <span style={{ color: '#6b7a90', fontStyle: 'italic' }}>⚙️ 正在思考…</span>
          )}

          {plainTools.length > 0 && (
            <div style={{ marginTop: 10, borderTop: '1px dashed #e3e8f0', paddingTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                🔧 工具调用轨迹
              </Text>
              {plainTools.map((tc, i) => (
                <div
                  key={i}
                  style={{
                    marginTop: 6,
                    padding: 8,
                    background: '#f8faff',
                    border: '1px solid #e3e8f0',
                    borderRadius: 6,
                    fontSize: 12,
                    fontFamily: 'monospace',
                  }}
                >
                  <div style={{ fontWeight: 600, color: '#2b57d6' }}>
                    {tc.tool}({JSON.stringify(tc.input)})
                  </div>
                  {/* output_preview 可能含 markdown 链接(如 search_kb 命中文档的来源链接),
                      走 MarkdownView 让来源链接可点击跳转,便于溯源核验。 */}
                  <div style={{ marginTop: 4, color: '#6b7a90' }}>
                    <MarkdownView text={tc.output_preview} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 子智能体调用折叠块 —— 默认收起, 点击展开看专家完整发言。 */
function SubInvocationBlock({ tc }: { tc: ToolCallTrace }) {
  const [open, setOpen] = useState(false);
  const agentColor = tc.agent_color ?? '#7c4dff';
  const agentName = tc.agent_name ?? '子智能体';
  // 阶段 6:从 agents 实时拉 display_name + avatar
  const agentMap = useAgentMap();
  const liveAgent = tc.agent_id ? agentMap.get(tc.agent_id) : undefined;
  const displayName = liveAgent?.display_name ?? agentName;
  const avatar = liveAgent?.avatar;
  return (
    <div
      style={{
        marginBottom: 10,
        border: `1px solid ${agentColor}55`,
        borderLeft: `3px solid ${agentColor}`,
        borderRadius: 6,
        background: `${agentColor}0a`,
        overflow: 'hidden',
      }}
    >
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: '6px 10px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          userSelect: 'none',
        }}
      >
        <CaretRightOutlined
          rotate={open ? 90 : 0}
          style={{ fontSize: 10, color: agentColor, transition: 'transform 0.15s' }}
        />
        <AgentAvatar
          agent={liveAgent}
          agentId={tc.agent_id}
          agentMap={agentMap}
          name={agentName}
          color={agentColor}
          size={18}
        />
        <span style={{ fontWeight: 600, color: agentColor }}>调用了 {displayName}</span>
        {!open && (
          <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
            点击展开发言
          </Text>
        )}
      </div>
      {open && (
        <div
          style={{
            padding: '4px 12px 10px 24px',
            fontSize: 12,
            color: '#333',
            borderTop: `1px dashed ${agentColor}44`,
          }}
        >
          <MarkdownView text={tc.output_preview} />
        </div>
      )}
    </div>
  );
}

/* ------ 输入栏 ------ */

function InputBar({
  value,
  onChange,
  onSend,
  onAbort,
  busy,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onAbort: () => void;
  /** true 时按钮变红色"打断"; 用户点击 → onAbort()。同时禁用回车发送。 */
  busy?: boolean;
  placeholder?: string;
}) {
  return (
    <Card size="small" bodyStyle={{ padding: 8 }} style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <Input.TextArea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoSize={{ minRows: 2, maxRows: 5 }}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              if (!busy) onSend();
            }
          }}
        />
        {busy ? (
          <Button
            danger
            icon={<PauseCircleOutlined />}
            onClick={onAbort}
            style={{ height: 'auto' }}
          >
            打断
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={onSend}
            style={{ height: 'auto' }}
          >
            发送
          </Button>
        )}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: '#6b7a90' }}>
        {busy ? '任务/对话进行中,点击"打断"终止' : 'Enter 发送 · Shift+Enter 换行'}
      </div>
    </Card>
  );
}

/* ------ 右侧:配置面板 ------ */

function ConfigPane({
  session,
  agents,
  skills,
  templates,
  nodes,
  kbs,
  onChange,
}: {
  session: ChatSession | null;
  agents: AgentDef[];
  skills: SkillDef[];
  templates: WorkflowTemplate[];
  nodes: NodeDef[];
  kbs: KnowledgeBase[];
  onChange: (patch: Partial<ChatSession>) => void;
}) {
  // 若挂载的是专家团, 预览其协作顺序(和以前一样, 只是从 team_template_id 换成 attached_expert)
  const teamAgents = useMemo(() => {
    const exp = session?.attached_expert;
    if (!exp || exp.kind !== 'team') return [];
    const tpl = templates.find((t) => t.id === exp.id);
    if (!tpl) return [];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const agentMap = new Map(agents.map((a) => [a.id, a]));
    const seen = new Set<string>();
    const list: AgentDef[] = [];
    for (const inst of tpl.nodes) {
      const def = nodeMap.get(inst.type);
      if (!def || def.kind !== 'compute' || !def.agent_id) continue;
      const a = agentMap.get(def.agent_id);
      if (!a || seen.has(a.id)) continue;
      seen.add(a.id);
      list.push(a);
    }
    return list;
  }, [session, templates, nodes, agents]);

  if (!session) {
    return (
      <Card title="会话配置">
        <Empty description="请先选择或新建会话" />
      </Card>
    );
  }

  const clearHistory = () => onChange({ messages: [] });

  const expValue = encodeExpertValue(session.attached_expert);
  const currentTpl =
    session.attached_expert?.kind === 'team'
      ? templates.find((t) => t.id === session.attached_expert!.id)
      : undefined;

  return (
    <Card
      title="会话配置"
      bodyStyle={{ padding: 12, overflow: 'auto' }}
      style={{ display: 'flex', flexDirection: 'column' }}
      extra={
        <Popconfirm title="清空当前会话消息?" onConfirm={clearHistory}>
          <Button size="small" danger icon={<ClearOutlined />}>
            清空
          </Button>
        </Popconfirm>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <Text strong style={{ fontSize: 12 }}>
            会话标题
          </Text>
          <Input
            size="small"
            value={session.title}
            onChange={(e) => onChange({ title: e.target.value })}
            style={{ marginTop: 4 }}
          />
        </div>

        <div>
          <Text strong style={{ fontSize: 12 }}>
            <RobotOutlined /> 挂载子智能体
          </Text>
          <Select
            value={expValue}
            onChange={(v) => onChange({ attached_expert: decodeExpertValue(v) })}
            style={{ width: '100%', marginTop: 6 }}
            placeholder="未挂载 —— 主助手直接回答"
            optionLabelProp="label"
            options={[
              {
                value: '',
                label: (
                  <Space>
                    <RobotOutlined style={{ color: '#6b7a90' }} />
                    <span>未挂载(通用主助手)</span>
                  </Space>
                ),
              },
              {
                label: (
                  <Space>
                    <RobotOutlined />
                    <span>专家</span>
                  </Space>
                ),
                options: agents.map((a) => ({
                  value: encodeExpertValue({ kind: 'agent', id: a.id }),
                  label: (
                    <Space>
                      <AgentAvatar agent={a} size={20} />
                      <span>{a.display_name ?? a.name}</span>
                    </Space>
                  ),
                })),
              },
              {
                label: (
                  <Space>
                    <TeamOutlined />
                    <span>专家团</span>
                  </Space>
                ),
                options: templates.map((t) => ({
                  value: encodeExpertValue({ kind: 'team', id: t.id }),
                  label: (
                    <Space>
                      <ApartmentOutlined />
                      {t.name}
                      {t.builtin && (
                        <Tag color="blue" style={{ margin: 0 }}>
                          内置
                        </Tag>
                      )}
                    </Space>
                  ),
                })),
              },
            ]}
          />
          <Text type="secondary" style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
            挂载后,主助手在合适时机会自主调用它;不挂载则纯通用助手对话。
          </Text>

          {session.attached_expert?.kind === 'agent' && (
            <Text type="secondary" style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
              {agents.find((a) => a.id === session.attached_expert!.id)?.description}
            </Text>
          )}
          {currentTpl && (
            <>
              <Text type="secondary" style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
                {currentTpl.description}
              </Text>
              <div
                style={{
                  marginTop: 8,
                  padding: 8,
                  background: '#faf5ff',
                  border: '1px solid #e9d5ff',
                  borderRadius: 6,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: 600 }}>
                  协作顺序({teamAgents.length} 位专家):
                </Text>
                {teamAgents.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                    (该架构未挂载任何专家)
                  </Text>
                ) : (
                  <ol
                    style={{
                      margin: '4px 0 0',
                      paddingLeft: 18,
                      fontSize: 11,
                      color: '#4a5568',
                    }}
                  >
                    {teamAgents.map((a) => (
                      <li key={a.id} style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <AgentAvatar agent={a} size={16} />
                        <span>{a.display_name ?? a.name}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
        </div>

        <Divider style={{ margin: '4px 0' }} />

        <div>
          <Text strong style={{ fontSize: 12 }}>
            <ToolOutlined /> 启用工具
          </Text>
          <Checkbox.Group
            value={session.tools}
            onChange={(v) => onChange({ tools: v as string[] })}
            style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}
          >
            {KNOWN_TOOLS.map((t) => (
              <Checkbox key={t.value} value={t.value} style={{ marginLeft: 0 }}>
                <span style={{ fontSize: 12 }}>{t.label}</span>
                <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                  {t.value}
                </Text>
              </Checkbox>
            ))}
          </Checkbox.Group>
        </div>

        <Divider style={{ margin: '4px 0' }} />

        <div>
          <Text strong style={{ fontSize: 12 }}>
            <ExperimentOutlined /> 挂载技能
          </Text>
          <Checkbox.Group
            value={session.skills}
            onChange={(v) => onChange({ skills: v as string[] })}
            style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}
          >
            {skills.map((s) => (
              <div key={s.id} style={{ marginBottom: 4 }}>
                <Checkbox value={s.id}>
                  <Space size={4}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: s.color,
                      }}
                    />
                    <span style={{ fontSize: 12 }}>{s.name}</span>
                    <Tag style={{ margin: 0, fontSize: 10 }}>{s.category}</Tag>
                  </Space>
                </Checkbox>
                <div style={{ marginLeft: 22, fontSize: 11, color: '#6b7a90', lineHeight: 1.4 }}>
                  {s.description}
                </div>
              </div>
            ))}
          </Checkbox.Group>
        </div>

        <Divider style={{ margin: '4px 0' }} />

        <div>
          <Text strong style={{ fontSize: 12 }}>
            <BookOutlined /> 挂载知识库
          </Text>
          {!session.tools.includes('search_kb') && (
            <div style={{ marginTop: 4 }}>
              <Text type="warning" style={{ fontSize: 11 }}>
                ⚠️ 需先勾选「知识库检索」工具,挂载才会生效
              </Text>
            </div>
          )}
          <Select
            mode="multiple"
            value={session.kb_ids ?? []}
            onChange={(v) => onChange({ kb_ids: v as string[] })}
            style={{ width: '100%', marginTop: 6 }}
            placeholder="选择要挂载的知识库(可多选)"
            optionLabelProp="label"
            maxTagCount="responsive"
            options={kbs.map((k) => ({
              value: k.id,
              label: (
                <Space size={4}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: k.color,
                    }}
                  />
                  {k.name}
                </Space>
              ),
            }))}
          />
          {(session.kb_ids?.length ?? 0) > 0 && (
            <div style={{ marginTop: 6 }}>
              {(session.kb_ids ?? []).map((id) => {
                const kb = kbs.find((k) => k.id === id);
                if (!kb) return null;
                return (
                  <div key={id} style={{ fontSize: 11, color: '#6b7a90', marginTop: 2 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: kb.color,
                        marginRight: 4,
                      }}
                    />
                    {kb.name} · {kb.docs.length} 篇
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Space>
    </Card>
  );
}
