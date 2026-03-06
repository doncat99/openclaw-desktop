// ═══════════════════════════════════════════════════════════
// OverviewCards — Five top-level stat cards for FullAnalytics
// (Total Cost, Total Tokens, Sessions, API Calls, Days of Data)
// ═══════════════════════════════════════════════════════════

import { useTranslation } from 'react-i18next';
import { type CostTotals, type UsageAggregates, type ByModelEntry } from '../types';
import { formatTokens, formatUsd } from '../helpers';
import { BigStatCard } from './BigStatCard';
import { themeHex, dataColor } from '@/utils/theme-colors';

interface OverviewCardsProps {
  totals:        CostTotals;
  sessionsCount: number;
  totalApiCalls: number;
  byModel:       ByModelEntry[];
  aggregates:    UsageAggregates | undefined;
  periodInfo:    { start: string; end: string; days: number };
}

export function OverviewCards({
  totals,
  sessionsCount,
  totalApiCalls,
  byModel,
  aggregates,
  periodInfo,
}: OverviewCardsProps) {
  const { t } = useTranslation();
  const isSingleDay = Number(periodInfo.days || 0) <= 1;
  const costLabel = isSingleDay
    ? t('analytics.todayCost', "Today's Cost")
    : t('analytics.selectedPeriodCost', 'Selected Period Cost');

  return (
    <div className="grid grid-cols-5 gap-3">
      {/* Total Cost */}
      <BigStatCard
        iconEmoji="💰"
        value={totals.totalCost}
        label={costLabel}
        color={themeHex('accent')}
        prefix="$"
        decimals={2}
        delay={0}
        sub={`in: ${formatUsd(totals.inputCost)} · out: ${formatUsd(totals.outputCost)}`}
        sub2={totals.cacheReadCost > 0
          ? `cache: ${formatUsd(totals.cacheReadCost + totals.cacheWriteCost)}`
          : undefined}
      />

      {/* Total Tokens */}
      <BigStatCard
        iconEmoji="⚡"
        value={formatTokens(totals.totalTokens)}
        label={t('analytics.totalTokens', 'Total Tokens')}
        color={themeHex('warning')}
        decimals={0}
        delay={0.05}
        sub={`in: ${formatTokens(totals.input)} · out: ${formatTokens(totals.output)}`}
        sub2={totals.cacheRead > 0
          ? `cache: ${formatTokens(totals.cacheRead)}`
          : undefined}
      />

      {/* Sessions */}
      <BigStatCard
        iconEmoji="📦"
        value={sessionsCount}
        label={t('analytics.sessions', 'Sessions')}
        color={dataColor(4)}
        decimals={0}
        delay={0.1}
        sub={aggregates ? `${aggregates.messages.total.toLocaleString()} messages` : undefined}
      />

      {/* API Calls */}
      <BigStatCard
        iconEmoji="💬"
        value={totalApiCalls}
        label={t('analytics.apiCalls', 'API Calls')}
        color={themeHex('primary')}
        decimals={0}
        delay={0.15}
        sub={byModel.length > 0 ? `${byModel.length} models used` : undefined}
      />

      {/* Days of Data */}
      <BigStatCard
        iconEmoji="📅"
        value={periodInfo.days}
        label={t('analytics.periodDays', 'Days of Data')}
        color={dataColor(6)}
        decimals={0}
        delay={0.2}
        sub={periodInfo.start !== '—' ? periodInfo.start : undefined}
        sub2={periodInfo.end !== '—' ? `→ ${periodInfo.end}` : undefined}
      />
    </div>
  );
}
