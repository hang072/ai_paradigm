import { useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Alert,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message as antMessage,
} from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { TemplatesApi } from '../../api/templates';
import { NodesApi } from '../../api/nodes';
import { AgentsApi } from '../../api/agents';
import type { WorkflowTemplate, NodeInstance, EdgeInstance, ParameterSchemaEntry } from '../../types/template';
import type { NodeDef, NodeDefConfigConventions } from '../../types/node';
import type { AgentDef } from '../../types/agent';
import { EditableCanvas } from '../../canvas/EditableCanvas';
import { validateTemplate, hasBlockingIssues, formatIssues } from './validateTemplate';

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
    // 阶段 2:parameter_schema 也要深拷,避免新模板被原模板引用
    parameter_schema: src.parameter_schema
      ? Object.fromEntries(
          Object.entries(src.parameter_schema).map(([k, v]) => [k, { ...v, enum_values: v.enum_values ? [...v.enum_values] : undefined }]),
        )
      : undefined,
    description_required_inputs: src.description_required_inputs
      ? [...src.description_required_inputs]
      : undefined,
  };
}

/**
 * 阶段 2:NodeDef.config 键值编辑器。
 * - 6 个约定键(system_prompt_template/input_keys/output_keys/retrieve_kb/
 *   retrieve_pubmed/cite_rule)给对应 UI(下拉/数字/开关)
 * - 其他任意键给 "JSON 字符串" 行(保留兼容性)
 */
function NodeConfigTable({
  config,
  onChange,
}: {
  config: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
}) {
  // 拆分:约定键走友好 UI,其他键走 JSON 行
  const CONVENTION_KEYS: (keyof NodeDefConfigConventions)[] = [
    'system_prompt_template',
    'input_keys',
    'output_keys',
    'retrieve_kb',
    'retrieve_pubmed',
    'cite_rule',
  ];
  const conventionEntries = CONVENTION_KEYS
    .filter((k) => k in config)
    .map((k) => ({ key: String(k), kind: 'convention' as const }));
  const extraEntries = Object.keys(config)
    .filter((k) => !CONVENTION_KEYS.includes(k as any))
    .map((k) => ({ key: k, kind: 'extra' as const }));

  const setKey = (oldKey: string, newKey: string) => {
    if (oldKey === newKey || !newKey) return;
    const next: Record<string, any> = {};
    Object.entries(config).forEach(([k, v]) => {
      next[k === oldKey ? newKey : k] = v;
    });
    onChange(next);
  };
  const setValue = (key: string, value: any) => {
    onChange({ ...config, [key]: value });
  };
  const del = (key: string) => {
    const next = { ...config };
    delete next[key];
    onChange(next);
  };
  const addExtra = () => {
    let i = 1;
    let key = `custom_${i}`;
    while (key in config) key = `custom_${++i}`;
    onChange({ ...config, [key]: '' });
  };

  const renderValueEditor = (key: string) => {
    if (key === 'system_prompt_template') {
      return (
        <Input.TextArea
          rows={2}
          value={config[key] ?? ''}
          onChange={(e) => setValue(key, e.target.value)}
          placeholder="支持 {{input_key}} 占位"
        />
      );
    }
    if (key === 'input_keys' || key === 'output_keys') {
      return (
        <Select
          mode="tags"
          size="small"
          value={config[key] ?? []}
          onChange={(v) => setValue(key, v)}
          placeholder="回车添加 key"
          style={{ width: '100%' }}
        />
      );
    }
    if (key === 'retrieve_kb') {
      return (
        <Switch
          size="small"
          checked={!!config[key]}
          onChange={(v) => setValue(key, v)}
        />
      );
    }
    if (key === 'retrieve_pubmed') {
      const v = config[key] ?? { enabled: false, max: 5 };
      return (
        <Space size={4}>
          <Switch
            size="small"
            checked={!!v.enabled}
            onChange={(b) => setValue(key, { ...v, enabled: b })}
          />
          <InputNumber
            size="small"
            min={1}
            max={20}
            value={v.max ?? 5}
            onChange={(n) => setValue(key, { ...v, max: n ?? 5 })}
            style={{ width: 70 }}
            disabled={!v.enabled}
          />
        </Space>
      );
    }
    if (key === 'cite_rule') {
      return (
        <Select
          size="small"
          value={config[key] ?? 'markdown'}
          onChange={(v) => setValue(key, v)}
          options={[
            { value: 'markdown', label: 'markdown' },
            { value: 'numbered', label: 'numbered' },
            { value: 'none', label: 'none' },
          ]}
          style={{ width: 120 }}
        />
      );
    }
    // extra: JSON 编辑
    return (
      <Input
        size="small"
        value={typeof config[key] === 'string' ? config[key] : JSON.stringify(config[key] ?? '')}
        onChange={(e) => {
          const raw = e.target.value;
          // 尝试解析 JSON,失败则当字符串
          try {
            setValue(key, raw === '' ? '' : JSON.parse(raw));
          } catch {
            setValue(key, raw);
          }
        }}
        placeholder="JSON 或字符串"
      />
    );
  };

  return (
    <div>
      <Table
        size="small"
        pagination={false}
        dataSource={[...conventionEntries, ...extraEntries]}
        rowKey="key"
        columns={[
          {
            title: 'Key',
            dataIndex: 'key',
            width: 160,
            render: (k: string, row) =>
              row.kind === 'convention' ? (
                <Tag color="blue">{k}</Tag>
              ) : (
                <Input
                  size="small"
                  defaultValue={k}
                  onBlur={(e) => setKey(k, e.target.value)}
                />
              ),
          },
          { title: '值', render: (_: any, row) => renderValueEditor(row.key) },
          {
            title: '',
            width: 40,
            render: (_: any, row) => (
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => del(row.key)}
              />
            ),
          },
        ]}
      />
      <Button
        size="small"
        icon={<PlusOutlined />}
        onClick={addExtra}
        style={{ marginTop: 8 }}
      >
        添加自定义键
      </Button>
    </div>
  );
}

/**
 * 阶段 2:模板级 parameter_schema 键值编辑器。
 * 列:key / type / required / description / default
 */
function ParameterSchemaTable({
  schema,
  onChange,
}: {
  schema: Record<string, ParameterSchemaEntry>;
  onChange: (next: Record<string, ParameterSchemaEntry>) => void;
}) {
  const entries = Object.entries(schema);
  const addRow = () => {
    let i = 1;
    let key = `param_${i}`;
    while (key in schema) key = `param_${++i}`;
    onChange({ ...schema, [key]: { type: 'string', required: false, description: '' } });
  };
  const setEntry = (oldKey: string, patch: Partial<ParameterSchemaEntry> & { newKey?: string }) => {
    const next: Record<string, ParameterSchemaEntry> = {};
    Object.entries(schema).forEach(([k, v]) => {
      const realKey = k === oldKey ? patch.newKey ?? oldKey : k;
      if (!realKey) return;
      next[realKey] = { ...v, ...patch, newKey: undefined } as ParameterSchemaEntry;
    });
    onChange(next);
  };
  const del = (key: string) => {
    const next = { ...schema };
    delete next[key];
    onChange(next);
  };

  return (
    <div>
      <Table
        size="small"
        pagination={false}
        dataSource={entries.map(([k, v]) => ({ key: k, ...v }))}
        rowKey="key"
        columns={[
          {
            title: '参数名',
            dataIndex: 'key',
            width: 130,
            render: (k: string, row) => (
              <Input
                size="small"
                defaultValue={k}
                onBlur={(e) => e.target.value !== k && setEntry(k, { newKey: e.target.value })}
              />
            ),
          },
          {
            title: '类型',
            dataIndex: 'type',
            width: 100,
            render: (t: string, row) => (
              <Select
                size="small"
                value={t}
                onChange={(v) => setEntry(row.key, { type: v as any })}
                options={[
                  { value: 'string', label: 'string' },
                  { value: 'number', label: 'number' },
                  { value: 'enum', label: 'enum' },
                  { value: 'boolean', label: 'boolean' },
                ]}
                style={{ width: '100%' }}
              />
            ),
          },
          {
            title: '必填',
            dataIndex: 'required',
            width: 60,
            render: (r: boolean, row) => (
              <Checkbox
                checked={!!r}
                onChange={(e) => setEntry(row.key, { required: e.target.checked })}
              />
            ),
          },
          {
            title: '描述',
            dataIndex: 'description',
            render: (d: string, row) => (
              <Input
                size="small"
                defaultValue={d}
                onBlur={(e) => setEntry(row.key, { description: e.target.value })}
                placeholder="给 Planner / 人类阅读"
              />
            ),
          },
          {
            title: '默认值',
            dataIndex: 'default',
            width: 110,
            render: (def: any, row) => {
              if (row.type === 'boolean') {
                return (
                  <Select
                    size="small"
                    value={def === undefined ? undefined : String(def)}
                    onChange={(v) => setEntry(row.key, { default: v === 'true' })}
                    options={[
                      { value: 'true', label: 'true' },
                      { value: 'false', label: 'false' },
                    ]}
                    allowClear
                    style={{ width: '100%' }}
                  />
                );
              }
              if (row.type === 'enum') {
                return (
                  <Select
                    size="small"
                    mode="tags"
                    value={row.enum_values ?? []}
                    onChange={(vs) => setEntry(row.key, { enum_values: vs })}
                    placeholder="候选值"
                    style={{ width: '100%' }}
                  />
                );
              }
              return (
                <Input
                  size="small"
                  defaultValue={def === undefined ? '' : String(def)}
                  onBlur={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      setEntry(row.key, { default: undefined });
                    } else if (row.type === 'number') {
                      const n = Number(raw);
                      setEntry(row.key, { default: Number.isNaN(n) ? raw : n });
                    } else {
                      setEntry(row.key, { default: raw });
                    }
                  }}
                />
              );
            },
          },
          {
            title: '',
            width: 40,
            render: (_: any, row) => (
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => del(row.key)}
              />
            ),
          },
        ]}
      />
      <Button
        size="small"
        icon={<PlusOutlined />}
        onClick={addRow}
        style={{ marginTop: 8 }}
      >
        添加参数
      </Button>
    </div>
  );
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
  // 阶段 2:validation issues 实时计算(节点/边变时重新跑)
  const [validationIssues, setValidationIssues] = useState<
    ReturnType<typeof validateTemplate>
  >([]);

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

  // ===== 阶段 2 节点级编辑 =====
  /**
   * 改 NodeDef.config(自由 map)。作用在 NodeDef 而不是 NodeInstance:
   * 一个 NodeDef 改 config 后,所有同 type 的 NodeInstance 实时看到(因为 NodeDef
   * 通过 nodeDefs 数组下传,instance 不缓存 config)。这是当前的简化模型。
   */
  const setNodeDefConfig = (defId: string, next: Record<string, any>) => {
    setNodeDefs((prev) => prev.map((d) => (d.id === defId ? { ...d, config: next } : d)));
    setDirty(true);
  };
  /** 改 NodeDef.agent_id。null = 解绑(由 builtin 默认或调用方运行时决定) */
  const setNodeDefAgentId = (defId: string, agentId: string | null) => {
    setNodeDefs((prev) =>
      prev.map((d) => (d.id === defId ? { ...d, agent_id: agentId } : d)),
    );
    setDirty(true);
  };
  /** 当前选中节点的 NodeDef config(若选中) */
  const selectedNodeConfig: Record<string, any> = useMemo(
    () => (selectedNodeDef?.config ? { ...selectedNodeDef.config } : {}),
    [selectedNodeDef],
  );

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
    // 阶段 2:DAG 校验(先 warn 后 error)
    if (hasBlockingIssues(validationIssues)) {
      modal.error({
        title: 'DAG 校验未通过',
        content: (
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 360, overflow: 'auto' }}>
            {formatIssues(validationIssues)}
          </pre>
        ),
        width: 640,
      });
      return;
    }
    // 警告给提示但允许保存
    const warns = validationIssues.filter((i) => i.severity === 'warn');
    if (warns.length > 0) {
      modal.confirm({
        title: `DAG 有 ${warns.length} 个警告`,
        content: (
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 360, overflow: 'auto' }}>
            {formatIssues(warns)}
          </pre>
        ),
        okText: '继续保存',
        cancelText: '取消',
        onOk: () => performSave(),
      });
      return;
    }
    return performSave();
  };

  const performSave = async () => {
    if (!tpl) return;
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
          parameter_schema: payload.parameter_schema,
          description_required_inputs: payload.description_required_inputs,
        });
      } else {
        // 阶段 2.4:版本化保存由后端决定是否创建新版本,这里只调 update
        saved = await TemplatesApi.update(tpl.id, payload);
      }
      antMessage.success(
        isNew
          ? '已创建'
          : `已保存到 v${saved.current_version ?? tpl.current_version ?? 1}`,
      );
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

  // ===== 阶段 2 实时校验(节点/边变时重算) =====
  useEffect(() => {
    if (!tpl) return;
    const allowCycle = new Set<string>();
    tpl.nodes.forEach((n) => {
      if (n.type && nodeDefMap.get(n.type)?.config?.allow_cycle === true) {
        allowCycle.add(n.id);
      }
    });
    setValidationIssues(
      validateTemplate(
        { entry: tpl.entry, nodes: tpl.nodes, edges: tpl.edges },
        { nodeDefMap, allowCycleNodes: allowCycle },
      ),
    );
  }, [tpl, nodeDefMap]);

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
        {/* 阶段 2:版本号 + 必填入参 + parameter_schema 折叠 */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Tag color="geekblue">v{tpl.current_version ?? 1}</Tag>
          {tpl.versions && tpl.versions.length > 1 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              历史版本:[{tpl.versions.join(', ')}]
            </Text>
          )}
        </div>
        <Collapse
          size="small"
          ghost
          style={{ marginTop: 8 }}
          items={[
            {
              key: 'param',
              label: (
                <Space>
                  <Text>模板参数(parameter_schema)</Text>
                  <Tag>{Object.keys(tpl.parameter_schema ?? {}).length}</Tag>
                </Space>
              ),
              children: (
                <ParameterSchemaTable
                  schema={tpl.parameter_schema ?? {}}
                  onChange={(s) => updateTpl({ parameter_schema: s })}
                />
              ),
            },
            {
              key: 'inputs',
              label: (
                <Space>
                  <Text>必填入参描述(Planner 用)</Text>
                  <Tag>{tpl.description_required_inputs?.length ?? 0}</Tag>
                </Space>
              ),
              children: (
                <Select
                  mode="tags"
                  size="small"
                  value={tpl.description_required_inputs ?? []}
                  onChange={(v) => updateTpl({ description_required_inputs: v })}
                  placeholder="回车添加,如:主题、目标听众、引用文献 URL"
                  style={{ width: '100%' }}
                />
              ),
            },
          ]}
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
                  {/* 阶段 2:Agent 绑定从只读 Tag 升级为可改 Select(影响所有同 type 实例) */}
                  {selectedNodeDef.kind === 'compute' && (
                    <Form.Item
                      label={
                        <Space size={4}>
                          绑定 Agent
                          <Tooltip title="修改后,所有同 type 的节点实例都会看到新 agent">
                            <Text type="secondary" style={{ fontSize: 11 }}>?</Text>
                          </Tooltip>
                        </Space>
                      }
                    >
                      <Select
                        size="small"
                        value={selectedNodeDef.agent_id ?? undefined}
                        onChange={(v) => setNodeDefAgentId(selectedNodeDef.id, v ?? null)}
                        placeholder="选择 Agent(可留空用默认)"
                        allowClear
                        options={agentDefs.map((a) => ({
                          value: a.id,
                          label: `${a.name} (${a.id})`,
                        }))}
                        style={{ width: '100%' }}
                      />
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

                {/* 阶段 2:config 键值编辑器(同样作用在 NodeDef) */}
                <Divider style={{ margin: '12px 0' }}>Config</Divider>
                <NodeConfigTable
                  config={selectedNodeConfig}
                  onChange={(next) => setNodeDefConfig(selectedNodeDef.id, next)}
                />

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

      {/* 阶段 2:实时 DAG 校验问题列表 */}
      {validationIssues.length > 0 && (
        <Alert
          showIcon
          type={hasBlockingIssues(validationIssues) ? 'error' : 'warning'}
          message={
            hasBlockingIssues(validationIssues)
              ? `DAG 校验未通过(${validationIssues.filter((i) => i.severity === 'error').length} 个错误,${validationIssues.filter((i) => i.severity === 'warn').length} 个警告)`
              : `DAG 有 ${validationIssues.length} 个警告(可继续保存)`
          }
          description={
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0 }}>
              {formatIssues(validationIssues)}
            </pre>
          }
        />
      )}

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
