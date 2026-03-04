// ═══════════════════════════════════════════════════════════
// FullAnalytics — Complete OpenClaw usage statistics page
// Composition layer: wires useAnalyticsData hook to sections.
// ═══════════════════════════════════════════════════════════

import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertCircle, AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { PageTransition } from '@/components/shared/PageTransition';
import { useChatStore }   from '@/stores/chatStore';

import { useAnalyticsData }   from './useAnalyticsData';
import { downloadCSV, copyAnalyticsText, formatTokens, formatUsd } from './helpers';
import {
  TokenBreakdownSection,
  AgentBreakdownSection,
  ByModelSection,
  DailyBreakdownTable,
  ExportMenu,
  DateRangePicker,
  LoadingSkeleton,
  OverviewCards,
  ChartsSection,
} from './components';

// ─────────────────────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────────────────────
export function FullAnalyticsPage() {
  const { t }         = useTranslation();
  const { connected } = useChatStore();

  const {
    costData,
    usageData,
    loading,
    error,
    pricingSyncing,
    pricingLastSyncedAt,
    pricingError,
    pricingPatchedEntries,
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
    isRefetching,
    savedPreset,
    handlePresetSelect,
    handleApply,
    refresh,
    syncModelPricing,
  } = useAnalyticsData();

  const hasData = !!(costData || usageData);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [showUnknownModelDetails, setShowUnknownModelDetails] = useState(false);

  const handleRefresh = useCallback(async () => {
    setManualRefreshing(true);
    await refresh();
    setTimeout(() => setManualRefreshing(false), 600);
  }, [refresh]);

  const handleSyncPricing = useCallback(async () => {
    await syncModelPricing();
  }, [syncModelPricing]);

  const unknownModelRows = useMemo(() => {
    const rows = byModel
      .map((entry) => ({
        model: entry.model || 'unknown',
        provider: entry.provider || '',
        missing: Number(entry.totals?.missingCostEntries || 0),
        calls: Number(entry.count || 0),
        tokens: Number(entry.totals?.totalTokens || 0),
        cost: Number(entry.totals?.totalCost || 0),
      }))
      .filter((row) => row.missing > 0)
      .sort((a, b) => {
        if (b.missing !== a.missing) return b.missing - a.missing;
        if (b.tokens !== a.tokens) return b.tokens - a.tokens;
        return b.calls - a.calls;
      });

    // Fallback: if totals says unknown entries exist but aggregates don't expose missingCostEntries,
    // still surface likely unresolved models (zero-cost with non-zero tokens).
    if (rows.length === 0 && totals.missingCostEntries > 0) {
      return byModel
        .map((entry) => ({
          model: entry.model || 'unknown',
          provider: entry.provider || '',
          missing: 0,
          calls: Number(entry.count || 0),
          tokens: Number(entry.totals?.totalTokens || 0),
          cost: Number(entry.totals?.totalCost || 0),
        }))
        .filter((row) => row.tokens > 0 && row.cost <= 0)
        .sort((a, b) => {
          if (b.tokens !== a.tokens) return b.tokens - a.tokens;
          return b.calls - a.calls;
        });
    }

    return rows;
  }, [byModel, totals.missingCostEntries]);

  // ── Export action handlers (delegate to helpers.ts) ──
  const handleExportCSV = () => downloadCSV(daily, totals);

  const handleCopyText  = () =>
    copyAnalyticsText({
      periodInfo,
      totals,
      sessionsCount: sessions.length,
      totalApiCalls,
      byAgent,
      byModel,
    });

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  return (
    <PageTransition className="p-6 space-y-5 max-w-[1200px] mx-auto">

      {/* ══ Header ══ */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[24px] font-extrabold text-aegis-text tracking-tight flex items-center gap-3">
            <Activity size={22} className="text-aegis-accent" />
            {t('analytics.title', 'Full Analytics')}
          </h1>
          <p className="text-[12px] text-aegis-text-muted mt-1 flex items-center gap-2">
            {connected ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-aegis-success inline-block animate-pulse" />
                {activePreset === 'all'
                  ? t('analytics.liveData',         'Live data — all-time statistics')
                  : t('analytics.liveDataFiltered', 'Live data — filtered range')}
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-aegis-danger inline-block" />
                {t('analytics.disconnected', 'Disconnected — showing cached data')}
              </>
            )}
            {periodInfo.days > 0 && (
              <>
                <span className="text-aegis-text-dim">·</span>
                <span className="text-aegis-text-dim font-mono">{periodInfo.days} days</span>
                <span className="text-aegis-text-dim">·</span>
                <span className="text-aegis-text-dim font-mono">{periodInfo.start}</span>
                <span className="text-aegis-text-dim">→</span>
                <span className="text-aegis-text-dim font-mono">{periodInfo.end}</span>
              </>
            )}
            {startDate && endDate && (
              <>
                <span className="text-aegis-text-dim">·</span>
                <span className="px-2 py-0.5 rounded-md bg-aegis-accent/10 border border-aegis-accent/20 text-aegis-accent/70 text-[10px] font-mono">
                  {startDate} → {endDate}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncPricing}
            disabled={pricingSyncing}
            className="px-2.5 py-1.5 rounded-lg border border-aegis-border text-[11px] text-aegis-text-secondary hover:text-aegis-text hover:border-aegis-accent/40 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            title="Sync model prices from OpenRouter"
          >
            {pricingSyncing ? 'Syncing prices...' : 'Sync OpenRouter Prices'}
          </button>
          <button
            onClick={handleRefresh}
            disabled={manualRefreshing || isRefetching}
            className="p-1.5 rounded-lg hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
            title="Refresh"
          >
            <RefreshCw
              size={15}
              className={clsx(
                'text-aegis-text-muted hover:text-aegis-text-secondary transition-colors',
                (manualRefreshing || isRefetching) && 'animate-spin text-aegis-accent'
              )}
            />
          </button>
          <ExportMenu onExportCSV={handleExportCSV} onCopyText={handleCopyText} />
        </div>
      </div>

      {/* ══ Date Range Picker ══ */}
      <DateRangePicker
        activePreset={activePreset}
        savedPreset={savedPreset}
        startDate={startDate}
        endDate={endDate}
        onPresetSelect={handlePresetSelect}
        onApply={handleApply}
      />

      {/* ══ Error banner ══ */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-aegis-danger/15 bg-aegis-danger/[0.04] text-[11px] text-aegis-danger/70">
          <AlertCircle size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {/* ══ Missing cost entries warning ══ */}
      {totals.missingCostEntries > 0 && (
        <div className="px-4 py-2.5 rounded-xl border border-aegis-warning/15 bg-aegis-warning/[0.04] text-[11px] text-aegis-warning/70">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0" />
              {t('analytics.missingPricing', '{{count}} entries use unknown models — some costs may be incomplete.', {
                count: totals.missingCostEntries,
              })}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowUnknownModelDetails((v) => !v)}
                className="px-2 py-1 rounded-md border border-aegis-warning/30 text-aegis-warning hover:bg-aegis-warning/10 transition-colors"
                title="Show unknown model details"
              >
                <span className="inline-flex items-center gap-1">
                  {showUnknownModelDetails ? 'Hide details' : `Details (${unknownModelRows.length})`}
                  {showUnknownModelDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </span>
              </button>
              <button
                onClick={handleSyncPricing}
                disabled={pricingSyncing}
                className="px-2 py-1 rounded-md border border-aegis-warning/30 text-aegis-warning hover:bg-aegis-warning/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {pricingSyncing ? 'Syncing...' : 'Sync now'}
              </button>
            </div>
          </div>

          {showUnknownModelDetails && (
            <div className="mt-3 rounded-lg border border-aegis-warning/20 bg-[rgb(var(--aegis-overlay)/0.03)] overflow-hidden">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[10px] uppercase tracking-wide text-aegis-warning/80 border-b border-aegis-warning/15">
                <div className="col-span-5">Model ID</div>
                <div className="col-span-2 text-end">Missing</div>
                <div className="col-span-1 text-end">Calls</div>
                <div className="col-span-2 text-end">Tokens</div>
                <div className="col-span-2 text-end">Cost</div>
              </div>

              <div className="max-h-52 overflow-y-auto">
                {unknownModelRows.length > 0 ? (
                  unknownModelRows.map((row) => (
                    <div
                      key={`${row.provider}:${row.model}`}
                      className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-aegis-warning/10 last:border-b-0"
                    >
                      <div className="col-span-5">
                        <div className="font-mono text-[10px] text-aegis-warning/95 break-all">
                          {row.model}
                        </div>
                        {row.provider && (
                          <div className="text-[9px] text-aegis-warning/70">
                            provider: {row.provider}
                          </div>
                        )}
                      </div>
                      <div className="col-span-2 text-end font-mono text-[10px]">
                        {row.missing > 0 ? row.missing.toLocaleString() : '—'}
                      </div>
                      <div className="col-span-1 text-end font-mono text-[10px]">
                        {row.calls.toLocaleString()}
                      </div>
                      <div className="col-span-2 text-end font-mono text-[10px]">
                        {formatTokens(row.tokens)}
                      </div>
                      <div className="col-span-2 text-end font-mono text-[10px]">
                        {formatUsd(row.cost)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-2 text-[10px] text-aegis-warning/70">
                    Unknown entries exist, but model-level details are not available in current aggregate data.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ OpenRouter pricing status ══ */}
      {pricingError && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-aegis-danger/15 bg-aegis-danger/[0.04] text-[11px] text-aegis-danger/70">
          <AlertCircle size={14} className="shrink-0" />
          OpenRouter pricing sync failed: {pricingError}
        </div>
      )}

      {pricingPatchedEntries > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-aegis-success/15 bg-aegis-success/[0.04] text-[11px] text-aegis-success/80">
          <AlertTriangle size={14} className="shrink-0" />
          Synced OpenRouter pricing for {pricingPatchedEntries} model entr{pricingPatchedEntries === 1 ? 'y' : 'ies'}
          {pricingLastSyncedAt ? ` (${new Date(pricingLastSyncedAt).toLocaleString()})` : ''}
        </div>
      )}

      {/* ══ Loading skeleton (first load only) ══ */}
      {loading && !hasData && <LoadingSkeleton />}

      {/* ══ Main content ══ */}
      {hasData && (
        <>
          {/* ── Section 1: Overview Cards ── */}
          <OverviewCards
            totals={totals}
            sessionsCount={sessions.length}
            totalApiCalls={totalApiCalls}
            byModel={byModel}
            aggregates={usageData?.aggregates}
            periodInfo={periodInfo}
          />

          {/* ── Section 2: Token Breakdown ── */}
          <TokenBreakdownSection totals={totals} />

          {/* ── Section 3: Charts (Daily Cost + Agent Donut) ── */}
          <ChartsSection
            chartData={chartData}
            donutData={donutData}
            totalCost={totals.totalCost}
          />

          {/* ── Section 4: Per-Agent Breakdown ── */}
          <AgentBreakdownSection byAgent={byAgent} totalCost={totals.totalCost} />

          {/* ── Section 5: By Model ── */}
          <ByModelSection byModel={byModel} />

          {/* ── Section 6: Daily Breakdown Table ── */}
          <DailyBreakdownTable daily={daily} />
        </>
      )}

      {/* ── Empty state (connected but no data yet) ── */}
      {!loading && !hasData && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Activity size={40} className="text-aegis-text-dim mb-4" />
          <p className="text-aegis-text-dim text-[14px]">
            {connected
              ? t('analytics.noData',       'No analytics data available yet.')
              : t('analytics.connectFirst', 'Connect to Gateway to view analytics.')}
          </p>
        </div>
      )}
    </PageTransition>
  );
}
