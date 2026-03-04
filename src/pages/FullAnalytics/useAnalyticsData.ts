// ═══════════════════════════════════════════════════════════
// useAnalyticsData — Custom hook
// Handles all state, data fetching, caching, date filtering,
// and derived computations for the FullAnalytics page.
//
// UX Contract:
//   • Page defaults to "Last 30 Days" on first visit.
//   • Clicking a preset changes the view immediately but does NOT
//     persist the selection — it's volatile.
//   • Clicking "Apply" saves the current preset to localStorage,
//     so next visit starts with that preset.
//   • "All Time" fetches 365 days + 2000 sessions.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useChatStore }  from '@/stores/chatStore';
import { fetchFullCost, fetchFullUsage, useGatewayDataStore } from '@/stores/gatewayDataStore';

import {
  type CostSummary,
  type SessionsUsageResponse,
  type CostTotals,
  type ByAgentEntry,
  type ByModelEntry,
  type DailyEntry,
  type PresetId,
} from './types';
import { getAgentColor } from './helpers';
import { cacheGet, cacheSet, CACHE_KEY_FULL_COST, CACHE_KEY_FULL_USAGE } from './cache';

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════
const PRESET_STORAGE_KEY       = 'aegis:analytics:savedPreset';   // v2 — old key auto-saved without Apply
const CUSTOM_DATES_STORAGE_KEY = 'aegis:analytics:customDates';
const OLD_PRESET_KEY           = 'aegis:analytics:preset';        // Legacy — will be cleaned up on load
const STALE_THRESHOLD_MS       = 15 * 60 * 1000; // 15 minutes

const EMPTY_TOTALS: CostTotals = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
  totalTokens: 0, totalCost: 0,
  inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0,
  missingCostEntries: 0,
};

interface OpenRouterPricing {
  prompt: number;
  completion: number;
  cacheRead: number;
  cacheWrite: number;
}

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeModelKey(value?: string): string {
  return String(value || '').trim().toLowerCase();
}

function stripOpenRouterPrefix(value: string): string {
  return value.replace(/^openrouter\//, '');
}

function computeCostFromPricing(tokens: CostTotals, pricing: OpenRouterPricing): Pick<CostTotals, 'inputCost' | 'outputCost' | 'cacheReadCost' | 'cacheWriteCost' | 'totalCost'> {
  const promptRate = pricing.prompt;
  const completionRate = pricing.completion > 0 ? pricing.completion : pricing.prompt;
  const cacheReadRate = pricing.cacheRead > 0 ? pricing.cacheRead : pricing.prompt;
  const cacheWriteRate = pricing.cacheWrite > 0 ? pricing.cacheWrite : pricing.prompt;

  const inputCost = tokens.input * promptRate;
  const outputCost = tokens.output * completionRate;
  const cacheReadCost = tokens.cacheRead * cacheReadRate;
  const cacheWriteCost = tokens.cacheWrite * cacheWriteRate;
  const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;

  return { inputCost, outputCost, cacheReadCost, cacheWriteCost, totalCost };
}

function costSignature(data: CostSummary | null | undefined): string {
  if (!data) return 'cost:null';
  const totals = data.totals || EMPTY_TOTALS;
  const daily = Array.isArray(data.daily) ? data.daily : [];
  const headDate = daily[0]?.date || '';
  const tailDate = daily[daily.length - 1]?.date || '';
  return [
    'cost',
    data.updatedAt || 0,
    data.days || 0,
    daily.length,
    headDate,
    tailDate,
    toNum(totals.totalTokens),
    toNum(totals.totalCost),
    toNum(totals.missingCostEntries),
  ].join('|');
}

function usageSignature(data: SessionsUsageResponse | null | undefined): string {
  if (!data) return 'usage:null';
  const totals = data.totals || EMPTY_TOTALS;
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const firstSessionTs = sessions[0]?.updatedAt || sessions[0]?.createdAt || '';
  const byAgentCount = Array.isArray(data.aggregates?.byAgent) ? data.aggregates.byAgent.length : 0;
  const byModelCount = Array.isArray(data.aggregates?.byModel) ? data.aggregates.byModel.length : 0;
  return [
    'usage',
    data.updatedAt || 0,
    data.startDate || '',
    data.endDate || '',
    sessions.length,
    firstSessionTs,
    byAgentCount,
    byModelCount,
    toNum(totals.totalTokens),
    toNum(totals.totalCost),
    toNum(totals.missingCostEntries),
  ].join('|');
}

function accumulateTotals(target: CostTotals, source: Partial<CostTotals>): void {
  target.input             += source.input             || 0;
  target.output            += source.output            || 0;
  target.cacheRead         += source.cacheRead         || 0;
  target.cacheWrite        += source.cacheWrite        || 0;
  target.totalTokens       += source.totalTokens       || 0;
  target.totalCost         += source.totalCost         || 0;
  target.inputCost         += source.inputCost         || 0;
  target.outputCost        += source.outputCost        || 0;
  target.cacheReadCost     += source.cacheReadCost     || 0;
  target.cacheWriteCost    += source.cacheWriteCost    || 0;
  target.missingCostEntries += source.missingCostEntries || 0;
}

/** Map a preset to the fetch parameters (days for cost, limit for sessions) */
function getFetchParams(preset: PresetId): { days: number; limit: number } {
  switch (preset) {
    case 'all':       return { days: 365, limit: 2000 };
    case '90d':       return { days: 90,  limit: 500  };
    case 'thisMonth': return { days: 31,  limit: 200  }; // Months can have 31 days
    default:          return { days: 30,  limit: 200  };
  }
}

// ═══════════════════════════════════════════════════════════
// Public interface
// ═══════════════════════════════════════════════════════════
export interface AnalyticsData {
  // Raw / server data
  costData:  CostSummary | null;
  usageData: SessionsUsageResponse | null;

  // UI state
  loading:      boolean;
  isRefetching: boolean;
  error:        string | null;

  // Date range
  activePreset: PresetId;
  savedPreset:  PresetId;
  startDate:    string;
  endDate:      string;

  // Filtered & derived
  daily:         DailyEntry[];
  totals:        CostTotals;
  sessions:      any[];
  byAgent:       ByAgentEntry[];
  byModel:       ByModelEntry[];
  periodInfo:    { start: string; end: string; days: number };
  totalApiCalls: number;

  // Chart data
  chartData: { date: string; cost: number; input: number; output: number }[];
  donutData: {
    name:       string;
    value:      number;
    color:      string;
    tokens:     number;
    actualCost: number;
  }[];

  // OpenRouter pricing sync
  pricingSyncing: boolean;
  pricingLastSyncedAt: number | null;
  pricingError: string | null;
  pricingPatchedEntries: number;

  // Handlers
  handlePresetSelect: (id: PresetId, start: string, end: string) => void;
  handleApply:        (customStart?: string, customEnd?: string) => void;
  refresh:            () => void;
  syncModelPricing:   () => Promise<void>;
}


// ═══════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════
export function useAnalyticsData(): AnalyticsData {
  const { connected } = useChatStore();
  const gatewayTickTs = useGatewayDataStore((s) => s.lastGatewayTick);

  // ── Core data state ──
  const [costData,     setCostData]     = useState<CostSummary | null>(null);
  const [usageData,    setUsageData]    = useState<SessionsUsageResponse | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [pricingMap, setPricingMap] = useState<Map<string, OpenRouterPricing>>(new Map());
  const [pricingSyncing, setPricingSyncing] = useState(false);
  const [pricingLastSyncedAt, setPricingLastSyncedAt] = useState<number | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const costSigRef = useRef<string>('cost:null');
  const usageSigRef = useRef<string>('usage:null');
  const fetchInFlightRef = useRef(false);
  const lastAutoRefreshAtRef = useRef(0);

  // ── Saved preference — only changes via Apply ──
  const [savedPreset, setSavedPreset] = useState<PresetId>(
    () => (localStorage.getItem(PRESET_STORAGE_KEY) as PresetId) || '30d'
  );

  // ── Current view — volatile, resets to savedPreset on mount ──
  const [activePreset, setActivePreset] = useState<PresetId>(
    () => (localStorage.getItem(PRESET_STORAGE_KEY) as PresetId) || '30d'
  );
  const [startDate, setStartDate] = useState<string>('');
  const [endDate,   setEndDate]   = useState<string>('');

  const syncModelPricing = useCallback(async () => {
    if (pricingSyncing) return;
    setPricingSyncing(true);
    setPricingError(null);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models');
      if (!response.ok) throw new Error(`OpenRouter models HTTP ${response.status}`);
      const payload = await response.json();
      const rows = Array.isArray(payload?.data) ? payload.data : [];

      const next = new Map<string, OpenRouterPricing>();
      for (const row of rows) {
        const id = normalizeModelKey(row?.id);
        if (!id) continue;
        const canonical = normalizeModelKey(row?.canonical_slug);
        const pricing = row?.pricing || {};
        const parsed: OpenRouterPricing = {
          prompt: toNum(pricing.prompt),
          completion: toNum(pricing.completion),
          cacheRead: toNum(pricing.input_cache_read),
          cacheWrite: toNum(pricing.input_cache_write),
        };
        if (parsed.prompt <= 0 && parsed.completion <= 0 && parsed.cacheRead <= 0 && parsed.cacheWrite <= 0) continue;

        next.set(id, parsed);
        next.set(`openrouter/${id}`, parsed);
        const stripped = stripOpenRouterPrefix(id);
        next.set(stripped, parsed);
        next.set(`openrouter/${stripped}`, parsed);

        if (canonical) {
          next.set(canonical, parsed);
          next.set(`openrouter/${canonical}`, parsed);
          const canonicalStripped = stripOpenRouterPrefix(canonical);
          next.set(canonicalStripped, parsed);
          next.set(`openrouter/${canonicalStripped}`, parsed);
        }
      }

      setPricingMap(next);
      setPricingLastSyncedAt(Date.now());
    } catch (err: any) {
      setPricingError(err?.message || 'Failed to sync OpenRouter pricing');
    } finally {
      setPricingSyncing(false);
    }
  }, [pricingSyncing]);

  // ── Cache hydration — show stale data immediately on mount ──
  const hydrateFromCache = useCallback(() => {
    const cachedCost  = cacheGet<CostSummary>(CACHE_KEY_FULL_COST);
    const cachedUsage = cacheGet<SessionsUsageResponse>(CACHE_KEY_FULL_USAGE);
    if (cachedCost?.data) {
      setCostData(cachedCost.data);
      costSigRef.current = costSignature(cachedCost.data);
    }
    if (cachedUsage?.data) {
      setUsageData(cachedUsage.data);
      usageSigRef.current = usageSignature(cachedUsage.data);
    }
    if (cachedCost?.data || cachedUsage?.data) setLoading(false);
    return !!(cachedCost?.data || cachedUsage?.data);
  }, []);

  // ── Data fetching ──
  const fetchData = useCallback(
    async (days = 30, limit = 200, showLoading = true) => {
      if (!connected) return;
      if (fetchInFlightRef.current) return;
      fetchInFlightRef.current = true;
      try {
        setError(null);
        if (showLoading) setLoading(true);

        const [costResult, usageResult] = await Promise.allSettled([
          fetchFullCost(days),
          fetchFullUsage(limit),
        ]);

        if (costResult.status === 'fulfilled' && costResult.value) {
          const nextCost = costResult.value as unknown as CostSummary;
          const nextSig = costSignature(nextCost);
          if (nextSig !== costSigRef.current) {
            setCostData(nextCost);
            costSigRef.current = nextSig;
            cacheSet(CACHE_KEY_FULL_COST, costResult.value);
          }
        } else if (costResult.status === 'rejected') {
          console.error('[Analytics] Cost fetch failed:', costResult.reason);
        }

        if (usageResult.status === 'fulfilled' && usageResult.value) {
          const nextUsage = usageResult.value as unknown as SessionsUsageResponse;
          const nextSig = usageSignature(nextUsage);
          if (nextSig !== usageSigRef.current) {
            setUsageData(nextUsage);
            usageSigRef.current = nextSig;
            cacheSet(CACHE_KEY_FULL_USAGE, usageResult.value);
          }
        } else if (usageResult.status === 'rejected') {
          console.error('[Analytics] Usage fetch failed:', usageResult.reason);
        }

        if (costResult.status === 'rejected' && usageResult.status === 'rejected') {
          throw new Error('Failed to load all analytics data');
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to load analytics data');
      } finally {
        fetchInFlightRef.current = false;
        if (showLoading) setLoading(false);
      }
    },
    [connected]
  );

  // ── Initial load ──
  useEffect(() => {
    // Clean up legacy key that auto-saved without Apply
    localStorage.removeItem(OLD_PRESET_KEY);

    const saved = (localStorage.getItem(PRESET_STORAGE_KEY) as PresetId) || '30d';
    const savedDatesRaw = localStorage.getItem(CUSTOM_DATES_STORAGE_KEY);
    const savedDates = savedDatesRaw ? JSON.parse(savedDatesRaw) : null;

    setSavedPreset(saved);
    setActivePreset(saved);

    if (saved === 'custom' && savedDates?.start && savedDates?.end) {
      setStartDate(savedDates.start);
      setEndDate(savedDates.end);
    }

    const hasCached = hydrateFromCache();
    const cachedCost = cacheGet<CostSummary>(CACHE_KEY_FULL_COST);
    // Fixed: cache returns { data, ts }, NOT { data, timestamp }
    const isStale = !cachedCost || (Date.now() - cachedCost.ts > STALE_THRESHOLD_MS);

    if (isStale || !hasCached) {
      const { days, limit } = getFetchParams(saved);
      fetchData(days, limit, !hasCached);
    }
    setHasHydrated(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Heartbeat-driven auto refresh (event-driven):
  // refresh analytics silently on gateway tick/health events.
  useEffect(() => {
    if (!connected) return;
    if (!hasHydrated) return;
    if (!gatewayTickTs) return;

    const now = Date.now();
    const autoRefreshMinMs =
      activePreset === 'all' ? 120_000 :
      activePreset === '90d' ? 60_000 :
      activePreset === 'custom' ? 60_000 : 30_000;

    if (now - lastAutoRefreshAtRef.current < autoRefreshMinMs) return;
    lastAutoRefreshAtRef.current = now;

    const { days, limit } = getFetchParams(activePreset);
    void fetchData(days, limit, false);
  }, [connected, hasHydrated, gatewayTickTs, activePreset, fetchData]);

  // Auto-sync OpenRouter prices when we detect unknown-model entries.
  useEffect(() => {
    if (!connected) return;
    if (pricingSyncing) return;
    if (pricingMap.size > 0) return;
    const missing = (costData?.totals?.missingCostEntries || 0) + (usageData?.totals?.missingCostEntries || 0);
    if (missing <= 0) return;
    void syncModelPricing();
  }, [connected, costData, usageData, pricingMap.size, pricingSyncing, syncModelPricing]);

  // ── Preset click: change view, fetch if needed, NO save ──
  const handlePresetSelect = useCallback(
    async (id: PresetId, start: string, end: string) => {
      setActivePreset(id);
      setStartDate(start);
      setEndDate(end);

      // Fetch more data if the new preset needs a wider scope
      const requiredDays = getFetchParams(id).days;
      const currentDays  = costData?.days || 0;

      if (requiredDays > currentDays) {
        setIsRefetching(true);
        const { limit } = getFetchParams(id);
        await fetchData(requiredDays, limit, false);
        setIsRefetching(false);
      }
    },
    [costData, fetchData]
  );

  // ── Apply: save current selection to localStorage ──
  const handleApply = useCallback(
    async (customStart?: string, customEnd?: string) => {
      if (customStart && customEnd) {
        // Custom date range: apply view + save
        setActivePreset('custom');
        setStartDate(customStart);
        setEndDate(customEnd);
        localStorage.setItem(PRESET_STORAGE_KEY, 'custom');
        localStorage.setItem(
          CUSTOM_DATES_STORAGE_KEY,
          JSON.stringify({ start: customStart, end: customEnd })
        );
        setSavedPreset('custom');

        // Fetch more data if needed for the custom range
        const dayDiff = Math.ceil(
          (new Date(customEnd).getTime() - new Date(customStart).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        const currentDays = costData?.days || 0;
        if (dayDiff > currentDays) {
          setIsRefetching(true);
          await fetchData(365, 2000, false);
          setIsRefetching(false);
        }
      } else {
        // Preset save (no custom dates)
        localStorage.setItem(PRESET_STORAGE_KEY, activePreset);
        localStorage.removeItem(CUSTOM_DATES_STORAGE_KEY);
        setSavedPreset(activePreset);
      }
    },
    [activePreset, costData, fetchData]
  );

  // ═══════════════════════════════════════════════════════════
  // Derived & filtered data
  // ═══════════════════════════════════════════════════════════

  const isInRange = useCallback(
    (date: string) => {
      if (!startDate && !endDate) return true;
      if (startDate && date < startDate) return false;
      if (endDate   && date > endDate)   return false;
      return true;
    },
    [startDate, endDate]
  );

  const allDaily = useMemo<DailyEntry[]>(() => costData?.daily || [], [costData]);

  const daily = useMemo<DailyEntry[]>(() => {
    if (!startDate && !endDate) return allDaily;
    return allDaily.filter((d) => isInRange(d.date));
  }, [allDaily, isInRange, startDate, endDate]);

  const findOpenRouterPricing = useCallback((model?: string): OpenRouterPricing | null => {
    const raw = normalizeModelKey(model);
    if (!raw || raw === 'unknown') return null;

    const stripped = stripOpenRouterPrefix(raw);
    const candidates = new Set<string>([
      raw,
      stripped,
      `openrouter/${stripped}`,
    ]);

    const atIdx = stripped.indexOf('@');
    if (atIdx > 0) {
      const base = stripped.slice(0, atIdx);
      candidates.add(base);
      candidates.add(`openrouter/${base}`);
    }

    for (const key of candidates) {
      const hit = pricingMap.get(key);
      if (hit) return hit;
    }

    // Fallback: canonical slugs may include date suffixes.
    for (const [key, value] of pricingMap.entries()) {
      if (key.startsWith(`${stripped}-`) || key.startsWith(`openrouter/${stripped}-`)) {
        return value;
      }
    }

    return null;
  }, [pricingMap]);

  const patchUsageWithPricing = useCallback((usage: Partial<CostTotals>, model?: string): Partial<CostTotals> => {
    const normalizedUsage = {
      ...EMPTY_TOTALS,
      ...usage,
      input: toNum(usage.input),
      output: toNum(usage.output),
      cacheRead: toNum(usage.cacheRead),
      cacheWrite: toNum(usage.cacheWrite),
      totalTokens: toNum(usage.totalTokens),
      totalCost: toNum(usage.totalCost),
      inputCost: toNum(usage.inputCost),
      outputCost: toNum(usage.outputCost),
      cacheReadCost: toNum(usage.cacheReadCost),
      cacheWriteCost: toNum(usage.cacheWriteCost),
      missingCostEntries: toNum(usage.missingCostEntries),
    } satisfies CostTotals;

    const needsPatch =
      normalizedUsage.missingCostEntries > 0 ||
      (normalizedUsage.totalTokens > 0 && normalizedUsage.totalCost <= 0);
    if (!needsPatch) return normalizedUsage;

    const pricing = findOpenRouterPricing(model);
    if (!pricing) return normalizedUsage;

    const computed = computeCostFromPricing(normalizedUsage, pricing);
    if (computed.totalCost <= 0) return normalizedUsage;

    return {
      ...normalizedUsage,
      ...computed,
      missingCostEntries: 0,
    } satisfies CostTotals;
  }, [findOpenRouterPricing]);

  const totalsBase = useMemo<CostTotals>(() => {
    // "All Time": always use server totals — they reflect whatever scope was fetched,
    // and auto-update when the 365-day refetch completes.
    if (activePreset === 'all') {
      return usageData?.totals || costData?.totals || EMPTY_TOTALS;
    }
    // For all other presets, sum from filtered daily entries
    const sum: CostTotals = { ...EMPTY_TOTALS };
    for (const d of daily) accumulateTotals(sum, d);
    return sum;
  }, [usageData, costData, daily, activePreset]);

  const allSessions = usageData?.sessions || [];
  const aggregates  = usageData?.aggregates;

  const sessions = useMemo(() => {
    if (!startDate && !endDate) return allSessions;
    return allSessions.filter((s) => {
      const updated = s.updatedAt
        ? new Date(s.updatedAt).toISOString().slice(0, 10)
        : '';
      return isInRange(updated);
    });
  }, [allSessions, isInRange, startDate, endDate]);

  const byAgent = useMemo<ByAgentEntry[]>(() => {
    if (activePreset === 'all') return aggregates?.byAgent || [];
    const map = new Map<string, CostTotals>();
    for (const s of sessions) {
      const aid      = (s as any).agentId || 'unknown';
      const existing = map.get(aid) || { ...EMPTY_TOTALS };
      const patchedUsage = patchUsageWithPricing((s as any).usage || {}, (s as any).model);
      accumulateTotals(existing, patchedUsage);
      map.set(aid, existing);
    }
    return Array.from(map.entries()).map(([agentId, t]) => ({ agentId, totals: t }));
  }, [aggregates, sessions, activePreset, patchUsageWithPricing]);

  const byModelRaw = useMemo<ByModelEntry[]>(() => {
    if (activePreset === 'all') return aggregates?.byModel || [];
    const map = new Map<string, { provider?: string; model: string; count: number; totals: CostTotals }>();

    const addSlice = (params: { model?: string; provider?: string; count?: number; totals?: Partial<CostTotals> }) => {
      const rawModel = String(params.model || '').trim();
      const provider = String(params.provider || '').trim();
      const resolvedModel = rawModel || (provider ? `${provider}/unknown` : 'unknown');
      const key = `${provider || ''}::${resolvedModel}`;
      const existing = map.get(key) || {
        provider: provider || undefined,
        model: resolvedModel,
        count: 0,
        totals: { ...EMPTY_TOTALS },
      };
      const count = Number(params.count);
      existing.count += Number.isFinite(count) && count > 0 ? count : 1;
      const patchedUsage = patchUsageWithPricing(params.totals || {}, resolvedModel);
      accumulateTotals(existing.totals, patchedUsage);
      if (!existing.provider && provider) existing.provider = provider;
      map.set(key, existing);
    };

    for (const s of sessions) {
      const modelUsage = Array.isArray((s as any)?.usage?.modelUsage) ? (s as any).usage.modelUsage : [];
      if (modelUsage.length > 0) {
        for (const mu of modelUsage) {
          addSlice({
            model: mu?.model || (s as any)?.model,
            provider: mu?.provider || (s as any)?.modelProvider,
            count: mu?.count,
            totals: mu?.totals || {},
          });
        }
        continue;
      }

      addSlice({
        model: (s as any)?.model,
        provider: (s as any)?.modelProvider,
        count: 1,
        totals: (s as any)?.usage || {},
      });
    }

    return Array.from(map.values()).map((entry) => ({
      provider: entry.provider,
      model: entry.model,
      count: entry.count,
      totals: entry.totals,
    }));
  }, [aggregates, sessions, activePreset, patchUsageWithPricing]);

  const pricingPatch = useMemo(() => {
    const delta = { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: 0 };
    let patchedEntries = 0;
    let removedMissing = 0;

    const patchedByModel = byModelRaw.map((entry) => {
      const original = entry.totals || EMPTY_TOTALS;
      const patched = patchUsageWithPricing(original, entry.model);
      const changed =
        toNum(patched.totalCost) !== toNum(original.totalCost) ||
        toNum(patched.inputCost) !== toNum(original.inputCost) ||
        toNum(patched.outputCost) !== toNum(original.outputCost) ||
        toNum(patched.cacheReadCost) !== toNum(original.cacheReadCost) ||
        toNum(patched.cacheWriteCost) !== toNum(original.cacheWriteCost) ||
        toNum(patched.missingCostEntries) !== toNum(original.missingCostEntries);

      if (!changed) return entry;

      patchedEntries += 1;
      removedMissing += Math.max(0, toNum(original.missingCostEntries) - toNum(patched.missingCostEntries));
      delta.inputCost += toNum(patched.inputCost) - toNum(original.inputCost);
      delta.outputCost += toNum(patched.outputCost) - toNum(original.outputCost);
      delta.cacheReadCost += toNum(patched.cacheReadCost) - toNum(original.cacheReadCost);
      delta.cacheWriteCost += toNum(patched.cacheWriteCost) - toNum(original.cacheWriteCost);
      delta.totalCost += toNum(patched.totalCost) - toNum(original.totalCost);

      const modelKey = stripOpenRouterPrefix(normalizeModelKey(entry.model));
      const provider = entry.provider || (modelKey.includes('/') ? modelKey.split('/')[0] : undefined);
      return { ...entry, provider, totals: patched as CostTotals };
    });

    return { patchedByModel, patchedEntries, removedMissing, delta };
  }, [byModelRaw, patchUsageWithPricing]);

  const byModel = pricingPatch.patchedByModel;

  const totalsFromByModel = useMemo<CostTotals>(() => {
    const sum: CostTotals = { ...EMPTY_TOTALS };
    for (const entry of byModel) {
      accumulateTotals(sum, entry.totals || EMPTY_TOTALS);
    }
    return sum;
  }, [byModel]);

  const totals = useMemo<CostTotals>(() => {
    // For filtered presets, byAgent/byModel are built from sessions and can include
    // OpenRouter-patched prices even when daily buckets are still zero/unknown.
    // Keep the overview totals aligned with those breakdowns.
    if (activePreset !== 'all') {
      const hasModelTotals =
        toNum(totalsFromByModel.totalTokens) > 0 ||
        toNum(totalsFromByModel.totalCost) > 0 ||
        toNum(totalsFromByModel.missingCostEntries) > 0;
      return hasModelTotals ? totalsFromByModel : totalsBase;
    }

    if (pricingPatch.patchedEntries <= 0) return totalsBase;
    return {
      ...totalsBase,
      inputCost: Math.max(0, toNum(totalsBase.inputCost) + pricingPatch.delta.inputCost),
      outputCost: Math.max(0, toNum(totalsBase.outputCost) + pricingPatch.delta.outputCost),
      cacheReadCost: Math.max(0, toNum(totalsBase.cacheReadCost) + pricingPatch.delta.cacheReadCost),
      cacheWriteCost: Math.max(0, toNum(totalsBase.cacheWriteCost) + pricingPatch.delta.cacheWriteCost),
      totalCost: Math.max(0, toNum(totalsBase.totalCost) + pricingPatch.delta.totalCost),
      missingCostEntries: Math.max(0, toNum(totalsBase.missingCostEntries) - pricingPatch.removedMissing),
    };
  }, [activePreset, totalsBase, totalsFromByModel, pricingPatch]);

  const periodInfo = useMemo(() => {
    if (startDate && endDate) {
      const days = Math.round(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) /
          (1000 * 60 * 60 * 24)
      ) + 1;
      return { start: startDate, end: endDate, days };
    }
    const start =
      usageData?.startDate ||
      (allDaily.length > 0 ? allDaily[allDaily.length - 1]?.date : '');
    const end =
      usageData?.endDate ||
      (allDaily.length > 0 ? allDaily[0]?.date : '');
    if (!start || !end) return { start: '—', end: '—', days: 0 };
    const days = Math.round(
      (new Date(end).getTime() - new Date(start).getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1;
    return { start, end, days };
  }, [usageData, allDaily, startDate, endDate]);

  const totalApiCalls = useMemo(
    () => byModel.reduce((sum, m) => sum + m.count, 0),
    [byModel]
  );

  const donutData = useMemo(
    () =>
      byAgent
        .filter((a) => a.totals.totalCost > 0 || a.totals.totalTokens > 0)
        .sort((a, b) => b.totals.totalCost - a.totals.totalCost)
        .map((a) => ({
          name:       a.agentId === 'main' ? 'Main Agent' : a.agentId,
          value:      Math.max(a.totals.totalCost, 0.001),
          color:      getAgentColor(a.agentId),
          tokens:     a.totals.totalTokens,
          actualCost: a.totals.totalCost,
        })),
    [byAgent]
  );

  const chartData = useMemo(
    () =>
      [...daily]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => ({
          date:   d.date.slice(5), // MM-DD
          cost:   d.totalCost,
          input:  d.inputCost,
          output: d.outputCost,
        })),
    [daily]
  );

  // ═══════════════════════════════════════════════════════════
  // Return
  // ═══════════════════════════════════════════════════════════
  return {
    costData,
    usageData,
    loading,
    isRefetching,
    error,
    pricingSyncing,
    pricingLastSyncedAt,
    pricingError,
    pricingPatchedEntries: pricingPatch.patchedEntries,
    activePreset,
    savedPreset,
    startDate,
    endDate,
    daily,
    totals,
    sessions,
    byAgent,
    byModel,
    periodInfo,
    totalApiCalls,
    chartData,
    donutData,
    handlePresetSelect,
    handleApply,
    syncModelPricing,
    refresh: async () => {
      const { days, limit } = getFetchParams(activePreset);
      await fetchData(days, limit, false);
    },
  };
}
