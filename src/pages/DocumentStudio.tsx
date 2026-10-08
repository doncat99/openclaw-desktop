import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, FolderOpen, RefreshCw, RotateCw, SquareStack } from 'lucide-react';
import clsx from 'clsx';
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';

interface OntoSynthApplication {
  id: string;
  name: string;
  documents_count?: number;
  modified_at_epoch?: number;
}

interface DocumentRecord {
  name: string;
  path?: string;
  modified_at_epoch?: number;
}

interface PreviewBundle {
  application_id: string;
  document_name: string;
  phase_id: string;
  bundle_stem: string;
  title: string;
  editor_path: string;
  facsimile_path: string;
  editor_state_path: string;
  alignment_path: string;
  doctags_path: string;
  patch_log_path?: string | null;
  modified_at_epoch?: number;
}

interface PreviewSessionInfo {
  sessionId?: string;
  appUrl?: string;
  applicationId?: string;
  documentName?: string;
  phaseId?: string;
  bundleStem?: string;
}

const PHASE_LABELS: Record<string, string> = {
  '00_textbook': '00 Textbook',
  '01_ingestion': '01 Ingestion',
  '01_preview': '01 Preview',
  '02_structure': '02 Structure',
  '03_enrichment': '03 Enrichment',
  '04_knowledge': '04 Knowledge',
  '05_mindmap': '05 Mindmap',
  '06_assessment': '06 Assessment',
  '07_slide': '07 Slide',
  '08_infographic': '08 Infographic',
  '09_video': '09 Video',
  '10_learning': '10 Learning',
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error instanceof Error) return error.message;
  return fallback;
}

function pickString(input: Record<string, unknown> | null | undefined, keys: string[]): string {
  for (const key of keys) {
    const value = input?.[key];
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

function formatTimestamp(epoch?: number): string {
  if (!epoch || !Number.isFinite(epoch)) return 'n/a';
  try {
    return new Date(epoch * 1000).toLocaleString();
  } catch {
    return 'n/a';
  }
}

function phaseLabel(phaseId?: string): string {
  const key = String(phaseId || '').trim();
  if (!key) return '';
  return PHASE_LABELS[key] || key.replace(/_/g, ' ');
}

export function DocumentStudioPage() {
  const connected = useChatStore((state) => state.connected);
  const [searchParams] = useSearchParams();

  const [applications, setApplications] = useState<OntoSynthApplication[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [bundles, setBundles] = useState<PreviewBundle[]>([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState('');
  const [selectedDocumentName, setSelectedDocumentName] = useState('');
  const [selectedPhaseId, setSelectedPhaseId] = useState('');
  const [selectedBundleStem, setSelectedBundleStem] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [sessionInfo, setSessionInfo] = useState<PreviewSessionInfo | null>(null);
  const [loadingApplications, setLoadingApplications] = useState(false);
  const [loadingBundles, setLoadingBundles] = useState(false);
  const [openingPreview, setOpeningPreview] = useState(false);
  const [generatingBundle, setGeneratingBundle] = useState(false);
  const [refreshingSession, setRefreshingSession] = useState(false);
  const [error, setError] = useState('');
  const [iframeReloadToken, setIframeReloadToken] = useState(0);
  const loadSeqRef = useRef(0);
  const autoOpenTokenRef = useRef('');

  const routeSelection = useMemo(
    () => ({
      applicationId: searchParams.get('applicationId')?.trim() || '',
      documentName: searchParams.get('documentName')?.trim() || '',
      phaseId: searchParams.get('phaseId')?.trim() || '',
      bundleStem: searchParams.get('bundleStem')?.trim() || '',
      autoOpen: searchParams.get('autoOpen') === '1',
    }),
    [searchParams],
  );

  const loadApplications = useCallback(async () => {
    if (!connected) return;
    setLoadingApplications(true);
    try {
      const payload = await gateway.listOntoSynthApplications();
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.applications.list failed'));
      }
      const rows = Array.isArray(payload.applications) ? payload.applications : [];
      const nextApps = rows
        .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
        .map((row) => ({
          id: pickString(row, ['id']),
          name: pickString(row, ['name']) || pickString(row, ['id']),
          documents_count: Number(row.documents_count ?? row.documentsCount ?? 0) || 0,
          modified_at_epoch: Number(row.modified_at_epoch ?? row.modifiedAtEpoch ?? 0) || 0,
        }))
        .filter((row) => row.id);

      setApplications(nextApps);
      setSelectedApplicationId((current) => {
        if (current && nextApps.some((item) => item.id === current)) return current;
        return nextApps[0]?.id || '';
      });
      setError('');
    } catch (loadError) {
      setApplications([]);
      setDocuments([]);
      setBundles([]);
      setSelectedApplicationId('');
      setSelectedDocumentName('');
      setSelectedBundleStem('');
      setError(getErrorMessage(loadError, 'Failed to load OntoSynth applications'));
    } finally {
      setLoadingApplications(false);
    }
  }, [connected]);

  const loadSessionHealth = useCallback(async () => {
    if (!connected) return;
    setRefreshingSession(true);
    try {
      const payload = await gateway.getOntoSynthDocumentPreviewHealth();
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.document_preview.health failed'));
      }
      const appUrl = pickString(payload, ['appUrl', 'app_url']);
      const nextSession: PreviewSessionInfo = {
        sessionId: pickString(payload, ['sessionId', 'session_id']),
        appUrl: appUrl || undefined,
        applicationId: pickString(payload, ['applicationId', 'application_id']),
        documentName: pickString(payload, ['documentName', 'document_name']),
        phaseId: pickString(payload, ['phaseId', 'phase_id']),
        bundleStem: pickString(payload, ['bundleStem', 'bundle_stem']),
      };
      setSessionInfo(nextSession);
      if (appUrl) {
        setPreviewUrl(normalizeGatewayAppUrl(appUrl));
      }
    } catch (healthError) {
      setSessionInfo(null);
      setError((current) => current || getErrorMessage(healthError, 'Failed to query document preview health'));
    } finally {
      setRefreshingSession(false);
    }
  }, [connected]);

  const loadBundles = useCallback(async (applicationId: string, documentName: string) => {
    if (!connected || !applicationId) {
      setDocuments([]);
      setBundles([]);
      setSelectedDocumentName('');
      setSelectedBundleStem('');
      return;
    }

    const seq = ++loadSeqRef.current;
    setLoadingBundles(true);
    try {
      const payload = await gateway.listOntoSynthDocumentPreviews({
        applicationId,
        ...(documentName ? { documentName } : {}),
      });
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.document_preview.list failed'));
      }
      if (seq !== loadSeqRef.current) return;

      const docs = Array.isArray(payload.documents) ? payload.documents : [];
      const nextDocs = docs
        .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
        .map((row) => ({
          name: pickString(row, ['name']),
          path: pickString(row, ['path']) || undefined,
          modified_at_epoch: Number(row.modified_at_epoch ?? row.modifiedAtEpoch ?? 0) || 0,
        }))
        .filter((row) => row.name);

      const nextBundles = (Array.isArray(payload.bundles) ? payload.bundles : [])
        .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
        .map((row) => ({
          application_id: pickString(row, ['application_id', 'applicationId']),
          document_name: pickString(row, ['document_name', 'documentName']),
          phase_id: pickString(row, ['phase_id', 'phaseId']),
          bundle_stem: pickString(row, ['bundle_stem', 'bundleStem']),
          title: pickString(row, ['title']) || pickString(row, ['bundle_stem', 'bundleStem']),
          editor_path: pickString(row, ['editor_path', 'editorPath']) || pickString(row, ['facsimile_path', 'facsimilePath']),
          facsimile_path: pickString(row, ['facsimile_path', 'facsimilePath']),
          editor_state_path: pickString(row, ['editor_state_path', 'editorStatePath']),
          alignment_path: pickString(row, ['alignment_path', 'alignmentPath']),
          doctags_path: pickString(row, ['doctags_path', 'doctagsPath']),
          patch_log_path: pickString(row, ['patch_log_path', 'patchLogPath']) || undefined,
          modified_at_epoch: Number(row.modified_at_epoch ?? row.modifiedAtEpoch ?? 0) || 0,
        }))
        .filter((row) => row.bundle_stem);

      setDocuments(nextDocs);
      setBundles(nextBundles);

      const gatewaySession = payload.current_session && typeof payload.current_session === 'object'
        ? payload.current_session as Record<string, unknown>
        : null;
      if (gatewaySession) {
        const appUrl = pickString(gatewaySession, ['appUrl', 'app_url']);
        const nextSession: PreviewSessionInfo = {
          sessionId: pickString(gatewaySession, ['sessionId', 'session_id']),
          appUrl: appUrl || undefined,
          applicationId: pickString(gatewaySession, ['applicationId', 'application_id']),
          documentName: pickString(gatewaySession, ['documentName', 'document_name']),
          phaseId: pickString(gatewaySession, ['phaseId', 'phase_id']),
          bundleStem: pickString(gatewaySession, ['bundleStem', 'bundle_stem']),
        };
        setSessionInfo(nextSession);
        if (
          appUrl &&
          nextSession.applicationId === applicationId &&
          (!documentName || nextSession.documentName === documentName)
        ) {
          setPreviewUrl(normalizeGatewayAppUrl(appUrl));
        }
      }

      const suggestedDoc =
        pickString(payload, ['selected_document', 'selectedDocument']) ||
        nextDocs[0]?.name ||
        '';
      setSelectedDocumentName((current) => {
        if (current && nextDocs.some((item) => item.name === current)) return current;
        return suggestedDoc;
      });

      setSelectedBundleStem((current) => {
      const filtered = nextBundles.filter((item) => !selectedPhaseId || item.phase_id === selectedPhaseId);
        if (current && filtered.some((item) => item.bundle_stem === current)) return current;
        return filtered[0]?.bundle_stem || nextBundles[0]?.bundle_stem || '';
      });

      setSelectedPhaseId((current) => {
        if (current && nextBundles.some((item) => item.phase_id === current)) return current;
        if (nextBundles.some((item) => item.phase_id === '01_preview')) return '01_preview';
        return current;
      });

      setError('');
    } catch (loadError) {
      if (seq !== loadSeqRef.current) return;
      setDocuments([]);
      setBundles([]);
      setSelectedBundleStem('');
      setError(getErrorMessage(loadError, 'Failed to load preview bundles'));
    } finally {
      if (seq === loadSeqRef.current) {
        setLoadingBundles(false);
      }
    }
  }, [connected, selectedPhaseId]);

  const phaseOptions = useMemo(() => {
    const seen = new Set<string>();
    const values: string[] = [];
    for (const bundle of bundles) {
      const phaseId = String(bundle.phase_id || '').trim();
      if (!phaseId || seen.has(phaseId)) continue;
      seen.add(phaseId);
      values.push(phaseId);
    }
    values.sort();
    return values;
  }, [bundles]);

  const visibleBundles = useMemo(() => {
    return bundles.filter((bundle) => !selectedPhaseId || bundle.phase_id === selectedPhaseId);
  }, [bundles, selectedPhaseId]);

  const selectedBundle = useMemo(() => {
    return visibleBundles.find((bundle) => bundle.bundle_stem === selectedBundleStem) || visibleBundles[0] || null;
  }, [selectedBundleStem, visibleBundles]);

  useEffect(() => {
    if (routeSelection.applicationId) setSelectedApplicationId(routeSelection.applicationId);
    if (routeSelection.documentName) setSelectedDocumentName(routeSelection.documentName);
    if (routeSelection.phaseId) setSelectedPhaseId(routeSelection.phaseId);
    if (routeSelection.bundleStem) setSelectedBundleStem(routeSelection.bundleStem);
    autoOpenTokenRef.current = routeSelection.autoOpen
      ? [
          routeSelection.applicationId,
          routeSelection.documentName,
          routeSelection.phaseId,
          routeSelection.bundleStem,
        ].join('|')
      : '';
  }, [
    routeSelection.applicationId,
    routeSelection.autoOpen,
    routeSelection.bundleStem,
    routeSelection.documentName,
    routeSelection.phaseId,
  ]);

  useEffect(() => {
    void loadApplications();
    void loadSessionHealth();
  }, [loadApplications, loadSessionHealth]);

  useEffect(() => {
    if (!selectedApplicationId) return;
    void loadBundles(selectedApplicationId, selectedDocumentName);
  }, [selectedApplicationId, selectedDocumentName, loadBundles]);

  useEffect(() => {
    if (!selectedPhaseId) return;
    if (phaseOptions.includes(selectedPhaseId)) return;
    setSelectedPhaseId('');
  }, [phaseOptions, selectedPhaseId]);

  useEffect(() => {
    setSelectedBundleStem((current) => {
      if (current && visibleBundles.some((bundle) => bundle.bundle_stem === current)) return current;
      return visibleBundles[0]?.bundle_stem || '';
    });
  }, [visibleBundles]);

  const openPreview = useCallback(async () => {
    if (!connected) {
      setError('Gateway disconnected');
      return;
    }
    if (!selectedApplicationId || !selectedDocumentName || !selectedBundle) {
      setError('Select an application, document, and preview bundle first.');
      return;
    }
    setOpeningPreview(true);
    try {
      const payload = await gateway.openOntoSynthDocumentPreview({
        applicationId: selectedApplicationId,
        documentName: selectedDocumentName,
        bundleStem: selectedBundle.bundle_stem,
      });
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.document_preview.open failed'));
      }
      const appUrl = pickString(payload, ['appUrl', 'app_url']);
      if (!appUrl) {
        throw new Error('No app URL returned by ontosynth.document_preview.open');
      }
      setPreviewUrl(`${normalizeGatewayAppUrl(appUrl)}?t=${Date.now()}`);
      setSessionInfo({
        sessionId: pickString(payload, ['sessionId', 'session_id']) || undefined,
        appUrl,
        applicationId: pickString(payload, ['applicationId', 'application_id']) || undefined,
        documentName: pickString(payload, ['documentName', 'document_name']) || undefined,
        phaseId: pickString(payload, ['phaseId', 'phase_id']) || undefined,
        bundleStem: pickString(payload, ['bundleStem', 'bundle_stem']) || undefined,
      });
      setError('');
    } catch (openError) {
      setError(getErrorMessage(openError, 'Failed to open document preview'));
    } finally {
      setOpeningPreview(false);
    }
  }, [connected, selectedApplicationId, selectedDocumentName, selectedBundle]);

  const generateBundle = useCallback(async () => {
    if (!connected) {
      setError('Gateway disconnected');
      return;
    }
    if (!selectedApplicationId || !selectedDocumentName) {
      setError('Select an application and document first.');
      return;
    }
    setGeneratingBundle(true);
    try {
      const payload = await gateway.generateOntoSynthDocumentPreview({
        applicationId: selectedApplicationId,
        documentName: selectedDocumentName,
        phaseId: selectedPhaseId || '01_preview',
        ...(selectedBundleStem ? { bundleStem: selectedBundleStem } : {}),
      });
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.document_preview.generate failed'));
      }
      const bundle = payload.bundle && typeof payload.bundle === 'object'
        ? payload.bundle as Record<string, unknown>
        : null;
      const generatedPhaseId = pickString(bundle, ['phase_id', 'phaseId']) || selectedPhaseId || '01_preview';
      const generatedBundleStem = pickString(bundle, ['bundle_stem', 'bundleStem']);
      if (generatedPhaseId) setSelectedPhaseId(generatedPhaseId);
      if (generatedBundleStem) setSelectedBundleStem(generatedBundleStem);
      await loadBundles(selectedApplicationId, selectedDocumentName);
      setError('');
    } catch (generateError) {
      setError(getErrorMessage(generateError, 'Failed to generate preview bundle'));
    } finally {
      setGeneratingBundle(false);
    }
  }, [connected, loadBundles, selectedApplicationId, selectedBundleStem, selectedDocumentName, selectedPhaseId]);

  useEffect(() => {
    if (!routeSelection.autoOpen || !selectedBundle) return;
    const selectedToken = [
      selectedApplicationId,
      selectedDocumentName,
      selectedPhaseId,
      selectedBundle.bundle_stem,
    ].join('|');
    if (!selectedToken.startsWith(`${routeSelection.applicationId}|${routeSelection.documentName}`)) return;
    if (routeSelection.phaseId && routeSelection.phaseId !== selectedPhaseId) return;
    if (routeSelection.bundleStem && routeSelection.bundleStem !== selectedBundle.bundle_stem) return;
    if (!autoOpenTokenRef.current || autoOpenTokenRef.current === `opened:${selectedToken}`) return;
    autoOpenTokenRef.current = `opened:${selectedToken}`;
    void openPreview();
  }, [
    openPreview,
    routeSelection.applicationId,
    routeSelection.autoOpen,
    routeSelection.bundleStem,
    routeSelection.documentName,
    routeSelection.phaseId,
    selectedApplicationId,
    selectedBundle,
    selectedDocumentName,
    selectedPhaseId,
  ]);

  const selectedApp = applications.find((item) => item.id === selectedApplicationId) || null;
  const sessionMatchesSelection =
    sessionInfo?.applicationId === selectedApplicationId &&
    sessionInfo?.documentName === selectedDocumentName &&
    (!selectedBundle || sessionInfo?.bundleStem === selectedBundle.bundle_stem);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden p-6 gap-4 bg-aegis-bg">
      <section className="shrink-0 rounded-xl border border-aegis-border bg-aegis-card p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[18px] font-semibold text-aegis-text">Document Studio</h1>
            <p className="mt-1 text-[12px] text-aegis-text-dim">
              Gateway-hosted OntoSynth facsimile editor. The Desktop only selects a bundle and hosts the returned preview URL.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void loadApplications();
                if (selectedApplicationId) void loadBundles(selectedApplicationId, selectedDocumentName);
                void loadSessionHealth();
              }}
              className="px-3 py-2 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] inline-flex items-center gap-1.5"
            >
              <RefreshCw size={12} className={clsx((loadingApplications || loadingBundles || refreshingSession) && 'animate-spin')} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => {
                void generateBundle();
              }}
              disabled={!selectedApplicationId || !selectedDocumentName || generatingBundle}
              className="px-3 py-2 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              <SquareStack size={12} />
              {generatingBundle ? 'Generating...' : 'Generate Bundle'}
            </button>
            <button
              type="button"
              onClick={() => {
                void openPreview();
              }}
              disabled={!selectedBundle || openingPreview}
              className="px-3 py-2 text-[12px] rounded-lg bg-aegis-primary text-white hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              <FolderOpen size={12} />
              {openingPreview ? 'Opening...' : 'Open Editor'}
            </button>
            <button
              type="button"
              onClick={() => setIframeReloadToken((value) => value + 1)}
              disabled={!previewUrl}
              className="px-3 py-2 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              <RotateCw size={12} />
              Reload Frame
            </button>
            <a
              href={previewUrl || '#'}
              target="_blank"
              rel="noreferrer"
              className={clsx(
                'px-3 py-2 text-[12px] rounded-lg border border-aegis-border text-aegis-text inline-flex items-center gap-1.5',
                previewUrl ? 'hover:bg-[rgb(var(--aegis-overlay)/0.04)]' : 'pointer-events-none opacity-60',
              )}
            >
              Open URL
              <ExternalLink size={12} />
            </a>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <div className="px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text">
            Applications: <span className="font-semibold">{applications.length}</span>
          </div>
          <div className="px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text">
            Documents: <span className="font-semibold">{documents.length}</span>
          </div>
          <div className="px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text">
            Bundles: <span className="font-semibold">{visibleBundles.length}</span>
          </div>
          <div className="px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text">
            Session: <span className={clsx('font-semibold', sessionInfo?.sessionId ? 'text-emerald-300' : 'text-aegis-text-dim')}>{sessionInfo?.sessionId ? 'ready' : 'idle'}</span>
          </div>
        </div>

        {sessionInfo?.appUrl && (
          <div className="text-[12px] text-aegis-text-dim">
            Current gateway session:{' '}
            <span className="font-mono text-aegis-text break-all">{normalizeGatewayAppUrl(sessionInfo.appUrl)}</span>
            {sessionMatchesSelection && <span className="ml-2 text-emerald-300">matches current selection</span>}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-aegis-danger/40 bg-aegis-danger/10 p-2 text-[12px] text-aegis-danger">
            {error}
          </div>
        )}
      </section>

      <section className="flex-1 min-h-0 grid gap-4 xl:grid-cols-[360px,minmax(0,1fr)]">
        <aside className="min-h-0 rounded-xl border border-aegis-border bg-aegis-card p-4 flex flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1 scrollbar-thin">
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-[0.12em] text-aegis-text-dim">Application</label>
                <select
                  value={selectedApplicationId}
                  onChange={(event) => {
                    setSelectedApplicationId(event.target.value);
                    setSelectedDocumentName('');
                    setSelectedBundleStem('');
                  }}
                  disabled={loadingApplications || applications.length === 0}
                  className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text"
                >
                  {applications.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.name}
                    </option>
                  ))}
                  {applications.length === 0 && <option value="">No OntoSynth application found</option>}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-[0.12em] text-aegis-text-dim">Document</label>
                <select
                  value={selectedDocumentName}
                  onChange={(event) => {
                    setSelectedDocumentName(event.target.value);
                    setSelectedBundleStem('');
                  }}
                  disabled={!selectedApplicationId || loadingBundles || documents.length === 0}
                  className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text"
                >
                  {documents.map((doc) => (
                    <option key={doc.name} value={doc.name}>
                      {doc.name}
                    </option>
                  ))}
                  {documents.length === 0 && <option value="">No document directory found</option>}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-[0.12em] text-aegis-text-dim">Phase Filter</label>
                <select
                  value={selectedPhaseId}
                  onChange={(event) => setSelectedPhaseId(event.target.value)}
                  disabled={bundles.length === 0}
                  className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text"
                >
                  <option value="">All phases</option>
                  {phaseOptions.map((phaseId) => (
                    <option key={phaseId} value={phaseId}>
                      {phaseLabel(phaseId)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-lg border border-aegis-border bg-aegis-elevated p-3 text-[12px] text-aegis-text-dim space-y-1">
                <div>Methods:</div>
                <div className="font-mono text-[11px] text-aegis-text break-all">
                  ontosynth.applications.list
                </div>
                <div className="font-mono text-[11px] text-aegis-text break-all">
                  ontosynth.document_preview.list / generate / open / health
                </div>
                <div className="pt-1">
                  Preview bundles appear only after OntoSynth has generated
                  {' '}<span className="font-mono text-aegis-text">.facsimile.html</span>,
                  {' '}<span className="font-mono text-aegis-text">.editor.html</span>,
                  {' '}<span className="font-mono text-aegis-text">.editor_state.json</span>,
                  {' '}<span className="font-mono text-aegis-text">.alignment.json</span>, and
                  {' '}<span className="font-mono text-aegis-text">.doctags</span>.
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-[0.12em] text-aegis-text-dim">Bundles</div>
                <div className="text-[11px] text-aegis-text-dim">{visibleBundles.length}</div>
              </div>

              <div className="space-y-2">
                {visibleBundles.map((bundle) => {
                  const isActive = selectedBundle?.bundle_stem === bundle.bundle_stem;
                  return (
                    <button
                      key={bundle.bundle_stem}
                      type="button"
                      onClick={() => setSelectedBundleStem(bundle.bundle_stem)}
                      className={clsx(
                        'w-full rounded-xl border p-3 text-left transition-colors',
                        isActive
                          ? 'border-aegis-primary bg-[rgb(var(--aegis-primary)/0.12)]'
                          : 'border-aegis-border bg-aegis-elevated hover:bg-[rgb(var(--aegis-overlay)/0.04)]',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium text-aegis-text truncate">{bundle.title}</div>
                          <div className="mt-1 text-[11px] text-aegis-text-dim truncate">{phaseLabel(bundle.phase_id)}</div>
                        </div>
                        <SquareStack size={14} className={clsx(isActive ? 'text-aegis-primary' : 'text-aegis-text-dim')} />
                      </div>
                      <div className="mt-2 text-[11px] text-aegis-text-dim break-all">{bundle.editor_path || bundle.facsimile_path}</div>
                      <div className="mt-2 text-[11px] text-aegis-text-dim">Updated: {formatTimestamp(bundle.modified_at_epoch)}</div>
                    </button>
                  );
                })}
                {!loadingBundles && visibleBundles.length === 0 && (
                  <div className="rounded-xl border border-dashed border-aegis-border p-4 text-[12px] text-aegis-text-dim">
                    No preview bundle found for the current selection.
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>

        <section className="min-h-0 rounded-xl border border-aegis-border bg-aegis-card p-2">
          {previewUrl ? (
            <iframe
              key={`${previewUrl}-${iframeReloadToken}`}
              src={previewUrl}
              title="OntoSynth Document Studio"
              className="h-full w-full rounded-lg border border-aegis-border bg-black"
              allow="clipboard-read; clipboard-write"
            />
          ) : (
            <div className="h-full w-full rounded-lg border border-aegis-border bg-aegis-elevated flex items-center justify-center px-8 text-center text-[13px] text-aegis-text-dim">
              Open a preview bundle to load the gateway-hosted facsimile editor.
            </div>
          )}
        </section>
      </section>

      {selectedApp && (
        <div className="shrink-0 text-[11px] text-aegis-text-dim">
          Selected app: <span className="text-aegis-text">{selectedApp.name}</span>
          {' '}· documents: <span className="text-aegis-text">{selectedApp.documents_count ?? 0}</span>
          {' '}· updated: <span className="text-aegis-text">{formatTimestamp(selectedApp.modified_at_epoch)}</span>
        </div>
      )}
    </div>
  );
}
