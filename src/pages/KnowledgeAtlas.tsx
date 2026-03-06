import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';

const ATLAS_EXAMPLES_URL = 'https://apple.github.io/embedding-atlas/examples/';
const ATLAS_GITHUB_URL = 'https://github.com/apple/embedding-atlas';

interface KnowledgeAtlasSource {
  path: string;
  relative_path: string;
  name: string;
  kind: 'units' | 'atlas';
  size_bytes: number;
  modified_at_epoch: number;
}

interface KnowledgeAtlasHealthResponse {
  status: string;
  sources_count: number;
  sources: KnowledgeAtlasSource[];
  has_embedding_atlas: boolean;
  embedding_atlas_version?: string;
  embedding_atlas_error?: string;
}

interface KnowledgeAtlasBuildResponse {
  status: string;
  error?: string;
  source?: KnowledgeAtlasSource;
  atlas_relative_path?: string;
  generated_projection?: boolean;
  app_url?: string;
  cached?: boolean;
  sources?: KnowledgeAtlasSource[];
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error instanceof Error) return error.message;
  return fallback;
}

function firstString(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeGatewayAppUrl(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = (localStorage.getItem('aegis-gateway-http') || 'http://127.0.0.1:18789').replace(/\/+$/, '');
  const suffix = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${base}${suffix}`;
}

function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIdx = 0;
  let size = bytes;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx += 1;
  }
  return `${size.toFixed(unitIdx === 0 ? 0 : 1)} ${units[unitIdx]}`;
}

function formatTimestamp(epoch: number | null | undefined): string {
  if (typeof epoch !== 'number' || Number.isNaN(epoch) || epoch <= 0) return '-';
  return new Date(epoch * 1000).toLocaleString();
}

function pickDefaultSource(sources: KnowledgeAtlasSource[]): KnowledgeAtlasSource | null {
  return sources.find((item) => item.kind === 'atlas') || sources[0] || null;
}

export function KnowledgeAtlasPage() {
  const connected = useChatStore((state) => state.connected);

  const [health, setHealth] = useState<KnowledgeAtlasHealthResponse | null>(null);
  const [sources, setSources] = useState<KnowledgeAtlasSource[]>([]);
  const [selectedSourcePath, setSelectedSourcePath] = useState('');
  const [selectedSourceKind, setSelectedSourceKind] = useState<'units' | 'atlas' | null>(null);
  const [atlasUrl, setAtlasUrl] = useState('');
  const [lastBuild, setLastBuild] = useState<KnowledgeAtlasBuildResponse | null>(null);
  const [lastBuiltSourcePath, setLastBuiltSourcePath] = useState('');

  const [statusText, setStatusText] = useState('Idle');
  const [healthError, setHealthError] = useState('');
  const [buildError, setBuildError] = useState('');
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [building, setBuilding] = useState(false);

  const selectedSource = useMemo(
    () => sources.find((item) => item.path === selectedSourcePath) || null,
    [sources, selectedSourcePath]
  );

  const loadHealth = useCallback(async () => {
    if (!connected) {
      setHealthError('Gateway disconnected');
      return;
    }
    setLoadingHealth(true);
    setHealthError('');

    try {
      const payload = await gateway.call('ontosynth.knowledge.atlas.health', {});
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error || 'ontosynth.knowledge.atlas.health failed', 'Atlas health failed'));
      }
      const nextHealth = payload as KnowledgeAtlasHealthResponse;
      const nextSources = Array.isArray(nextHealth.sources) ? nextHealth.sources : [];
      setHealth(nextHealth);
      setSources(nextSources);

      const nextDefault = pickDefaultSource(nextSources);
      setSelectedSourcePath((current) => {
        if (current && nextSources.some((item) => item.path === current)) return current;
        return nextDefault?.path || '';
      });
    } catch (error) {
      setHealth(null);
      setSources([]);
      setSelectedSourcePath('');
      setHealthError(getErrorMessage(error, 'Failed to query Atlas health'));
    } finally {
      setLoadingHealth(false);
    }
  }, [connected]);

  const buildAtlas = useCallback(
    async (forceRebuild: boolean) => {
      if (!connected) {
        setBuildError('Gateway disconnected');
        return;
      }
      if (!selectedSourcePath) {
        setBuildError('Select a parquet source first.');
        return;
      }

      setBuilding(true);
      setBuildError('');
      setStatusText('Building Embedding Atlas application ...');

      try {
        const payload = (await gateway.call('ontosynth.knowledge.atlas.build', {
          sourcePath: selectedSourcePath,
          forceRebuild,
        })) as KnowledgeAtlasBuildResponse;

        if (!payload || payload.status === 'error') {
          throw new Error(payload?.error || 'ontosynth.knowledge.atlas.build failed');
        }

        setLastBuild(payload);
        if (payload.sources && payload.sources.length > 0) {
          setSources(payload.sources);
        }

        if (payload.status !== 'ok' || !payload.app_url) {
          setBuildError(payload.error || 'Atlas build failed');
          setStatusText('Build failed');
          return;
        }

        setLastBuiltSourcePath(selectedSourcePath);
        setAtlasUrl(`${normalizeGatewayAppUrl(payload.app_url)}?t=${Date.now()}`);
        const cacheLabel = payload.cached ? 'cached app' : 'fresh app';
        const projectionLabel = payload.generated_projection ? 'projection generated' : 'projection reused';
        setStatusText(`Ready (${cacheLabel}, ${projectionLabel})`);
      } catch (error) {
        setBuildError(getErrorMessage(error, 'Atlas build request failed'));
        setStatusText('Build failed');
      } finally {
        setBuilding(false);
      }
    },
    [connected, selectedSourcePath]
  );

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  useEffect(() => {
    if (!selectedSource) {
      setSelectedSourceKind(null);
      return;
    }
    setSelectedSourceKind(selectedSource.kind);
  }, [selectedSource]);

  useEffect(() => {
    if (!selectedSourcePath) return;
    if (building) return;
    if (selectedSourcePath === lastBuiltSourcePath && atlasUrl) return;
    void buildAtlas(false);
  }, [atlasUrl, buildAtlas, building, lastBuiltSourcePath, selectedSourcePath]);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden p-6 gap-4 bg-aegis-bg">
      <section className="shrink-0 rounded-xl border border-aegis-border bg-aegis-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[18px] font-semibold text-aegis-text">Knowledge Atlas</h1>
            <p className="mt-1 text-[12px] text-aegis-text-dim">
              Gateway-backed Embedding Atlas generated from OntoSynth parquet sources.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={ATLAS_EXAMPLES_URL}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] inline-flex items-center gap-1.5"
            >
              Examples
              <ExternalLink size={12} />
            </a>
            <a
              href={ATLAS_GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] inline-flex items-center gap-1.5"
            >
              Source
              <ExternalLink size={12} />
            </a>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto]">
          <div className="px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text">
            Gateway methods: <span className="font-mono">ontosynth.knowledge.atlas.health</span> / <span className="font-mono">ontosynth.knowledge.atlas.build</span>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadHealth();
            }}
            className="px-3 py-2 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] inline-flex items-center justify-center gap-1.5"
          >
            <RefreshCw size={12} className={clsx(loadingHealth && 'animate-spin')} />
            Refresh Sources
          </button>
        </div>

        <div className="mt-3 grid gap-2 xl:grid-cols-[minmax(340px,1fr),auto,auto]">
          <select
            value={selectedSourcePath}
            onChange={(event) => setSelectedSourcePath(event.target.value)}
            disabled={sources.length === 0 || building}
            className="px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text"
          >
            {sources.map((source) => (
              <option key={source.path} value={source.path}>
                {source.relative_path}
              </option>
            ))}
            {sources.length === 0 && <option value="">No knowledge parquet source found</option>}
          </select>
          <button
            type="button"
            onClick={() => {
              void buildAtlas(false);
            }}
            disabled={building || !selectedSourcePath}
            className="px-3 py-2 text-[12px] rounded-lg bg-aegis-primary text-white hover:opacity-90 disabled:opacity-60"
          >
            {building ? 'Building...' : 'Build Atlas'}
          </button>
          <button
            type="button"
            onClick={() => {
              void buildAtlas(true);
            }}
            disabled={building || !selectedSourcePath}
            className="px-3 py-2 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
          >
            Force Rebuild
          </button>
        </div>

        <div className="mt-3 rounded-lg border border-aegis-border bg-aegis-elevated p-3 text-[12px] text-aegis-text-dim space-y-1">
          <div>Status: <span className="text-aegis-text">{statusText}</span></div>
          <div>Embedding Atlas: <span className="text-aegis-text">{health?.has_embedding_atlas ? health.embedding_atlas_version || 'available' : 'missing'}</span></div>
          <div>Sources: <span className="text-aegis-text">{health?.sources_count ?? 0}</span></div>
          <div>Selected kind: <span className="text-aegis-text">{selectedSourceKind || '-'}</span></div>
          <div>Selected size: <span className="text-aegis-text">{formatBytes(selectedSource?.size_bytes)}</span></div>
          <div>Updated: <span className="text-aegis-text">{formatTimestamp(selectedSource?.modified_at_epoch)}</span></div>
          <div>Atlas file: <span className="text-aegis-text">{lastBuild?.atlas_relative_path || '-'}</span></div>
          {healthError && <div className="text-aegis-danger">Health error: {healthError}</div>}
          {buildError && <div className="text-aegis-danger">Build error: {buildError}</div>}
          {health?.embedding_atlas_error && <div className="text-aegis-danger">Dependency error: {health.embedding_atlas_error}</div>}
        </div>
      </section>

      <section className="flex-1 min-h-0 rounded-xl border border-aegis-border bg-aegis-card p-2">
        {atlasUrl ? (
          <iframe
            key={atlasUrl}
            src={atlasUrl}
            title="Embedding Atlas"
            className="h-full w-full rounded-lg border border-aegis-border bg-black"
            allow="clipboard-read; clipboard-write"
          />
        ) : (
          <div className="h-full flex items-center justify-center text-[13px] text-aegis-text-dim">
            Select a source and build the Atlas app.
          </div>
        )}
      </section>
    </div>
  );
}
