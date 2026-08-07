import { useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Alert,
  AutoComplete,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  Row,
  Select,
  Space,
  Tag,
  Typography,
  message as antMessage,
} from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { TemplatesApi } from '../../api/templates';
import { NodesApi } from '../../api/nodes';
import { AgentsApi } from '../../api/agents';
import type { WorkflowTemplate, NodeInstance, EdgeInstance } from '../../types/template';
import type { NodeDef } from '../../types/node';
import type { AgentDef } from '../../types/agent';
import { EditableCanvas } from '../../canvas/EditableCanvas';

const { Title, Text } = Typography;

const KIND_TAG_COLOR: Record<NodeDef['kind'], string> = {
  compute: 'blue',
  interrupt: 'gold',
  counter: 'purple',
  router: 'cyan',
};

const KIND_LABEL: Record<NodeDef['kind'], string> = {
  compute: 'Compute',
  interrupt: 'HITL',
  counter: 'Counter',
  router: 'Router',
};

/** 给新节点生成一个不冲突的实例 id(NodeDef.id 加 4 位后缀)。 */
function newInstanceId(defId: string, existing: NodeInstance[]): string {
  for (let i = 0; i < 50; i++) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const id = `${defId}_${suffix}`;
    if (!existing.some((n) => n.id === id)) return id;
  }
  return `${defId}_${Date.now().toString(36)}`;
}

/** fork 内置模板:克隆但去掉 builtin、生成新 id。 */
function forkTemplate(src: WorkflowTemplate): WorkflowTemplate {
  return {
    ...src,
    id: `tpl-${Math.random().toString(36).slice(2, 10)}`,
    name: `${src.name} · 副本`,
    builtin: false,
    nodes: src.nodes.map((n) => ({ ...n })),
    edges: src.edges.map((e) => ({ ...e })),
    tags: [...src.tags],
  };
}

export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const { message: ctxMessage, modal } = AntApp.useApp();
  const [tpl, setTpl] = useState<WorkflowTemplate | null>(null);
  const [nodeDefs, setNodeDefs] = useState<NodeDef[]>([]);
  const [agentDefs, setAgentDefs] = useState<AgentDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // 初始加载
  useEffect(() => {
    Promise.all([NodesApi.list(), AgentsApi.list()])
      .then(([n, a]) => {
        setNodeDefs(n);
        setAgentDefs(a);
      })
      .catch((e) => ctxMessage.error(e.message));

    if (isNew) {
      setTpl({
        id: '',
        name: '新建模板',
        description: '',
        tags: [],
        entry: '',
        nodes: [],
        edges: [],
        builtin: false,
      });
      setLoading(false);
      return;
    }
    TemplatesApi.get(id!)
      .then((src) => {
        // 内置模板进入时直接 fork,避免后端 PUT 拒 400
        setTpl(src.builtin ? forkTemplate(src) : { ...src });
      })
      .catch((e) => ctxMessage.error(e.message))
      .finally(() => setLoading(false));
  }, [id, isNew, ctxMessage]);

  const nodeDefMap = useMemo(
    () => new Map(nodeDefs.map((n) => [n.id, n])),
    [nodeDefs],
  );
  const selectedNode = useMemo(
    () => tpl?.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [tpl, selectedNodeId],
  );
  const selectedNodeDef = selectedNode ? nodeDefMap.get(selectedNode.type) : null;
  const selectedEdge = useMemo(() => {
    if (!tpl || !selectedEdgeId) return null;
    // 编辑器里 edge.id 形如 e-<idx>-<from>-<to>-<port>
    const m = /^e-(\d+)-/.exec(selectedEdgeId);
    if (!m) return null;
    const idx = Number(m[1]);
    return tpl.edges[idx] ?? null;
  }, [tpl, selectedEdgeId]);

  // ===== Mutations =====
  const updateTpl = (patch: Partial<WorkflowTemplate>) => {
    setTpl((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  };

  const setNodes = (next: NodeInstance[]) => {
    setTpl((prev) => {
      if (!prev) return prev;
      const nextEntry = prev.nodes.find((n) => n.id === prev.entry) ? prev.entry : '';
      return { ...prev, nodes: next, entry: nextEntry };
    });
    setDirty(true);
  };
  const setEdges = (next: EdgeInstance[]) => updateTpl({ edges: next });

  const addNode = (def: NodeDef) => {
    if (!tpl) return;
    const inst: NodeInstance = {
      id: newInstanceId(def.id, tpl.nodes),
      type: def.id,
    };
    const nodes = [...tpl.nodes, inst];
    setTpl((prev) =>
      prev
        ? { ...prev, nodes, entry: prev.entry || inst.id }
        : prev,
    );
    setDirty(true);
  };

  const removeNode = (nodeId: string) => {
    if (!tpl) return;
    setNodes(tpl.nodes.filter((n) => n.id !== nodeId));
    setEdges(tpl.edges.filter((e) => e.from !== nodeId && e.to !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  };
  const removeEdge = (idx: number) => {
    if (!tpl) return;
    setEdges(tpl.edges.filter((_, i) => i !== idx));
    if (selectedEdgeId) setSelectedEdgeId(null);
  };

  const setEntry = (nodeId: string) => updateTpl({ entry: nodeId });
  const setNodeLabel = (nodeId: string, label: string) => {
    if (!tpl) return;
    setNodes(
      tpl.nodes.map((n) =>
        n.id === nodeId ? ({ ...n, label } as NodeInstance & { label?: string }) : n,
      ),
    );
  };

  const setEdgePort = (idx: number, port: string) => {
    if (!tpl) return;
    setEdges(tpl.edges.map((e, i) => (i === idx ? { ...e, port } : e)));
  };

  // ===== Save =====
  const handleSave = async () => {
    if (!tpl) return;
    if (!tpl.name.trim()) {
      antMessage.warning('请填写模板名称');
      return;
    }
    if (tpl.nodes.length === 0) {
      antMessage.warning('请至少添加一个节点');
      return;
    }
    if (!tpl.entry) {
      antMessage.warning('请指定入口节点');
      return;
    }
    setSaving(true);
    try {
      const payload: WorkflowTemplate = {
        ...tpl,
        // 清理 instance 上不存的字段(只保留后端契约字段)
        nodes: tpl.nodes.map(({ id, type, x, y }) => ({ id, type, x, y })),
        edges: tpl.edges.map(({ from, to, port }) => ({ from, to, port })),
      };
      let saved: WorkflowTemplate;
      if (isNew || !tpl.id) {
        saved = await TemplatesApi.create({
          name: payload.name,
          description: payload.description,
          tags: payload.tags,
          entry: payload.entry,
          nodes: payload.nodes,
          edges: payload.edges,
        });
      } else {
        saved = await TemplatesApi.update(tpl.id, payload);
      }
      antMessage.success('已保存');
      setDirty(false);
      navigate(`/templates`);
      return saved;
    } catch (e: any) {
      ctxMessage.error(e.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (dirty) {
      modal.confirm({
        title: '放弃当前编辑?',
        content: '有未保存的改动,确定离开?',
        okText: '放弃',
        cancelText: '继续编辑',
        onOk: () => navigate('/templates'),
      });
    } else {
      navigate('/templates');
    }
  };

  // ===== NodeDef 面板分组 =====
  const grouped = useMemo(() => {
    const m: Record<NodeDef['kind'], NodeDef[]> = {
      compute: [],
      interrupt: [],
      counter: [],
      router: [],
    };
    nodeDefs.forEach((d) => m[d.kind].push(d));
    return m;
  }, [nodeDefs]);

  if (loading || !tpl) {
    return <div style={{ padding: 24 }}>加载中…</div>;
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 顶部 toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Button icon={<ArrowLeftOutlined />} onClick={handleCancel}>
          返回
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          {isNew ? '新建模板' : `编辑 · ${tpl.name}`}
        </Title>
        {dirty && <Tag color="orange">未保存</Tag>}
        <div style={{ flex: 1 }} />
        <Space>
          <Button onClick={handleCancel}>取消</Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
          >
            保存
          </Button>
        </Space>
      </div>

      {/* 元信息 */}
      <Card size="small">
        <Form layout="inline" style={{ rowGap: 8 }}>
          <Form.Item label="名称" required style={{ minWidth: 260 }}>
            <Input
              value={tpl.name}
              onChange={(e) => updateTpl({ name: e.target.value })}
              placeholder="模板名称"
            />
          </Form.Item>
          <Form.Item label="标签" style={{ minWidth: 320 }}>
            <Select
              mode="tags"
              value={tpl.tags}
              onChange={(tags) => updateTpl({ tags })}
              placeholder="回车添加标签"
              style={{ minWidth: 240 }}
            />
          </Form.Item>
          <Form.Item label="入口节点">
            <Select
              value={tpl.entry || undefined}
              onChange={setEntry}
              placeholder="选择 entry"
              style={{ minWidth: 200 }}
              options={tpl.nodes.map((n) => ({
                value: n.id,
                label: `${n.id} (${nodeDefMap.get(n.type)?.name ?? n.type})`,
              }))}
              allowClear
            />
          </Form.Item>
        </Form>
        <Input.TextArea
          rows={2}
          value={tpl.description}
          onChange={(e) => updateTpl({ description: e.target.value })}
          placeholder="模板描述"
          style={{ marginTop: 8 }}
        />
      </Card>

      {/* 三栏:左 NodeDef 面板 · 中 画布 · 右 属性 */}
      <Row gutter={12} style={{ flex: 1, minHeight: 0 }}>
        <Col span={4}>
          <Card
            size="small"
            title="节点类型"
            style={{ height: '100%' }}
            bodyStyle={{
              padding: 8,
              maxHeight: 'calc(100vh - 280px)',
              overflowY: 'auto',
            }}
          >
            {(Object.keys(grouped) as NodeDef['kind'][]).map((kind) =>
              grouped[kind].length === 0 ? null : (
                <div key={kind} style={{ marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {KIND_LABEL[kind]} · {grouped[kind].length}
                  </Text>
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {grouped[kind].map((d) => (
                      <Button
                        key={d.id}
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => addNode(d)}
                        style={{ textAlign: 'left' }}
                        block
                      >
                        <Tag color={KIND_TAG_COLOR[kind]} style={{ marginRight: 4 }}>
                          {KIND_LABEL[kind]}
                        </Tag>
                        {d.name}
                      </Button>
                    ))}
                  </div>
                </div>
              ),
            )}
            <Text type="secondary" style={{ fontSize: 11 }}>
              点击「+」把节点加入画布,可在画布上拖动位置。
            </Text>
          </Card>
        </Col>

        <Col span={15}>
          <EditableCanvas
            nodes={tpl.nodes}
            edges={tpl.edges}
            nodeDefs={nodeDefs}
            agentDefs={agentDefs}
            entry={tpl.entry}
            height="calc(100vh - 280px)"
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onNodesChange={setNodes}
            onEdgesChange={setEdges}
            onSelect={(sel) => {
              setSelectedNodeId(sel.nodeId);
              setSelectedEdgeId(sel.edgeId);
            }}
          />
        </Col>

        <Col span={5}>
          <Card
            size="small"
            title="属性"
            style={{ height: '100%' }}
            bodyStyle={{
              padding: 12,
              maxHeight: 'calc(100vh - 280px)',
              overflowY: 'auto',
            }}
          >
            {!selectedNode && !selectedEdge && (
              <Text type="secondary">
                选中节点或边查看/编辑属性。节点可拖动,边从源端口拖到目标端口。
              </Text>
            )}

            {selectedNode && selectedNodeDef && (
              <div>
                <Title level={5} style={{ marginTop: 0 }}>
                  节点 · {selectedNodeDef.name}
                </Title>
                <Form layout="vertical" size="small">
                  <Form.Item label="实例 ID">
                    <Input value={selectedNode.id} disabled />
                  </Form.Item>
                  <Form.Item label="显示名">
                    <Input
                      value={
                        (selectedNode as any).label ?? selectedNodeDef.name
                      }
                      onChange={(e) => setNodeLabel(selectedNode.id, e.target.value)}
                      placeholder={selectedNodeDef.name}
                    />
                  </Form.Item>
                  <Form.Item label="类型">
                    <Tag color={KIND_TAG_COLOR[selectedNodeDef.kind]}>
                      {KIND_LABEL[selectedNodeDef.kind]}
                    </Tag>
                    <Text type="secondary" style={{ marginLeft: 8 }}>
                      {selectedNode.type}
                    </Text>
                  </Form.Item>
                  {selectedNodeDef.agent_id && (
                    <Form.Item label="绑定 Agent">
                      <Tag>
                        {agentDefs.find((a) => a.id === selectedNodeDef.agent_id)?.name ??
                          selectedNodeDef.agent_id}
                      </Tag>
                    </Form.Item>
                  )}
                  <Form.Item label="输出端口">
                    {selectedNodeDef.out_ports.map((p) => (
                      <Tag key={p} color="blue" style={{ marginRight: 4 }}>
                        {p}
                      </Tag>
                    ))}
                  </Form.Item>
                  <Form.Item label="设为入口">
                    <Button
                      size="small"
                      type={tpl.entry === selectedNode.id ? 'primary' : 'default'}
                      onClick={() => setEntry(selectedNode.id)}
                      block
                    >
                      {tpl.entry === selectedNode.id ? '当前 entry' : '设为 entry'}
                    </Button>
                  </Form.Item>
                </Form>
                <Divider style={{ margin: '12px 0' }} />
                <Button
                  danger
                  size="small"
                  block
                  onClick={() => removeNode(selectedNode.id)}
                >
                  删除节点
                </Button>
              </div>
            )}

            {selectedEdge && (
              <div>
                <Title level={5} style={{ marginTop: 0 }}>
                  边 · {selectedEdge.from} → {selectedEdge.to}
                </Title>
                <Form layout="vertical" size="small">
                  <Form.Item label="源节点">
                    <Input value={selectedEdge.from} disabled />
                  </Form.Item>
                  <Form.Item label="目标节点">
                    <Input value={selectedEdge.to} disabled />
                  </Form.Item>
                  <Form.Item label="端口">
                    <AutoComplete
                      value={selectedEdge.port}
                      onChange={(v) => {
                        const idx = tpl.edges.findIndex(
                          (e) =>
                            e.from === selectedEdge.from &&
                            e.to === selectedEdge.to &&
                            e.port === selectedEdge.port,
                        );
                        if (idx >= 0) setEdgePort(idx, v);
                      }}
                      options={(
                        nodeDefMap.get(
                          tpl.nodes.find((n) => n.id === selectedEdge.from)?.type ?? '',
                        )?.out_ports ?? ['next']
                      ).map((p) => ({ value: p }))}
                      placeholder="端口名,必须出现在源节点 out_ports 中"
                    />
                  </Form.Item>
                </Form>
                <Divider style={{ margin: '12px 0' }} />
                <Button
                  danger
                  size="small"
                  block
                  onClick={() => {
                    const idx = tpl.edges.findIndex(
                      (e) =>
                        e.from === selectedEdge.from &&
                        e.to === selectedEdge.to &&
                        e.port === selectedEdge.port,
                    );
                    if (idx >= 0) removeEdge(idx);
                  }}
                >
                  删除边
                </Button>
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {tpl.nodes.length === 0 && (
        <Alert
          showIcon
          type="info"
          message="从左侧「节点类型」点击 + 按钮加入第一个节点,然后在右侧设 entry,即可保存。"
        />
      )}
    </div>
  );
}
