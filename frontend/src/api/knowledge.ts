import { client } from './client';
import type { KnowledgeBase, KnowledgeDoc, KbSearchHit } from '../types/knowledge';

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
  removeDoc: (kbId: string, docId: string) =>
    client.delete(`/api/kb/${kbId}/docs/${docId}`).then((r) => r.data),

  // 检索(供对话工具调用轨迹展示)
  search: (query: string, kbIds: string[]) =>
    client
      .post<KbSearchHit[]>('/api/kb/search', { query, kb_ids: kbIds })
      .then((r) => r.data),
};
