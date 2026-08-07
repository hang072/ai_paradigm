import { Layout, Menu, Space, Tag, Tooltip } from 'antd';
import {
  AppstoreOutlined,
  BookOutlined,
  ClusterOutlined,
  ExperimentOutlined,
  MessageOutlined,
  RocketOutlined,
  SettingOutlined,
  ThunderboltFilled,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';

const { Sider, Header, Content } = Layout;

const menu = [
  { key: '/workbench', icon: <AppstoreOutlined />, label: '协同工作台' },
  { key: '/chat', icon: <MessageOutlined />, label: '对话' },
  { key: '/tasks', icon: <RocketOutlined />, label: '任务运行' },
  { key: '/agents', icon: <ClusterOutlined />, label: '专家团' },
  { key: '/knowledge', icon: <BookOutlined />, label: '知识库' },
  { key: '/skills', icon: <ThunderboltOutlined />, label: '技能库' },
  { key: '/templates', icon: <ExperimentOutlined />, label: '模板库' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
];

export default function AppShell() {
  const location = useLocation();
  const activeConfigId = useAppStore((s) => s.activeConfigId);
  const modelConfigs = useAppStore((s) => s.modelConfigs);

  // 选中最长匹配前缀
  const selected =
    menu
      .map((m) => m.key)
      .filter((k) => location.pathname === k || location.pathname.startsWith(k + '/'))
      .sort((a, b) => b.length - a.length)[0] ?? '/workbench';

  const activeConfig = modelConfigs.find(c => c.id === activeConfigId);
  const displayName = activeConfig ? `${activeConfig.provider}/${activeConfig.model}` : '未配置';

  return (
    <Layout style={{ height: '100vh' }}>
      <Header
        style={{
          background: 'linear-gradient(90deg,#1e3a8a 0%,#2b57d6 40%,#7c4dff 100%)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          gap: 12,
        }}
      >
        <ThunderboltFilled style={{ color: '#fff', fontSize: 20 }} />
        <span style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>
          AI 工作台 · Paradigm Eino
        </span>
        <span style={{ color: 'rgba(255,255,255,.7)', fontSize: 12 }}>
          多智能体协同 · 医疗内容框架生成
        </span>
        <div style={{ flex: 1 }} />
        <Space>
          <Tooltip title="当前主模型">
            <Tag color="processing" style={{ margin: 0 }}>
              {displayName}
            </Tag>
          </Tooltip>
          <Tag color="success" style={{ margin: 0 }}>
            ● 联机正常
          </Tag>
        </Space>
      </Header>
      <Layout>
        <Sider width={200} theme="light" style={{ borderRight: '1px solid #e3e8f0' }}>
          <Menu
            mode="inline"
            selectedKeys={[selected]}
            style={{ border: 0, height: '100%', paddingTop: 8 }}
            items={menu.map((m) => ({
              key: m.key,
              icon: m.icon,
              label: <Link to={m.key}>{m.label}</Link>,
            }))}
          />
        </Sider>
        <Content style={{ padding: 16, overflow: 'auto', background: '#f2f4f8' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
