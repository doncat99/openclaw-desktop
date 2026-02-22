// ═══════════════════════════════════════════════════════════
// SettingsPage — Full settings with Gateway, Theme, Model
// ═══════════════════════════════════════════════════════════

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings, Bell, BellOff, Globe, Volume2, VolumeX,
  Wifi, WifiOff, Palette, Cpu, CheckCircle, Loader2, Keyboard, Copy
} from 'lucide-react';
import { GlassCard } from '@/components/shared/GlassCard';
import { PageTransition } from '@/components/shared/PageTransition';
import { StatusDot } from '@/components/shared/StatusDot';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { gateway } from '@/services/gateway';
import { notifications } from '@/services/notifications';
import { changeLanguage } from '@/i18n';
import clsx from 'clsx';

export function SettingsPageFull() {
  const { t } = useTranslation();
  const {
    language, setLanguage,
    theme, setTheme,
    notificationsEnabled, setNotificationsEnabled,
    soundEnabled, setSoundEnabled,
    dndMode, setDndMode,
    memoryExplorerEnabled, setMemoryExplorerEnabled,
    memoryMode, setMemoryMode,
    memoryApiUrl, setMemoryApiUrl,
    memoryLocalPath, setMemoryLocalPath,
    context1mEnabled, setContext1mEnabled,
    toolIntentEnabled, setToolIntentEnabled,
    gatewayUrl, setGatewayUrl,
    gatewayToken, setGatewayToken,
  } = useSettingsStore();
  const { connected, connecting } = useChatStore();
  const sessions = useGatewayDataStore((s) => s.sessions);

  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);
  const [editUrl, setEditUrl] = useState(gatewayUrl);
  const [editToken, setEditToken] = useState(gatewayToken);
  const [connectionDirty, setConnectionDirty] = useState(false);

  const mainSession = sessions.find((s) => (s.key || '') === 'agent:main:main');
  const mainModel = mainSession?.model || '—';
  const contextTokens = mainSession?.contextTokens || 0;

  const handleLanguageChange = (lang: 'ar' | 'en') => {
    setLanguage(lang);
    changeLanguage(lang);
  };

  const handleNotificationsToggle = (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    notifications.setEnabled(enabled);
  };

  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    notifications.setSoundEnabled(enabled);
  };

  const handleDndToggle = (dnd: boolean) => {
    setDndMode(dnd);
    notifications.setDndMode(dnd);
  };

  const [context1mSaving, setContext1mSaving] = useState(false);

  const handleContext1mToggle = async (enabled: boolean) => {
    setContext1mEnabled(enabled);
    setContext1mSaving(true);
    try {
      // Apply to main agent via agents.update extraParams
      await gateway.updateAgentParams('main', { context1m: enabled || undefined });
    } catch (err) {
      console.error('[Settings] Failed to update context1m:', err);
    } finally {
      setContext1mSaving(false);
    }
  };

  const resolveConnectionUrl = async (): Promise<{ url: string; token: string }> => {
    const userUrl = editUrl.trim();
    const userToken = editToken.trim();
    if (userUrl) return { url: userUrl, token: userToken };
    try {
      const config = await window.aegis?.config.get();
      return {
        url: config?.gatewayUrl || config?.gatewayWsUrl || 'ws://127.0.0.1:18789',
        token: config?.gatewayToken || '',
      };
    } catch {
      return { url: 'ws://127.0.0.1:18789', token: '' };
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const { url, token } = await resolveConnectionUrl();
      gateway.connect(url, token);
      await new Promise((r) => setTimeout(r, 2500));
      setTestResult(useChatStore.getState().connected ? 'success' : 'fail');
    } catch {
      setTestResult('fail');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleReconnect = async () => {
    const { url, token } = await resolveConnectionUrl();
    gateway.connect(url, token);
  };

  const handleSaveConnection = () => {
    setGatewayUrl(editUrl.trim());
    setGatewayToken(editToken.trim());
    setConnectionDirty(false);
    // Reconnect with new settings
    const url = editUrl.trim() || 'ws://127.0.0.1:18789';
    gateway.connect(url, editToken.trim());
  };

  // Toggle switch — unified design (used everywhere in settings)
  const Toggle = ({
    enabled,
    onChange,
    disabled,
  }: {
    enabled: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
  }) => (
    <button
      onClick={() => !disabled && onChange(!enabled)}
      className={clsx(
        'w-[42px] h-[24px] rounded-full relative transition-all shrink-0 border',
        enabled
          ? 'bg-aegis-primary/30 border-aegis-primary/40'
          : 'bg-[rgb(var(--aegis-overlay)/0.08)] border-[rgb(var(--aegis-overlay)/0.1)]',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div className={clsx(
        'absolute top-[2px] w-[18px] h-[18px] rounded-full transition-all duration-300',
        enabled
          ? 'left-[21px] bg-aegis-primary shadow-[0_0_8px_rgba(78,201,176,0.5)]'
          : 'left-[2px] bg-[rgb(var(--aegis-overlay)/0.3)]'
      )} />
    </button>
  );

  return (
    <PageTransition className="p-6 space-y-6 max-w-[700px] mx-auto">
      <div>
        <h1 className="text-[22px] font-bold text-aegis-text flex items-center gap-3">
          <Settings size={24} className="text-aegis-text-dim" />
          {t('settings.title')}
        </h1>
      </div>

      {/* Theme */}
      <GlassCard delay={0}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <Palette size={16} className="text-aegis-primary" />
          {t('settings.theme', 'المظهر')}
        </h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setTheme('dark'); document.documentElement.classList.remove('light'); }}
            className={clsx(
              'flex-1 py-3 rounded-xl text-[14px] font-medium border transition-colors',
              theme === 'dark'
                ? 'bg-aegis-primary/15 border-aegis-primary/30 text-aegis-primary'
                : 'border-aegis-border text-aegis-text-dim hover:border-aegis-border-hover'
            )}
          >
            🌙 Dark Mode
          </button>
          <button
            onClick={() => { setTheme('light'); document.documentElement.classList.add('light'); }}
            className={clsx(
              'flex-1 py-3 rounded-xl text-[14px] font-medium border transition-colors',
              theme === 'light'
                ? 'bg-aegis-primary/15 border-aegis-primary/30 text-aegis-primary'
                : 'border-aegis-border text-aegis-text-dim hover:border-aegis-border-hover'
            )}
          >
            ☀️ Light Mode
          </button>
        </div>
      </GlassCard>

      {/* Language */}
      <GlassCard delay={0.05}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <Globe size={16} className="text-aegis-primary" />
          {t('settings.language')}
        </h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleLanguageChange('ar')}
            className={clsx(
              'flex-1 py-3 rounded-xl text-[14px] font-medium border transition-colors',
              language === 'ar'
                ? 'bg-aegis-primary/15 border-aegis-primary/30 text-aegis-primary'
                : 'border-aegis-border/20 text-aegis-text-dim hover:border-aegis-border/40'
            )}
          >
            العربية
          </button>
          <button
            onClick={() => handleLanguageChange('en')}
            className={clsx(
              'flex-1 py-3 rounded-xl text-[14px] font-medium border transition-colors',
              language === 'en'
                ? 'bg-aegis-primary/15 border-aegis-primary/30 text-aegis-primary'
                : 'border-aegis-border/20 text-aegis-text-dim hover:border-aegis-border/40'
            )}
          >
            English
          </button>
        </div>
      </GlassCard>

      {/* Notifications */}
      <GlassCard delay={0.1}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <Bell size={16} className="text-aegis-warning" />
          {t('settings.notifications')}
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-aegis-text">{t('settings.enableNotifications')}</div>
              <div className="text-[11px] text-aegis-text-dim">{t('settings.notificationsDesc')}</div>
            </div>
            <Toggle enabled={notificationsEnabled} onChange={handleNotificationsToggle} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-aegis-text flex items-center gap-2">
                {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                {t('settings.sound')}
              </div>
              <div className="text-[11px] text-aegis-text-dim">{t('settings.soundDesc')}</div>
            </div>
            <Toggle enabled={soundEnabled} onChange={handleSoundToggle} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-aegis-text flex items-center gap-2">
                <BellOff size={14} />
                {t('settings.dnd')}
              </div>
              <div className="text-[11px] text-aegis-text-dim">{t('settings.dndDesc')}</div>
            </div>
            <Toggle enabled={dndMode} onChange={handleDndToggle} />
          </div>

          <button
            onClick={() => notifications.notify({ title: 'AEGIS', body: t('settings.testNotification') })}
            className="text-[12px] px-4 py-2 rounded-xl border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text hover:border-aegis-border/40 transition-colors"
          >
            🔔 {t('settings.testSound')}
          </button>
        </div>
      </GlassCard>

      {/* Gateway */}
      <GlassCard delay={0.15}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          {connected ? <Wifi size={16} className="text-aegis-success" /> : <WifiOff size={16} className="text-aegis-danger" />}
          {t('settings.gateway', 'Gateway')}
        </h3>
        <div className="space-y-4">
          {/* Connection Status */}
          <div className="flex items-center justify-between">
            <div className="text-[13px] text-aegis-text">{t('settings.connectionStatus', 'حالة الاتصال')}</div>
            <div className="flex items-center gap-2">
              <StatusDot status={connected ? 'active' : connecting ? 'idle' : 'error'} size={7} />
              <span className={clsx('text-[12px] font-medium',
                connected ? 'text-aegis-success' : connecting ? 'text-aegis-warning' : 'text-aegis-danger'
              )}>
                {connected ? t('connection.connected') : connecting ? t('connection.connecting') : t('connection.disconnected')}
              </span>
            </div>
          </div>

          {/* Gateway URL — editable */}
          <div>
            <label className="text-[12px] text-aegis-text-muted font-medium mb-1.5 block">
              WebSocket URL
            </label>
            <input
              type="text"
              value={editUrl}
              onChange={(e) => { setEditUrl(e.target.value); setConnectionDirty(true); }}
              placeholder="ws://127.0.0.1:18789"
              className="w-full px-3 py-2.5 rounded-xl text-[13px] font-mono
                bg-[rgb(var(--aegis-overlay)/0.03)] border border-aegis-border
                text-aegis-text placeholder:text-aegis-text-dim
                outline-none focus:border-aegis-accent/40 focus:bg-aegis-accent/[0.03] transition-all"
              dir="ltr"
            />
            <div className="text-[10px] text-aegis-text-dim mt-1">
              {t('settings.gatewayUrlHint', 'اتركه فاضي لاستخدام الافتراضي (ws://127.0.0.1:18789)')}
            </div>
          </div>

          {/* Gateway Token — editable */}
          <div>
            <label className="text-[12px] text-aegis-text-muted font-medium mb-1.5 block">
              Gateway Token
            </label>
            <input
              type="password"
              value={editToken}
              onChange={(e) => { setEditToken(e.target.value); setConnectionDirty(true); }}
              placeholder={t('settings.gatewayTokenPlaceholder', 'اختياري — للمصادقة')}
              className="w-full px-3 py-2.5 rounded-xl text-[13px] font-mono
                bg-[rgb(var(--aegis-overlay)/0.03)] border border-aegis-border
                text-aegis-text placeholder:text-aegis-text-dim
                outline-none focus:border-aegis-accent/40 focus:bg-aegis-accent/[0.03] transition-all"
              dir="ltr"
            />
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {connectionDirty && (
              <button
                onClick={handleSaveConnection}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold
                  bg-aegis-primary/15 text-aegis-primary border border-aegis-primary/25
                  hover:bg-aegis-primary/25 transition-colors"
              >
                <CheckCircle size={13} />
                {t('settings.saveReconnect', 'حفظ وإعادة الاتصال')}
              </button>
            )}
            <button
              onClick={handleTestConnection}
              disabled={testingConnection}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] border border-aegis-border/20 text-aegis-text-dim hover:text-aegis-text hover:border-aegis-border/40 transition-colors disabled:opacity-40"
            >
              {testingConnection ? <Loader2 size={13} className="animate-spin" /> : <Wifi size={13} />}
              {t('settings.testConnection', 'اختبار الاتصال')}
            </button>
            {!connected && !connectionDirty && (
              <button
                onClick={handleReconnect}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] bg-aegis-primary/10 text-aegis-primary border border-aegis-primary/20 hover:bg-aegis-primary/20 transition-colors"
              >
                <Wifi size={13} />
                {t('connection.reconnect', 'إعادة الاتصال')}
              </button>
            )}
            {testResult && (
              <span className={clsx('text-[11px] flex items-center gap-1',
                testResult === 'success' ? 'text-aegis-success' : 'text-aegis-danger'
              )}>
                <CheckCircle size={12} />
                {testResult === 'success' ? '✓' : '✗'}
              </span>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Model */}
      <GlassCard delay={0.2}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <Cpu size={16} className="text-aegis-accent" />
          {t('settings.model', 'النموذج')}
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[13px] text-aegis-text">{t('settings.activeModel', 'النموذج النشط')}</div>
            <span className="text-[12px] font-mono text-aegis-primary font-medium">
              {mainModel.split('/').pop() || mainModel}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-[13px] text-aegis-text">{t('settings.provider', 'المزود')}</div>
            <span className="text-[12px] font-mono text-aegis-text-dim">
              {mainModel.includes('/') ? mainModel.split('/')[0] : '—'}
            </span>
          </div>
          {contextTokens > 0 && (
            <div className="flex items-center justify-between">
              <div className="text-[13px] text-aegis-text">{t('settings.contextWindow', 'نافذة السياق')}</div>
              <span className="text-[12px] font-mono text-aegis-text-dim">
                {contextTokens >= 1000000 ? `${(contextTokens / 1000000).toFixed(0)}M` : `${Math.round(contextTokens / 1000)}k`} tokens
              </span>
            </div>
          )}
          <p className="text-[10px] text-aegis-text-dim/60 mt-1">
            {t('settings.modelNote', 'يتغير من إعدادات Gateway')}
          </p>
        </div>
      </GlassCard>

      {/* Keyboard Shortcuts */}
      <GlassCard delay={0.25}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <Keyboard size={16} className="text-aegis-primary" />
          {t('settings.shortcuts', 'اختصارات لوحة المفاتيح')}
        </h3>
        <div className="space-y-2.5">
          {[
            ['Ctrl+K', 'Command Palette'],
            ['Ctrl+1-8', t('settings.navigatePages', 'التنقل بين الصفحات')],
            ['Ctrl+N', t('settings.newTab', 'Tab جديد')],
            ['Ctrl+W', t('settings.closeTab', 'إغلاق Tab')],
            ['Ctrl+Tab', t('settings.nextTab', 'Tab التالي')],
            ['Ctrl+,', t('settings.openSettings', 'الإعدادات')],
            ['Ctrl+R', t('settings.refresh', 'تحديث')],
            ['Escape', t('settings.closeModal', 'إغلاق')],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-[12px] text-aegis-text-muted">{desc}</span>
              <kbd
                className="text-[10px] font-mono px-2 py-1 rounded"
                style={{ background: 'rgb(var(--aegis-overlay) / 0.08)', color: 'rgb(var(--aegis-text-muted))', border: '1px solid var(--aegis-border-hover)' }}
              >{key}</kbd>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Experimental */}
      <GlassCard delay={0.3}>
        <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
          <span className="text-aegis-primary">🧪</span>
          {t('settings.experimental', 'Experimental')}
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">BETA</span>
        </h3>

        {/* 1M Context Toggle */}
        <div className="flex items-center justify-between py-3 border-b border-aegis-border/10">
          <div>
            <div className="text-[13px] text-aegis-text font-medium flex items-center gap-2">
              1M Context Window
              {context1mSaving && <Loader2 size={11} className="animate-spin text-aegis-text-dim" />}
            </div>
            <div className="text-[11px] text-aegis-text-dim/60 mt-0.5">
              تفعيل Anthropic 1M context beta لـ Opus / Sonnet — يزيد السياق لـ 1,000,000 token
            </div>
          </div>
          <Toggle
            enabled={context1mEnabled}
            onChange={(v) => handleContext1mToggle(v)}
            disabled={context1mSaving}
          />
        </div>

        {/* Tool Intent View Toggle */}
        <div className="flex items-center justify-between py-3 border-b border-aegis-border/10">
          <div>
            <div className="text-[13px] text-aegis-text font-medium">🔧 Tool Intent View</div>
            <div className="text-[11px] text-aegis-text-dim/60 mt-0.5">
              عرض tool calls في الشات كـ cards مع الـ input/output — مخفية افتراضياً
            </div>
          </div>
          <Toggle
            enabled={toolIntentEnabled}
            onChange={(v) => setToolIntentEnabled(v)}
          />
        </div>

        {/* Memory Explorer Toggle */}
        <div className="flex items-center justify-between py-3 border-b border-aegis-border/10">
          <div>
            <div className="text-[13px] text-aegis-text font-medium">{t('settings.memoryExplorer', 'Memory Explorer')}</div>
            <div className="text-[11px] text-aegis-text-dim/60 mt-0.5">{t('settings.memoryExplorerDesc', 'Browse and search memories via API server or local .md files')}</div>
          </div>
          <Toggle
            enabled={memoryExplorerEnabled}
            onChange={(v) => setMemoryExplorerEnabled(v)}
          />
        </div>

        {/* Memory Config */}
        {memoryExplorerEnabled && (
          <div className="mt-3 space-y-3">
            {/* Mode Toggle */}
            <div>
              <label className="text-[11px] text-aegis-text-dim block mb-1.5">{t('settings.memoryMode', 'Source')}</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMemoryMode('local')}
                  className={clsx(
                    'flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition-all duration-150',
                    memoryMode === 'local'
                      ? 'bg-[rgb(var(--aegis-primary)/0.1)] border-[rgb(var(--aegis-primary)/0.25)] text-aegis-primary'
                      : 'bg-transparent border-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-dim hover:border-[rgb(var(--aegis-overlay)/0.15)] hover:text-aegis-text-muted'
                  )}
                >
                  📁 {t('settings.memoryLocal', 'Local Files')}
                </button>
                <button
                  onClick={() => setMemoryMode('api')}
                  className={clsx(
                    'flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition-all duration-150',
                    memoryMode === 'api'
                      ? 'bg-[rgb(var(--aegis-primary)/0.1)] border-[rgb(var(--aegis-primary)/0.25)] text-aegis-primary'
                      : 'bg-transparent border-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-dim hover:border-[rgb(var(--aegis-overlay)/0.15)] hover:text-aegis-text-muted'
                  )}
                >
                  🔌 {t('settings.memoryApi', 'API Server')}
                </button>
              </div>
            </div>

            {/* Local Files Path */}
            {memoryMode === 'local' && (
              <div>
                <label className="text-[11px] text-aegis-text-dim block mb-1.5">{t('settings.memoryPath', 'Memory Folder')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={memoryLocalPath}
                    readOnly
                    placeholder={t('settings.memoryPathPlaceholder', 'Select folder...')}
                    className="flex-1 bg-[rgb(var(--aegis-overlay)/0.05)] border border-[rgb(var(--aegis-overlay)/0.1)] rounded-lg px-3 py-2 text-[12px] font-mono text-aegis-text placeholder:text-aegis-text-dim/30 focus:outline-none"
                    style={{ colorScheme: 'dark' }}
                  />
                  <button
                    onClick={async () => {
                      const path = await (window as any).aegis?.memory?.browse();
                      if (path) setMemoryLocalPath(path);
                    }}
                    className="px-3 py-2 rounded-lg bg-aegis-primary/15 border border-aegis-primary/30 text-aegis-primary text-[12px] font-medium hover:bg-aegis-primary/25 transition-colors whitespace-nowrap"
                  >
                    {t('settings.browse', 'Browse')}
                  </button>
                </div>
                <p className="text-[10px] text-aegis-text-dim/40 mt-1">{t('settings.memoryPathHint', 'Select your OpenClaw workspace folder (contains MEMORY.md)')}</p>
              </div>
            )}

            {/* API URL */}
            {memoryMode === 'api' && (
              <div>
                <label className="text-[11px] text-aegis-text-dim block mb-1.5">{t('settings.memoryApiUrl', 'Memory API URL')}</label>
                <input
                  type="text"
                  defaultValue={memoryApiUrl}
                  onBlur={(e) => setMemoryApiUrl(e.target.value)}
                  placeholder="http://localhost:3040"
                  className="w-full bg-[rgb(var(--aegis-overlay)/0.05)] border border-[rgb(var(--aegis-overlay)/0.1)] rounded-lg px-3 py-2 text-[12px] font-mono text-aegis-text placeholder:text-aegis-text-dim/30 focus:outline-none focus:border-[rgb(var(--aegis-primary)/0.4)] focus:bg-[rgb(var(--aegis-overlay)/0.07)]"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
            )}
          </div>
        )}
      </GlassCard>

      {/* About + System Info */}
      <GlassCard delay={0.3}>
        <div className="text-center py-4 mb-4">
          <div className="text-3xl mb-2">🛡️</div>
          <div className="text-[14px] font-bold text-aegis-text">AEGIS Desktop</div>
          <div className="text-[12px] text-aegis-text-dim mt-1">v5.2.1 — Mission Control</div>
          <div className="text-[11px] text-aegis-text-dim mt-0.5">Advanced Executive General Intelligence System</div>
        </div>
        <div className="space-y-2 border-t border-aegis-border/15 pt-3">
          {[
            ['Platform', typeof navigator !== 'undefined' ? navigator.platform : '—'],
            ['User Agent', typeof navigator !== 'undefined' ? (navigator.userAgent.match(/Electron\/[\d.]+/)?.[0] || '—') : '—'],
            ['Gateway', connected ? `${localStorage.getItem('aegis-gateway-http')?.replace('http', 'ws') || 'ws://127.0.0.1:18789'} ✓` : '— ✗'],
            ['Model', mainModel.split('/').pop() || '—'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[11px] text-aegis-text-dim">{label}</span>
              <span className="text-[10px] font-mono text-aegis-text-muted truncate max-w-[250px]">{value}</span>
            </div>
          ))}
        </div>
        <button onClick={() => {
          const info = `AEGIS Desktop v4.0.0\nPlatform: ${navigator.platform}\nModel: ${mainModel}\nGateway: ${connected ? 'connected' : 'disconnected'}`;
          navigator.clipboard?.writeText(info);
        }}
          className="mt-3 flex items-center gap-1.5 mx-auto px-3 py-1.5 rounded-lg text-[11px] text-aegis-text-dim hover:text-aegis-text border border-aegis-border/20 hover:border-aegis-border/40 transition-colors">
          <Copy size={12} /> {t('settings.copySystemInfo', 'نسخ معلومات النظام')}
        </button>
      </GlassCard>
    </PageTransition>
  );
}
