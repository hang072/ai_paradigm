import { useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
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
  Tooltip,
  Typography,
} from 'antd';
import {
  BookOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  LinkOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { KnowledgeApi } from '../../api/knowledge';
import type {
  KbDocType,
  KbSearchHit,
  KnowledgeBase,
  KnowledgeDoc,
} from '../../types/knowledge';
import { MarkdownView } from '../../components/MarkdownView';
import { fromNow } from '../../utils/time';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

/**
 * 知识库管理页面。
 * 左侧:KB 列表(新建/删除,内置只读)
 * 右侧上:当前 KB 的文档列表(选中一篇展示 Markdown)
 * 右侧下:文档预览 / 编辑
 * 顶部搜索框:跨 KB 命中(供快速验证 search_kb 效果)
 */
export default function KnowledgePage() {
  const { message } = AntApp.useApp();
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [activeKbId, setActiveKbId] = useState<string | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [kbModalOpen, setKbModalOpen] = useState(false);
  const [editingKb, setEditingKb] = useState<KnowledgeBase | null>(null);
  const [kbForm] = Form.useForm();

  const [docModalOpen, setDocModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<KnowledgeDoc | null>(null);
  const [docForm] = Form.useForm();

  const [searchTerm, setSearchTerm] = useState('');
  const [searchHits, setSearchHits] = useState<KbSearchHit[] | null>(null);

  const refresh = () => {
    setLoading(true);
    KnowledgeApi.list()
      .then((list) => {
        setKbs(list);
        if (list.length && !list.find((k) => k.id === activeKbId)) {
          setActiveKbId(list[0].id);
          setActiveDocId(list[0].docs[0]?.id ?? null);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeKb = useMemo(
    () => kbs.find((k) => k.id === activeKbId) ?? null,
    [kbs, activeKbId],
  );
  const activeDoc = useMemo(
    () => activeKb?.docs.find((d) => d.id === activeDocId) ?? null,
    [activeKb, activeDocId],
  );

  /* --- KB CRUD --- */
  const openCreateKb = () => {
    setEditingKb(null);
    kbForm.resetFields();
    kbForm.setFieldsValue({ name: '', description: '', color: '#2b57d6' });
    setKbModalOpen(true);
  };
  const openEditKb = (kb: KnowledgeBase) => {
    setEditingKb(kb);
    kbForm.setFieldsValue({ name: kb.name, description: kb.description, color: kb.color });
    setKbModalOpen(true);
  };
  const submitKb = async () => {
    const v = await kbForm.validateFields();
    if (editingKb) {
      await KnowledgeApi.update(editingKb.id, v);
      message.success('已更新知识库');
    } else {
      const created = await KnowledgeApi.create(v);
      message.success('已创建知识库');
      setActiveKbId(created.id);
    }
    setKbModalOpen(false);
    refresh();
  };
  const removeKb = async (kb: KnowledgeBase) => {
    try {
      await KnowledgeApi.remove(kb.id);
      message.success('已删除');
      if (activeKbId === kb.id) {
        setActiveKbId(null);
        setActiveDocId(null);
      }
      refresh();
    } catch (e: any) {
      message.error(e.message ?? '删除失败');
    }
  };

  /* --- Doc CRUD --- */
  const openCreateDoc = () => {
    if (!activeKb) return;
    setEditingDoc(null);
    docForm.resetFields();
    docForm.setFieldsValue({
      title: '',
      type: 'markdown' as KbDocType,
      tags: [],
      content: '',
      url: '',
    });
    setDocModalOpen(true);
  };
  const openEditDoc = (doc: KnowledgeDoc) => {
    setEditingDoc(doc);
    docForm.setFieldsValue({
      title: doc.title,
      type: doc.type,
      tags: doc.tags,
      content: doc.content,
      url: doc.url ?? '',
    });
    setDocModalOpen(true);
  };
  const submitDoc = async () => {
    if (!activeKb) return;
    const v = await docForm.validateFields();
    if (editingDoc) {
      await KnowledgeApi.updateDoc(activeKb.id, editingDoc.id, v);
      message.success('已更新文档');
    } else {
      const created = await KnowledgeApi.addDoc(activeKb.id, v);
      message.success('已新增文档');
      setActiveDocId(created.id);
    }
    setDocModalOpen(false);
    refresh();
  };
  const removeDoc = async (doc: KnowledgeDoc) => {
    if (!activeKb) return;
    await KnowledgeApi.removeDoc(activeKb.id, doc.id);
    message.success('已删除');
    if (activeDocId === doc.id) setActiveDocId(null);
    refresh();
  };

  /* --- 检索 --- */
  const doSearch = async () => {
    const q = searchTerm.trim();
    if (!q) {
      setSearchHits(null);
      return;
    }
    const hits = await KnowledgeApi.search(q, []); // 空数组 = 全库
    setSearchHits(hits);
  };

  const docTypeIcon = (t: KbDocType) =>
    t === 'link' ? <LinkOutlined /> : <FileTextOutlined />;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 顶部标题 + 搜索 */}
      <Card size="small" bodyStyle={{ padding: '12px 16px' }}>
        <Row gutter={12} align="middle">
          <Col flex="none">
            <Title level={4} style={{ margin: 0 }}>
              <BookOutlined /> 知识库
            </Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              管理可被 search_kb 工具检索的私域知识 · 对话中挂载后自动生效
            </Text>
          </Col>
          <Col flex="auto" />
          <Col flex="none" style={{ minWidth: 340 }}>
            <Input.Search
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onSearch={doSearch}
              placeholder="跨知识库检索关键字…"
              enterButton={<SearchOutlined />}
              allowClear
              onClear={() => setSearchHits(null)}
            />
          </Col>
        </Row>
        {searchHits && (
          <div style={{ marginTop: 10 }}>
            <Text strong style={{ fontSize: 12 }}>
              命中 {searchHits.length} 条:
            </Text>
            {searchHits.length === 0 ? (
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                无结果
              </Text>
            ) : (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {searchHits.map((h) => (
                  <div
                    key={h.doc_id}
                    style={{
                      background: '#f8faff',
                      border: '1px solid #e3e8f0',
                      padding: '6px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      setActiveKbId(h.kb_id);
                      setActiveDocId(h.doc_id);
                      setSearchHits(null);
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                      <Tag color="blue" style={{ margin: 0 }}>
                        {h.kb_name}
                      </Tag>
                      <span style={{ marginLeft: 6 }}>{h.doc_title}</span>
                      <Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>
                        score {h.score}
                      </Text>
                    </div>
                    <div style={{ marginTop: 3, fontSize: 12, color: '#4a5568' }}>{h.snippet}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* 主体二栏 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '280px 1fr',
          gap: 12,
        }}
      >
        {/* 左:KB 列表 */}
        <Card
          size="small"
          title={
            <Space>
              <BookOutlined />
              <span>知识库</span>
              <Tag>{kbs.length}</Tag>
            </Space>
          }
          extra={
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreateKb}>
              新建
            </Button>
          }
          bodyStyle={{ padding: 0, overflow: 'auto', height: '100%' }}
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          {loading ? (
            <div style={{ padding: 12 }}>
              <Text type="secondary">加载中…</Text>
            </div>
          ) : kbs.length === 0 ? (
            <Empty description="暂无知识库" style={{ marginTop: 40 }} />
          ) : (
            kbs.map((kb) => {
              const active = kb.id === activeKbId;
              return (
                <div
                  key={kb.id}
                  onClick={() => {
                    setActiveKbId(kb.id);
                    setActiveDocId(kb.docs[0]?.id ?? null);
                  }}
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    background: active ? '#eef3ff' : undefined,
                    borderLeft: active ? `3px solid ${kb.color}` : '3px solid transparent',
                    borderBottom: '1px solid #f1f2f5',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: kb.color,
                      }}
                    />
                    <span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0 }}>
                      {kb.name}
                    </span>
                    {kb.builtin && (
                      <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>
                        内置
                      </Tag>
                    )}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 11,
                      color: '#6b7a90',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {kb.description}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {kb.docs.length} 篇 · {fromNow(kb.updated_at)}
                    </Text>
                    <Space size={4}>
                      <Tooltip title="编辑">
                        <EditOutlined
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditKb(kb);
                          }}
                          style={{ color: '#2b57d6' }}
                        />
                      </Tooltip>
                      {!kb.builtin && (
                        <Popconfirm
                          title={`删除「${kb.name}」?`}
                          onConfirm={(e) => {
                            e?.stopPropagation();
                            removeKb(kb);
                          }}
                          onCancel={(e) => e?.stopPropagation()}
                        >
                          <DeleteOutlined
                            style={{ color: '#dc2626' }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </Popconfirm>
                      )}
                    </Space>
                  </div>
                </div>
              );
            })
          )}
        </Card>

        {/* 右:文档列表 + 预览 */}
        <div
          style={{
            minHeight: 0,
            display: 'grid',
            gridTemplateRows: '260px 1fr',
            gap: 12,
          }}
        >
          <Card
            size="small"
            title={
              <Space>
                <FileTextOutlined />
                <span>{activeKb ? activeKb.name + ' · 文档' : '文档'}</span>
                {activeKb && <Tag>{activeKb.docs.length}</Tag>}
              </Space>
            }
            extra={
              activeKb && (
                <Button
                  size="small"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={openCreateDoc}
                >
                  新增文档
                </Button>
              )
            }
            bodyStyle={{ padding: 0, overflow: 'auto', height: '100%' }}
          >
            {!activeKb ? (
              <Empty description="请选择一个知识库" style={{ marginTop: 40 }} />
            ) : activeKb.docs.length === 0 ? (
              <Empty description="尚无文档" style={{ marginTop: 40 }} />
            ) : (
              activeKb.docs.map((doc) => {
                const active = doc.id === activeDocId;
                return (
                  <div
                    key={doc.id}
                    onClick={() => setActiveDocId(doc.id)}
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      background: active ? '#f6f8fe' : undefined,
                      borderBottom: '1px solid #f1f2f5',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span style={{ color: '#6b7a90' }}>{docTypeIcon(doc.type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 13,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {doc.title}
                      </div>
                      <div style={{ marginTop: 2 }}>
                        {doc.tags.map((tg) => (
                          <Tag key={tg} style={{ margin: '0 4px 0 0', fontSize: 10 }}>
                            {tg}
                          </Tag>
                        ))}
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {fromNow(doc.updated_at)}
                        </Text>
                      </div>
                    </div>
                    <Space size={6}>
                      <Tooltip title="编辑">
                        <EditOutlined
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditDoc(doc);
                          }}
                          style={{ color: '#2b57d6' }}
                        />
                      </Tooltip>
                      <Popconfirm
                        title={`删除文档「${doc.title}」?`}
                        onConfirm={(e) => {
                          e?.stopPropagation();
                          removeDoc(doc);
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                      >
                        <DeleteOutlined
                          style={{ color: '#dc2626' }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Popconfirm>
                    </Space>
                  </div>
                );
              })
            )}
          </Card>

          <Card
            size="small"
            title={
              activeDoc ? (
                <Space>
                  {docTypeIcon(activeDoc.type)}
                  <span>{activeDoc.title}</span>
                  {activeDoc.tags.map((tg) => (
                    <Tag key={tg} style={{ margin: 0 }}>
                      {tg}
                    </Tag>
                  ))}
                </Space>
              ) : (
                '文档预览'
              )
            }
            extra={
              activeDoc && (
                <Space size={4}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    更新于 {activeDoc.updated_at}
                  </Text>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEditDoc(activeDoc)}>
                    编辑
                  </Button>
                </Space>
              )
            }
            bodyStyle={{ overflow: 'auto', height: '100%', padding: 16 }}
          >
            {!activeDoc ? (
              <Empty description="选择一篇文档以预览" style={{ marginTop: 60 }} />
            ) : activeDoc.type === 'link' ? (
              <div>
                <Paragraph>
                  <LinkOutlined /> 外链:
                  <a href={activeDoc.url} target="_blank" rel="noreferrer">
                    {activeDoc.url}
                  </a>
                </Paragraph>
                <MarkdownView text={activeDoc.content} />
              </div>
            ) : (
              <MarkdownView text={activeDoc.content} />
            )}
          </Card>
        </div>
      </div>

      {/* KB 弹窗 */}
      <Modal
        open={kbModalOpen}
        title={editingKb ? '编辑知识库' : '新建知识库'}
        onCancel={() => setKbModalOpen(false)}
        onOk={submitKb}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={kbForm} layout="vertical" preserve={false}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请填写名称' }]}>
            <Input placeholder="如:临床指南库" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="简短说明该知识库的用途/覆盖范围" />
          </Form.Item>
          <Form.Item name="color" label="展示色">
            <Input placeholder="#2b57d6" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Doc 弹窗 */}
      <Modal
        open={docModalOpen}
        title={editingDoc ? '编辑文档' : '新增文档'}
        onCancel={() => setDocModalOpen(false)}
        onOk={submitDoc}
        okText="保存"
        cancelText="取消"
        width={720}
        destroyOnClose
      >
        <Form form={docForm} layout="vertical" preserve={false}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请填写标题' }]}>
            <Input placeholder="如:ESC 2023 心衰指南要点" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="type" label="类型" initialValue="markdown">
                <Select
                  options={[
                    { value: 'markdown', label: 'Markdown 文档' },
                    { value: 'text', label: '纯文本' },
                    { value: 'link', label: '外部链接' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="tags" label="标签(逗号分隔或回车分隔)">
                <Select mode="tags" placeholder="添加标签,回车确认" tokenSeparators={[',', ',']} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="url" label="URL(仅链接类型)">
            <Input placeholder="https://…" />
          </Form.Item>
          <Form.Item name="content" label="正文(Markdown / 摘要)">
            <TextArea rows={12} placeholder="正文内容,支持 Markdown。链接类型可填摘要。" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
