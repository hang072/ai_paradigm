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
//
// 阶段 5 续 2:axios.isCancel(err) 必须透传 —— 上传时 AbortController 触发
// 中断,UI 要识别"已取消"与"网络错误"区别(后端也可能返 499)。
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (axios.isCancel(err)) {
      // 透传:UI catch 后用 err.name === 'CanceledError' 区分。
      // 不包成 Error(detail) 是为了保留 .name / .code。
      return Promise.reject(err);
    }
    const detail = err?.response?.data?.detail ?? err?.message ?? '请求失败';
    const wrapped = new Error(detail);
    (wrapped as any).cause = err;
    return Promise.reject(wrapped);
  },
);
