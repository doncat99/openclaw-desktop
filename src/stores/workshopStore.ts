import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { migrateStorageKey, storageKey } from '@/utils/storage';

// ═══════════════════════════════════════════════════════════
// Workshop Store — Kanban tasks + Activity Log
// ═══════════════════════════════════════════════════════════

export interface Task {
  applicationId?: string;
  inputDocs?: TaskInputDocument[];
  inputDocMode?: 'standardTextbook' | 'rawDocuments';
  standardInputDocs?: TaskInputDocument[];
  rawInputDocs?: TaskInputDocument[];
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  status: 'queue' | 'inProgress' | 'done';
  createdAt: string;
  completedAt?: string;
  tags: string[];
  assignedAgent?: string;
  progress?: number; // 0-100, for inProgress tasks
  lastRunAt?: string;
  lastRunStatus?: 'ok' | 'error';
  lastRunError?: string;
  lastRunAgent?: string;
  lastRunSessionKey?: string;
}

export interface TaskInputDocument {
  name: string;
  mimeType: string;
  size: number;
  path?: string;
}

export interface ActivityEntry {
  id: string;
  type: 'created' | 'moved' | 'progress' | 'deleted' | 'completed' | 'run' | 'runError';
  taskTitle: string;
  agent?: string;
  from?: string;
  to?: string;
  progress?: number;
  error?: string;
  timestamp: string;
}

interface WorkshopState {
  tasks: Task[];
  activities: ActivityEntry[];
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'status' | 'tags'> & { tags?: string[] }) => void;
  moveTask: (id: string, status: Task['status']) => void;
  deleteTask: (id: string) => void;
  reorderInColumn: (status: Task['status'], orderedIds: string[]) => void;
  setProgress: (id: string, progress: number) => void;
  updateTask: (id: string, updates: Partial<Pick<Task, 'title' | 'description' | 'priority' | 'tags' | 'assignedAgent' | 'applicationId'>>) => void;
  setTaskRunResult: (id: string, run: { status: 'ok' | 'error'; agent?: string; error?: string; sessionKey?: string }) => void;
  clearCompleted: () => void;
}

const MAX_ACTIVITIES = 50;

function makeActivity(
  type: ActivityEntry['type'],
  taskTitle: string,
  extra?: Partial<ActivityEntry>,
): ActivityEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    taskTitle,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

const STATUS_LABELS: Record<string, string> = {
  queue: 'Queue',
  inProgress: 'In Progress',
  done: 'Done',
};

const WORKSHOP_STORAGE_KEY = storageKey('workshop-tasks');
migrateStorageKey(WORKSHOP_STORAGE_KEY, 'aegis-workshop-tasks');

export const useWorkshopStore = create<WorkshopState>()(
  persist(
    (set, get) => ({
      tasks: [],
      activities: [],

      addTask: (partial) => set((state) => {
        const task: Task = {
          ...partial,
          id: crypto.randomUUID(),
          status: 'queue',
          createdAt: new Date().toISOString(),
          tags: partial.tags || [],
          inputDocs: partial.inputDocs || [],
          standardInputDocs: partial.standardInputDocs || [],
          rawInputDocs: partial.rawInputDocs || [],
        };
        return {
          tasks: [...state.tasks, task],
          activities: [
            makeActivity('created', task.title, { agent: task.assignedAgent }),
            ...state.activities,
          ].slice(0, MAX_ACTIVITIES),
        };
      }),

      moveTask: (id, status) => set((state) => {
        const task = state.tasks.find((t) => t.id === id);
        if (!task || task.status === status) return state;
        const fromLabel = STATUS_LABELS[task.status] || task.status;
        const toLabel = STATUS_LABELS[status] || status;
        const isCompleting = status === 'done';
        return {
          tasks: state.tasks.map((t) =>
            t.id === id
              ? { ...t, status, ...(isCompleting ? { completedAt: new Date().toISOString(), progress: 100 } : {}) }
              : t,
          ),
          activities: [
            makeActivity(
              isCompleting ? 'completed' : 'moved',
              task.title,
              { from: fromLabel, to: toLabel, agent: task.assignedAgent },
            ),
            ...state.activities,
          ].slice(0, MAX_ACTIVITIES),
        };
      }),

      deleteTask: (id) => set((state) => {
        const task = state.tasks.find((t) => t.id === id);
        if (!task) return state;
        return {
          tasks: state.tasks.filter((t) => t.id !== id),
          activities: [
            makeActivity('deleted', task.title, { agent: task.assignedAgent }),
            ...state.activities,
          ].slice(0, MAX_ACTIVITIES),
        };
      }),

      setProgress: (id, progress) => set((state) => {
        const task = state.tasks.find((t) => t.id === id);
        if (!task) return state;
        return {
          tasks: state.tasks.map((t) => t.id === id ? { ...t, progress } : t),
          activities: [
            makeActivity('progress', task.title, { progress, agent: task.assignedAgent }),
            ...state.activities,
          ].slice(0, MAX_ACTIVITIES),
        };
      }),

      updateTask: (id, updates) => set((state) => ({
        tasks: state.tasks.map((t) => t.id === id ? { ...t, ...updates } : t),
      })),

      setTaskRunResult: (id, run) => set((state) => {
        const task = state.tasks.find((t) => t.id === id);
        if (!task) return state;
        const timestamp = new Date().toISOString();
        return {
          tasks: state.tasks.map((t) => (t.id === id
            ? {
                ...t,
                lastRunAt: timestamp,
                lastRunStatus: run.status,
                lastRunError: run.error,
                lastRunAgent: run.agent,
                lastRunSessionKey: run.sessionKey,
              }
            : t)),
          activities: [
            makeActivity(run.status === 'ok' ? 'run' : 'runError', task.title, {
              agent: run.agent,
              error: run.error,
            }),
            ...state.activities,
          ].slice(0, MAX_ACTIVITIES),
        };
      }),

      clearCompleted: () => set((state) => ({
        tasks: state.tasks.filter((t) => t.status !== 'done'),
      })),

      reorderInColumn: (status, orderedIds) => set((state) => {
        const others = state.tasks.filter((t) => t.status !== status);
        const columnTasks = orderedIds
          .map((id) => state.tasks.find((t) => t.id === id))
          .filter(Boolean) as Task[];
        return { tasks: [...others, ...columnTasks] };
      }),
    }),
    { name: WORKSHOP_STORAGE_KEY },
  ),
);
