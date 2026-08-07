import { createBrowserRouter, Navigate } from 'react-router-dom';
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
]);
