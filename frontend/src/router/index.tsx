import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Button, Result } from 'antd';
import AppShell from '../layout/AppShell';
import WorkbenchPage from '../pages/workbench';
import AgentsPage from '../pages/agents';
import TasksPage from '../pages/tasks';
import TemplatesPage from '../pages/templates';
import TemplateEditorPage from '../pages/templates/edit';
import SettingsPage from '../pages/settings';
import ChatPage from '../pages/chat';
import KnowledgePage from '../pages/knowledge';
import SkillsPage from '../pages/skills';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/workbench" replace /> },
      { path: 'workbench', element: <WorkbenchPage /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'agents', element: <AgentsPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'tasks/:taskId', element: <TasksPage /> },
      { path: 'knowledge', element: <KnowledgePage /> },
      { path: 'skills', element: <SkillsPage /> },
      { path: 'templates', element: <TemplatesPage /> },
      { path: 'templates/new', element: <TemplateEditorPage /> },
      { path: 'templates/:id/edit', element: <TemplateEditorPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  // 兜底 404 页面:替换默认 "💿 Hey developer" 文案, 给用户友好提示
  {
    path: '*',
    element: (
      <Result
        status="404"
        title="404"
        subTitle="页面不存在。可能 KB 详情/任务详情链接已变化, 请回到工作台或知识库首页。"
        extra={
          <Button type="primary" href="/workbench">
            回工作台
          </Button>
        }
      />
    ),
  },
]);
