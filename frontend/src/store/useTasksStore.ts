import { create } from 'zustand';
import { TasksApi } from '../api/tasks';
import type { TaskSnapshot, TaskSummary } from '../types/task';

/**
 * 任务 store:列表 + 当前详情 + 轮询。
 * 轮询频率:2s(mock);后端接入可以调 3~5s。
 */

interface TasksState {
  list: TaskSummary[];
  current: TaskSnapshot | null;
  currentId: string | null;
  listLoading: boolean;
  detailLoading: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
  refreshList: () => Promise<void>;
  select: (id: string | null) => Promise<void>;
  refreshDetail: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  list: [],
  current: null,
  currentId: null,
  listLoading: false,
  detailLoading: false,
  pollTimer: null,

  async refreshList() {
    set({ listLoading: true });
    try {
      const list = await TasksApi.list();
      set({ list });
    } finally {
      set({ listLoading: false });
    }
  },

  async select(id: string | null) {
    set({ currentId: id, current: null });
    if (!id) return;
    set({ detailLoading: true });
    try {
      const snap = await TasksApi.get(id);
      set({ current: snap });
    } finally {
      set({ detailLoading: false });
    }
  },

  async refreshDetail() {
    const id = get().currentId;
    if (!id) return;
    try {
      const snap = await TasksApi.get(id);
      set({ current: snap });
    } catch {
      /* 忽略,让 UI 继续用旧数据 */
    }
    // 顺带刷新列表(状态可能变化)
    try {
      const list = await TasksApi.list();
      set({ list });
    } catch {
      /* ignore */
    }
  },

  startPolling() {
    const existed = get().pollTimer;
    if (existed) return;
    const timer = setInterval(() => {
      const s = get();
      // 若当前任务不是终态,才刷详情
      if (s.currentId) {
        if (s.current?.status !== 'done') {
          s.refreshDetail();
        }
      } else {
        s.refreshList();
      }
    }, 2000);
    set({ pollTimer: timer });
  },

  stopPolling() {
    const t = get().pollTimer;
    if (t) clearInterval(t);
    set({ pollTimer: null });
  },
}));
