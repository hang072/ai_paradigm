import { useEffect } from 'react';
import { Button, Card, Empty, Input, List, Space, Spin, Tag, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useTasksStore } from '../../store/useTasksStore';
import { StatusBadge } from '../../components/StatusBadge';
import { fromNow } from '../../utils/time';
import { NewTaskModal } from './NewTaskModal';
import { TaskDetail } from './TaskDetail';

const { Text, Title } = Typography;

export default function TasksPage() {
  const { taskId } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const {
    list,
    current,
    currentId,
    listLoading,
    detailLoading,
    refreshList,
    select,
    startPolling,
    stopPolling,
  } = useTasksStore();
  const [keyword, setKeyword] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const defaultTemplate = search.get('tpl') ?? undefined;

  // 挂载 / 卸载:拉数据 + 启动轮询
  useEffect(() => {
    refreshList();
    startPolling();
    return () => stopPolling();
  }, [refreshList, startPolling, stopPolling]);

  // URL 上有 taskId 就自动选中
  useEffect(() => {
    if (taskId && taskId !== currentId) {
      select(taskId);
    }
  }, [taskId, currentId, select]);

  // 若从模板页跳过来带 ?tpl=xxx,默认弹新建
  useEffect(() => {
    if (defaultTemplate && !newOpen) {
      setNewOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredList = list.filter((t) =>
    keyword ? t.title.toLowerCase().includes(keyword.toLowerCase()) : true,
  );

  const handleSelect = (id: string) => {
    navigate(`/tasks/${id}`);
    select(id);
  };

  const handleCreated = (id: string) => {
    setNewOpen(false);
    // 清除 tpl query
    if (search.has('tpl')) {
      search.delete('tpl');
      setSearch(search, { replace: true });
    }
    refreshList();
    navigate(`/tasks/${id}`);
    select(id);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12, height: '100%' }}>
      {/* 左侧任务列表 */}
      <Card
        title={
          <Space>
            <Title level={5} style={{ margin: 0 }}>
              任务列表
            </Title>
            <Tag>{list.length}</Tag>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} size="small" onClick={refreshList} />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              size="small"
              onClick={() => setNewOpen(true)}
            >
              新建
            </Button>
          </Space>
        }
        bodyStyle={{ padding: 0 }}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
          <Input.Search
            placeholder="搜索任务标题…"
            allowClear
            size="small"
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          {filteredList.length === 0 && !listLoading ? (
            <Empty description="没有任务" style={{ marginTop: 40 }} />
          ) : (
            <List
              size="small"
              loading={listLoading}
              dataSource={filteredList}
              renderItem={(t) => {
                const active = t.thread_id === currentId;
                return (
                  <List.Item
                    onClick={() => handleSelect(t.thread_id)}
                    style={{
                      cursor: 'pointer',
                      padding: '10px 12px',
                      background: active ? '#eef3ff' : undefined,
                      borderLeft: active ? '3px solid #2b57d6' : '3px solid transparent',
                    }}
                  >
                    <div style={{ width: '100%' }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 13,
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {t.title}
                      </div>
                      <Space size={4} style={{ marginTop: 6 }}>
                        <Tag style={{ margin: 0 }}>{t.task_type}</Tag>
                        <StatusBadge status={t.status} />
                      </Space>
                      <div style={{ marginTop: 4, fontSize: 11, color: '#6b7a90' }}>
                        {fromNow(t.created_at)}
                        {t.revision_count > 0 && ` · 修订 ${t.revision_count} 次`}
                      </div>
                    </div>
                  </List.Item>
                );
              }}
            />
          )}
        </div>
      </Card>

      {/* 右侧详情 */}
      <div style={{ overflow: 'auto' }}>
        {!currentId ? (
          <div style={{ marginTop: 80 }}>
            <Empty description="请从左侧选择任务,或点击右上「新建」" />
          </div>
        ) : detailLoading && !current ? (
          <div style={{ textAlign: 'center', marginTop: 80 }}>
            <Spin />
          </div>
        ) : current ? (
          <TaskDetail task={current} />
        ) : (
          <Empty description="任务不存在" />
        )}
      </div>

      <NewTaskModal
        open={newOpen}
        onClose={() => {
          setNewOpen(false);
          if (search.has('tpl')) {
            search.delete('tpl');
            setSearch(search, { replace: true });
          }
        }}
        onCreated={handleCreated}
        defaultTemplateId={defaultTemplate}
      />
    </div>
  );
}
