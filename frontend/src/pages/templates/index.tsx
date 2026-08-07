import { useEffect, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Col,
  Empty,
  Modal,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { TemplatesApi } from '../../api/templates';
import { NodesApi } from '../../api/nodes';
import { AgentsApi } from '../../api/agents';
import type { WorkflowTemplate } from '../../types/template';
import type { NodeDef } from '../../types/node';
import type { AgentDef } from '../../types/agent';
import { FlowCanvas } from '../../canvas/FlowCanvas';

const { Title, Text, Paragraph } = Typography;

export default function TemplatesPage() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [list, setList] = useState<WorkflowTemplate[]>([]);
  const [nodeDefs, setNodeDefs] = useState<NodeDef[]>([]);
  const [agentDefs, setAgentDefs] = useState<AgentDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<WorkflowTemplate | null>(null);

  useEffect(() => {
    Promise.all([TemplatesApi.list(), NodesApi.list(), AgentsApi.list()])
      .then(([t, n, a]) => {
        setList(t);
        setNodeDefs(n);
        setAgentDefs(a);
      })
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false));
  }, [message]);

  const startFrom = (tpl: WorkflowTemplate) => {
    navigate(`/tasks?tpl=${tpl.id}`);
  };

  const editTpl = (tpl: WorkflowTemplate) => {
    navigate(`/templates/${tpl.id}/edit`);
  };

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            工作流模板库
          </Title>
          <Text type="secondary">选择模板 · 一键创建对应类型的智能体流水线任务</Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigate('/templates/new')}
        >
          新建模板
        </Button>
      </div>

      {list.length === 0 && !loading ? (
        <Empty description="暂无模板" />
      ) : (
        <Row gutter={[16, 16]}>
          {list.map((t) => (
            <Col span={8} key={t.id}>
              <Card
                loading={loading}
                title={
                  <Space size={8}>
                    <span>{t.name}</span>
                    {t.builtin && <Tag color="blue">内置</Tag>}
                  </Space>
                }
                actions={[
                  <span key="preview" onClick={() => setPreview(t)}>
                    <EyeOutlined /> 预览画布
                  </span>,
                  <span key="edit" onClick={() => editTpl(t)}>
                    <EditOutlined /> {t.builtin ? 'Fork & 编辑' : '编辑'}
                  </span>,
                  <span key="start" onClick={() => startFrom(t)}>
                    <RocketOutlined /> 从此新建任务
                  </span>,
                ]}
              >
                <Paragraph
                  type="secondary"
                  style={{ minHeight: 44, marginBottom: 8 }}
                  ellipsis={{ rows: 2 }}
                >
                  {t.description}
                </Paragraph>
                <div style={{ marginBottom: 8 }}>
                  {t.tags.map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  节点数:{t.nodes.length} · 边:{t.edges.length}
                </Text>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        title={preview ? `模板预览 · ${preview.name}` : ''}
        open={!!preview}
        onCancel={() => setPreview(null)}
        footer={[
          <Button key="close" onClick={() => setPreview(null)}>
            关闭
          </Button>,
          preview && (
            <Button key="edit" onClick={() => editTpl(preview)}>
              {preview.builtin ? 'Fork & 编辑' : '编辑此模板'}
            </Button>
          ),
          preview && (
            <Button key="start" type="primary" onClick={() => startFrom(preview)}>
              从此模板新建任务
            </Button>
          ),
        ]}
        width={960}
        destroyOnClose
      >
        {preview && (
          <FlowCanvas
            entry={preview.entry}
            nodes={preview.nodes}
            edges={preview.edges}
            nodeDefs={nodeDefs}
            agentDefs={agentDefs}
            height={560}
          />
        )}
      </Modal>
    </div>
  );
}
