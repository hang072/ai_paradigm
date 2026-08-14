import { client } from './client';
import type { WorkflowTemplate } from '../types/template';

export const TemplatesApi = {
  list: () => client.get<WorkflowTemplate[]>('/api/templates').then((r) => r.data),
  get: (id: string) => client.get<WorkflowTemplate>(`/api/templates/${id}`).then((r) => r.data),
  create: (patch: Partial<WorkflowTemplate> & { name: string }) =>
    client.post<WorkflowTemplate>('/api/templates', patch).then((r) => r.data),
  update: (id: string, patch: Partial<WorkflowTemplate>) =>
    client.put(`/api/templates/${id}`, patch).then((r) => r.data),
  remove: (id: string) => client.delete(`/api/templates/${id}`).then((r) => r.data),
  /** P92: 后端 /fork 端点 — 克隆源模板(builtin→普通)并自动写 v1, 返回新模板对象。 */
  fork: (srcId: string) =>
    client.post<WorkflowTemplate>(`/api/templates/${srcId}/fork`).then((r) => r.data),
};
