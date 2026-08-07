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
};
