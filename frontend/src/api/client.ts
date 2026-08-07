import axios from 'axios';

/**
 * 全局 axios 实例。
 * - baseURL 从 env 取(mock 模式下会被 adapter 拦截,baseURL 无所谓)
 * - 统一响应格式:直接返回 res.data
 */
export const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? '',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// 统一错误处理:把 error.response.data.detail 抛出去,业务层直接 catch e.message
client.interceptors.response.use(
  (res) => res,
  (err) => {
    const detail = err?.response?.data?.detail ?? err?.message ?? '请求失败';
    const wrapped = new Error(detail);
    (wrapped as any).cause = err;
    return Promise.reject(wrapped);
  },
);
