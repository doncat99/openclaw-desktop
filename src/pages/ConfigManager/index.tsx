// ═══════════════════════════════════════════════════════════
// Config Manager — Complete (Phase 5)
// Full config state management + Diff Preview + Export/Import
// ═══════════════════════════════════════════════════════════

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileJson, CheckCircle2, AlertCircle, Pencil } from 'lucide-react';
import clsx from 'clsx';
import type { OpenClawConfig } from './types';
import { ProvidersTab } from './ProvidersTab';
import { AgentsTab } from './AgentsTab';
import { ChannelsTab } from './ChannelsTab';
import { AdvancedTab } from './AdvancedTab';
import { SecretsTab } from './SecretsTab';
import { FloatingSaveButton, ChangesPill, DiffPreviewModal } from './components';

type Tab = 'providers' | 'agents' | 'channels' | 'advanced' | 'secrets';

export function ConfigManagerPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('providers');

  // ── Config detection ──
  const [detecting, setDetecting]     = useState(true);
  const [configPath, setConfigPath]   = useState<string>('');
  const [configExists, setConfigExists] = useState(false);
  const [error, setError]             = useState<string>('');

  // ── Config state (live + original for diff) ──
  const [config, setConfig]                 = useState<OpenClawConfig | null>(null);
  const [originalConfig, setOriginalConfig] = useState<OpenClawConfig | null>(null);
  const [saving, setSaving]                 = useState(false);

  // ── Modal / toast state ──
  const [diffOpen, setDiffOpen]       = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Editable config path ──
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput]     = useState('');

  // ── hasChanges — true when config differs from disk ──
  const hasChanges = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(originalConfig),
    [config, originalConfig]
  );

  // ── Load config on mount ──
  useEffect(() => {
    const init = async () => {
      try {
        setDetecting(true);
        setError('');

        const detected = await window.aegis.config.detect();
        setConfigPath(detected.path);
        setConfigExists(detected.exists);

        if (detected.exists) {
          const { data } = await window.aegis.config.read(detected.path);
          setConfig(data);
          setOriginalConfig(structuredClone(data));
        }
      } catch (err: any) {
        setError(err.message || 'Unknown error');
      } finally {
        setDetecting(false);
      }
    };

    init();
  }, []);

  // ── Ctrl+S shortcut — opens diff modal ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges && config) setDiffOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hasChanges, config]);

  // ── onChange handler — takes an updater function ──
  const handleChange = useCallback(
    (updater: (prev: OpenClawConfig) => OpenClawConfig) => {
      setConfig((prev) => (prev ? updater(prev) : prev));
    },
    []
  );

  // ── Save ──
  const handleSave = async () => {
    if (!config || !configPath) return;
    setSaving(true);
    try {
      await window.aegis.config.write(configPath, config);
      setOriginalConfig(structuredClone(config));

      // Restart gateway after successful save
      try {
        const restartResult = await window.aegis.config.restart() as {
          success: boolean;
          error?: string;
          instructions?: { native: string; docker: string };
        };
        if (restartResult.success) {
          setSaveSuccess(true);
          // Toast will show "Saved & Restarted"
        } else {
          // Save succeeded but restart failed — show warning with instructions
          setSaveSuccess(true);
          console.warn('[Config] Restart failed:', restartResult.error);
          if (restartResult.instructions) {
            setError(
              `Config saved ✓ but gateway restart failed. Try manually:\n` +
              `• ${restartResult.instructions.native}\n` +
              `• ${restartResult.instructions.docker}`
            );
          }
        }
      } catch {
        // restart IPC not available — still show save success
        setSaveSuccess(true);
        console.warn('[Config] Restart IPC unavailable');
      }

      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || t('config.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // ── Export ──
  const handleExport = () => {
    if (!config) return;
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openclaw-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Import ──
  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.json5';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        setConfig(data);
        // Don't update originalConfig — so hasChanges becomes true
      } catch {
        setError(t('config.importError'));
      }
    };
    input.click();
  };

  // ── Reload (re-detect path + re-read) ──
  const handleReload = async () => {
    try {
      setError('');
      // Re-detect in case path preference was saved
      const detected = await window.aegis.config.detect();
      const pathToUse = configPath || detected.path;
      setConfigPath(pathToUse);
      setConfigExists(detected.exists || !!pathToUse);

      const { data } = await window.aegis.config.read(pathToUse);
      setConfig(data);
      setOriginalConfig(structuredClone(data));
      setConfigExists(true);
    } catch (err: any) {
      setError(err.message || 'Reload failed');
    }
  };

  // ── Discard ──
  const handleDiscard = () => {
    if (originalConfig) {
      setConfig(structuredClone(originalConfig));
    }
  };

  // ── Path editing ──
  const handleStartEdit = () => {
    setPathInput(configPath);
    setEditingPath(true);
  };

  const handlePathApply = async () => {
    const trimmed = pathInput.trim();
    if (!trimmed) return;
    setConfigPath(trimmed);
    setEditingPath(false);
    try {
      // Try to read from new path
      const { data } = await window.aegis.config.read(trimmed);
      setConfig(data);
      setOriginalConfig(structuredClone(data));
      setConfigExists(true);
      setError('');
      // Save path preference for next time
      if (window.aegis.settings?.save) {
        await window.aegis.settings.save('openclawConfigPath', trimmed);
      }
    } catch (err: any) {
      setConfigExists(false);
      setConfig(null);
      setOriginalConfig(null);
      setError(err.message || 'Failed to read config');
    }
  };

  // ── Derived counts ──
  const providerCount = config?.auth?.profiles
    ? Object.keys(config.auth.profiles).length
    : 0;
  const agentCount   = config?.agents?.list?.length ?? 0;
  const channelCount = config?.channels ? Object.keys(config.channels).length : 0;

  // ── Smart tab badges ──
  const toolCount = [
    config?.tools?.profile,
    config?.tools?.deny?.length,
    config?.tools?.allow?.length,
  ].filter(Boolean).length;

  const tabs: { id: Tab; labelKey: string; icon: string; badge?: number | string }[] = [
    { id: 'providers', labelKey: 'config.providers', icon: '🤖', badge: providerCount           },
    { id: 'agents',    labelKey: 'config.agents',    icon: '👥', badge: agentCount              },
    { id: 'channels',  labelKey: 'config.channels',  icon: '💬', badge: channelCount            },
    { id: 'advanced',  labelKey: 'config.advanced',  icon: '🔧', badge: toolCount || undefined  },
    { id: 'secrets',   labelKey: 'config.secrets',   icon: '🔐', badge: undefined               },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-aegis-border bg-aegis-card/80 backdrop-blur-md flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-aegis-text">{t('config.title')}</h1>
          {hasChanges && <ChangesPill label={t('config.unsavedChanges')} />}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReload}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-medium border',
              'border-aegis-border text-aegis-text-secondary',
              'hover:bg-white/[0.03] hover:border-aegis-border-hover',
              'transition-all duration-200'
            )}
          >
            🔄 {t('config.reload')}
          </button>
          <button
            onClick={handleExport}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-medium border',
              'border-aegis-border text-aegis-text-secondary',
              'hover:bg-white/[0.03] hover:border-aegis-border-hover',
              'transition-all duration-200'
            )}
          >
            📥 {t('config.exportConfig')}
          </button>
          <button
            onClick={handleImport}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-medium border',
              'border-aegis-border text-aegis-text-secondary',
              'hover:bg-white/[0.03] hover:border-aegis-border-hover',
              'transition-all duration-200'
            )}
          >
            📤 {t('config.importConfig')}
          </button>
        </div>
      </div>

      {/* ── Tabs bar ── */}
      <div className="border-b border-aegis-border flex gap-0 overflow-x-auto flex-shrink-0 bg-aegis-card/60 backdrop-blur-sm">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap',
              'border-b-2 transition-all duration-200',
              activeTab === tab.id
                ? 'text-aegis-primary border-aegis-primary bg-white/[0.02]'
                : 'text-aegis-text-muted border-transparent hover:text-aegis-text-secondary hover:bg-white/[0.02]'
            )}
          >
            <span>{tab.icon}</span>
            <span>{t(tab.labelKey)}</span>
            {tab.badge != null && (typeof tab.badge === 'string' || tab.badge > 0) && (
              <span
                className={clsx(
                  'text-[10px] font-bold px-1.5 py-0.5 rounded-full border',
                  activeTab === tab.id
                    ? 'bg-aegis-primary/10 text-aegis-primary border-aegis-primary/20'
                    : 'bg-aegis-elevated text-aegis-text-muted border-aegis-border'
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto p-6 pb-24">

        {/* Config path card */}
        <div className="rounded-xl border border-aegis-border bg-aegis-elevated p-4 flex items-start gap-3 mb-5">
          <FileJson className="text-aegis-primary mt-0.5 shrink-0" size={16} />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-aegis-text-muted mb-1 font-medium">{t('config.configPath')}</div>
            {detecting ? (
              <div className="text-sm text-aegis-text-muted animate-pulse">{t('config.detecting')}</div>
            ) : editingPath ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  className="flex-1 bg-aegis-surface border border-aegis-border rounded-lg px-3 py-1.5 text-aegis-text text-sm font-mono outline-none focus:border-aegis-primary transition-colors"
                  placeholder="D:\\MyClawdbot\\clawdbot.json"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handlePathApply();
                    if (e.key === 'Escape') setEditingPath(false);
                  }}
                />
                <button
                  onClick={handlePathApply}
                  className="px-2 py-1.5 rounded-lg text-xs font-medium bg-aegis-primary/10 text-aegis-primary border border-aegis-primary/20 hover:bg-aegis-primary/20 transition-colors"
                >
                  ✅ Apply
                </button>
                <button
                  onClick={() => setEditingPath(false)}
                  className="px-2 py-1.5 rounded-lg text-xs font-medium text-aegis-text-muted hover:text-aegis-text transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-aegis-text font-mono truncate flex-1 min-w-0">
                  {configPath || '—'}
                </span>
                <button
                  onClick={handleStartEdit}
                  className="text-aegis-text-muted hover:text-aegis-primary transition-colors shrink-0"
                  title="Edit path"
                >
                  <Pencil size={13} />
                </button>
                {configExists ? (
                  <CheckCircle2 size={13} className="text-aegis-primary shrink-0" />
                ) : (
                  <AlertCircle size={13} className="text-aegis-text-muted shrink-0" />
                )}
              </div>
            )}
            {!detecting && !configExists && (
              <div className="text-xs text-aegis-text-muted mt-1">{t('config.noFile')}</div>
            )}
          </div>
        </div>

        {/* Quick stats (only when config loaded) */}
        {!detecting && configExists && config && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { val: providerCount, label: t('config.providers'), color: 'text-aegis-primary' },
              { val: agentCount,    label: t('config.agents'),    color: 'text-blue-400' },
              { val: channelCount,  label: t('config.channels'),  color: 'text-purple-400' },
            ].map(({ val, label, color }) => (
              <div
                key={label}
                className="rounded-xl border border-aegis-border bg-aegis-elevated p-4 text-center"
              >
                <div className={clsx('text-2xl font-extrabold', color)}>{val}</div>
                <div className="text-xs text-aegis-text-muted mt-1">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tab content */}
        {detecting ? (
          <div className="flex items-center justify-center py-20 text-aegis-text-muted text-sm animate-pulse">
            {t('config.detecting')}
          </div>
        ) : !configExists || !config ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <AlertCircle size={32} className="text-aegis-text-muted" />
            <p className="text-sm text-aegis-text-secondary">{t('config.noFile')}</p>
          </div>
        ) : activeTab === 'providers' ? (
          <ProvidersTab config={config} onChange={handleChange} />
        ) : activeTab === 'agents' ? (
          <AgentsTab config={config} onChange={handleChange} />
        ) : activeTab === 'channels' ? (
          <ChannelsTab config={config} onChange={handleChange} />
        ) : activeTab === 'advanced' ? (
          <AdvancedTab config={config} onChange={handleChange} />
        ) : activeTab === 'secrets' ? (
          <SecretsTab config={config} />
        ) : null}

        {/* Error display */}
        {error && (
          <div className="mt-4 rounded-xl border border-aegis-border bg-aegis-elevated p-4 flex items-start gap-3">
            <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
            <span className="text-sm text-red-400">{error}</span>
          </div>
        )}
      </div>

      {/* ── Floating Save ── */}
      <FloatingSaveButton
        hasChanges={hasChanges}
        saving={saving}
        onSave={() => setDiffOpen(true)}
        onDiscard={handleDiscard}
      />

      {/* ── Diff Preview Modal ── */}
      <DiffPreviewModal
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        onConfirm={async () => { await handleSave(); setDiffOpen(false); }}
        original={originalConfig}
        current={config}
        saving={saving}
      />

      {/* ── Save Success Toast ── */}
      {saveSuccess && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-aegis-primary/10 border border-aegis-primary/20 text-aegis-primary text-sm font-medium animate-[float-in_0.3s_ease-out] shadow-lg">
          <CheckCircle2 size={15} />
          {t('config.configSaved')}
        </div>
      )}
    </div>
  );
}

export default ConfigManagerPage;
