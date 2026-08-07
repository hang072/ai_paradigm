import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // 5173 被占用时直接报错,不要自动换端口:
    // - 浏览器 localStorage / cookie 全按 origin (含端口) 隔离,换端口就等于换宿主
    // - 数据现在存后端 SQLite, 换端口不再丢数据; 但保持 origin 稳定仍能避免:
    //   1) 老 localStorage 遗留数据在新 origin 里 "消失" 造成的错觉
    //   2) 认证 / CORS / SSO 联调的 origin 漂移
    // 若报错 "port 5173 is already in use", 说明有旧 dev server 没退干净:
    //   netstat -ano | grep :5173  →  taskkill /F /PID <pid>
    strictPort: true,
    proxy: {
      // 代理 LLM API 请求解决 CORS 问题
      '/zh/api': {
        target: 'https://api-doc.aa.com.cn/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/zh\/api/, ''),
        configure: (proxy, options) => {
          // 打印代理请求方便调试
          proxy.on('error', (err, req, res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('proxy', req.method, req.url, '→', proxyReq.path);
          });
        },
      },
    },
  },
});
