// ═══════════════════════════════════════════════════════════
// useAnalyticsData — Custom hook
// Handles all state, data fetching, caching, date filtering,
// and derived computations for the FullAnalytics page.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useChatStore }  from '@/stores/chatStore';
import { fetchFullCost, fetchFullUsage } from '@/stores/gatewayDataStore';

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

// ─────────────────────────────────────────────────────────────
// Empty totals template — avoids repetition
// ─────────────────────────────────────────────────────────────
const EMPTY_TOTALS: CostTotals = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
  totalTokens: 0, totalCost: 0,
  inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0,
  missingCostEntries: 0,
};

/** Accumulate usage fields from a partial record into an existing CostTotals */
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

export interface AnalyticsData {
  // Raw / server data
  costData:  CostSummary | null;
  usageData: SessionsUsageResponse | null;

  // UI state
  loading: boolean;
  error:   string | null;

  // Date range
  activePreset: PresetId;
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

  // Handlers
  handlePresetSelect: (id: PresetId, start: string, end: string) => void;
  handleCustomApply:  (start: string, end: string) => void;
  refresh:            () => void;
}

export function useAnalyticsData(): AnalyticsData {
  const { connected } = useChatStore();

  // ── Core data state ──
  const [costData,  setCostData]  = useState<CostSummary | null>(null);
  const [usageData, setUsageData] = useState<SessionsUsageResponse | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  // ── Date range state ──
  const [activePreset, setActivePreset] = useState<PresetId>('all');
  const [startDate,    setStartDate]    = useState<string>('');
  const [endDate,      setEndDate]      = useState<string>('');

  // ── Cache hydration — show stale data immediately on mount ──
  const hydrateFromCache = useCallback(() => {
    const cachedCost  = cacheGet<CostSummary>(CACHE_KEY_FULL_COST);
    const cachedUsage = cacheGet<SessionsUsageResponse>(CACHE_KEY_FULL_USAGE);
    if (cachedCost?.data)  setCostData(cachedCost.data);
    if (cachedUsage?.data) setUsageData(cachedUsage.data);
    if (cachedCost?.data || cachedUsage?.data) setLoading(false);
    return !!(cachedCost?.data || cachedUsage?.data);
  }, []);

  // ── Fetch full-year data on-demand (not part of regular polling) ──
  const fetchData = useCallback(
    async (showLoading = true) => {
      if (!connected) return;
      try {
        setError(null);
        if (showLoading) setLoading(true);

        const [rawCost, rawUsage] = await Promise.all([
          fetchFullCost(365),
          fetchFullUsage(2000),
        ]);

        if (rawCost)  { setCostData(rawCost);   cacheSet(CACHE_KEY_FULL_COST,  rawCost); }
        if (rawUsage) { setUsageData(rawUsage); cacheSet(CACHE_KEY_FULL_USAGE, rawUsage); }
      } catch (err: any) {
        setError(err?.message || 'Failed to load analytics data');
      } finally {
        setLoading(false);
      }
    },
    [connected]
  );

  // ── Initial load: hydrate from cache first, then fetch fresh data ──
  useEffect(() => {
    const hasCached = hydrateFromCache();
    fetchData(!hasCached);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // No auto-refresh interval — full-year data is heavy.
  // User can manually refresh via the Refresh button.

  // ── Date range handlers (client-side filtering — no re-fetch needed) ──
  const handlePresetSelect = useCallback((id: PresetId, start: string, end: string) => {
    setActivePreset(id);
    setStartDate(start);
    setEndDate(end);
  }, []);

  const handleCustomApply = useCallback((start: string, end: string) => {
    setActivePreset('custom');
    setStartDate(start);
    setEndDate(end);
  }, []);

  // ── Helper: check if a YYYY-MM-DD date falls within the selected range ──
  const isInRange = useCallback(
    (date: string) => {
      if (!startDate && !endDate) return true; // "All Time" — no filter
      if (startDate && date < startDate) return false;
      if (endDate   && date > endDate)   return false;
      return true;
    },
    [startDate, endDate]
  );

  // ── Filtered daily entries ──
  const allDaily = useMemo<DailyEntry[]>(() => costData?.daily || [], [costData]);

  const daily = useMemo<DailyEntry[]>(() => {
    if (!startDate && !endDate) return allDaily;
    return allDaily.filter((d) => isInRange(d.date));
  }, [allDaily, isInRange, startDate, endDate]);

  // ── Derived totals — recalculated from filtered daily when date range is active ──
  const totals = useMemo<CostTotals>(() => {
    if (!startDate && !endDate) {
      return usageData?.totals || costData?.totals || EMPTY_TOTALS;
    }
    const sum: CostTotals = { ...EMPTY_TOTALS };
    for (const d of daily) accumulateTotals(sum, d);
    return sum;
  }, [usageData, costData, daily, startDate, endDate]);

  const allSessions = usageData?.sessions || [];
  const aggregates  = usageData?.aggregates;

  // ── Filter sessions by date range ──
  const sessions = useMemo(() => {
    if (!startDate && !endDate) return allSessions;
    return allSessions.filter((s) => {
      const updated = s.updatedAt
        ? new Date(s.updatedAt).toISOString().slice(0, 10)
        : '';
      return isInRange(updated);
    });
  }, [allSessions, isInRange, startDate, endDate]);

  // ── Recalculate byAgent from filtered sessions when range is active ──
  const byAgent = useMemo<ByAgentEntry[]>(() => {
    if (!startDate && !endDate) return aggregates?.byAgent || [];

    const map = new Map<string, CostTotals>();
    for (const s of sessions) {
      const aid      = (s as any).agentId || 'unknown';
      const existing = map.get(aid) || { ...EMPTY_TOTALS };
      accumulateTotals(existing, (s as any).usage || {});
      map.set(aid, existing);
    }
    return Array.from(map.entries()).map(([agentId, t]) => ({ agentId, totals: t }));
  }, [aggregates, sessions, startDate, endDate]);

  // ── Recalculate byModel from filtered sessions when range is active ──
  const byModel = useMemo<ByModelEntry[]>(() => {
    if (!startDate && !endDate) return aggregates?.byModel || [];

    const map = new Map<string, { count: number; totals: CostTotals }>();
    for (const s of sessions) {
      const model    = (s as any).model || 'unknown';
      const existing = map.get(model) || { count: 0, totals: { ...EMPTY_TOTALS } };
      existing.count++;
      accumulateTotals(existing.totals, (s as any).usage || {});
      map.set(model, existing);
    }
    return Array.from(map.entries()).map(([model, data]) => ({
      model,
      count:  data.count,
      totals: data.totals,
    }));
  }, [aggregates, sessions, startDate, endDate]);

  // ── Period info — reflects selected range or full data ──
  const periodInfo = useMemo(() => {
    if (startDate && endDate) {
      const days =
        Math.round(
          (new Date(endDate).getTime() - new Date(startDate).getTime()) /
          (1000 * 60 * 60 * 24)
        ) + 1;
      return { start: startDate, end: endDate, days };
    }
    const start = usageData?.startDate || (allDaily.length > 0 ? allDaily[allDaily.length - 1]?.date : '');
    const end   = usageData?.endDate   || (allDaily.length > 0 ? allDaily[0]?.date : '');
    if (!start || !end) return { start: '—', end: '—', days: 0 };
    const days =
      Math.round(
        (new Date(end).getTime() - new Date(start).getTime()) /
        (1000 * 60 * 60 * 24)
      ) + 1;
    return { start, end, days };
  }, [usageData, allDaily, startDate, endDate]);

  // ── Total API calls = sum of all per-model call counts ──
  const totalApiCalls = useMemo(
    () => byModel.reduce((sum, m) => sum + m.count, 0),
    [byModel]
  );

  // ── Donut chart data (cost by agent) ──
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

  // ── Daily chart data — oldest first (for the area chart) ──
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

  return {
    costData,
    usageData,
    loading,
    error,
    activePreset,
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
    handleCustomApply,
    refresh: () => fetchData(false),
  };
}
