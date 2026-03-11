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
  state?: any;
  // Gateway 2026.2.22+: split run vs delivery status
  lastRunStatus?: string;
  lastDeliveryStatus?: string;
  [k: string]: any;
}

// ── Running Sub-Agent Tracking ───────────────────────────
// Detected from sessions polling (every 10s).
// Gateway WebSocket does NOT send stream:"tool" events,
// so we scan sessions.list for key "agent:<id>:subagent:<uuid>" + running=true.

export interface RunningSubAgent {
  agentId: string;
  startTime: number;
  label?: string;
  sessionKey?: string;
}

// ── Store State ──────────────────────────────────────────

interface GatewayDataState {
  // Data
  sessions: SessionInfo[];
  agents: AgentInfo[];
  costSummary: CostSummary | null;
  sessionsUsage: SessionsUsage | null;
  cronJobs: CronJob[];
  runningSubAgents: RunningSubAgent[];

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
  // Last gateway heartbeat/tick event timestamp
  lastGatewayTick: number;

  // ── Actions ──

  // Setters (called by polling engine or event handler)
  setSessions: (sessions: SessionInfo[]) => void;
  setAgents: (agents: AgentInfo[]) => void;
  setCostSummary: (data: CostSummary) => void;
  setSessionsUsage: (data: SessionsUsage) => void;
  setCronJobs: (jobs: CronJob[]) => void;

  setLoading: (group: keyof GatewayDataState['loading'], val: boolean) => void;
  setError: (group: keyof GatewayDataState['errors'], err: string | null) => void;

  // Sub-agent tracking (synced from sessions polling)
  setRunningSubAgents: (list: RunningSubAgent[]) => void;

  // Mark polling active/inactive
  setPolling: (active: boolean) => void;
  setLastGatewayTick: (ts: number) => void;

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
  runningSubAgents: [],

  // Timestamps
  lastFetch: { sessions: 0, agents: 0, cost: 0, usage: 0, cron: 0 },

  // Loading
  loading: { sessions: false, agents: false, cost: false, usage: false, cron: false },

  // Errors
  errors: { sessions: null, agents: null, cost: null, usage: null, cron: null },

  polling: false,
  lastGatewayTick: 0,

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

  // ── Sub-agent tracking ──

  setRunningSubAgents: (list) => set({ runningSubAgents: list }),

  setPolling: (active) => set({ polling: active }),
  setLastGatewayTick: (ts) => set({ lastGatewayTick: ts }),

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

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function emptyTotals() {
  return {
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    requests: 0,
    totalTokens: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    missingCostEntries: 0,
  };
}

function mergeTotals(target: any, source: any) {
  const out = { ...target };
  out.totalCost += toNum(source?.totalCost);
  out.inputCost += toNum(source?.inputCost);
  out.outputCost += toNum(source?.outputCost);
  out.input += toNum(source?.input);
  out.output += toNum(source?.output);
  out.cacheRead += toNum(source?.cacheRead);
  out.cacheWrite += toNum(source?.cacheWrite);
  out.requests += toNum(source?.requests);
  out.totalTokens += toNum(source?.totalTokens) || (toNum(source?.input) + toNum(source?.output) + toNum(source?.cacheRead) + toNum(source?.cacheWrite));
  out.cacheReadCost += toNum(source?.cacheReadCost);
  out.cacheWriteCost += toNum(source?.cacheWriteCost);
  out.missingCostEntries += toNum(source?.missingCostEntries);
  return out;
}

function normalizeDailyEntry(entry: any) {
  return {
    date: String(entry?.date || ''),
    totalCost: toNum(entry?.totalCost ?? entry?.cost),
    inputCost: toNum(entry?.inputCost),
    outputCost: toNum(entry?.outputCost),
    input: toNum(entry?.input),
    output: toNum(entry?.output),
    cacheRead: toNum(entry?.cacheRead),
    cacheWrite: toNum(entry?.cacheWrite),
    requests: toNum(entry?.requests),
    totalTokens: toNum(entry?.totalTokens) || (toNum(entry?.input) + toNum(entry?.output) + toNum(entry?.cacheRead) + toNum(entry?.cacheWrite)),
    cacheReadCost: toNum(entry?.cacheReadCost),
    cacheWriteCost: toNum(entry?.cacheWriteCost),
    missingCostEntries: toNum(entry?.missingCostEntries),
  };
}

function normalizeCostSummary(summary: any, fallbackDays = 30): CostSummary | null {
  if (!summary || typeof summary !== 'object') return null;
  const dailyRaw = Array.isArray(summary.daily) ? summary.daily : [];
  const daily = dailyRaw
    .map(normalizeDailyEntry)
    .filter((d) => d.date);
  const totals = mergeTotals(emptyTotals(), summary.totals || {});
  if (totals.totalTokens <= 0 && daily.length > 0) {
    for (const row of daily) {
      Object.assign(totals, mergeTotals(totals, row));
    }
  }
  return {
    days: Number.isFinite(Number(summary.days)) ? Number(summary.days) : fallbackDays,
    daily,
    totals,
    updatedAt: Number(summary.updatedAt) || Date.now(),
  };
}

function mergeCostSummaries(openClaw: any, ontoSynth: any, fallbackDays = 30): CostSummary | null {
  const a = normalizeCostSummary(openClaw, fallbackDays);
  const b = normalizeCostSummary(ontoSynth, fallbackDays);
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;

  const dailyMap = new Map<string, any>();
  for (const row of a.daily) dailyMap.set(row.date, { ...row });
  for (const row of b.daily) {
    const current = dailyMap.get(row.date) || normalizeDailyEntry({ date: row.date });
    dailyMap.set(row.date, mergeTotals(current, row));
    dailyMap.get(row.date).date = row.date;
  }
  const mergedDaily = Array.from(dailyMap.values()).sort((x, y) => String(x.date).localeCompare(String(y.date)));
  return {
    days: Math.max(a.days || 0, b.days || 0, fallbackDays),
    daily: mergedDaily,
    totals: mergeTotals(a.totals || emptyTotals(), b.totals || {}),
    updatedAt: Math.max(toNum(a.updatedAt), toNum(b.updatedAt), Date.now()),
  };
}

function normalizeUsageResponse(response: any): any | null {
  if (!response || typeof response !== 'object') return null;
  const totals = mergeTotals(emptyTotals(), response.totals || {});
  const aggregates = response.aggregates || {};
  return {
    updatedAt: Number(response.updatedAt) || Date.now(),
    startDate: String(response.startDate || ''),
    endDate: String(response.endDate || ''),
    sessions: Array.isArray(response.sessions) ? response.sessions : [],
    totals,
    aggregates: {
      messages: aggregates.messages || { total: 0, user: 0, assistant: 0, toolCalls: 0, toolResults: 0, errors: 0 },
      tools: aggregates.tools || { totalCalls: 0, uniqueTools: 0, tools: [] },
      byAgent: Array.isArray(aggregates.byAgent) ? aggregates.byAgent : [],
      byModel: Array.isArray(aggregates.byModel) ? aggregates.byModel : [],
      byProvider: Array.isArray(aggregates.byProvider) ? aggregates.byProvider : [],
      byApplicationPhaseModel: Array.isArray(aggregates.byApplicationPhaseModel) ? aggregates.byApplicationPhaseModel : [],
      daily: Array.isArray(aggregates.daily) ? aggregates.daily.map(normalizeDailyEntry).filter((d: any) => d.date) : [],
    },
  };
}

function mergeUsageBreakdowns(openClaw: any, ontoSynth: any): any | null {
  const a = normalizeUsageResponse(openClaw);
  const b = normalizeUsageResponse(ontoSynth);
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;

  const byAgentMap = new Map<string, any>();
  for (const row of a.aggregates.byAgent || []) byAgentMap.set(String(row?.agentId || 'unknown'), { ...row, totals: mergeTotals(emptyTotals(), row?.totals || {}) });
  for (const row of b.aggregates.byAgent || []) {
    const key = String(row?.agentId || 'unknown');
    const cur = byAgentMap.get(key) || { agentId: key, totals: emptyTotals() };
    cur.totals = mergeTotals(cur.totals, row?.totals || {});
    byAgentMap.set(key, cur);
  }

  const byModelMap = new Map<string, any>();
  const addModel = (row: any) => {
    const provider = String(row?.provider || '');
    const model = String(row?.model || 'unknown');
    const key = `${provider}::${model}`;
    const cur = byModelMap.get(key) || { provider: provider || undefined, model, count: 0, totals: emptyTotals() };
    cur.count += toNum(row?.count) || 1;
    cur.totals = mergeTotals(cur.totals, row?.totals || {});
    byModelMap.set(key, cur);
  };
  (a.aggregates.byModel || []).forEach(addModel);
  (b.aggregates.byModel || []).forEach(addModel);

  const byProviderMap = new Map<string, any>();
  const addProvider = (row: any) => {
    const provider = String(row?.provider || row?.model || 'unknown');
    const cur = byProviderMap.get(provider) || { provider, model: provider, count: 0, totals: emptyTotals() };
    cur.count += toNum(row?.count) || 1;
    cur.totals = mergeTotals(cur.totals, row?.totals || {});
    byProviderMap.set(provider, cur);
  };
  (a.aggregates.byProvider || []).forEach(addProvider);
  (b.aggregates.byProvider || []).forEach(addProvider);

  const dailyMap = new Map<string, any>();
  const addDaily = (row: any) => {
    const day = String(row?.date || '');
    if (!day) return;
    const cur = dailyMap.get(day) || normalizeDailyEntry({ date: day });
    dailyMap.set(day, mergeTotals(cur, row));
    dailyMap.get(day).date = day;
  };
  (a.aggregates.daily || []).forEach(addDaily);
  (b.aggregates.daily || []).forEach(addDaily);

  const messagesA = a.aggregates.messages || {};
  const messagesB = b.aggregates.messages || {};
  const toolsA = a.aggregates.tools || {};
  const toolsB = b.aggregates.tools || {};

  return {
    updatedAt: Math.max(toNum(a.updatedAt), toNum(b.updatedAt), Date.now()),
    startDate: a.startDate || b.startDate || '',
    endDate: a.endDate || b.endDate || '',
    sessions: [...(a.sessions || []), ...(b.sessions || [])],
    totals: mergeTotals(a.totals || emptyTotals(), b.totals || {}),
    aggregates: {
      messages: {
        total: toNum(messagesA.total) + toNum(messagesB.total),
        user: toNum(messagesA.user) + toNum(messagesB.user),
        assistant: toNum(messagesA.assistant) + toNum(messagesB.assistant),
        toolCalls: toNum(messagesA.toolCalls) + toNum(messagesB.toolCalls),
        toolResults: toNum(messagesA.toolResults) + toNum(messagesB.toolResults),
        errors: toNum(messagesA.errors) + toNum(messagesB.errors),
      },
      tools: {
        totalCalls: toNum(toolsA.totalCalls) + toNum(toolsB.totalCalls),
        uniqueTools: Math.max(toNum(toolsA.uniqueTools), toNum(toolsB.uniqueTools)),
        tools: [...(Array.isArray(toolsA.tools) ? toolsA.tools : []), ...(Array.isArray(toolsB.tools) ? toolsB.tools : [])],
      },
      byAgent: Array.from(byAgentMap.values()),
      byModel: Array.from(byModelMap.values()),
      byProvider: Array.from(byProviderMap.values()),
      byApplicationPhaseModel: [
        ...(Array.isArray(a.aggregates.byApplicationPhaseModel) ? a.aggregates.byApplicationPhaseModel : []),
        ...(Array.isArray(b.aggregates.byApplicationPhaseModel) ? b.aggregates.byApplicationPhaseModel : []),
      ],
      daily: Array.from(dailyMap.values()).sort((x, y) => String(x.date).localeCompare(String(y.date))),
    },
  };
}

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
    const [openClawResult, ontoSynthResult] = await Promise.allSettled([
      gw.getCostSummary(30),
      gw.getOntoSynthCostSummary(30),
    ]);
    const openClaw = openClawResult.status === 'fulfilled' ? openClawResult.value : null;
    const ontoSynth = ontoSynthResult.status === 'fulfilled' ? ontoSynthResult.value : null;
    const merged = mergeCostSummaries(openClaw, ontoSynth, 30);
    if (merged) {
      store.setCostSummary(merged);
      return;
    }
    throw new Error('No cost data available from OpenClaw or OntoSynth');
  } catch (e: any) {
    store.setError('cost', e?.message || String(e));
    store.setLoading('cost', false);
  }
}

async function fetchUsage() {
  const store = useGatewayDataStore.getState();
  store.setLoading('usage', true);
  try {
    const [openClawResult, ontoSynthResult] = await Promise.allSettled([
      gw.getSessionsUsage({ limit: 100 }),
      gw.getOntoSynthUsage({ days: 30 }),
    ]);
    const openClaw = openClawResult.status === 'fulfilled' ? openClawResult.value : null;
    const ontoSynth = ontoSynthResult.status === 'fulfilled' ? ontoSynthResult.value : null;
    const merged = mergeUsageBreakdowns(openClaw, ontoSynth);
    if (merged) {
      store.setSessionsUsage(merged);
      return;
    }
    throw new Error('No usage data available from OpenClaw or OntoSynth');
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
  // Detect running sub-agents from sessions data
  syncRunningSubAgents();
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
  const [openClawResult, ontoSynthResult] = await Promise.allSettled([
    gw.getCostSummary(days),
    gw.getOntoSynthCostSummary(days),
  ]);
  const openClaw = openClawResult.status === 'fulfilled' ? openClawResult.value : null;
  const ontoSynth = ontoSynthResult.status === 'fulfilled' ? ontoSynthResult.value : null;
  return mergeCostSummaries(openClaw, ontoSynth, days);
}

/**
 * Fetch heavy usage data on-demand (for FullAnalytics).
 */
export async function fetchFullUsage(
  params: { limit?: number; startDate?: string; endDate?: string; key?: string } = {}
): Promise<SessionsUsage | null> {
  if (!gw) return null;
  const daysFromRange = (() => {
    const start = String(params.startDate || '').trim();
    const end = String(params.endDate || '').trim();
    if (!start || !end) return 365;
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffMs = endDate.getTime() - startDate.getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return 365;
    return Math.min(365, Math.max(1, Math.floor(diffMs / 86_400_000) + 1));
  })();
  const [openClawResult, ontoSynthResult] = await Promise.allSettled([
    gw.getSessionsUsage(params),
    gw.getOntoSynthUsage({ days: daysFromRange, startDate: params.startDate, endDate: params.endDate }),
  ]);
  const openClaw = openClawResult.status === 'fulfilled' ? openClawResult.value : null;
  const ontoSynth = ontoSynthResult.status === 'fulfilled' ? ontoSynthResult.value : null;
  return mergeUsageBreakdowns(openClaw, ontoSynth);
}

// ═══════════════════════════════════════════════════════════
// Sub-Agent Detection — polling-based
// Gateway WebSocket does NOT emit stream:"tool" events,
// so we detect running sub-agents from sessions.list data.
// ═══════════════════════════════════════════════════════════

const SUB_AGENT_RE = /^agent:([^:]+):subagent:/;

/**
 * Sync runningSubAgents from sessions data.
 * Called every 10s in tickFast() after fetchSessions().
 * Sessions with key "agent:<id>:subagent:<uuid>" that appear in sessions.list
 * are running — completed sub-agent sessions are removed from the list automatically.
 * Note: sessions.list does NOT return a "running" field, so presence = active.
 */
function syncRunningSubAgents() {
  const store = useGatewayDataStore.getState();
  const sessions = store.sessions;
  const prev = store.runningSubAgents;

  // Any sub-agent session in sessions.list is active (completed ones get removed)
  const running: RunningSubAgent[] = [];
  for (const s of sessions) {
    const match = s.key?.match(SUB_AGENT_RE);
    if (!match) continue;

    const agentId = match[1];
    // Preserve startTime for already-tracked entries
    const existing = prev.find((r) => r.sessionKey === s.key);
    running.push({
      agentId,
      startTime: existing?.startTime || Date.now(),
      label: s.label || s.displayName || '',
      sessionKey: s.key,
    });
  }

  // Only update store if list actually changed
  const prevKeys = new Set(prev.map((r) => r.sessionKey));
  const newKeys = new Set(running.map((r) => r.sessionKey));
  const changed =
    prev.length !== running.length ||
    running.some((r) => !prevKeys.has(r.sessionKey)) ||
    prev.some((r) => !newKeys.has(r.sessionKey));

  if (!changed) return;

  // Log transitions
  for (const r of running) {
    if (!prevKeys.has(r.sessionKey)) {
      console.log('[DataStore] 🚀 Sub-agent detected:', r.agentId, r.label);
    }
  }
  for (const old of prev) {
    if (!newKeys.has(old.sessionKey)) {
      console.log('[DataStore] ✅ Sub-agent done:', old.agentId);
    }
  }

  store.setRunningSubAgents(running);
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
    // ── Gateway heartbeat/tick events ──
    case 'tick':
    case 'health': {
      const ts = Number(payload?.ts) || Date.now();
      store.setLastGatewayTick(ts);
      break;
    }

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
