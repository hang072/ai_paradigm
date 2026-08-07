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
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { SkillsApi } from '../../api/skills';
import type { SkillDef } from '../../types/skill';

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

// 与 fixtures/skills.ts 中出现过的分类保持一致,同时允许自定义
const KNOWN_CATEGORIES = ['文献', '写作', '分析', '医学', '通用'];
// 后端 tools 生态目前只有这三个(见 agents 页面),保持一致
const KNOWN_TOOLS = ['search_literature', 'verify_reference', 'search_kb'];

const DEFAULT_COLORS = [
  '#2b57d6',
  '#7c4dff',
  '#0891b2',
  '#16a34a',
  '#e08600',
  '#dc2626',
];

export default function SkillsPage() {
  const { message } = AntApp.useApp();
  const [list, setList] = useState<SkillDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SkillDef | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<SkillDef>();

  const refresh = () => {
    setLoading(true);
    SkillsApi.list()
      .then(setList)
      .catch((e: any) => message.error(e.message ?? '加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => {
    const s = new Set<string>(KNOWN_CATEGORIES);
    list.forEach((sk) => sk.category && s.add(sk.category));
    return Array.from(s);
  }, [list]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return list.filter((s) => {
      if (category && s.category !== category) return false;
      if (!k) return true;
      return (
        s.name.toLowerCase().includes(k) ||
        (s.description ?? '').toLowerCase().includes(k) ||
        (s.prompt_fragment ?? '').toLowerCase().includes(k) ||
        (s.suggested_tools ?? []).some((t) => t.toLowerCase().includes(k))
      );
    });
  }, [list, keyword, category]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      id: '',
      name: '',
      category: '通用',
      description: '',
      prompt_fragment: '',
      suggested_tools: [],
      color: DEFAULT_COLORS[0],
      builtin: false,
    });
    setModalOpen(true);
  };

  const openEdit = (s: SkillDef) => {
    setEditing(s);
    form.setFieldsValue({
      ...s,
      suggested_tools: s.suggested_tools ?? [],
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editing) {
        await SkillsApi.update(editing.id, values);
        message.success(`已更新 · ${values.name}`);
      } else {
        // 后端会忽略前端塞的 builtin,始终写 false
        await SkillsApi.create(values);
        message.success(`已创建 · ${values.name}`);
      }
      setModalOpen(false);
      refresh();
    } catch (e: any) {
      message.error(e.message ?? '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (s: SkillDef) => {
    try {
      await SkillsApi.remove(s.id);
      message.success('已删除');
      refresh();
    } catch (e: any) {
      message.error(e.message ?? '删除失败');
    }
  };

  return (
    <div>
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 16, display: 'flex', alignItems: 'center' }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            技能库
          </Title>
          <Text type="secondary">
            即插即用的能力模块 · 挂载到对话或专家后自动注入 system prompt
          </Text>
        </div>
        <Space>
          <Select
            allowClear
            placeholder="按分类筛选"
            style={{ width: 160 }}
            value={category}
            onChange={setCategory}
            options={categories.map((c) => ({ value: c, label: c }))}
          />
          <Input.Search
            placeholder="搜索技能 / 描述 / 工具…"
            allowClear
            style={{ width: 260 }}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建技能
          </Button>
        </Space>
      </div>

      {filtered.length === 0 && !loading ? (
        <Empty description={list.length === 0 ? '还没有技能,点击右上角新建' : '没有匹配项'} />
      ) : (
        <Row gutter={[16, 16]}>
          {filtered.map((s) => (
            <Col span={8} key={s.id}>
              <Card
                loading={loading}
                actions={[
                  <span onClick={() => openEdit(s)} key="edit">
                    <EditOutlined /> {s.builtin ? '查看' : '编辑'}
                  </span>,
                  s.builtin ? (
                    <span key="del" style={{ color: '#ccc' }}>
                      <DeleteOutlined /> 内置
                    </span>
                  ) : (
                    <Popconfirm
                      key="del"
                      title="确认删除该技能?"
                      description="删除后已挂载该技能的会话/专家不再生效。"
                      onConfirm={() => remove(s)}
                    >
                      <span style={{ color: '#dc2626' }}>
                        <DeleteOutlined /> 删除
                      </span>
                    </Popconfirm>
                  ),
                ]}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar
                    style={{ background: s.color || '#2b57d6' }}
                    icon={<ThunderboltOutlined />}
                    size={44}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</div>
                    <Space size={4} style={{ marginTop: 4 }}>
                      {s.builtin && <Tag color="blue">内置</Tag>}
                      {s.category && <Tag>{s.category}</Tag>}
                    </Space>
                  </div>
                </div>

                <Paragraph
                  type="secondary"
                  style={{
                    marginTop: 12,
                    marginBottom: 8,
                    fontSize: 12,
                    minHeight: 36,
                  }}
                  ellipsis={{ rows: 2 }}
                >
                  {s.description || '(无描述)'}
                </Paragraph>

                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    建议工具:
                  </Text>{' '}
                  {(!s.suggested_tools || s.suggested_tools.length === 0) ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      无
                    </Text>
                  ) : (
                    s.suggested_tools.map((t) => (
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
        title={
          editing
            ? `${editing.builtin ? '查看内置技能' : '编辑技能'} · ${editing.name}`
            : '新建技能'
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        width={720}
        okText="保存"
        // 内置技能后端已允许 PUT(见 backend/internal/api/skills.go),
        // 但产品语义上不建议改写,这里给禁用信号;想改的把下面 disable 去掉即可。
        okButtonProps={{ disabled: !!editing?.builtin }}
      >
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 12 }}
          disabled={!!editing?.builtin}
        >
          <Row gutter={12}>
            <Col span={14}>
              <Form.Item
                label="名称"
                name="name"
                rules={[{ required: true, message: '请输入名称' }]}
              >
                <Input placeholder="例:文献检索与解读" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                label="分类"
                name="category"
                rules={[{ required: true, message: '请选择或输入分类' }]}
              >
                <Select
                  showSearch
                  allowClear={false}
                  options={categories.map((c) => ({ value: c, label: c }))}
                  // 允许输入自定义分类
                  mode="tags"
                  maxCount={1}
                  onChange={(v) => {
                    // Select mode=tags 返回数组,取第一个
                    if (Array.isArray(v)) {
                      form.setFieldValue('category', v[0] ?? '');
                    }
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item label="展示色" name="color">
                <Input type="color" style={{ width: '100%', height: 32, padding: 2 }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="简介" name="description">
            <Input placeholder="一句话说明这个技能做什么" />
          </Form.Item>

          <Form.Item
            label="Prompt 片段(挂载后追加到 system prompt)"
            name="prompt_fragment"
            rules={[{ required: true, message: '请填写 prompt 片段' }]}
            extra="示例:『当涉及医学论断时,主动调用 search_literature 检索原始文献,并给出引用来源。』"
          >
            <TextArea rows={6} placeholder="你在被激活时的行为约束……" />
          </Form.Item>

          <Form.Item
            label="建议工具"
            name="suggested_tools"
            extra="下拉预设 + 可自由输入。前端暂不自动带上,提示用户手动勾。"
          >
            <Select
              mode="tags"
              placeholder="选择或输入工具名"
              options={KNOWN_TOOLS.map((t) => ({ value: t, label: t }))}
            />
          </Form.Item>

          {editing?.builtin && (
            <Text type="warning" style={{ fontSize: 12 }}>
              内置技能不可修改,若要定制请复制成新的技能。
            </Text>
          )}
        </Form>
      </Modal>
    </div>
  );
}
