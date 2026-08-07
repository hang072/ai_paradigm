import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { RouterProvider } from 'react-router-dom';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import '@xyflow/react/dist/style.css';
import './styles/global.css';
import { router } from './router';
import { installMockAdapter } from './api/mock';
import { useAppStore } from './store/useAppStore';

dayjs.locale('zh-cn');

/**
 * 一次性清理旧版本 localStorage 遗留数据。
 *
 * S3 之前 (2026-07-23 前),会话 & LLM 配置存浏览器 localStorage。改后端 SQLite
 * 之后,老 key 仍留在浏览器里,虽然不再被读取,但会:
 *   1) 在 DevTools 里让人以为还在生效
 *   2) 明文 apiKey 长期驻留浏览器,不安全
 * 用 `paradigm-eino-migration` 作为一次性 flag,清完就打勾,后续不再动。
 */
function cleanupLegacyLocalStorage() {
  try {
    const FLAG = 'paradigm-eino-migration:2026-07-23-sqlite';
    if (localStorage.getItem(FLAG)) return;
    ['paradigm-eino-chat', 'paradigm-eino-app'].forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(FLAG, '1');
    console.info('[paradigm-eino] 已清理旧 localStorage (paradigm-eino-chat / paradigm-eino-app)。数据已迁移到后端 SQLite。');
  } catch (e) {
    // 私密模式 / 禁用存储时会抛,忽略。
  }
}
cleanupLegacyLocalStorage();

// 启动 mock(视 env 决定)。真后端就位后设 VITE_USE_MOCK=false。
installMockAdapter();

// 从后端 (或 mock) 拉取用户偏好设置, 覆盖默认值。
// 之前用 zustand persist(localStorage), 换端口就丢, 已改为服务端持久化。
useAppStore.getState().loadFromBackend();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2b57d6',
          colorInfo: '#2b57d6',
          borderRadius: 8,
          fontSize: 13,
        },
      }}
    >
      <AntApp>
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
