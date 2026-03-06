import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';

const AELLA_REPO_URL = 'https://github.com/context-labs/aella-data-explorer';

interface AellaHealth {
  status: string;
  service?: string;
  mode?: string;
  appUrl?: string;
  apiTarget?: string;
  frontendDistPath?: string;
  frontendDistExists?: boolean;
  databasePath?: string;
  databaseExists?: boolean;
  version?: string;
  upstreamReady?: boolean;
  upstreamStatus?: number;
  upstreamHealthUrl?: string;
  upstreamError?: string | null;
  serverError?: string | null;
  apiRuntimeRunning?: boolean;
  apiRuntimeError?: string | null;
  apiRuntimeLogPath?: string;
  apiRuntimeCommand?: string[];
  error?: string | null;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error instanceof Error) return error.message;
  return 'Unable to load Aella health status';
}

function normalizeGatewayAppUrl(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = (localStorage.getItem('aegis-gateway-http') || 'http://127.0.0.1:18789').replace(/\/+$/, '');
  const suffix = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${base}${suffix}`;
}

function firstString(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function AellaExplorerPage() {
  const connected = useChatStore((state) => state.connected);
  const [health, setHealth] = useState<AellaHealth | null>(null);
  const [healthError, setHealthError] = useState('');
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [managedUrl, setManagedUrl] = useState('');
  const [iframeReloadToken, setIframeReloadToken] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const parseHealthPayload = useCallback((payload: Record<string, unknown>) => {
    const upstreamStatusRaw = payload.upstreamStatus ?? payload.upstream_status;
    const upstreamStatusNumber = Number(upstreamStatusRaw);
    const upstreamStatus = Number.isFinite(upstreamStatusNumber) ? upstreamStatusNumber : undefined;
    const appUrl = firstString(payload, ['appUrl', 'app_url', 'url', 'launchUrl']);
    return {
      appUrl,
      health: {
        status: firstString(payload, ['status']) || 'ok',
        service: firstString(payload, ['service']),
        mode: firstString(payload, ['mode']),
        appUrl: appUrl || undefined,
        apiTarget: firstString(payload, ['apiTarget', 'api_target']),
        frontendDistPath: firstString(payload, ['frontendDistPath', 'frontend_dist_path']),
        frontendDistExists: !!payload.frontendDistExists || !!payload.frontend_dist_exists,
        databasePath: firstString(payload, ['databasePath', 'database_path']),
        databaseExists: !!payload.databaseExists || !!payload.database_exists,
        version: firstString(payload, ['version']),
        upstreamReady: !!payload.upstreamReady || !!payload.upstream_ready,
        upstreamStatus,
        upstreamHealthUrl: firstString(payload, ['upstreamHealthUrl', 'upstream_health_url']),
        upstreamError: firstString(payload, ['upstreamError', 'upstream_error']) || null,
        serverError: firstString(payload, ['serverError', 'server_error']) || null,
        apiRuntimeRunning: !!payload.apiRuntimeRunning || !!payload.api_runtime_running,
        apiRuntimeError: firstString(payload, ['apiRuntimeError', 'api_runtime_error']) || null,
        apiRuntimeLogPath: firstString(payload, ['apiRuntimeLogPath', 'api_runtime_log_path']) || undefined,
        apiRuntimeCommand: Array.isArray(payload.apiRuntimeCommand)
          ? (payload.apiRuntimeCommand.filter((v) => typeof v === 'string') as string[])
          : Array.isArray(payload.api_runtime_command)
            ? (payload.api_runtime_command.filter((v) => typeof v === 'string') as string[])
            : undefined,
        error: firstString(payload, ['error']) || null,
      } satisfies AellaHealth,
    };
  }, []);

  const refreshFromPayload = useCallback((payload: Record<string, unknown>) => {
    const parsed = parseHealthPayload(payload);
    const appUrl = parsed.appUrl;
    if (appUrl) {
      setManagedUrl(normalizeGatewayAppUrl(appUrl));
    }
    setHealth(parsed.health);
    return parsed.health;
  }, [parseHealthPayload]);

  const loadHealth = useCallback(async () => {
    if (!connected) {
      setHealthError('Gateway disconnected');
      return;
    }
    setLoadingHealth(true);
    try {
      const payload = await gateway.call('ontosynth.aella.health', {});
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error || 'ontosynth.aella.health failed'));
      }
      refreshFromPayload(payload as Record<string, unknown>);
      setHealthError('');
    } catch (error) {
      setHealth(null);
      setHealthError(getErrorMessage(error));
    } finally {
      setLoadingHealth(false);
    }
  }, [connected, refreshFromPayload]);

  const pollUntilApiReady = useCallback(async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const payload = await gateway.call('ontosynth.aella.health', {});
        if (!payload || payload.status === 'error') continue;
        const healthNow = refreshFromPayload(payload as Record<string, unknown>);
        if (healthNow.upstreamReady) {
          setHealthError('');
          break;
        }
      } catch {
        // Ignore transient poll errors while API is warming up.
      }
    }
  }, [refreshFromPayload]);

  const launchManaged = useCallback(async () => {
    if (!connected) {
      setHealthError('Gateway disconnected');
      return;
    }
    setLaunching(true);
    try {
      const payload = await gateway.call('ontosynth.aella.open', {});
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error || 'ontosynth.aella.open failed'));
      }
      const parsed = refreshFromPayload(payload as Record<string, unknown>);
      const appUrl = parsed.appUrl;
      if (!appUrl) {
        throw new Error('No managed app URL returned by ontosynth.aella.open');
      }
      setHealthError('');
      void pollUntilApiReady();
    } catch (error) {
      setHealthError(getErrorMessage(error));
    } finally {
      setLaunching(false);
    }
  }, [connected, pollUntilApiReady, refreshFromPayload]);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  const iframeUrl = useMemo(() => managedUrl || 'about:blank', [managedUrl]);
  const appReady = Boolean(managedUrl);
  const frontendReady = Boolean(health?.frontendDistExists);
  const databaseReady = Boolean(health?.databaseExists);
  const apiState: 'ready' | 'starting' | 'missing' =
    health?.upstreamReady ? 'ready' : health?.apiRuntimeRunning ? 'starting' : 'missing';
  const hasHardError = Boolean(healthError || health?.error || health?.serverError || (health?.upstreamError && !health?.apiRuntimeRunning));

  function statusBadge(label: string, state: 'ready' | 'starting' | 'missing') {
    return (
      <span className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px]',
        state === 'ready'
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
          : state === 'starting'
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            : 'border-rose-500/40 bg-rose-500/10 text-rose-300',
      )}>
        <span
          className={clsx(
            'h-1.5 w-1.5 rounded-full',
            state === 'ready' ? 'bg-emerald-400' : state === 'starting' ? 'bg-amber-400' : 'bg-rose-400',
          )}
        />
        {label}: {state}
      </span>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden p-4 gap-3 bg-aegis-bg">
      <section className="shrink-0 rounded-xl border border-aegis-border bg-aegis-card p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[16px] font-semibold text-aegis-text mr-1">Aella Data Explorer</h1>
          {statusBadge('App', appReady ? 'ready' : 'missing')}
          {statusBadge('Frontend', frontendReady ? 'ready' : 'missing')}
          {statusBadge('Database', databaseReady ? 'ready' : 'missing')}
          {statusBadge('API', apiState)}
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void launchManaged();
              }}
              className="px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
            >
              {launching ? 'Launching...' : 'Launch'}
            </button>
            <button
              type="button"
              onClick={() => {
                void loadHealth();
              }}
              className="px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] inline-flex items-center justify-center gap-1.5"
            >
              <RefreshCw size={12} className={clsx(loadingHealth && 'animate-spin')} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setIframeReloadToken((value) => value + 1)}
              className="px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => setShowDiagnostics((value) => !value)}
              className="px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
            >
              {showDiagnostics ? 'Hide Details' : 'Details'}
            </button>
            <a
              href={AELLA_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] inline-flex items-center gap-1.5"
            >
              Repo
              <ExternalLink size={12} />
            </a>
          </span>
        </div>

        <div className="text-[12px] text-aegis-text-dim">
          {appReady ? (
            <>Local app URL: <span className="font-mono text-aegis-text">{managedUrl}</span></>
          ) : (
            'Local app not launched. Click Launch.'
          )}
        </div>
        {hasHardError && (
          <div className="text-[12px] text-aegis-danger">
            {healthError || health?.error || health?.serverError || health?.upstreamError}
          </div>
        )}
        {!health?.upstreamReady && health?.apiRuntimeRunning && (
          <div className="text-[12px] text-amber-300">
            API is warming up. This can take ~10-20s on cold start.
          </div>
        )}
        {health?.apiRuntimeError && (
          <div className="text-[12px] text-amber-300">
            API runtime: {health.apiRuntimeError}
            {health.apiRuntimeLogPath ? ` (log: ${health.apiRuntimeLogPath})` : ''}
          </div>
        )}
        {showDiagnostics && (
          <div className="rounded-lg border border-aegis-border bg-aegis-elevated p-2 text-[11px] text-aegis-text-dim grid gap-1 md:grid-cols-2">
            <div>Status: <span className="text-aegis-text">{health?.status || 'unavailable'}</span></div>
            <div>Service: <span className="text-aegis-text">{health?.service || '-'}</span></div>
            <div>Mode: <span className="text-aegis-text">{health?.mode || '-'}</span></div>
            <div>Version: <span className="text-aegis-text">{health?.version || '-'}</span></div>
            <div>API target: <span className="text-aegis-text break-all">{health?.apiTarget || '-'}</span></div>
            <div>Upstream status: <span className="text-aegis-text">{health?.upstreamStatus ?? '-'}</span></div>
            <div>Frontend path: <span className="text-aegis-text break-all">{health?.frontendDistPath || '-'}</span></div>
            <div>Database path: <span className="text-aegis-text break-all">{health?.databasePath || '-'}</span></div>
            <div>API runtime: <span className="text-aegis-text">{health?.apiRuntimeRunning ? 'running' : 'stopped'}</span></div>
            <div>API log path: <span className="text-aegis-text break-all">{health?.apiRuntimeLogPath || '-'}</span></div>
            <div className="md:col-span-2">API command: <span className="text-aegis-text break-all">{health?.apiRuntimeCommand?.join(' ') || '-'}</span></div>
            <div className="md:col-span-2">Upstream health URL: <span className="text-aegis-text break-all">{health?.upstreamHealthUrl || '-'}</span></div>
          </div>
        )}
      </section>

      <section className="flex-1 min-h-0 rounded-xl border border-aegis-border bg-aegis-card p-2">
        {managedUrl ? (
          <iframe
            key={`${iframeUrl}-${iframeReloadToken}`}
            src={iframeUrl}
            title="Aella Data Explorer"
            className="h-full w-full rounded-lg border border-aegis-border bg-black"
            allow="clipboard-read; clipboard-write"
          />
        ) : (
          <div className="h-full w-full rounded-lg border border-aegis-border bg-aegis-elevated flex items-center justify-center text-[13px] text-aegis-text-dim">
            Local Aella app not running. Click <span className="mx-1 text-aegis-text">Launch</span>.
          </div>
        )}
      </section>
    </div>
  );
}
