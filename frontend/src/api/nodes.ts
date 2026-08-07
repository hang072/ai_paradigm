import { client } from './client';
import type { NodeDef } from '../types/node';

export const NodesApi = {
  list: () => client.get<NodeDef[]>('/api/nodes').then((r) => r.data),
  get: (id: string) => client.get<NodeDef>(`/api/nodes/${id}`).then((r) => r.data),
  create: (patch: Partial<NodeDef> & { name: string; kind: NodeDef['kind'] }) =>
    client.post<NodeDef>('/api/nodes', patch).then((r) => r.data),
  update: (id: string, patch: Partial<NodeDef>) =>
    client.put(`/api/nodes/${id}`, patch).then((r) => r.data),
  remove: (id: string) => client.delete(`/api/nodes/${id}`).then((r) => r.data),
};
