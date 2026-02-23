import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Zap, TrendingUp, Clock, Layers, RefreshCw, Activity } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getDirection } from '@/i18n';
import { gateway } from '@/services/gateway';
import { timeAgo as timeAgoFmt } from '@/utils/format';
import clsx from 'clsx';

// ═══════════════════════════════════════════════════════════
// Token Usage Dashboard — detailed context & usage analytics
// ═══════════════════════════════════════════════════════════

interface SessionDetail {
  key: string;
  label: string;
  kind?: string;
  contextTokens?: number;
  maxTokens?: number;
  percentage?: number;
  compactions?: number;
  model?: string;
  messageCount?: number;
  lastActivity?: string;
}

interface TokenDashboardProps {
  open: boolean;
  onClose: () => void;
}

export function TokenDashboard({ open, onClose }: TokenDashboardProps) {
  const { t } = useTranslation();
  const { tokenUsage } = useChatStore();
  const { language } = useSettingsStore();
  const dir = getDirection(language);
  const dateLocale = language === 'ar' ? 'ar-SA' : 'en-US';
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadDetails = useCallback(async () => {
    setLoading(true);
    try {
      const result = await gateway.getSessions();
      const rawSessions = Array.isArray(result?.sessions) ? result.sessions : [];

      const details: SessionDetail[] = rawSessions.map((s: any) => {
        const key = s.key || s.sessionKey || 'unknown';
        let label = s.label || s.name || key;
        if (key === 'agent:main:main') label = t('dashboard.mainSession');
        else if (key.startsWith('agent:main:')) label = key.split(':').pop() || key;

        // Gateway returns: totalTokens (used), contextTokens (max capacity)
        const used = s.totalTokens || 0;
        const max = s.contextTokens || 200000;
        const pct = max > 0 ? Math.round((used / max) * 100) : 0;

        return {
          key,
          label,
          kind: s.kind || 'main',
          contextTokens: used,
          maxTokens: max,
          percentage: pct,
          compactions: s.compactions || 0,
          model: s.model || s.defaultModel || '—',
          messageCount: s.messageCount || s.messages?.length || 0,
          lastActivity: s.updatedAt ? new Date(s.updatedAt).toISOString() : undefined,
        };
      });

      // Sort: main first, then by tokens descending
      details.sort((a, b) => {
        if (a.key === 'agent:main:main') return -1;
        if (b.key === 'agent:main:main') return 1;
        return (b.contextTokens || 0) - (a.contextTokens || 0);
      });

      setSessions(details);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('[TokenDashboard] Load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadDetails();
  }, [open, loadDetails]);

  // Escape to close
  useEffect(() => {
    const handler = () => { if (open) onClose(); };
    window.addEventListener('aegis:escape', handler);
    return () => window.removeEventListener('aegis:escape', handler);
  }, [open, onClose]);

  if (!open) return null;

  const formatTokens = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
    return String(n);
  };

  const formatTime = (ts?: string) => {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '—';
      const diff = Date.now() - d.getTime();
      // For recent times, use the shared i18n-aware timeAgo
      if (diff < 86400000) return timeAgoFmt(ts);
      // For older dates, use locale-aware date
      return d.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' });
    } catch { return '—'; }
  };

  const getUsageColor = (pct: number) => {
    if (pct > 85) return { text: 'text-aegis-danger', bg: 'bg-aegis-danger', label: t('token.critical') };
    if (pct > 60) return { text: 'text-aegis-warning', bg: 'bg-aegis-warning', label: t('token.high') };
    if (pct > 30) return { text: 'text-aegis-primary', bg: 'bg-aegis-primary', label: t('token.normal') };
    return { text: 'text-aegis-success', bg: 'bg-aegis-success', label: t('token.low') };
  };

  // Total stats
  const totalTokens = sessions.reduce((sum, s) => sum + (s.contextTokens || 0), 0);
  const totalCompactions = sessions.reduce((sum, s) => sum + (s.compactions || 0), 0);
  const activeSessions = sessions.filter(s => (s.contextTokens || 0) > 0).length;

  // Main session
  const mainSession = sessions.find(s => s.key === 'agent:main:main');
  const mainPct = mainSession?.percentage || tokenUsage?.percentage || 0;
  const mainColor = getUsageColor(mainPct);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-h-[85vh] glass rounded-3xl shadow-float overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        dir={dir}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-aegis-border/20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-aegis-primary/20 to-aegis-accent/15 flex items-center justify-center border border-aegis-primary/15">
              <Activity size={18} className="text-aegis-primary" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-aegis-text">{t('dashboard.totalTokens')}</h2>
              <p className="text-[10px] text-aegis-text-dim">
                {lastRefresh ? `${t('token.lastUpdate')}: ${lastRefresh.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={loadDetails}
              disabled={loading}
              className="p-2 rounded-xl hover:bg-[rgb(var(--aegis-overlay)/0.04)] transition-colors"
              title={t('token.refresh')}
            >
              <RefreshCw size={14} className={clsx('text-aegis-text-dim', loading && 'animate-spin')} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-[rgb(var(--aegis-overlay)/0.04)] transition-colors"
            >
              <X size={14} className="text-aegis-text-muted" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto max-h-[calc(85vh-72px)] p-5 space-y-5">

          {/* ── Main Session Ring ── */}
          <div className="flex items-center gap-6 p-5 rounded-2xl bg-aegis-surface/50 border border-aegis-border/20">
            {/* Circular Progress */}
            <div className="relative w-24 h-24 shrink-0">
              <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                {/* Background ring */}
                <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor"
                  className="text-aegis-border/30" strokeWidth="8" />
                {/* Progress ring */}
                <circle cx="50" cy="50" r="42" fill="none"
                  strokeWidth="8" strokeLinecap="round"
                  className={mainColor.text}
                  strokeDasharray={`${mainPct * 2.64} ${264 - mainPct * 2.64}`}
                  style={{ transition: 'stroke-dasharray 0.8s ease' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={clsx('text-[20px] font-bold', mainColor.text)}>{mainPct}%</span>
                <span className="text-[9px] text-aegis-text-dim">{t('token.context')}</span>
              </div>
            </div>

            {/* Main Stats */}
            <div className="flex-1 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-aegis-text-muted">{t('dashboard.mainSession')}</span>
                <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border', 
                  mainPct > 85 ? 'bg-aegis-danger/10 text-aegis-danger border-aegis-danger/20' :
                  mainPct > 60 ? 'bg-aegis-warning/10 text-aegis-warning border-aegis-warning/20' :
                  'bg-aegis-success/10 text-aegis-success border-aegis-success/20'
                )}>
                  {mainColor.label}
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-aegis-text-dim">{t('token.tokens')}</span>
                  <span className="text-aegis-text font-mono">
                    {formatTokens(mainSession?.contextTokens || tokenUsage?.contextTokens || 0)}
                    <span className="text-aegis-text-dim"> / {formatTokens(mainSession?.maxTokens || tokenUsage?.maxTokens || 200000)}</span>
                  </span>
                </div>
                {/* Progress bar */}
                <div className="h-2 rounded-full bg-aegis-border/25 overflow-hidden">
                  <div
                    className={clsx('h-full rounded-full transition-all duration-700', mainColor.bg)}
                    style={{ width: `${Math.min(100, mainPct)}%` }}
                  />
                </div>
              </div>

              {(mainSession?.compactions || 0) > 0 && (
                <div className="text-[10px] text-aegis-text-dim flex items-center gap-1">
                  <Layers size={10} />
                  {mainSession?.compactions} {t('token.compactionOps')}
                </div>
              )}
            </div>
          </div>

          {/* ── Quick Stats Grid ── */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Zap, label: t('token.totalTokens'), value: formatTokens(totalTokens), color: 'text-aegis-primary' },
              { icon: Layers, label: t('token.compactions'), value: String(totalCompactions), color: 'text-aegis-warning' },
              { icon: TrendingUp, label: t('token.activeSessions'), value: String(activeSessions), color: 'text-aegis-accent' },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className="p-3.5 rounded-xl bg-aegis-surface/40 border border-aegis-border/15 text-center">
                <Icon size={16} className={clsx(color, 'mx-auto mb-1.5')} />
                <div className="text-[16px] font-bold text-aegis-text">{value}</div>
                <div className="text-[10px] text-aegis-text-dim mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {/* ── Sessions Breakdown ── */}
          {sessions.length > 1 && (
            <div>
              <h3 className="text-[12px] font-medium text-aegis-text-muted mb-3 flex items-center gap-2">
                <Clock size={12} />
                {t('token.sessionDetails')}
              </h3>
              <div className="space-y-2">
                {sessions.map((session) => {
                  const pct = session.percentage || (session.contextTokens && session.maxTokens
                    ? Math.round((session.contextTokens / session.maxTokens) * 100) : 0);
                  const color = getUsageColor(pct);
                  const isMain = session.key === 'agent:main:main';

                  return (
                    <div
                      key={session.key}
                      className={clsx(
                        'flex items-center gap-3 p-3 rounded-xl border transition-colors',
                        isMain
                          ? 'bg-aegis-primary-surface border-aegis-primary/15'
                          : 'bg-aegis-surface/30 border-aegis-border/10 hover:bg-aegis-surface/50'
                      )}
                    >
                      {/* Mini progress ring */}
                      <div className="relative w-10 h-10 shrink-0">
                        <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
                          <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor"
                            className="text-aegis-border/20" strokeWidth="3" />
                          <circle cx="20" cy="20" r="16" fill="none"
                            strokeWidth="3" strokeLinecap="round"
                            className={color.text}
                            strokeDasharray={`${pct * 1.005} ${100.5 - pct * 1.005}`}
                          />
                        </svg>
                        <span className={clsx('absolute inset-0 flex items-center justify-center text-[8px] font-bold', color.text)}>
                          {pct}%
                        </span>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-aegis-text truncate">{session.label}</span>
                          <span className="text-[9px] text-aegis-text-dim font-mono">
                            {formatTokens(session.contextTokens || 0)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          {session.model && session.model !== '—' && (
                            <span className="text-[9px] text-aegis-text-dim truncate max-w-[140px]">{session.model}</span>
                          )}
                          <span className="text-[9px] text-aegis-text-dim">{formatTime(session.lastActivity)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Model Info ── */}
          {mainSession?.model && mainSession.model !== '—' && (
            <div className="p-3.5 rounded-xl bg-aegis-surface/30 border border-aegis-border/10">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-aegis-text-dim">{t('token.currentModel')}</span>
                <span className="text-[11px] text-aegis-primary font-mono">{mainSession.model}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
