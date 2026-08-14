import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import {
  BookOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  InboxOutlined,
  LinkOutlined,
  LoadingOutlined,
  PlusOutlined,
  ProfileOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { KnowledgeApi, type BatchPrecheckResp } from '../../api/knowledge';
import type {
  DocStructure,
  KbDocType,
  KbSearchHit,
  KnowledgeBase,
  KnowledgeDoc,
} from '../../types/knowledge';
import { MarkdownView } from '../../components/MarkdownView';
import { fromNow } from '../../utils/time';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// 阶段 5:Mock 模式检测 —— VITE_USE_MOCK !== 'false' 时走 mock 引擎。
// Mock 不实现文件上传,UI 需要隐藏 Tab 并提示。
const isMock = import.meta.env.VITE_USE_MOCK !== 'false';

// 单文件硬上限 64 MiB(与后端 ParseMultipartForm 一致)。
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
// 允许的扩展名(后端 parser.ForExt 也认这些,大小写不敏感)。
const UPLOAD_EXT_RE = /\.(md|markdown|pdf|docx)$/i;

/**
 * 知识库管理页面。
 * 左侧:KB 列表(新建/删除,内置只读)
 * 右侧上:当前 KB 的文档列表 + 配额进度条(选中一篇展示 Markdown)
 * 右侧下:文档预览 / 编辑
 * 顶部搜索框:跨 KB 命中(供快速验证 search_kb 效果)
 *
 * 阶段 5:新增本地文件上传(md / pdf / docx)到 KB;mock 模式不显示该 Tab。
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

  // 阶段 5:弹窗内"文本编辑" / "上传文件"两 Tab
  const [docTab, setDocTab] = useState<'text' | 'upload'>('text');

  // P84: 单 doc 嵌入状态 — 字典形式让每个 doc row 各自显示状态 badge。
  // 'idle' = 未开始 / 'pending' = 已入队 / 'parsing' = 后台解析中
  // 'ready' = 成功 / 'failed' = 失败(hover 显示 err)
  const [embedStatus, setEmbedStatus] = useState<
    Record<string, { status: 'idle' | 'pending' | 'parsing' | 'ready' | 'failed'; error?: string }>
  >({});

  // P84: 当前打开的 SSE 连接(单 doc),用于切 doc 时 close 旧的
  const embedStreamRef = useRef<EventSource | null>(null);

  // 阶段 5 续 5: 文档结构化(sidecar)查看弹窗
  const [structureOpen, setStructureOpen] = useState(false);
  const [structure, setStructure] = useState<DocStructure | null>(null);
  const [structureLoading, setStructureLoading] = useState(false);
  const openDocStructure = async (docId: string) => {
    setStructureOpen(true);
    setStructureLoading(true);
    try {
      const ds = await KnowledgeApi.getDocStructure(docId);
      setStructure(ds);
    } catch (e: any) {
      message.error(e?.response?.data?.detail ?? e?.message ?? '加载结构失败');
      setStructure(null);
    } finally {
      setStructureLoading(false);
    }
  };

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

  // P84: 卸载 / 切 KB 时关 SSE, 防止 EventSource 泄漏。
  useEffect(() => {
    return () => {
      if (embedStreamRef.current) {
        embedStreamRef.current.close();
        embedStreamRef.current = null;
      }
    };
  }, []);

  const activeKb = useMemo(
    () => kbs.find((k) => k.id === activeKbId) ?? null,
    [kbs, activeKbId],
  );
  const activeDoc = useMemo(
    () => activeKb?.docs.find((d) => d.id === activeDocId) ?? null,
    [activeKb, activeDocId],
  );

  // 阶段 5:配额派生 —— SUM(doc.size_bytes) vs kb.quota_bytes(默认 1 GiB)
  const usageBytes = useMemo(
    () => (activeKb?.docs ?? []).reduce((s, d) => s + (d.size_bytes ?? 0), 0),
    [activeKb],
  );
  const quotaBytes = activeKb?.quota_bytes ?? 1 << 30;
  const usagePct = quotaBytes > 0 ? Math.min(100, (usageBytes / quotaBytes) * 100) : 0;
  const usageColor = usagePct < 70 ? '#52c41a' : usagePct < 90 ? '#faad14' : '#ff4d4f';

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
  const reembedKb = async (kb: KnowledgeBase) => {
    try {
      const r = await KnowledgeApi.reembedKB(kb.id);
      message.success(`已入队 ${r.queued} 个 doc,后台向量化中`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail ?? e?.message ?? '入队失败');
    }
  };

  // P84: 单 doc 重新向量化(点行内的"闪电"图标触发)。
  // 流程:1) 后端先清 Milvus 旧 chunks 再入队 2) 返 200 + { status: 'pending' }
  // 3) 前端开 EventSource 监听 SSE, 收到 ready/failed 自动断。
  // 失败时 message.error + 把状态写回 idle(下次可再点)。
  const reembedDoc = async (doc: KnowledgeDoc) => {
    if (!activeKb) return;
    if (doc.type === 'link') {
      message.warning('链接类型无内容可向量化');
      return;
    }
    // 关旧 SSE(若有)
    if (embedStreamRef.current) {
      embedStreamRef.current.close();
      embedStreamRef.current = null;
    }
    setEmbedStatus((s) => ({ ...s, [doc.id]: { status: 'pending' } }));
    try {
      await KnowledgeApi.reembedDoc(activeKb.id, doc.id);
    } catch (e: any) {
      setEmbedStatus((s) => ({ ...s, [doc.id]: { status: 'failed', error: e?.response?.data?.detail ?? e?.message ?? '入队失败' } }));
      message.error(e?.response?.data?.detail ?? e?.message ?? '入队失败');
      return;
    }
    // 开 SSE 监听
    const es = KnowledgeApi.openEmbedStatusStream(activeKb.id, doc.id);
    embedStreamRef.current = es;
    es.addEventListener('parsing', () => {
      setEmbedStatus((s) => ({ ...s, [doc.id]: { status: 'parsing' } }));
    });
    es.addEventListener('ready', (ev: MessageEvent) => {
      // ready data: { status: 'ready', chunk_n: N }
      setEmbedStatus((s) => ({ ...s, [doc.id]: { status: 'ready' } }));
      es.close();
      embedStreamRef.current = null;
      message.success(`「${doc.title}」已就绪`);
      refresh(); // ready 后从 server 拉一次新 kb(更新 KB 状态)
    });
    es.addEventListener('failed', (ev: MessageEvent) => {
      let err = '嵌入失败';
      try {
        const data = JSON.parse(ev.data);
        if (data?.error) err = data.error;
      } catch {}
      setEmbedStatus((s) => ({ ...s, [doc.id]: { status: 'failed', error: err } }));
      es.close();
      embedStreamRef.current = null;
      message.error(`「${doc.title}」${err}`);
    });
    es.onerror = () => {
      // 静默: SSE 后端 ready/failed 终态会主动断; 这里通常是被 server 提前关;
      // 用户未收到 ready/failed 时, 状态保持 pending, 下次 refresh 会从 KB 读真实态。
    };
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
    setDocTab('text');
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
    // 编辑时只走"文本编辑" Tab;上传类型的 doc 改标题也会清掉 blob(后端 cascade)
    setDocTab('text');
    docForm.setFieldsValue({
      title: doc.title,
      type: doc.type,
      tags: doc.tags,
      content: doc.content,
      url: doc.url ?? '',
    });
    setDocModalOpen(true);
  };
  const closeDocModal = () => {
    setDocModalOpen(false);
  };
  const submitDoc = async () => {
    if (!activeKb) return;

    // 阶段 5 续:上传分支 —— 批量上传由 UploadForm 内部管"开始预检 / 确认上传"按钮,
    // 这里只处理"用户已上传完成,刷新列表"的兜底(实际由 UploadForm 的 onSuccess 触发)。
    // 文本编辑分支继续走原 docForm 校验路径。
    if (!editingDoc && docTab === 'upload') {
      // UploadForm 内部完成上传后,会回调 onSuccess 让父组件关弹窗 + refresh。
      // 这里不应到达 —— UploadForm 的"确认上传"按钮在 UploadForm 自己里就调 API,
      // 完成后 onSuccess 触发,父组件弹窗已关。
      message.info('请在弹窗内点击"确认上传"完成操作');
      return;
    }

    const v = await docForm.validateFields();
    if (editingDoc) {
      await KnowledgeApi.updateDoc(activeKb.id, editingDoc.id, v);
      message.success('已更新文档');
    } else {
      const created = await KnowledgeApi.addDoc(activeKb.id, v);
      message.success('已新增文档');
      setActiveDocId(created.id);
    }
    closeDocModal();
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
                      {h.location && (
                        <Tag color="purple" style={{ margin: '0 0 0 6px', fontSize: 11 }}>
                          {h.location}
                        </Tag>
                      )}
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
                      <Tooltip title="重新向量化(把所有 doc 入队 Milvus)">
                        <ThunderboltOutlined
                          onClick={(e) => {
                            e.stopPropagation();
                            reembedKb(kb);
                          }}
                          style={{ color: '#7c3aed' }}
                        />
                      </Tooltip>
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
            {/* 阶段 5:配额进度条 + Mock 模式提示 */}
            {activeKb && (
              <div
                style={{
                  padding: '10px 12px 6px 12px',
                  borderBottom: '1px solid #f1f2f5',
                }}
              >
                <Progress
                  percent={Number(usagePct.toFixed(1))}
                  strokeColor={usageColor}
                  size="small"
                  showInfo
                  format={() =>
                    `已用 ${(usageBytes / (1 << 20)).toFixed(1)} MB / ${(quotaBytes / (1 << 20)).toFixed(0)} MB`
                  }
                />
              </div>
            )}
            {activeKb && isMock && (
              <Alert
                type="info"
                showIcon
                style={{ margin: '0 12px 8px 12px' }}
                message="文档上传功能需要连接真实后端 (VITE_USE_MOCK=false)"
              />
            )}
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
                        {/* P84: 嵌入状态 badge — 实时反映 SSE 推送的 pending/parsing/ready/failed */}
                        {(() => {
                          const st = embedStatus[doc.id];
                          if (!st || st.status === 'idle') return null;
                          if (st.status === 'pending' || st.status === 'parsing') {
                            return (
                              <Tag color="processing" style={{ marginLeft: 6, fontSize: 10 }}>
                                <LoadingOutlined spin /> {st.status === 'parsing' ? '解析中' : '排队中'}
                              </Tag>
                            );
                          }
                          if (st.status === 'ready') {
                            return (
                              <Tag color="success" style={{ marginLeft: 6, fontSize: 10 }}>
                                就绪
                              </Tag>
                            );
                          }
                          if (st.status === 'failed') {
                            return (
                              <Tooltip title={st.error ?? '嵌入失败'}>
                                <Tag color="error" style={{ marginLeft: 6, fontSize: 10 }}>
                                  失败
                                </Tag>
                              </Tooltip>
                            );
                          }
                          return null;
                        })()}
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
                      {/* P84: 重新向量化按钮 — 单 doc 级别, 失败文档可点击重试 */}
                      {doc.type !== 'link' && (
                        <Tooltip title="重新向量化">
                          <ThunderboltOutlined
                            onClick={(e) => {
                              e.stopPropagation();
                              reembedDoc(doc);
                            }}
                            style={{
                              color:
                                embedStatus[doc.id]?.status === 'failed' ? '#dc2626' : '#fa8c16',
                            }}
                          />
                        </Tooltip>
                      )}
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
                        description="会同时删除 Milvus 向量与原始文件"
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
                  {activeDoc.source === 'upload' && activeKb && (
                    <Tooltip title="下载原始文件">
                      <Button
                        size="small"
                        icon={<DownloadOutlined />}
                        href={KnowledgeApi.getDocBlobUrl(activeKb.id, activeDoc.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        下载原始文件
                      </Button>
                    </Tooltip>
                  )}
                  {/* 阶段 5 续 5: 多模态结构化(sidecar)查看弹窗 */}
                  {activeDoc.type === 'upload' && (
                    <Tooltip title="查看结构(表格 / 公式 / 图 caption)">
                      <Button
                        size="small"
                        icon={<ProfileOutlined />}
                        onClick={() => openDocStructure(activeDoc.id)}
                      >
                        查看结构
                      </Button>
                    </Tooltip>
                  )}
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
        onCancel={closeDocModal}
        onOk={submitDoc}
        okText="保存"
        cancelText="取消"
        width={720}
        destroyOnClose
      >
        {!editingDoc && !isMock ? (
          <Tabs
            activeKey={docTab}
            onChange={(k) => setDocTab(k as 'text' | 'upload')}
            items={[
              {
                key: 'text',
                label: (
                  <span>
                    <FileTextOutlined /> 文本编辑
                  </span>
                ),
                children: (
                  <Form form={docForm} layout="vertical" preserve={false}>
                    <Form.Item
                      name="title"
                      label="标题"
                      rules={[{ required: true, message: '请填写标题' }]}
                    >
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
                          <Select
                            mode="tags"
                            placeholder="添加标签,回车确认"
                            tokenSeparators={[',', ',']}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item name="url" label="URL(仅链接类型)">
                      <Input placeholder="https://…" />
                    </Form.Item>
                    <Form.Item name="content" label="正文(Markdown / 摘要)">
                      <TextArea
                        rows={12}
                        placeholder="正文内容,支持 Markdown。链接类型可填摘要。"
                      />
                    </Form.Item>
                  </Form>
                ),
              },
              {
                key: 'upload',
                label: (
                  <span>
                    <CloudUploadOutlined /> 上传文件
                  </span>
                ),
                children: activeKb ? (
                  <UploadForm
                    kbId={activeKb.id}
                    message={message}
                    onSuccess={() => {
                      // 父组件:上传成功后关弹窗 + 刷新列表
                      setActiveDocId(null);
                      closeDocModal();
                      refresh();
                    }}
                  />
                ) : null,
              },
            ]}
          />
        ) : (
          // 编辑模式 或 mock 模式:只走文本编辑
          <Form form={docForm} layout="vertical" preserve={false}>
            <Form.Item
              name="title"
              label="标题"
              rules={[{ required: true, message: '请填写标题' }]}
            >
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
                      { value: 'upload', label: '已上传文件' },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col span={16}>
                <Form.Item name="tags" label="标签(逗号分隔或回车分隔)">
                  <Select
                    mode="tags"
                    placeholder="添加标签,回车确认"
                    tokenSeparators={[',', ',']}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="url" label="URL(仅链接类型)">
              <Input placeholder="https://…" />
            </Form.Item>
            <Form.Item name="content" label="正文(Markdown / 摘要)">
              <TextArea
                rows={12}
                placeholder="正文内容,支持 Markdown。链接类型可填摘要。"
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* 阶段 5 续 5: 文档结构化(sidecar)查看弹窗 */}
      <Modal
        open={structureOpen}
        title={
          structure
            ? `结构化抽取 — ${structure.pages_n} 页 / ${structure.structure.pages.reduce((n, p) => n + p.blocks.length, 0)} blocks`
            : '结构化抽取'
        }
        onCancel={() => setStructureOpen(false)}
        footer={<Button onClick={() => setStructureOpen(false)}>关闭</Button>}
        width={720}
        destroyOnClose
      >
        {structureLoading ? (
          <Text type="secondary">加载中…</Text>
        ) : !structure ? (
          <Text type="secondary">无结构数据</Text>
        ) : (
          <div style={{ maxHeight: 480, overflow: 'auto' }}>
            {/* 合并后的表格 */}
            {structure.structure.merged_tables?.map((t, i) => (
              <Card
                key={`t${i}`}
                size="small"
                title={`表格 ${i + 1} (跨页 ${t.source_pages.join('+')})`}
                style={{ marginBottom: 12 }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {t.header.map((h, hi) => (
                        <th
                          key={hi}
                          style={{
                            border: '1px solid #d9d9d9',
                            padding: '4px 8px',
                            background: '#fafafa',
                            textAlign: 'left',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r, ri) => (
                      <tr key={ri}>
                        {r.map((c, ci) => (
                          <td
                            key={ci}
                            style={{ border: '1px solid #d9d9d9', padding: '4px 8px' }}
                          >
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}

            {/* 公式 (LaTeX) */}
            {structure.structure.pages
              .flatMap((p) => p.blocks)
              .filter((b) => b.type === 'formula' && b.latex)
              .map((b, i) => (
                <Card key={`f${i}`} size="small" title={`公式 ${i + 1}`} style={{ marginBottom: 12 }}>
                  <pre style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, margin: 0 }}>
                    {b.latex}
                  </pre>
                </Card>
              ))}

            {/* 图 caption + 抽出图(P85) */}
            {structure.structure.pages
              .flatMap((p) => p.blocks)
              .filter((b) => b.type === 'figure' && b.caption)
              .map((b, i) => {
                // 按 page_nr + idx 找抽出的图(可能 sidecar 缺图, 走 caption-only fallback)
                const matchedImg = structure.images?.find(
                  (img) => img.page_nr === (b as any).page_nr,
                );
                return (
                  <Card key={`c${i}`} size="small" title={`图 ${i + 1}`} style={{ marginBottom: 12 }}>
                    {matchedImg ? (
                      <div>
                        <a
                          href={KnowledgeApi.getDocImageUrl(structure.kb_id, structure.doc_id, matchedImg.filename)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            src={KnowledgeApi.getDocImageUrl(structure.kb_id, structure.doc_id, matchedImg.filename)}
                            alt={b.caption}
                            style={{
                              maxWidth: '100%',
                              maxHeight: 320,
                              borderRadius: 4,
                              border: '1px solid #e8e8e8',
                              cursor: 'zoom-in',
                            }}
                          />
                        </a>
                        <div style={{ marginTop: 6, fontSize: 11, color: '#999' }}>
                          {matchedImg.width}×{matchedImg.height} · {(matchedImg.byte_size / 1024).toFixed(1)} KB · {matchedImg.filename}
                        </div>
                      </div>
                    ) : (
                      <Text type="secondary">[原图未提取] </Text>
                    )}
                    <div style={{ marginTop: matchedImg ? 8 : 0 }}>
                      <Text>{b.caption}</Text>
                    </div>
                  </Card>
                );
              })}

            {/* 兜底: 全部 markdown 拼起来 */}
            {structure.structure.pages
              .flatMap((p) => p.blocks)
              .filter((b) => b.type === 'text' || b.type === 'title' || b.type === 'list')
              .length === 0 && (
                <Text type="secondary">纯文本见 KB 内容字段</Text>
              )}
          </div>
        )}
      </Modal>
    </div>
  );
}

/**
 * 批量上传文件子组件 —— Dragger(多选) + 三阶段状态机。
 *
 * 阶段:picking → prechecked → uploading
 *   - picking     : 选文件,本地累计"已选"列表(可剔除)
 *   - prechecked  : 调 precheckUpload 拿 verdict,把每文件标 ready/failed;
 *                   有任何 failed → "确认上传"按钮 disabled,用户可剔除失败项
 *   - uploading   : 调 uploadDocs 上传通过项;显示聚合进度条;
 *                   整批成功后回调 onSuccess 让父组件关弹窗 + refresh
 */
type FileItemStatus = 'pending' | 'ready' | 'failed' | 'uploading' | 'success';
type FileItem = {
  uid: string;
  file: File;
  status: FileItemStatus;
  reason?: string;
  ext?: string;
};

const UPLOAD_BATCH_LIMIT = 20; // 与后端 uploadBatchMaxFiles 保持一致

// 阶段 5 续 2:总上传量 > 50 MiB 走分片(session 路径),否则走快路径(uploadDocs)。
// 50 MiB 阈值 = 10 个 5 MiB chunk 内,网络抖动概率低,快路径简单够用。
const CHUNKED_THRESHOLD_BYTES = 50 * 1024 * 1024;

function UploadForm(props: {
  kbId: string;
  message: ReturnType<typeof AntApp.useApp>['message'];
  onSuccess: () => void;
}) {
  const [items, setItems] = useState<FileItem[]>([]);
  const [phase, setPhase] = useState<'picking' | 'prechecked' | 'uploading' | 'error'>('picking');
  const [precheck, setPrecheck] = useState<BatchPrecheckResp | null>(null);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [lastError, setLastError] = useState<string | null>(null);
  // abortController:取消按钮触发 abort,所有进行中的 axios 请求 CanceledError。
  // 取消时同时调 abortUploadSession 清理服务端。
  const abortControllerRef = useRef<AbortController | null>(null);
  // sessionID:chunked 路径启动后保留 sid,以便 retry 时续传。
  const sessionIDRef = useRef<string | null>(null);
  // overLimitNotified:当用户拖超过 20 个文件时,只 toast 一次,后续静默忽略。
  // antd 的 beforeUpload 是逐文件调用,没办法一次看到 30 个,所以用 ref 去重。
  const overLimitNotified = useRef(false);

  const readyItems = items.filter((i) => i.status === 'ready');
  const failedItems = items.filter((i) => i.status === 'failed');
  const successItems = items.filter((i) => i.status === 'success');
  const readyTotalBytes = readyItems.reduce((s, i) => s + i.file.size, 0);
  const canConfirm = phase === 'prechecked' && failedItems.length === 0 && readyItems.length > 0;
  const progressPct =
    progress.total > 0 ? Math.min(100, (progress.loaded / progress.total) * 100) : 0;
  const willUseChunked = readyTotalBytes > CHUNKED_THRESHOLD_BYTES;

  // 选文件(支持多选)。阶段 5 续:选完即自动触发预检,不再需要"开始预检"按钮。
  const handleBeforeUpload = (file: File) => {
    if (!UPLOAD_EXT_RE.test(file.name)) {
      props.message.error(`"${file.name}": 仅支持 .md / .pdf / .docx`);
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      props.message.error(`"${file.name}": 单文件不能超过 ${MAX_UPLOAD_BYTES / (1 << 20)} MB`);
      return Upload.LIST_IGNORE;
    }
    if (items.length >= UPLOAD_BATCH_LIMIT) {
      // 第 21+ 个文件:只 toast 一次,后续静默忽略,避免连弹 N 个错
      if (!overLimitNotified.current) {
        overLimitNotified.current = true;
        props.message.warning(
          `单批最多 ${UPLOAD_BATCH_LIMIT} 个文件,超出部分已忽略(可分批上传)`,
        );
      }
      return Upload.LIST_IGNORE;
    }
    setItems((prev) => [
      ...prev,
      { uid: `${file.name}-${file.size}-${prev.length}`, file, status: 'pending' },
    ]);
    // 立刻触发预检 —— 用户选完文件不需要再点按钮
    // 延迟到下一拍:setItems 的更新在闭包里可能还是 stale,
    // 用 queueMicrotask 让 setItems 先落地,再读 items。
    queueMicrotask(() => {
      runPrecheck();
    });
    return false; // 阻止 antd 自动上传
  };

  // 剔除某项。如果之前已预检,自动重跑预检以同步 verdict 数组。
  const removeItem = (uid: string) => {
    setItems((prev) => {
      // items 降到上限内,允许下一批超额时再次 toast
      if (prev.length - 1 < UPLOAD_BATCH_LIMIT) {
        overLimitNotified.current = false;
      }
      return prev.filter((i) => i.uid !== uid);
    });
    if (phase === 'prechecked' || phase === 'uploading') {
      // 重新预检 —— 用新 items 列表。如果剔到 0 个,直接清回 picking。
      queueMicrotask(() => {
        if (items.length <= 1) {
          setPhase('picking');
          setPrecheck(null);
        } else {
          runPrecheck();
        }
      });
    }
  };

  // 调 precheckUpload,根据响应把每个文件标 ready/failed。
  // 可由 handleBeforeUpload / removeItem / "重新预检" 按钮触发。
  // 注:必须用函数式 setItems(prev => ...) 拿最新 items,不要闭包旧值。
  const runPrecheck = async () => {
    // 取当前 items 快照(用 ref-style 写法:用 setState 回调拿 prev 值)
    let snapshot: FileItem[] = [];
    setItems((prev) => {
      snapshot = prev;
      return prev;
    });
    if (snapshot.length === 0) {
      setPhase('picking');
      setPrecheck(null);
      return;
    }
    setPhase('picking');
    setItems((prev) => prev.map((i) => ({ ...i, status: 'pending', reason: undefined })));
    try {
      const resp = await KnowledgeApi.precheckUpload(
        props.kbId,
        snapshot.map((i) => ({ name: i.file.name, size: i.file.size })),
      );
      setPrecheck(resp);
      setItems((prev) =>
        prev.map((it, idx) => {
          const v = resp.verdict[idx];
          if (!v) return it;
          return {
            ...it,
            ext: v.ext,
            status: v.ok ? 'ready' : 'failed',
            reason: v.ok ? undefined : v.reason,
          };
        }),
      );
      setPhase('prechecked');
    } catch (e: any) {
      props.message.error(e?.response?.data?.detail ?? e?.message ?? '预检失败');
      // 失败后回 picking,允许用户手动"重新预检"或继续选/剔文件
      setPhase('picking');
    }
  };

  // 点"确认上传"按钮 —— 分支到快路径 / 分片路径
  const runUpload = async () => {
    if (!canConfirm) return;
    if (willUseChunked) {
      await runUploadChunked();
    } else {
      await runUploadQuick();
    }
  };

  // 取消当前上传 —— abort in-flight 请求 + 清服务端 session
  const cancelUpload = async () => {
    abortControllerRef.current?.abort();
    if (sessionIDRef.current) {
      try {
        await KnowledgeApi.abortUploadSession(props.kbId, sessionIDRef.current);
      } catch {
        // 忽略 abort 自身错误
      }
      sessionIDRef.current = null;
    }
    props.message.info('已取消上传');
    setPhase('prechecked');
  };

  // 重试 —— 复用已有 session 续传(chunked)或从头(quick)
  const retryUpload = () => {
    setLastError(null);
    void runUpload();
  };

  // 快路径:小文件(< 50 MiB 总)走这里,单次 multipart 上传,简单。
  const runUploadQuick = async () => {
    setPhase('uploading');
    setItems((prev) => prev.map((i) => (i.status === 'ready' ? { ...i, status: 'uploading' } : i)));
    const toUpload = readyItems.map((i) => i.file);
    setProgress({ loaded: 0, total: readyTotalBytes });
    abortControllerRef.current = new AbortController();
    try {
      const created = await KnowledgeApi.uploadDocs(props.kbId, toUpload, {
        onUploadProgress: (e) => setProgress({ loaded: e.loaded, total: e.total ?? readyTotalBytes }),
        signal: abortControllerRef.current.signal,
      });
      setItems((prev) => prev.map((i) => (i.status === 'uploading' ? { ...i, status: 'success' } : i)));
      props.message.success(`已上传 ${created.length} 个文档`);
      abortControllerRef.current = null;
      sessionIDRef.current = null;
      props.onSuccess();
    } catch (e: any) {
      // CanceledError 特殊处理
      if (axios.isCancel(e)) {
        // 不再弹错 —— cancelUpload 已弹了"已取消"
        return;
      }
      const detail = e?.response?.data?.detail ?? e?.message ?? '上传失败';
      setLastError(detail);
      // 后端整批回滚 —— 把所有 uploading 标 failed
      setItems((prev) =>
        prev.map((i) =>
          i.status === 'uploading'
            ? { ...i, status: 'failed', reason: detail || '上传失败,后端已整批回滚' }
            : i,
        ),
      );
      props.message.error(detail);
      setPhase('error');
    }
  };

  // 分片路径:大文件走 session + 5 MiB chunks。中断可续传(按已有 sid)。
  // 流程:startUploadSession → 切分所有文件成 5 MiB chunks → 依次 putUploadChunk
  //       → commitUploadSession → 返 created docs。
  // 重试:已有 sessionIDRef 时,先 getUploadSession 拿 missing_chunks,只 PUT 缺失。
  const runUploadChunked = async () => {
    setPhase('uploading');
    setItems((prev) => prev.map((i) => (i.status === 'ready' ? { ...i, status: 'uploading' } : i)));
    setProgress({ loaded: 0, total: readyTotalBytes });
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      // 1) 启 session(若还没有)
      if (!sessionIDRef.current) {
        const startResp = await KnowledgeApi.startUploadSession(
          props.kbId,
          {
            file_count: readyItems.length,
            total_size: readyTotalBytes,
            files: readyItems.map((i) => ({ name: i.file.name, size: i.file.size })),
          },
          { signal },
        );
        sessionIDRef.current = startResp.id;
      }
      const sid = sessionIDRef.current;

      // 2) 拿当前缺失 chunks(若是 retry,可能有部分已上传)
      const status = await KnowledgeApi.getUploadSession(props.kbId, sid, { signal });
      const missingSet = new Set(status.missing_chunks);

      // 3) 构造完整的 chunk 序列(按 5 MiB 切,顺序与后端 per_file meta 一致)
      //    chunk 索引连续 0..N,跨文件拼接,后端 per_file 用 start/end 切片。
      const CHUNK = 5 * 1024 * 1024;
      const chunks: Blob[] = [];
      for (const it of readyItems) {
        const f = it.file;
        if (f.size === 0) {
          chunks.push(f.slice(0, 0));
          continue;
        }
        let offset = 0;
        while (offset < f.size) {
          const end = Math.min(offset + CHUNK, f.size);
          chunks.push(f.slice(offset, end));
          offset = end;
        }
      }

      // 4) 串行 PUT 缺失的 chunk。axios.isCancel 走外层 catch。
      let loadedSoFar = status.received_size;
      setProgress({ loaded: loadedSoFar, total: readyTotalBytes });
      for (let i = 0; i < chunks.length; i++) {
        if (signal.aborted) break;
        if (!missingSet.has(i)) {
          // 已上传,跳过(累计 loaded 用于进度条)
          loadedSoFar += chunks[i].size;
          setProgress({ loaded: loadedSoFar, total: readyTotalBytes });
          continue;
        }
        await KnowledgeApi.putUploadChunk(props.kbId, sid, i, chunks[i], {
          signal,
          onUploadProgress: (e) => {
            const cur = loadedSoFar + (e.loaded ?? 0);
            setProgress({ loaded: cur, total: readyTotalBytes });
          },
        });
        loadedSoFar += chunks[i].size;
        setProgress({ loaded: loadedSoFar, total: readyTotalBytes });
      }
      if (signal.aborted) return; // 已被 cancelUpload 处理

      // 5) commit —— 60s 解析超时,90s 兜底
      setPhase('uploading'); // 仍 uploading,但下面 commit 阶段 UI 用 progress 已 100% 区分
      setProgress({ loaded: readyTotalBytes, total: readyTotalBytes });
      const created = await KnowledgeApi.commitUploadSession(props.kbId, sid, { signal });
      setItems((prev) => prev.map((i) => (i.status === 'uploading' ? { ...i, status: 'success' } : i)));
      props.message.success(`已上传 ${created.length} 个文档`);
      abortControllerRef.current = null;
      sessionIDRef.current = null;
      props.onSuccess();
    } catch (e: any) {
      if (axios.isCancel(e)) return; // cancelUpload 已处理
      const detail = e?.response?.data?.detail ?? e?.message ?? '上传失败';
      setLastError(detail);
      setItems((prev) =>
        prev.map((i) =>
          i.status === 'uploading'
            ? { ...i, status: 'failed', reason: detail || '上传失败' }
            : i,
        ),
      );
      props.message.error(detail);
      // sessionID 保留,retry 时续传
      setPhase('error');
    }
  };

  // 阶段 1:picking —— 显示 Dragger + 选中的文件列表(全 pending)
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Upload.Dragger
        name="file"
        multiple={true}
        beforeUpload={handleBeforeUpload}
        showUploadList={false}
        accept=".md,.markdown,.pdf,.docx"
        disabled={phase === 'uploading'}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">点击或拖拽文件到此区域(可多选)</p>
        <p className="ant-upload-hint" style={{ fontSize: 12, color: '#6b7a90' }}>
          支持 .md / .pdf / .docx · 单文件 ≤ {MAX_UPLOAD_BYTES / (1 << 20)} MB · 单批 ≤{' '}
          {UPLOAD_BATCH_LIMIT} 个文件
        </p>
      </Upload.Dragger>

      {items.length > 0 && (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 6,
            }}
          >
            <Text strong style={{ fontSize: 12 }}>
              {phase === 'picking' && `预检中… (${items.length} 个文件)`}
              {phase === 'prechecked' &&
                `预检完成: ${readyItems.length} 通过 · ${failedItems.length} 失败`}
              {phase === 'uploading' &&
                (willUseChunked ? `分片上传中… (5 MiB/chunk)` : '上传中…')}
              {phase === 'error' && '上传失败'}
            </Text>
            {precheck && phase !== 'uploading' && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {readyItems.length > 0 &&
                  `共 ${(readyTotalBytes / (1 << 20)).toFixed(1)} MB`}
                {precheck.quota_size > 0 && (
                  <>
                    {' · 剩余 '}
                    {(precheck.remaining / (1 << 20)).toFixed(0)} /{' '}
                    {(precheck.quota_size / (1 << 20)).toFixed(0)} MB
                  </>
                )}
              </Text>
            )}
          </div>

          <div
            style={{
              maxHeight: 220,
              overflowY: 'auto',
              border: '1px solid #f0f0f0',
              borderRadius: 4,
            }}
          >
            {items.map((it) => (
              <FileRow key={it.uid} item={it} onRemove={() => removeItem(it.uid)} />
            ))}
          </div>

          {phase === 'uploading' && (
            <Progress
              percent={Number(progressPct.toFixed(1))}
              size="small"
              style={{ marginTop: 8 }}
            />
          )}

          <Space style={{ marginTop: 10 }}>
            {phase === 'prechecked' && (
              <>
                <Button
                  type="primary"
                  icon={<CloudUploadOutlined />}
                  onClick={runUpload}
                  disabled={!canConfirm}
                >
                  确认上传 ({readyItems.length})
                </Button>
                <Button onClick={runPrecheck} disabled={items.length === 0}>
                  重新预检
                </Button>
              </>
            )}
            {phase === 'picking' && items.length > 0 && (
              <Button onClick={runPrecheck}>重新预检</Button>
            )}
            {phase === 'uploading' && (
              <Button danger onClick={cancelUpload}>
                取消上传
              </Button>
            )}
            {phase === 'error' && (
              <>
                <Button type="primary" onClick={retryUpload}>
                  重试
                </Button>
                <Button onClick={runPrecheck} disabled={items.length === 0}>
                  重新预检
                </Button>
                <Button onClick={cancelUpload}>放弃</Button>
              </>
            )}
          </Space>

          {phase === 'prechecked' && failedItems.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 10 }}
              message={`${failedItems.length} 个文件未通过预检,已在上方标红。请剔除后重新预检,或仅上传通过项。`}
            />
          )}
          {successItems.length > 0 && phase !== 'uploading' && (
            <Alert
              type="success"
              showIcon
              style={{ marginTop: 10 }}
              message={`${successItems.length} 个文件已上传完成`}
            />
          )}
          {phase === 'error' && lastError && (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 10 }}
              message={lastError}
              description={
                sessionIDRef.current
                  ? '分片 session 已保留,点"重试"可从断点续传。'
                  : '快路径无续传,点"重试"将重新上传。'
              }
            />
          )}
        </div>
      )}
    </Space>
  );
}

/** 文件状态行:文件图标 + 名 + 大小 + 状态 tag + 删除按钮。 */
function FileRow(props: { item: FileItem; onRemove: () => void }) {
  const { item, onRemove } = props;
  const tag =
    item.status === 'ready' ? (
      <Tag color="blue">已通过预检</Tag>
    ) : item.status === 'failed' ? (
      <Tag color="red" title={item.reason}>
        失败
      </Tag>
    ) : item.status === 'uploading' ? (
      <Tag color="processing">上传中</Tag>
    ) : item.status === 'success' ? (
      <Tag color="green">已上传</Tag>
    ) : (
      <Tag>待预检</Tag>
    );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderBottom: '1px solid #f5f5f5',
        fontSize: 12,
      }}
    >
      <FileTextOutlined style={{ color: '#6b7a90' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={item.file.name}
        >
          {item.file.name}
        </div>
        <div style={{ fontSize: 11, color: '#6b7a90' }}>
          {(item.file.size / 1024).toFixed(1)} KB
          {item.ext ? ` · ${item.ext}` : ''}
          {item.reason && (
            <span style={{ color: '#dc2626', marginLeft: 6 }}>· {item.reason}</span>
          )}
        </div>
      </div>
      {tag}
      <Button
        type="text"
        size="small"
        icon={<DeleteOutlined />}
        onClick={onRemove}
        disabled={item.status === 'uploading'}
      />
    </div>
  );
}
