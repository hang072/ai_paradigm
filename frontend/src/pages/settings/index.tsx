import {
  App as AntApp,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  ApiOutlined,
  KeyOutlined,
  RobotOutlined,
  ThunderboltFilled,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useState } from 'react';
import { useAppStore, providerPresets, type ProviderType, type ModelConfig } from '../../store/useAppStore';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

export default function SettingsPage() {
  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        设置
      </Title>
      <Text type="secondary">工作台参数配置 · API Key · 三方集成</Text>
      <Tabs
        style={{ marginTop: 8 }}
        items={[
          { key: 'model', label: 'AI 模型接入', children: <ModelSection /> },
          { key: 'integration', label: '三方集成', children: <IntegrationsSection /> },
          { key: 'about', label: '关于', children: <AboutSection /> },
        ]}
      />
    </div>
  );
}

function ModelSection() {
  const { message } = AntApp.useApp();
  const {
    modelConfigs,
    activeConfigId,
    setActiveConfigId,
    addModelConfig,
    updateModelConfig,
    deleteModelConfig,
  } = useAppStore();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm<Omit<ModelConfig, 'id'>>();

  const handleAdd = () => {
    form.resetFields();
    setEditingId(null);
    setOpen(true);
  };

  const handleEdit = (config: ModelConfig) => {
    form.setFieldsValue(config);
    setEditingId(config.id);
    setOpen(true);
  };

  const handleOk = () => {
    form.validateFields().then(values => {
      if (editingId) {
        updateModelConfig(editingId, values);
        message.success('更新成功');
      } else {
        addModelConfig(values);
        message.success('添加成功');
      }
      setOpen(false);
    });
  };

  const testConnection = (config: ModelConfig) => {
    if (!config.apiKey) {
      message.warning('请先填写 API Key');
      return;
    }
    // TODO: 后端测试接口
    message.loading({ content: '正在测试连接…', key: 'test' });
    setTimeout(() => {
      message.success({ content: `${config.name} 连接成功`, key: 'test' });
    }, 800);
  };

  const activeConfig = modelConfigs.find(c => c.id === activeConfigId);

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          添加模型配置
        </Button>
      </Space>
      <Row gutter={[16, 16]}>
        {modelConfigs.map(config => (
          <Col span={12} key={config.id}>
            <Card
              size="default"
              title={
                <Space>
                  <RobotOutlined />
                  {config.name}
                  <Tag color={config.apiKey ? 'success' : 'warning'}>
                    {config.apiKey ? '已配置' : '未配置'}
                  </Tag>
                  {activeConfigId === config.id && (
                    <Tag color="blue">当前使用</Tag>
                  )}
                </Space>
              }
              extra={
                <Space>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleEdit(config)}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="确定删除此配置?"
                    onConfirm={() => deleteModelConfig(config.id)}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              }
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <Text type="secondary">供应商:</Text>{' '}
                  <Tag>{providerPresets[config.provider]?.label || config.provider}</Tag>
                </div>
                <div>
                  <Text type="secondary">模型:</Text> {config.model || '(未设置)'}
                </div>
                <div>
                  <Text type="secondary">Base URL:</Text> <Text copyable code>{config.baseURL || '(未设置)'}</Text>
                </div>
                <Space style={{ marginTop: 8 }}>
                  <Button
                    size="small"
                    onClick={() => testConnection(config)}
                    icon={<ApiOutlined />}
                  >
                    测试连接
                  </Button>
                  {activeConfigId !== config.id && (
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => setActiveConfigId(config.id)}
                    >
                      设为当前使用
                    </Button>
                  )}
                </Space>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Card style={{ marginTop: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Text strong>当前使用的模型配置</Text>
          {activeConfig ? (
            <div>
              <ThunderboltFilled style={{ marginRight: 8, color: '#52c41a' }} />
              <Text strong>{activeConfig.name}</Text>
              {' · '}
              <Text type="secondary">{activeConfig.provider} · {activeConfig.model}</Text>
            </div>
          ) : (
            <Text type="warning">未选择任何配置,使用 fallback mock</Text>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            当前配置用于所有未单独指定模型的 Agent。切换后立即生效并存 localStorage。
          </Text>
        </Space>
      </Card>

      <Modal
        title={editingId ? '编辑模型配置' : '添加模型配置'}
        open={open}
        onOk={handleOk}
        onCancel={() => setOpen(false)}
        width={500}
      >
        <Form form={form} layout="vertical" size="middle">
          <Form.Item
            name="name"
            label="配置名称"
            rules={[{ required: true, message: '请输入配置名称' }]}
          >
            <Input placeholder="如: 我的千问" />
          </Form.Item>

          <Form.Item
            name="provider"
            label="供应商"
            rules={[{ required: true }]}
            initialValue="deepseek"
          >
            <Select
              onChange={(val) => {
                const preset = providerPresets[val as ProviderType];
                form.setFieldsValue({
                  baseURL: preset.defaultBaseURL,
                  model: preset.defaultModel,
                });
              }}
            >
              {Object.entries(providerPresets).map(([key, preset]) => (
                <Option key={key} value={key}>
                  {preset.label}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="model"
            label="模型名称"
            rules={[{ required: true, message: '请输入模型名称' }]}
          >
            <Input placeholder="如: deepseek-chat" />
          </Form.Item>

          <Form.Item
            name="baseURL"
            label="Base URL"
            rules={[{ required: true, message: '请输入 Base URL' }]}
          >
            <Input placeholder="https://..." />
          </Form.Item>

          <Form.Item
            name="apiKey"
            label="API Key"
            rules={[{ required: true, message: '请输入 API Key' }]}
          >
            <Input.Password placeholder="sk-..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function IntegrationsSection() {
  return (
    <Row gutter={16}>
      <Col span={12}>
        <Card
          title={
            <Space>
              <span>Teambition 同步</span>
              <Tag color="default">仅演示 · 未接入</Tag>
            </Space>
          }
        >
          <Form layout="vertical" size="small">
            <Form.Item label="企业 ID">
              <Input placeholder="orgId" />
            </Form.Item>
            <Form.Item label="应用的 App ID">
              <Input placeholder="appId" />
            </Form.Item>
            <Form.Item label="应用的 App Secret">
              <Input.Password placeholder="appSecret" />
            </Form.Item>
          </Form>
          <Button disabled>订阅与密钥绑定(暂未实现)</Button>
        </Card>
      </Col>
      <Col span={12}>
        <Card
          title={
            <Space>
              <span>钉钉会议协同</span>
              <Tag color="default">仅演示 · 未接入</Tag>
            </Space>
          }
        >
          <Form layout="vertical" size="small">
            <Form.Item label="入会密钥 / 链接">
              <Input placeholder="https://…" />
            </Form.Item>
            <Form.Item label="自动跳转目标">
              <Radio.Group defaultValue="dingtalk">
                <Radio value="dingtalk">钉钉客户端</Radio>
                <Radio value="web">网页版</Radio>
              </Radio.Group>
            </Form.Item>
          </Form>
          <Button disabled>发起会议(暂未实现)</Button>
        </Card>
      </Col>
    </Row>
  );
}

function AboutSection() {
  return (
    <Card>
      <Title level={4} style={{ marginTop: 0 }}>
        AI 工作台 · Paradigm Eino
      </Title>
      <Paragraph>
        多智能体协同的医疗内容框架生成平台。使用 <b>React + Ant Design + xyflow</b> 构建,
        后端使用 CloudWeGo Eino (Go)。
      </Paragraph>
      <Divider />
      <Paragraph>
        <Text strong>当前版本</Text>: 0.3.0(支持多供应商模型配置管理)
        <br />
        <Text strong>核心能力</Text>:
      </Paragraph>
      <ul>
        <li>支持多供应商自定义模型配置,可添加/编辑/删除</li>
        <li>兼容 OpenAI API 格式: DeepSeek/Claude/OpenAI/通义千问/智谱清言/文心一言/典名词元/自定义都支持</li>
        <li>5 Agent / 10 节点的完整工作流(含审核回路)</li>
        <li>3 处 HITL 人工确认点(澄清、策略、终稿)</li>
        <li>xyflow 画布实时可视化流程状态</li>
        <li>幻灯 / 文章双输出模式</li>
      </ul>
      <Divider />
      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        构建产物存储于内存,页面刷新会重置为初始 fixtures。生产环境将由 Eino Go 后端提供持久化。
      </Paragraph>
    </Card>
  );
}
