import { client } from './client';
import type { AgentDef } from '../types/agent';

export const AgentsApi = {
  list: () => client.get<AgentDef[]>('/api/agents').then((r) => r.data),
  get: (id: string) => client.get<AgentDef>(`/api/agents/${id}`).then((r) => r.data),
  create: (patch: Partial<AgentDef> & { name: string }) =>
    client.post<AgentDef>('/api/agents', patch).then((r) => r.data),
  update: (id: string, patch: Partial<AgentDef>) =>
    client.put(`/api/agents/${id}`, patch).then((r) => r.data),
  remove: (id: string) => client.delete(`/api/agents/${id}`).then((r) => r.data),
};
