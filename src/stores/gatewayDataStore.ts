import { create } from 'zustand';

// ═══════════════════════════════════════════════════════════
// Gateway Data Store — Central data layer for all pages
//
// DESIGN:
//   All pages READ from this store — nobody calls gateway directly.
//   Smart polling fetches at 3 speeds:
//     Fast  (10s)  → sessions.list         (who's running now?)
//     Mid   (30s)  → agents.list + cron    (rarely change)
//     Slow  (120s) → usage.cost + sessions.usage (heavy, slow-changing)
//
//   Gateway events (session.started, etc.) update the store
//   in real-time without polling.
// ═══════════════════════════════════════════════════════════

// ── Types ────────────────────────────────────────────────

export interface SessionInfo {
  key: string;
  label?: string;
  model?: string;
  running?: boolean;
  totalTokens?: number;
  contextTokens?: number;
  maxTokens?: number;
  compactions?: number;
  lastActive?: string;
  kind?: string;
  [k: string]: any;
}

export interface AgentInfo {
  id: string;
  name?: string;
  model?: string;
  workspace?: string;
  [k: string]: any;
}

export interface DailyEntry {
  date: string;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  requests: number;
  [k: string]: any;
}

export interface CostSummary {
  days: number;
  daily: DailyEntry[];
  totals: {
    totalCost: number;
    inputCost: number;
    outputCost: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    requests: number;
    [k: string]: any;
  };
  updatedAt?: number;
}

export interface SessionsUsage {
  sessions?: any[];
  totals?: any;
  aggregates?: {
    byAgent?: any[];
    byModel?: any[];
    [k: string]: any;
  };
  [k: string]: any;
}

export interface CronJob {
  id: string;
  name?: string;
  schedule?: any;
  enabled?: boolean;
  lastRun?: string;
  state?: string;
  [k: string]: any;
}

// ── Store State ──────────────────────────────────────────

interface GatewayDataState {
  // Data
  sessions: SessionInfo[];
  agents: AgentInfo[];
  costSummary: CostSummary | null;
  sessionsUsage: SessionsUsage | null;
  cronJobs: CronJob[];

  // Timestamps (ms) — when each group was last fetched
  lastFetch: {
    sessions: number;
    agents: number;
    cost: number;
    usage: number;
    cron: number;
  };

  // Loading states per group
  loading: {
    sessions: boolean;
    agents: boolean;
    cost: boolean;
    usage: boolean;
    cron: boolean;
  };

  // Error states per group
  errors: {
    sessions: string | null;
    agents: string | null;
    cost: string | null;
    usage: string | null;
    cron: string | null;
  };

  // Polling active flag
  polling: boolean;

  // ── Actions ──

  // Setters (called by polling engine or event handler)
  setSessions: (sessions: SessionInfo[]) => void;
  setAgents: (agents: AgentInfo[]) => void;
  setCostSummary: (data: CostSummary) => void;
  setSessionsUsage: (data: SessionsUsage) => void;
  setCronJobs: (jobs: CronJob[]) => void;

  setLoading: (group: keyof GatewayDataState['loading'], val: boolean) => void;
  setError: (group: keyof GatewayDataState['errors'], err: string | null) => void;

  // Mark polling active/inactive
  setPolling: (active: boolean) => void;

  // ── Derived helpers (convenience) ──
  getMainSession: () => SessionInfo | undefined;
}

// ── Store ────────────────────────────────────────────────

export const useGatewayDataStore = create<GatewayDataState>((set, get) => ({
  // Data
  sessions: [],
  agents: [],
  costSummary: null,
  sessionsUsage: null,
  cronJobs: [],

  // Timestamps
  lastFetch: { sessions: 0, agents: 0, cost: 0, usage: 0, cron: 0 },

  // Loading
  loading: { sessions: false, agents: false, cost: false, usage: false, cron: false },

  // Errors
  errors: { sessions: null, agents: null, cost: null, usage: null, cron: null },

  polling: false,

  // ── Setters ──

  setSessions: (sessions) =>
    set({
      sessions,
      lastFetch: { ...get().lastFetch, sessions: Date.now() },
      loading: { ...get().loading, sessions: false },
      errors: { ...get().errors, sessions: null },
    }),

  setAgents: (agents) =>
    set({
      agents,
      lastFetch: { ...get().lastFetch, agents: Date.now() },
      loading: { ...get().loading, agents: false },
      errors: { ...get().errors, agents: null },
    }),

  setCostSummary: (data) =>
    set({
      costSummary: data,
      lastFetch: { ...get().lastFetch, cost: Date.now() },
      loading: { ...get().loading, cost: false },
      errors: { ...get().errors, cost: null },
    }),

  setSessionsUsage: (data) =>
    set({
      sessionsUsage: data,
      lastFetch: { ...get().lastFetch, usage: Date.now() },
      loading: { ...get().loading, usage: false },
      errors: { ...get().errors, usage: null },
    }),

  setCronJobs: (jobs) =>
    set({
      cronJobs: jobs,
      lastFetch: { ...get().lastFetch, cron: Date.now() },
      loading: { ...get().loading, cron: false },
      errors: { ...get().errors, cron: null },
    }),

  setLoading: (group, val) =>
    set({ loading: { ...get().loading, [group]: val } }),

  setError: (group, err) =>
    set({ errors: { ...get().errors, [group]: err } }),

  setPolling: (active) => set({ polling: active }),

  // ── Derived ──

  getMainSession: () =>
    get().sessions.find((s) => s.key === 'agent:main:main'),
}));


// ═══════════════════════════════════════════════════════════
// Polling Engine — starts/stops with gateway connection
// ═══════════════════════════════════════════════════════════

// Polling intervals (ms)
const FAST_INTERVAL  = 10_000;   // 10s — sessions
const MID_INTERVAL   = 30_000;   // 30s — agents + cron
const SLOW_INTERVAL  = 120_000;  // 120s — cost + usage

let fastTimer:  ReturnType<typeof setInterval> | null = null;
let midTimer:   ReturnType<typeof setInterval> | null = null;
let slowTimer:  ReturnType<typeof setInterval> | null = null;

// Reference to gateway (set by initPolling)
let gw: any = null;

// ── Fetch functions ──────────────────────────────────────

async function fetchSessions() {
  const store = useGatewayDataStore.getState();
  store.setLoading('sessions', true);
  try {
    const res = await gw.getSessions();
    const list = Array.isArray(res?.sessions) ? res.sessions : [];
    store.setSessions(list);
  } catch (e: any) {
    store.setError('sessions', e?.message || String(e));
    store.setLoading('sessions', false);
  }
}

async function fetchAgents() {
  const store = useGatewayDataStore.getState();
  store.setLoading('agents', true);
  try {
    const res = await gw.getAgents();
    const list = Array.isArray(res?.agents) ? res.agents
               : Array.isArray(res) ? res : [];
    store.setAgents(list);
  } catch (e: any) {
    store.setError('agents', e?.message || String(e));
    store.setLoading('agents', false);
  }
}

async function fetchCost() {
  const store = useGatewayDataStore.getState();
  store.setLoading('cost', true);
  try {
    const res = await gw.getCostSummary(30);
    if (res) store.setCostSummary(res);
  } catch (e: any) {
    store.setError('cost', e?.message || String(e));
    store.setLoading('cost', false);
  }
}

async function fetchUsage() {
  const store = useGatewayDataStore.getState();
  store.setLoading('usage', true);
  try {
    const res = await gw.getSessionsUsage({ limit: 100 });
    if (res) store.setSessionsUsage(res);
  } catch (e: any) {
    store.setError('usage', e?.message || String(e));
    store.setLoading('usage', false);
  }
}

async function fetchCron() {
  const store = useGatewayDataStore.getState();
  store.setLoading('cron', true);
  try {
    const res = await gw.call('cron.list', { includeDisabled: true });
    const list = Array.isArray(res?.jobs) ? res.jobs
               : Array.isArray(res) ? res : [];
    store.setCronJobs(list);
  } catch (e: any) {
    store.setError('cron', e?.message || String(e));
    store.setLoading('cron', false);
  }
}

// ── Grouped fetchers (called by timers) ─────────────────

async function tickFast() {
  await fetchSessions();
}

async function tickMid() {
  await Promise.allSettled([fetchAgents(), fetchCron()]);
}

async function tickSlow() {
  await Promise.allSettled([fetchCost(), fetchUsage()]);
}

// ── Public API ──────────────────────────────────────────

/**
 * Start smart polling. Call once when gateway connects.
 * @param gateway  The GatewayService instance
 */
export function startPolling(gateway: any) {
  // Prevent double-start
  if (gw && useGatewayDataStore.getState().polling) return;

  gw = gateway;
  useGatewayDataStore.getState().setPolling(true);
  console.log('[DataStore] ▶ Polling started (fast=10s, mid=30s, slow=120s)');

  // Immediate initial fetch — all groups
  tickFast();
  tickMid();
  tickSlow();

  // Set up intervals
  fastTimer = setInterval(tickFast, FAST_INTERVAL);
  midTimer  = setInterval(tickMid,  MID_INTERVAL);
  slowTimer = setInterval(tickSlow, SLOW_INTERVAL);
}

/**
 * Stop polling. Call when gateway disconnects.
 */
export function stopPolling() {
  if (fastTimer)  { clearInterval(fastTimer);  fastTimer  = null; }
  if (midTimer)   { clearInterval(midTimer);   midTimer   = null; }
  if (slowTimer)  { clearInterval(slowTimer);  slowTimer  = null; }
  gw = null;
  useGatewayDataStore.getState().setPolling(false);
  console.log('[DataStore] ⏹ Polling stopped');
}

/**
 * Force refresh all data now (e.g. user clicks Refresh button).
 */
export async function refreshAll() {
  if (!gw) return;
  console.log('[DataStore] 🔄 Manual refresh — all groups');
  await Promise.allSettled([tickFast(), tickMid(), tickSlow()]);
}

/**
 * Force refresh a specific group.
 */
export async function refreshGroup(group: 'sessions' | 'agents' | 'cost' | 'usage' | 'cron') {
  if (!gw) return;
  switch (group) {
    case 'sessions': return fetchSessions();
    case 'agents':   return fetchAgents();
    case 'cost':     return fetchCost();
    case 'usage':    return fetchUsage();
    case 'cron':     return fetchCron();
  }
}

/**
 * Fetch full-year cost data (for FullAnalytics).
 * NOT part of regular polling — only called on-demand.
 */
export async function fetchFullCost(days = 365): Promise<CostSummary | null> {
  if (!gw) return null;
  try {
    return await gw.getCostSummary(days);
  } catch {
    return null;
  }
}

/**
 * Fetch heavy usage data on-demand (for FullAnalytics).
 */
export async function fetchFullUsage(limit = 2000): Promise<SessionsUsage | null> {
  if (!gw) return null;
  try {
    return await gw.getSessionsUsage({ limit });
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// Event Handler — real-time updates from Gateway events
// ═══════════════════════════════════════════════════════════

/**
 * Handle a non-chat gateway event and update the store.
 * Call this from gateway.ts handleEvent for non-chat events.
 */
export function handleGatewayEvent(event: string, payload: any) {
  const store = useGatewayDataStore.getState();

  switch (event) {
    // ── Session events ──
    case 'session.started':
    case 'session.running': {
      const key = payload?.sessionKey || payload?.key;
      if (!key) break;
      const existing = store.sessions.find((s) => s.key === key);
      if (existing) {
        store.setSessions(
          store.sessions.map((s) => s.key === key ? { ...s, running: true } : s)
        );
      } else {
        // New session — add it
        store.setSessions([...store.sessions, { key, running: true, ...payload }]);
      }
      console.log('[DataStore] 📡 Session started:', key);
      break;
    }

    case 'session.ended':
    case 'session.stopped':
    case 'session.idle': {
      const key = payload?.sessionKey || payload?.key;
      if (!key) break;
      store.setSessions(
        store.sessions.map((s) => s.key === key ? { ...s, running: false } : s)
      );
      console.log('[DataStore] 📡 Session ended:', key);
      break;
    }

    // ── Cron events ──
    case 'cron.run.started': {
      const jobId = payload?.jobId || payload?.id;
      if (!jobId) break;
      store.setCronJobs(
        store.cronJobs.map((j) => j.id === jobId ? { ...j, state: 'running' } : j)
      );
      console.log('[DataStore] 📡 Cron started:', jobId);
      break;
    }

    case 'cron.run.completed':
    case 'cron.run.finished': {
      const jobId = payload?.jobId || payload?.id;
      if (!jobId) break;
      store.setCronJobs(
        store.cronJobs.map((j) => j.id === jobId
          ? { ...j, state: 'idle', lastRun: new Date().toISOString() }
          : j)
      );
      console.log('[DataStore] 📡 Cron completed:', jobId);
      break;
    }

    // ── Agent events ──
    case 'agent.spawned':
    case 'agent.created': {
      // Trigger a full agents refresh to get accurate data
      fetchAgents();
      console.log('[DataStore] 📡 Agent event — refreshing agents');
      break;
    }

    // ── Catch-all logging ──
    default:
      console.log('[DataStore] 📡 Unhandled event:', event, JSON.stringify(payload).substring(0, 200));
      break;
  }
}
