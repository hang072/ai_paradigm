import { client } from './client';
import type { SkillDef } from '../types/skill';

export const SkillsApi = {
  list: () => client.get<SkillDef[]>('/api/skills').then((r) => r.data),
  get: (id: string) => client.get<SkillDef>(`/api/skills/${id}`).then((r) => r.data),
  create: (patch: Partial<SkillDef> & { name: string }) =>
    client.post<SkillDef>('/api/skills', patch).then((r) => r.data),
  update: (id: string, patch: Partial<SkillDef>) =>
    client.put(`/api/skills/${id}`, patch).then((r) => r.data),
  remove: (id: string) => client.delete(`/api/skills/${id}`).then((r) => r.data),
};
