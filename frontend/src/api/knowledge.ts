import { client } from './client';
import type { DocStructure, KnowledgeBase, KnowledgeDoc, KbSearchHit } from '../types/knowledge';

/** 批量上传单文件进度回调。loaded/total 是字节数。 */
export interface UploadProgress {
  loaded: number;
  total?: number;
}

/** 预检输入:每文件仅 name + size(避免先把字节传过去再被拒)。 */
export interface BatchPrecheckFile {
  name: string;
  size: number;
}

/** 预检单文件 verdict。 */
export interface BatchPrecheckVerdict {
  ok: boolean;
  /** 失败原因(用户可读)。ok=true 时为空。 */
  reason?: string;
  /** 归一化扩展名(.md / .pdf / .docx / "")。前端可按它显示文件类型 tag。 */
  ext?: string;
}

/** 预检响应:逐文件 verdict + 整批 summary。can_upload 是给"确认上传"按钮的最终依据。 */
export interface BatchPrecheckResp {
  verdict: BatchPrecheckVerdict[];
  total_size: number;
  used_size: number;
  quota_size: number;
  remaining: number;
  can_upload: boolean;
}

// ===== 阶段 5 续 2:分片上传 session 类型 =====

/** SessionStartReq 启 session 请求体。 */
export interface SessionStartReq {
  file_count: number;
  total_size: number;
  files: BatchPrecheckFile[];
}

/** SessionStartResp 后端返的 session id + 元信息(chunk_size 前端用这个切)。 */
export interface SessionStartResp {
  id: string;
  expires_at: string;
  chunk_size: number;
  total_size: number;
  file_count: number;
  kb_id: string;
}

/** SessionStatusResp GET 续传查询响应。 */
export interface SessionStatusResp {
  id: string;
  kb_id: string;
  state: 'open' | 'committed' | 'aborted';
  file_count: number;
  total_size: number;
  received_size: number;
  received_chunks: number[];
  missing_chunks: number[];
  expires_at: string;
}

export const KnowledgeApi = {
  list: () => client.get<KnowledgeBase[]>('/api/kb').then((r) => r.data),
  get: (id: string) => client.get<KnowledgeBase>(`/api/kb/${id}`).then((r) => r.data),
  create: (patch: Partial<KnowledgeBase> & { name: string }) =>
    client.post<KnowledgeBase>('/api/kb', patch).then((r) => r.data),
  update: (id: string, patch: Partial<KnowledgeBase>) =>
    client.put<KnowledgeBase>(`/api/kb/${id}`, patch).then((r) => r.data),
  remove: (id: string) => client.delete(`/api/kb/${id}`).then((r) => r.data),

  // 文档级 CRUD
  addDoc: (kbId: string, patch: Partial<KnowledgeDoc> & { title: string }) =>
    client.post<KnowledgeDoc>(`/api/kb/${kbId}/docs`, patch).then((r) => r.data),
  updateDoc: (kbId: string, docId: string, patch: Partial<KnowledgeDoc>) =>
    client.put<KnowledgeDoc>(`/api/kb/${kbId}/docs/${docId}`, patch).then((r) => r.data),
  // P84: 单 doc 删除 — 后端级联清 Milvus chunks + BLOB + sidecar + 从 KB 摘除。
  removeDoc: (kbId: string, docId: string) =>
    client.delete(`/api/kb/${kbId}/docs/${docId}`).then((r) => r.data),
  // P84: 单 doc 重新向量化 — 后端先清 Milvus 旧 chunks 再入队, SSE 推状态。
  reembedDoc: (kbId: string, docId: string) =>
    client
      .post<{ doc_id: string; status: string }>(`/api/kb/${kbId}/docs/${docId}/reembed`)
      .then((r) => r.data),
  // P84: 单 doc SSE 状态流(挂 EventSource 即可,后端 ready/failed 终态自动断)。
  // 返 EventSource, 业务侧监听 message / open / error。
  openEmbedStatusStream: (kbId: string, docId: string) =>
    new EventSource(`/api/kb/${kbId}/docs/${docId}/embed-status/stream`),

  // 阶段 5 续:批量本地文件上传(md / pdf / docx)。
  // 1) 先调 precheckUpload 拿 verdict;用户剔除失败项后
  // 2) 调 uploadDocs 上传通过项;后端任一解析失败整批回滚。
  // axios 看到 FormData 自动设 multipart/form-data 与 boundary,无需手动 Content-Type。
  precheckUpload: (kbId: string, files: BatchPrecheckFile[]) =>
    client
      .post<BatchPrecheckResp>(`/api/kb/${kbId}/docs/upload/precheck`, { files })
      .then((r) => r.data),

  // uploadDocs 是"快路径" —— 走 multipart 一次性传整批。阶段 5 续 2 加了
  // 分片 session 路径给大文件用,小文件仍走这里。
  // 显式 timeout:10 分钟,与后端 http.Server.ReadTimeout 对齐,避免单批
  // 大文件被全局 30s timeout 砍。
  // signal 透传:UI 在 AbortController.abort() 时,axios 走 CanceledError,
  // 客户端 interceptor 透传给 catch,UI 据此显示"已取消"。
  uploadDocs: (
    kbId: string,
    files: File[],
    opts: { onUploadProgress?: (e: UploadProgress) => void; signal?: AbortSignal } = {},
  ) => {
    const form = new FormData();
    files.forEach((f) => form.append('file', f));
    return client
      .post<KnowledgeDoc[]>(`/api/kb/${kbId}/docs/upload`, form, {
        headers: { 'Content-Type': undefined as unknown as string },
        onUploadProgress: (e) => opts.onUploadProgress?.({ loaded: e.loaded, total: e.total }),
        signal: opts.signal,
        timeout: 10 * 60 * 1000,
      })
      .then((r) => r.data);
  },

  // ===== 阶段 5 续 2:分片上传 session 路径 =====
  // 大文件 / 网络不稳场景:5 MiB 一片,中断可续传。
  // UI 通常自己选 quick / chunked(本类不上传大文件用 quick 即可)。

  startUploadSession: (kbId: string, body: SessionStartReq, opts?: { signal?: AbortSignal }) =>
    client
      .post<SessionStartResp>(`/api/kb/${kbId}/docs/upload/sessions`, body, { signal: opts?.signal })
      .then((r) => r.data),

  putUploadChunk: (
    kbId: string,
    sid: string,
    idx: number,
    blob: Blob,
    opts: { onUploadProgress?: (e: UploadProgress) => void; signal?: AbortSignal } = {},
  ) =>
    client
      .put<void>(`/api/kb/${kbId}/docs/upload/sessions/${sid}/chunks/${idx}`, blob, {
        signal: opts.signal,
        headers: { 'Content-Type': 'application/octet-stream' },
        onUploadProgress: (e) => opts.onUploadProgress?.({ loaded: e.loaded, total: e.total }),
        // 单 chunk 5 MiB,5 分钟足够(慢网 + 重试)。
        timeout: 5 * 60 * 1000,
      })
      .then((r) => r.data),

  commitUploadSession: (kbId: string, sid: string, opts?: { signal?: AbortSignal }) =>
    client
      .post<KnowledgeDoc[]>(`/api/kb/${kbId}/docs/upload/sessions/${sid}/commit`, undefined, {
        signal: opts?.signal,
        // commit 走 60s 解析超时(后端硬限),前端给 90s 兜底。
        timeout: 90 * 1000,
      })
      .then((r) => r.data),

  abortUploadSession: (kbId: string, sid: string, opts?: { signal?: AbortSignal }) =>
    client
      .delete(`/api/kb/${kbId}/docs/upload/sessions/${sid}`, { signal: opts?.signal })
      .then((r) => r.data),

  getUploadSession: (kbId: string, sid: string, opts?: { signal?: AbortSignal }) =>
    client
      .get<SessionStatusResp>(`/api/kb/${kbId}/docs/upload/sessions/${sid}`, { signal: opts?.signal })
      .then((r) => r.data),

  // ===== 阶段 5 续 3:整 KB 重新向量化 =====
  reembedKB: (kbId: string) =>
    client
      .post<{ kb_id: string; queued: number }>(`/api/kb/${kbId}/reembed`)
      .then((r) => r.data),

  // ===== 阶段 5 续 5:文档结构化(sidecar) =====
  getDocStructure: (docId: string) =>
    client
      .get<DocStructure>(`/api/kb/docs/${docId}/structure`)
      .then((r) => r.data),

  // 阶段 5:原始文件下载 URL(供 <a href={...} target="_blank"> 使用)。
  getDocBlobUrl: (kbId: string, docId: string) =>
    `/api/kb/${kbId}/docs/${docId}/blob`,

  // P85: 抽出的图片 URL(结构化弹窗渲染用)。 后端会校验 filename 在 sidecar
  // images_json 里才返二进制, 防止越权。
  getDocImageUrl: (kbId: string, docId: string, filename: string) =>
    `/api/kb/${kbId}/docs/${docId}/images/${filename}`,

  // 检索(供对话工具调用轨迹展示)
  search: (query: string, kbIds: string[]) =>
    client
      .post<KbSearchHit[]>('/api/kb/search', { query, kb_ids: kbIds })
      .then((r) => r.data),
};
