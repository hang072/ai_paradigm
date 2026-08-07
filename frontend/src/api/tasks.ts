import { client } from './client';
import type { TaskSnapshot, TaskSpec, TaskSummary, TaskType } from '../types/task';

export interface StartTaskInput {
  brief: string;
  task_type?: TaskType;
  title?: string;
  template_id?: string | null;
  spec?: TaskSpec | null;
}

export const TasksApi = {
  list: () => client.get<TaskSummary[]>('/api/tasks').then((r) => r.data),
  get: (id: string) => client.get<TaskSnapshot>(`/api/tasks/${id}`).then((r) => r.data),
  start: (input: StartTaskInput) =>
    client.post<TaskSnapshot>('/api/tasks', input).then((r) => r.data),
  resume: (id: string, answer: string) =>
    client.post<TaskSnapshot>(`/api/tasks/${id}/resume`, { answer }).then((r) => r.data),
  /** 请求打断一个正在运行 / 等待人工的任务。幂等 —— 已终态 → 200 no-op。 */
  cancel: (id: string) =>
    client.post<TaskSnapshot>(`/api/tasks/${id}/cancel`).then((r) => r.data),
  updateSpec: (id: string, spec: TaskSpec) =>
    client.post<TaskSnapshot>(`/api/tasks/${id}/spec`, { spec }).then((r) => r.data),
};
