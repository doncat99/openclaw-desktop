import { useEffect, useCallback, useState, useRef } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/Layout/AppLayout';
import { DashboardPage } from '@/pages/Dashboard';
import { ChatPage } from '@/pages/ChatPage';
import { WorkshopPage } from '@/pages/Workshop';
import { FullAnalyticsPage } from '@/pages/FullAnalytics';
import { CronMonitorPage } from '@/pages/CronMonitor';
import { AgentHubPage } from '@/pages/AgentHub';
import { MemoryExplorerPage } from '@/pages/MemoryExplorer';
import { SkillsPage as SkillsPageFull } from '@/pages/SkillsPage';
import { TerminalPage } from '@/pages/TerminalPage';
import { SettingsPageFull } from '@/pages/SettingsPage';
import { PairingScreen } from '@/components/PairingScreen';
import { ToastContainer } from '@/components/Toast/ToastContainer';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { gateway } from '@/services/gateway';
import { notifications } from '@/services/notifications';
import { changeLanguage } from '@/i18n';

// ═══════════════════════════════════════════════════════════
// AEGIS Desktop v4.0 — Mission Control
// ═══════════════════════════════════════════════════════════

export default function App() {
  const { t } = useTranslation();
  const {
    addMessage,
    updateStreamingMessage,
    finalizeStreamingMessage,
    setConnectionStatus,
    setIsTyping,
    setSessions,
    setTokenUsage,
    setCurrentModel,
    setCurrentThinking,
    setAvailableModels,
    manualModelOverride,
  } = useChatStore();

  // ── Auto-Pairing State ──
  const [needsPairing, setNeedsPairing] = useState(false);
  const [scopeError, setScopeError] = useState<string>('');
  const [gatewayHttpUrl, setGatewayHttpUrl] = useState('http://127.0.0.1:18789');
  const pairingTriggeredRef = useRef(false);

  // ── Load Sessions from Gateway ──
  const loadSessions = useCallback(async () => {
    try {
      const result = await gateway.getSessions();
      const rawSessions = Array.isArray(result?.sessions) ? result.sessions : [];
      if (rawSessions.length > 0) {
        const sessions = rawSessions.map((s: any) => {
          const key = s.key || s.sessionKey || 'unknown';
          let label = s.label || s.name || key;
          if (key === 'agent:main:main') label = t('dashboard.mainSession');
          else if (key.startsWith('agent:main:')) label = key.split(':').pop() || key;
          return {
            key, label,
            lastMessage: s.lastMessage?.content?.substring?.(0, 60),
            lastTimestamp: s.lastMessage?.timestamp || s.updatedAt,
            kind: s.kind,
          };
        });
        setSessions(sessions);
      }
    } catch { /* silent */ }
  }, [setSessions]);

  // ── Token Usage ──
  const loadTokenUsage = useCallback(async () => {
    try {
      const result = await gateway.getSessions();
      const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
      const main = sessions.find((s: any) => (s.key || '') === 'agent:main:main');
      if (main) {
        const used = main.totalTokens ?? 0;
        const max = main.contextTokens ?? 200000;
        const pct = max > 0 ? Math.round((used / max) * 100) : 0;
        if (used > 0 || max > 0) {
          setTokenUsage({ contextTokens: used, maxTokens: max, percentage: pct, compactions: main.compactions ?? 0 });
        }
        // Update model from polling ONLY if user hasn't manually selected one
        if (main.model && !manualModelOverride) setCurrentModel(main.model);
        // Always update thinking level from session
        if (main.thinkingLevel !== undefined) setCurrentThinking(main.thinkingLevel ?? null);
      }
    } catch { /* silent */ }
  }, [setTokenUsage]);

  // ── Load Available Models from Gateway ──
  // Multi-strategy: config.get → agents.list + session → fallback
  // Labels are formatted in TitleBar via formatModelName(), so we just store IDs.
  const loadAvailableModels = useCallback(async () => {
    // ── Strategy 1: config.get → agents.defaults.models (most reliable) ──
    try {
      const raw = await gateway.call('config.get', {});
      // Response may be config directly OR wrapped: { config: {...} }
      const config = raw?.agents?.defaults?.models ? raw : raw?.config;
      const modelsSection: Record<string, any> = config?.agents?.defaults?.models ?? {};
      const fromConfig = Object.entries(modelsSection)
        .filter(([, cfg]: [string, any]) => cfg?.alias)
        .map(([id, cfg]: [string, any]) => ({
          id,
          label: id,           // Raw — formatted in TitleBar
          alias: cfg.alias as string,
        }));
      if (fromConfig.length > 0) {
        console.log('[Models] Loaded from config.get:', fromConfig.length);
        setAvailableModels(fromConfig);
        return;
      }
    } catch (e) {
      console.warn('[Models] config.get failed, trying agents.list:', e);
    }

    // ── Strategy 2: Collect unique models from agents + session ──
    try {
      const modelMap = new Map<string, { id: string; label: string; alias?: string }>();

      // Main session model
      const sessionsResult = await gateway.getSessions();
      const sessions = Array.isArray(sessionsResult?.sessions) ? sessionsResult.sessions : [];
      const main = sessions.find((s: any) => (s.key || '') === 'agent:main:main');
      if (main?.model) modelMap.set(main.model, { id: main.model, label: main.model });

      // Agent models
      const agentsResult = await gateway.getAgents();
      const agents = Array.isArray(agentsResult?.agents) ? agentsResult.agents : [];
      for (const agent of agents) {
        const modelId = agent?.model?.primary;
        if (modelId && !modelMap.has(modelId)) {
          modelMap.set(modelId, { id: modelId, label: modelId });
        }
      }

      if (modelMap.size > 0) {
        const fromAgents = [...modelMap.values()];
        console.log('[Models] Loaded from agents/sessions:', fromAgents.length);
        setAvailableModels(fromAgents);
        return;
      }
    } catch (e) {
      console.warn('[Models] agents.list failed:', e);
    }

    // ── Strategy 3: FALLBACK_MODELS in TitleBar ──
    console.warn('[Models] All strategies failed — using hardcoded fallback');
  }, [setAvailableModels]);

  // ── Request notification permission (Web Notification API) ──
  useEffect(() => { notifications.requestPermission(); }, []);

  // ── Gateway Setup ──
  useEffect(() => {
    gateway.setCallbacks({
      onMessage: (msg) => {
        setIsTyping(false);
        addMessage(msg);
        // Notify when app is minimized/background OR user is on a different page
        const isOnChat = window.location.hash === '#/chat' || window.location.hash.startsWith('#/chat?');
        if (!document.hasFocus() || !isOnChat) {
          notifications.notify({
            type: 'message',
            title: t('notifications.newMessage'),
            body: msg.content.substring(0, 120),
          });
        }
      },
      onStreamChunk: (messageId, content, media) => {
        updateStreamingMessage(messageId, content, media ? { mediaUrl: media.mediaUrl, mediaType: media.mediaType } : undefined);
      },
      onStreamEnd: (messageId, content, media) => {
        finalizeStreamingMessage(messageId, content, media ? { mediaUrl: media.mediaUrl, mediaType: media.mediaType } : undefined);
        loadTokenUsage();
        // Notify (sound + toast) when app is minimized/background OR user is on a different page
        const isOnChat = window.location.hash === '#/chat' || window.location.hash.startsWith('#/chat?');
        if (!document.hasFocus() || !isOnChat) {
          notifications.notify({
            type: 'task_complete',
            title: t('notifications.replyComplete'),
            body: content.substring(0, 120),
          });
        }
      },
      onStatusChange: (status) => {
        setConnectionStatus(status);
        if (status.connected) {
          // Successfully connected — dismiss pairing screen if showing
          if (needsPairing) {
            setNeedsPairing(false);
            pairingTriggeredRef.current = false;
          }
          loadSessions();
          loadTokenUsage();
          loadAvailableModels();
        }
      },
      onScopeError: (error) => {
        console.warn('[App] 🔑 Scope error — triggering pairing flow:', error);
        // Only trigger pairing once per connection attempt
        if (!pairingTriggeredRef.current) {
          pairingTriggeredRef.current = true;
          setScopeError(error);
          setNeedsPairing(true);
        }
      },
    });

    initConnection();

    // Apply saved theme on startup
    const savedTheme = useSettingsStore.getState().theme;
    if (savedTheme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }

    // Listen for model changes → refresh session metadata (maxTokens, contextTokens)
    const handleModelChanged = () => loadTokenUsage();
    window.addEventListener('aegis:model-changed', handleModelChanged);

    // Cleanup — prevent orphan WebSocket connections on remount
    return () => {
      window.removeEventListener('aegis:model-changed', handleModelChanged);
      gateway.disconnect();
    };
  }, []);

  const initConnection = async () => {
    const DEFAULT_URL = 'ws://127.0.0.1:18789';

    // Priority: Settings Store (user override) → Electron config → fallback
    // Settings fields are empty by default — only override when user explicitly fills them
    const settings = useSettingsStore.getState();
    const userUrl = settings.gatewayUrl?.trim() || '';
    const userToken = settings.gatewayToken?.trim() || '';

    try {
      if (window.aegis?.config) {
        const config = await window.aegis.config.get();
        const configUrl = config.gatewayUrl || config.gatewayWsUrl || DEFAULT_URL;
        const configToken = config.gatewayToken || '';

        // User settings override ONLY if non-empty (otherwise use config as before)
        const wsUrl = userUrl || configUrl;
        const token = userToken || configToken;

        // Store HTTP URL for pairing flow + media resolution
        const httpUrl = wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
        setGatewayHttpUrl(httpUrl);
        localStorage.setItem('aegis-gateway-http', httpUrl);
        if (!localStorage.getItem('aegis-language') && config.installerLanguage) {
          const lang = config.installerLanguage as 'ar' | 'en';
          changeLanguage(lang);
          useSettingsStore.getState().setLanguage(lang);
        }
        gateway.connect(wsUrl, token);
      } else {
        gateway.connect(userUrl || DEFAULT_URL, userToken || '');
      }
    } catch {
      gateway.connect(userUrl || DEFAULT_URL, userToken || '');
    }
  };

  // ── Pairing Handlers ──
  const handlePairingComplete = useCallback(async (token: string) => {
    console.log('[App] 🔑 Pairing complete — reconnecting with new token');
    // Save token to config via IPC
    if (window.aegis?.pairing?.saveToken) {
      await window.aegis.pairing.saveToken(token);
    }
    // Also update config via the existing config:save IPC
    if (window.aegis?.config?.save) {
      await window.aegis.config.save({ gatewayToken: token });
    }
    // Reconnect gateway with new token
    gateway.reconnectWithToken(token);
    setNeedsPairing(false);
    pairingTriggeredRef.current = false;
  }, []);

  const handlePairingCancel = useCallback(() => {
    console.log('[App] Pairing cancelled by user');
    setNeedsPairing(false);
    pairingTriggeredRef.current = false;
    // Stop gateway pairing retry loop — user chose to dismiss
    gateway.stopPairingRetry();
  }, []);

  return (
    <>
      {/* Pairing overlay — shown when Gateway rejects due to missing scopes */}
      {needsPairing && (
        <PairingScreen
          gatewayHttpUrl={gatewayHttpUrl}
          onPaired={handlePairingComplete}
          onCancel={handlePairingCancel}
          errorMessage={scopeError}
        />
      )}

      <HashRouter>
        {/* In-app toast notifications — always visible, above all routes */}
        <ToastContainer />
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/workshop" element={<WorkshopPage />} />
            <Route path="/costs" element={<FullAnalyticsPage />} />
            <Route path="/analytics" element={<FullAnalyticsPage />} />
            <Route path="/cron" element={<CronMonitorPage />} />
            <Route path="/agents" element={<AgentHubPage />} />
            <Route path="/skills" element={<SkillsPageFull />} />
            <Route path="/terminal" element={<TerminalPage />} />
            <Route path="/memory" element={<MemoryExplorerPage />} />
            <Route path="/settings" element={<SettingsPageFull />} />
          </Route>
        </Routes>
      </HashRouter>
    </>
  );
}
