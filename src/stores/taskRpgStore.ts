import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { migrateStorageKey, storageKey } from '@/utils/storage';

export type MessageChannel = 'email' | 'sms' | 'slack' | 'other';

export interface MessageTask {
  id: string;
  title: string;
  channel: MessageChannel;
  providerId?: string;
  upCount: number;
  downCount: number;
  createdAt: string;
  source?: 'manual' | 'gateway' | 'provider';
  externalKey?: string;
  receivedAt?: string;
  unread?: boolean;
}

export interface DailyTask {
  id: string;
  title: string;
  done: boolean;
  streak: number;
  lastCompletedOn?: string;
  createdAt: string;
}

export interface TodoTask {
  id: string;
  title: string;
  completed: boolean;
  dueDate?: string;
  createdAt: string;
}

export interface RewardTask {
  id: string;
  title: string;
  cost: number;
  redeemedCount: number;
  createdAt: string;
}

interface TaskRpgState {
  points: number;
  messages: MessageTask[];
  dailies: DailyTask[];
  todos: TodoTask[];
  rewards: RewardTask[];
  seenExternalKeys: string[];
  lastDailyReset: string;
  addMessage: (title: string, channel: MessageChannel, providerId?: string) => void;
  addDaily: (title: string) => void;
  addTodo: (title: string, dueDate?: string) => void;
  addReward: (title: string, cost: number) => void;
  deleteMessage: (id: string) => void;
  deleteDaily: (id: string) => void;
  deleteTodo: (id: string) => void;
  deleteReward: (id: string) => void;
  scoreMessage: (id: string, direction: 'up' | 'down') => void;
  importExternalMessages: (items: Array<{
    title: string;
    channel: MessageChannel;
    providerId?: string;
    externalKey: string;
    receivedAt?: string;
    unread?: boolean;
    source?: 'gateway' | 'provider';
  }>) => { added: number };
  toggleDaily: (id: string, checked: boolean) => void;
  toggleTodo: (id: string, checked: boolean) => void;
  redeemReward: (id: string) => boolean;
  runDailyResetIfNeeded: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayKey(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function clampPoints(n: number): number {
  return Math.max(0, n);
}

const TASK_RPG_STORAGE_KEY = storageKey('task-rpg');
migrateStorageKey(TASK_RPG_STORAGE_KEY, 'aegis-task-rpg');

export const useTaskRpgStore = create<TaskRpgState>()(
  persist(
    (set, get) => ({
      points: 24,
      messages: [
        {
          id: 'msg-inbox-triage',
          title: 'Inbox triage: VIP senders',
          channel: 'email',
          upCount: 0,
          downCount: 0,
          createdAt: nowIso(),
        },
      ],
      dailies: [
        {
          id: 'daily-inbox-zero',
          title: 'Clear urgent email + SMS queue',
          done: false,
          streak: 0,
          createdAt: nowIso(),
        },
      ],
      todos: [
        {
          id: 'todo-follow-up',
          title: 'Reply to pending client follow-ups',
          completed: false,
          createdAt: nowIso(),
        },
      ],
      rewards: [
        {
          id: 'reward-break',
          title: 'Coffee break',
          cost: 10,
          redeemedCount: 0,
          createdAt: nowIso(),
        },
      ],
      seenExternalKeys: [],
      lastDailyReset: todayKey(),

      addMessage: (title, channel, providerId) => set((state) => {
        const clean = title.trim();
        if (!clean) return state;
        return {
          messages: [
            ...state.messages,
            {
              id: createId('msg'),
              title: clean,
              channel,
              providerId,
              upCount: 0,
              downCount: 0,
              createdAt: nowIso(),
            },
          ],
        };
      }),

      addDaily: (title) => set((state) => {
        const clean = title.trim();
        if (!clean) return state;
        return {
          dailies: [
            ...state.dailies,
            {
              id: createId('daily'),
              title: clean,
              done: false,
              streak: 0,
              createdAt: nowIso(),
            },
          ],
        };
      }),

      addTodo: (title, dueDate) => set((state) => {
        const clean = title.trim();
        if (!clean) return state;
        return {
          todos: [
            ...state.todos,
            {
              id: createId('todo'),
              title: clean,
              completed: false,
              dueDate: dueDate || undefined,
              createdAt: nowIso(),
            },
          ],
        };
      }),

      addReward: (title, cost) => set((state) => {
        const clean = title.trim();
        if (!clean || Number.isNaN(cost) || cost <= 0) return state;
        return {
          rewards: [
            ...state.rewards,
            {
              id: createId('reward'),
              title: clean,
              cost: Math.round(cost),
              redeemedCount: 0,
              createdAt: nowIso(),
            },
          ],
        };
      }),

      deleteMessage: (id) => set((state) => ({ messages: state.messages.filter((m) => m.id !== id) })),
      deleteDaily: (id) => set((state) => ({ dailies: state.dailies.filter((d) => d.id !== id) })),
      deleteTodo: (id) => set((state) => ({ todos: state.todos.filter((t) => t.id !== id) })),
      deleteReward: (id) => set((state) => ({ rewards: state.rewards.filter((r) => r.id !== id) })),

      scoreMessage: (id, direction) => set((state) => {
        const pointsDelta = direction === 'up' ? 2 : -1;
        return {
          points: clampPoints(state.points + pointsDelta),
          messages: state.messages.map((m) =>
            m.id === id
              ? {
                  ...m,
                  upCount: m.upCount + (direction === 'up' ? 1 : 0),
                  downCount: m.downCount + (direction === 'down' ? 1 : 0),
                }
              : m,
          ),
        };
      }),

      importExternalMessages: (items) => {
        const state = get();
        if (!items.length) return { added: 0 };

        const seen = new Set(state.seenExternalKeys);
        const nextMessages: MessageTask[] = [];
        const nextSeen: string[] = [];

        for (const item of items) {
          const key = item.externalKey?.trim();
          const title = item.title?.trim();
          if (!key || !title || seen.has(key)) continue;

          seen.add(key);
          nextSeen.push(key);
          nextMessages.push({
            id: createId('msg'),
            title,
            channel: item.channel,
            providerId: item.providerId,
            upCount: 0,
            downCount: 0,
            createdAt: nowIso(),
            source: item.source ?? 'gateway',
            externalKey: key,
            receivedAt: item.receivedAt,
            unread: item.unread ?? true,
          });
        }

        if (!nextMessages.length) return { added: 0 };

        set((current) => ({
          messages: [...nextMessages, ...current.messages],
          seenExternalKeys: [...current.seenExternalKeys, ...nextSeen],
        }));

        return { added: nextMessages.length };
      },

      toggleDaily: (id, checked) => set((state) => {
        const delta = checked ? 5 : -5;
        return {
          points: clampPoints(state.points + delta),
          dailies: state.dailies.map((d) =>
            d.id === id
              ? {
                  ...d,
                  done: checked,
                  streak: checked ? d.streak + 1 : Math.max(0, d.streak - 1),
                  lastCompletedOn: checked ? todayKey() : d.lastCompletedOn,
                }
              : d,
          ),
        };
      }),

      toggleTodo: (id, checked) => set((state) => {
        const delta = checked ? 8 : -8;
        return {
          points: clampPoints(state.points + delta),
          todos: state.todos.map((t) => (t.id === id ? { ...t, completed: checked } : t)),
        };
      }),

      redeemReward: (id) => {
        const state = get();
        const reward = state.rewards.find((r) => r.id === id);
        if (!reward || state.points < reward.cost) return false;

        set((current) => ({
          points: current.points - reward.cost,
          rewards: current.rewards.map((r) =>
            r.id === id ? { ...r, redeemedCount: r.redeemedCount + 1 } : r,
          ),
        }));
        return true;
      },

      runDailyResetIfNeeded: () => {
        const state = get();
        const today = todayKey();
        if (state.lastDailyReset === today) return;

        set({
          lastDailyReset: today,
          dailies: state.dailies.map((d) => ({ ...d, done: false })),
        });
      },
    }),
    { name: TASK_RPG_STORAGE_KEY },
  ),
);
