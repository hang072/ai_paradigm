import { useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Avatar,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, RobotOutlined } from '@ant-design/icons';
import { AgentsApi } from '../../api/agents';
import type { AgentDef } from '../../types/agent';

const { Text, Title } = Typography;
const { TextArea } = Input;

const KNOWN_TOOLS = ['search_literature', 'verify_reference', 'search_kb'];

export default function AgentsPage() {
  const { message } = AntApp.useApp();
  const [list, setList] = useState<AgentDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AgentDef | null>(null);
  const [form] = Form.useForm();

  const refresh = () => {
    setLoading(true);
    AgentsApi.list()
      .then(setList)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return list;
    return list.filter(
      (a) =>
        a.name.toLowerCase().includes(k) ||
        a.description.toLowerCase().includes(k) ||
        a.tools.some((t) => t.includes(k)),
    );
  }, [list, keyword]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      name: '',
      description: '',
      system_prompt: '',
      tools: [],
      llm_model: 'default',
      recursion_limit: 40,
      color: '#2b57d6',
      runtime: '云端',
    });
    setModalOpen(true);
  };

  const openEdit = (a: AgentDef) => {
    setEditing(a);
    form.setFieldsValue(a);
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await AgentsApi.update(editing.id, values);
        message.success('已更新');
      } else {
        await AgentsApi.create(values);
        message.success('已创建');
      }
      setModalOpen(false);
      refresh();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const remove = async (a: AgentDef) => {
    try {
      await AgentsApi.remove(a.id);
      message.success('已删除');
      refresh();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            多智能体专家团
          </Title>
          <Text type="secondary">建立并管理协作智能体 · 挂载技能与工具</Text>
        </div>
        <Space>
          <Input.Search
            placeholder="搜索智能体…"
            allowClear
            style={{ width: 260 }}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            建立协作智能体
          </Button>
        </Space>
      </div>

      {filtered.length === 0 && !loading ? (
        <Empty description="没有找到智能体" />
      ) : (
        <Row gutter={[16, 16]}>
          {filtered.map((a) => (
            <Col span={8} key={a.id}>
              <Card
                loading={loading}
                actions={[
                  <span onClick={() => openEdit(a)} key="edit">
                    <EditOutlined /> 编辑
                  </span>,
                  a.builtin ? (
                    <span key="del" style={{ color: '#ccc' }}>
                      <DeleteOutlined /> 内置
                    </span>
                  ) : (
                    <Popconfirm
                      key="del"
                      title="确认删除该智能体?"
                      onConfirm={() => remove(a)}
                    >
                      <span style={{ color: '#dc2626' }}>
                        <DeleteOutlined /> 删除
                      </span>
                    </Popconfirm>
                  ),
                ]}
              >
                <div className="flex items-center gap-12">
                  <Avatar
                    style={{ background: a.color }}
                    icon={<RobotOutlined />}
                    size={44}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{a.name}</div>
                    <Space size={4} style={{ marginTop: 4 }}>
                      {a.builtin && <Tag color="blue">内置</Tag>}
                      <Tag>{a.runtime ?? '云端'}</Tag>
                    </Space>
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 12,
                    fontSize: 12,
                    color: '#6b7a90',
                    minHeight: 36,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {a.description || '(无描述)'}
                </div>
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    挂载技能:
                  </Text>{' '}
                  {a.tools.length === 0 ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      无
                    </Text>
                  ) : (
                    a.tools.map((t) => (
                      <Tag key={t} color="geekblue" style={{ marginTop: 4 }}>
                        {t}
                      </Tag>
                    ))
                  )}
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        title={editing ? `编辑智能体 · ${editing.name}` : '新建协作智能体'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        width={720}
        okText="保存"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label="名称 (Name)"
                name="name"
                rules={[{ required: true, message: '请输入名称' }]}
              >
                <Input placeholder="例:安全卫士 / 幻灯制作器" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="运行时" name="runtime">
                <Select
                  options={[
                    { value: '云端', label: '云端' },
                    { value: '本地 Mac mini', label: '本地 Mac mini' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="简介 (Brief Subtitle)" name="description">
            <Input placeholder="一句话描述该智能体做什么" />
          </Form.Item>
          <Form.Item label="核心系统 Prompt (System Instruction)" name="system_prompt">
            <TextArea rows={8} placeholder="你是一个……" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="挂载技能 (Tools)" name="tools">
                <Select
                  mode="multiple"
                  placeholder="勾选或输入自定义工具名"
                  options={KNOWN_TOOLS.map((t) => ({ value: t, label: t }))}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="LLM 模型" name="llm_model">
                <Select
                  options={[
                    { value: 'default', label: '继承全局' },
                    { value: 'deepseek-chat', label: 'deepseek-chat' },
                    { value: 'deepseek-r1', label: 'deepseek-r1' },
                    { value: 'claude-4-sonnet', label: 'claude-4-sonnet' },
                    { value: 'claude-4-opus', label: 'claude-4-opus' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="递归上限" name="recursion_limit">
                <Input type="number" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="展示色 (画布)" name="color">
            <Input type="color" style={{ width: 80, height: 32 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
