import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';

interface OntoSynthApplication {
  id: string;
  name: string;
  documents_count?: number;
  modified_at_epoch?: number;
}

interface LlmGatewayHealth {
  requestsTracked?: number;
  inflight?: number;
  deadLetters?: number;
  updatedAt?: string;
  llmMode?: string;
  gatewayEnabled?: boolean;
  deployStage?: string;
  directModeAllowed?: boolean;
  statusCounts?: Record<string, number>;
}

interface LlmGatewayRequest {
  request_id: string;
  status?: string;
  model?: string;
  provider?: string;
  phase?: string;
  operation?: string;
  completed_at?: string;
  error_message?: string;
}

interface LlmGatewayDeadLetter {
  request_id: string;
  status?: string;
  model?: string;
  provider?: string;
  error_message?: string;
  dead_letter_reason?: string;
  ts?: string;
}

interface LlmGatewayFacets {
  statuses: string[];
  providers: string[];
  models: string[];
}

interface LlmGatewayAudit {
  applicationsCount: number;
  queuedCount: number;
  driftCount: number;
}

interface LlmGatewayPolicyEntry {
  scope: 'provider' | 'model';
  key: string;
  limit: number;
  updatedAt?: string;
  updatedBy?: string;
  note?: string;
}

interface LlmGatewaySummaryMeta {
  filteredCount: number;
  limit: number;
  offset: number;
}

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

function formatTimestamp(epoch?: number): string {
  if (!epoch || !Number.isFinite(epoch)) return 'n/a';
  try {
    return new Date(epoch * 1000).toLocaleString();
  } catch {
    return 'n/a';
  }
}

export function LlmGatewayPage() {
  const connected = useChatStore((state) => state.connected);
  const [applications, setApplications] = useState<OntoSynthApplication[]>([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState('');
  const [llmHealth, setLlmHealth] = useState<LlmGatewayHealth | null>(null);
  const [llmRequests, setLlmRequests] = useState<LlmGatewayRequest[]>([]);
  const [llmDeadLetters, setLlmDeadLetters] = useState<LlmGatewayDeadLetter[]>([]);
  const [llmFacets, setLlmFacets] = useState<LlmGatewayFacets>({ statuses: [], providers: [], models: [] });
  const [llmAudit, setLlmAudit] = useState<LlmGatewayAudit | null>(null);
  const [providerPolicies, setProviderPolicies] = useState<LlmGatewayPolicyEntry[]>([]);
  const [modelPolicies, setModelPolicies] = useState<LlmGatewayPolicyEntry[]>([]);
  const [providerPolicyDrafts, setProviderPolicyDrafts] = useState<Record<string, string>>({});
  const [modelPolicyDrafts, setModelPolicyDrafts] = useState<Record<string, string>>({});
  const [policyBusy, setPolicyBusy] = useState('');
  const [newProviderKey, setNewProviderKey] = useState('');
  const [newProviderLimit, setNewProviderLimit] = useState('');
  const [newModelKey, setNewModelKey] = useState('');
  const [newModelLimit, setNewModelLimit] = useState('');
  const [loadingApplications, setLoadingApplications] = useState(false);
  const [loadingGateway, setLoadingGateway] = useState(false);
  const [llmActionBusy, setLlmActionBusy] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [requestPage, setRequestPage] = useState(0);
  const [deadLetterPage, setDeadLetterPage] = useState(0);
  const [requestMeta, setRequestMeta] = useState<LlmGatewaySummaryMeta>({ filteredCount: 0, limit: 25, offset: 0 });
  const [deadLetterMeta, setDeadLetterMeta] = useState<LlmGatewaySummaryMeta>({ filteredCount: 0, limit: 10, offset: 0 });
  const [error, setError] = useState('');

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
      setSelectedApplicationId('');
      setError(getErrorMessage(loadError, 'Failed to load OntoSynth applications'));
    } finally {
      setLoadingApplications(false);
    }
  }, [connected]);

  const loadGateway = useCallback(async (applicationId: string) => {
    if (!connected || !applicationId) {
      setLlmHealth(null);
      setLlmRequests([]);
      setLlmDeadLetters([]);
      return;
    }
    setLoadingGateway(true);
    try {
      const [healthPayload, auditPayload, facetsPayload, policiesPayload, summaryPayload, deadLettersPayload] = await Promise.all([
        gateway.getOntoSynthLlmGatewayHealth({ applicationId }),
        gateway.getOntoSynthLlmGatewayAudit({}),
        gateway.getOntoSynthLlmGatewayFacets({ applicationId }),
        gateway.getOntoSynthLlmGatewayPolicies({ applicationId }),
        gateway.getOntoSynthLlmGatewaySummary({
          applicationId,
          limit: requestMeta.limit,
          offset: requestPage * requestMeta.limit,
          status: statusFilter,
          provider: providerFilter,
          model: modelFilter,
          search: searchFilter,
          sortOrder,
        }),
        gateway.getOntoSynthLlmGatewayDeadLetters({
          applicationId,
          limit: deadLetterMeta.limit,
          offset: deadLetterPage * deadLetterMeta.limit,
          status: statusFilter,
          provider: providerFilter,
          model: modelFilter,
          search: searchFilter,
          sortOrder,
        }),
      ]);
      if (!healthPayload || healthPayload.status === 'error') {
        throw new Error(getErrorMessage(healthPayload?.error, 'ontosynth.llm_gateway.health failed'));
      }
      if (!auditPayload || auditPayload.status === 'error') {
        throw new Error(getErrorMessage(auditPayload?.error, 'ontosynth.llm_gateway.audit failed'));
      }
      if (!summaryPayload || summaryPayload.status === 'error') {
        throw new Error(getErrorMessage(summaryPayload?.error, 'ontosynth.llm_gateway.summary failed'));
      }
      if (!deadLettersPayload || deadLettersPayload.status === 'error') {
        throw new Error(getErrorMessage(deadLettersPayload?.error, 'ontosynth.llm_gateway.dead_letters failed'));
      }
      if (!facetsPayload || facetsPayload.status === 'error') {
        throw new Error(getErrorMessage(facetsPayload?.error, 'ontosynth.llm_gateway.facets failed'));
      }
      if (!policiesPayload || policiesPayload.status === 'error') {
        throw new Error(getErrorMessage(policiesPayload?.error, 'ontosynth.llm_gateway.policies failed'));
      }
      setLlmHealth({
        requestsTracked: Number(healthPayload.requestsTracked ?? 0) || 0,
        inflight: Number(healthPayload.inflight ?? 0) || 0,
        deadLetters: Number(healthPayload.deadLetters ?? 0) || 0,
        updatedAt: pickString(healthPayload, ['updatedAt']),
        llmMode: pickString(healthPayload, ['llmMode']) || undefined,
        gatewayEnabled: Boolean(healthPayload.gatewayEnabled),
        deployStage: pickString(healthPayload, ['deployStage']) || undefined,
        directModeAllowed: Boolean(healthPayload.directModeAllowed),
        statusCounts:
          healthPayload.statusCounts && typeof healthPayload.statusCounts === 'object'
            ? (healthPayload.statusCounts as Record<string, number>)
            : {},
      });
      setLlmAudit({
        applicationsCount: Number(auditPayload.applicationsCount ?? 0) || 0,
        queuedCount: Number(auditPayload.queuedCount ?? 0) || 0,
        driftCount: Number(auditPayload.driftCount ?? 0) || 0,
      });
      setLlmRequests(
        (Array.isArray(summaryPayload.requests) ? summaryPayload.requests : [])
          .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
          .map((row) => ({
            request_id: pickString(row, ['request_id', 'requestId']),
            status: pickString(row, ['status']) || undefined,
            model: pickString(row, ['model']) || undefined,
            provider: pickString(row, ['provider']) || undefined,
            phase: pickString(row, ['phase']) || undefined,
            operation: pickString(row, ['operation']) || undefined,
            completed_at: pickString(row, ['completed_at', 'completedAt']) || undefined,
            error_message: pickString(row, ['error_message', 'errorMessage']) || undefined,
          })),
      );
      setLlmFacets({
        statuses: Array.isArray(facetsPayload.statuses) ? facetsPayload.statuses.map((value: unknown) => String(value || '').trim()).filter(Boolean) : [],
        providers: Array.isArray(facetsPayload.providers) ? facetsPayload.providers.map((value: unknown) => String(value || '').trim()).filter(Boolean) : [],
        models: Array.isArray(facetsPayload.models) ? facetsPayload.models.map((value: unknown) => String(value || '').trim()).filter(Boolean) : [],
      });
      const nextProviderPolicies = (Array.isArray(policiesPayload.providerLimits) ? policiesPayload.providerLimits : [])
        .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
        .map((row) => ({
          scope: 'provider' as const,
          key: pickString(row, ['key']),
          limit: Number(row.limit ?? 0) || 0,
          updatedAt: pickString(row, ['updatedAt']) || undefined,
          updatedBy: pickString(row, ['updatedBy']) || undefined,
          note: pickString(row, ['note']) || undefined,
        }))
        .filter((row) => row.key);
      const nextModelPolicies = (Array.isArray(policiesPayload.modelLimits) ? policiesPayload.modelLimits : [])
        .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
        .map((row) => ({
          scope: 'model' as const,
          key: pickString(row, ['key']),
          limit: Number(row.limit ?? 0) || 0,
          updatedAt: pickString(row, ['updatedAt']) || undefined,
          updatedBy: pickString(row, ['updatedBy']) || undefined,
          note: pickString(row, ['note']) || undefined,
        }))
        .filter((row) => row.key);
      setProviderPolicies(nextProviderPolicies);
      setModelPolicies(nextModelPolicies);
      setProviderPolicyDrafts((current) => {
        const next = { ...current };
        for (const row of nextProviderPolicies) {
          if (!next[row.key]) next[row.key] = String(row.limit);
        }
        return next;
      });
      setModelPolicyDrafts((current) => {
        const next = { ...current };
        for (const row of nextModelPolicies) {
          if (!next[row.key]) next[row.key] = String(row.limit);
        }
        return next;
      });
      setRequestMeta({
        filteredCount: Number(summaryPayload.filteredCount ?? 0) || 0,
        limit: Number(summaryPayload.limit ?? requestMeta.limit) || requestMeta.limit,
        offset: Number(summaryPayload.offset ?? 0) || 0,
      });
      setLlmDeadLetters(
        (Array.isArray(deadLettersPayload.deadLetters) ? deadLettersPayload.deadLetters : [])
          .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
          .map((row) => ({
            request_id: pickString(row, ['request_id', 'requestId']),
            status: pickString(row, ['status']) || undefined,
            model: pickString(row, ['model']) || undefined,
            provider: pickString(row, ['provider']) || undefined,
            error_message: pickString(row, ['error_message', 'errorMessage']) || undefined,
            dead_letter_reason: pickString(row, ['dead_letter_reason', 'deadLetterReason']) || undefined,
            ts: pickString(row, ['ts']) || undefined,
          })),
      );
      setDeadLetterMeta({
        filteredCount: Number(deadLettersPayload.filteredCount ?? 0) || 0,
        limit: Number(deadLettersPayload.limit ?? deadLetterMeta.limit) || deadLetterMeta.limit,
        offset: Number(deadLettersPayload.offset ?? 0) || 0,
      });
      setError('');
    } catch (loadError) {
      setLlmHealth(null);
      setLlmRequests([]);
      setLlmDeadLetters([]);
      setLlmFacets({ statuses: [], providers: [], models: [] });
      setLlmAudit(null);
      setProviderPolicies([]);
      setModelPolicies([]);
      setError(getErrorMessage(loadError, 'Failed to load LLM gateway state'));
    } finally {
      setLoadingGateway(false);
    }
  }, [
    connected,
    deadLetterMeta.limit,
    deadLetterPage,
    modelFilter,
    providerFilter,
    requestMeta.limit,
    requestPage,
    searchFilter,
    sortOrder,
    statusFilter,
  ]);

  const cancelLlmRequest = useCallback(async (requestId: string) => {
    if (!connected || !selectedApplicationId || !requestId) return;
    setLlmActionBusy(`cancel:${requestId}`);
    try {
      const payload = await gateway.cancelOntoSynthLlmGatewayRequest({
        applicationId: selectedApplicationId,
        requestId,
      });
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.llm_gateway.cancel failed'));
      }
      await loadGateway(selectedApplicationId);
    } catch (actionError) {
      setError(getErrorMessage(actionError, 'Failed to cancel LLM request'));
    } finally {
      setLlmActionBusy('');
    }
  }, [connected, loadGateway, selectedApplicationId]);

  const requeueDeadLetter = useCallback(async (requestId: string) => {
    if (!connected || !selectedApplicationId || !requestId) return;
    setLlmActionBusy(`requeue:${requestId}`);
    try {
      const payload = await gateway.requeueOntoSynthLlmGatewayDeadLetter({
        applicationId: selectedApplicationId,
        requestId,
      });
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.llm_gateway.requeue_dead_letter failed'));
      }
      await loadGateway(selectedApplicationId);
    } catch (actionError) {
      setError(getErrorMessage(actionError, 'Failed to requeue dead letter'));
    } finally {
      setLlmActionBusy('');
    }
  }, [connected, loadGateway, selectedApplicationId]);

  const setPolicyLimit = useCallback(async (scope: 'provider' | 'model', key: string, rawLimit: string) => {
    if (!connected || !selectedApplicationId || !key) return;
    const parsed = Number(rawLimit);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError('Policy limit must be an integer greater than or equal to 1');
      return;
    }
    setPolicyBusy(`${scope}:${key}`);
    try {
      const payload = await gateway.setOntoSynthLlmGatewayPolicy({
        applicationId: selectedApplicationId,
        scope,
        key,
        limit: Math.trunc(parsed),
        updatedBy: 'desktop-operator',
      });
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.llm_gateway.set_policy failed'));
      }
      await loadGateway(selectedApplicationId);
    } catch (actionError) {
      setError(getErrorMessage(actionError, 'Failed to update runtime policy'));
    } finally {
      setPolicyBusy('');
    }
  }, [connected, loadGateway, selectedApplicationId]);

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  useEffect(() => {
    if (!selectedApplicationId) return;
    void loadGateway(selectedApplicationId);
  }, [loadGateway, selectedApplicationId]);

  const selectedApp = useMemo(
    () => applications.find((item) => item.id === selectedApplicationId) || null,
    [applications, selectedApplicationId],
  );

  const providerOptions = useMemo(() => llmFacets.providers, [llmFacets.providers]);
  const modelOptions = useMemo(() => llmFacets.models, [llmFacets.models]);
  const requestStatusOptions = useMemo(() => llmFacets.statuses, [llmFacets.statuses]);
  const configuredProviderKeys = useMemo(() => new Set(providerPolicies.map((item) => item.key)), [providerPolicies]);
  const configuredModelKeys = useMemo(() => new Set(modelPolicies.map((item) => item.key)), [modelPolicies]);
  const providerSuggestions = useMemo(
    () => providerOptions.filter((item) => !configuredProviderKeys.has(item)),
    [configuredProviderKeys, providerOptions],
  );
  const modelSuggestions = useMemo(
    () => modelOptions.filter((item) => !configuredModelKeys.has(item)),
    [configuredModelKeys, modelOptions],
  );

  useEffect(() => {
    setRequestPage(0);
    setDeadLetterPage(0);
  }, [modelFilter, providerFilter, searchFilter, sortOrder, statusFilter]);

  const requestPageCount = useMemo(
    () => Math.max(1, Math.ceil((requestMeta.filteredCount || 0) / Math.max(1, requestMeta.limit))),
    [requestMeta.filteredCount, requestMeta.limit],
  );
  const deadLetterPageCount = useMemo(
    () => Math.max(1, Math.ceil((deadLetterMeta.filteredCount || 0) / Math.max(1, deadLetterMeta.limit))),
    [deadLetterMeta.filteredCount, deadLetterMeta.limit],
  );

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden p-6 gap-4 bg-aegis-bg">
      <section className="shrink-0 rounded-xl border border-aegis-border bg-aegis-card p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[18px] font-semibold text-aegis-text">LLM Gateway</h1>
            <p className="mt-1 text-[12px] text-aegis-text-dim">
              Operational queue view for OntoSynth model execution. Monitor inflight work, inspect dead letters, and control request lifecycle.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadApplications();
              if (selectedApplicationId) void loadGateway(selectedApplicationId);
            }}
            className="px-3 py-2 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] inline-flex items-center gap-1.5"
          >
            <RefreshCw size={12} className={clsx((loadingApplications || loadingGateway) && 'animate-spin')} />
            Refresh
          </button>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-[0.12em] text-aegis-text-dim">Application</label>
            <select
              value={selectedApplicationId}
              onChange={(event) => setSelectedApplicationId(event.target.value)}
              disabled={loadingApplications || applications.length === 0}
              className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text"
            >
              {applications.map((app) => (
                <option key={app.id} value={app.id}>{app.name}</option>
              ))}
              {applications.length === 0 && <option value="">No OntoSynth application found</option>}
            </select>
          </div>
          <div className="px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text">
            Tracked: <span className="font-semibold">{llmHealth?.requestsTracked ?? 0}</span>
          </div>
          <div className="px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text">
            Inflight: <span className="font-semibold">{llmHealth?.inflight ?? 0}</span>
          </div>
          <div className="px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text">
            Dead letters: <span className="font-semibold text-aegis-danger">{llmHealth?.deadLetters ?? 0}</span>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <div className="px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text">
            Audited apps: <span className="font-semibold">{llmAudit?.applicationsCount ?? 0}</span>
          </div>
          <div className="px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text">
            Queued apps: <span className="font-semibold text-emerald-300">{llmAudit?.queuedCount ?? 0}</span>
          </div>
          <div className="px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text">
            Mode drift: <span className="font-semibold text-aegis-danger">{llmAudit?.driftCount ?? 0}</span>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-[0.12em] text-aegis-text-dim">Status</label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text"
            >
              <option value="">All statuses</option>
              {requestStatusOptions.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-[0.12em] text-aegis-text-dim">Provider</label>
            <select
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text"
            >
              <option value="">All providers</option>
              {providerOptions.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-[0.12em] text-aegis-text-dim">Model</label>
            <select
              value={modelFilter}
              onChange={(event) => setModelFilter(event.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text"
            >
              <option value="">All models</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-[0.12em] text-aegis-text-dim">Search</label>
            <input
              value={searchFilter}
              onChange={(event) => setSearchFilter(event.target.value)}
              placeholder="request id, model, phase, error..."
              className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text placeholder:text-aegis-text-dim"
            />
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-[0.12em] text-aegis-text-dim">Sort</label>
            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value === 'asc' ? 'asc' : 'desc')}
              className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text"
            >
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </div>
        </div>

        {selectedApp && (
          <div className="space-y-2">
            <div className="text-[12px] text-aegis-text-dim">
            Selected app: <span className="text-aegis-text">{selectedApp.name}</span>
            {' '}· documents: <span className="text-aegis-text">{selectedApp.documents_count ?? 0}</span>
            {' '}· updated: <span className="text-aegis-text">{formatTimestamp(selectedApp.modified_at_epoch)}</span>
            {' '}· gateway updated: <span className="text-aegis-text">{llmHealth?.updatedAt || 'n/a'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-md border border-aegis-border bg-aegis-elevated px-2 py-1 text-aegis-text">
                Mode: <span className="font-semibold">{llmHealth?.llmMode || 'unknown'}</span>
              </span>
              <span className="rounded-md border border-aegis-border bg-aegis-elevated px-2 py-1 text-aegis-text">
                Deploy: <span className="font-semibold">{llmHealth?.deployStage || 'unknown'}</span>
              </span>
              <span className={clsx(
                'rounded-md border px-2 py-1',
                llmHealth?.gatewayEnabled
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-aegis-danger/40 bg-aegis-danger/10 text-aegis-danger',
              )}>
                {llmHealth?.gatewayEnabled ? 'Gateway active' : 'Gateway bypassed'}
              </span>
              <span className={clsx(
                'rounded-md border px-2 py-1',
                llmHealth?.directModeAllowed
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-aegis-border bg-aegis-elevated text-aegis-text-dim',
              )}>
                Direct allowed: <span className="font-semibold">{llmHealth?.directModeAllowed ? 'yes' : 'no'}</span>
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-aegis-danger/40 bg-aegis-danger/10 p-2 text-[12px] text-aegis-danger">
            {error}
          </div>
        )}
      </section>

      <section className="flex-1 min-h-0 grid gap-4 xl:grid-cols-[320px,minmax(0,1fr),minmax(0,1fr)]">
        <aside className="min-h-0 rounded-xl border border-aegis-border bg-aegis-card p-4 overflow-y-auto">
          <div className="space-y-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-aegis-text-dim">Status Counts</div>
            {llmHealth?.statusCounts && Object.keys(llmHealth.statusCounts).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(llmHealth.statusCounts).map(([key, value]) => (
                  <div key={key} className="rounded-lg border border-aegis-border bg-aegis-elevated p-3 text-[12px] flex items-center justify-between gap-3">
                    <span className="font-mono text-aegis-text-dim">{key}</span>
                    <span className="text-aegis-text font-semibold">{value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-aegis-border p-3 text-[12px] text-aegis-text-dim">
                No request statuses recorded yet.
              </div>
            )}

            <div className="pt-3 space-y-3 border-t border-aegis-border/60">
              <div className="text-[11px] uppercase tracking-[0.12em] text-aegis-text-dim">Runtime Policies</div>
              <div className="space-y-2">
                <div className="text-[11px] text-aegis-text-dim">Provider caps</div>
                <div className="rounded-lg border border-aegis-border bg-aegis-elevated p-3 space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-aegis-text-dim">Add provider cap</div>
                  <div className="flex items-center gap-2">
                    <input
                      value={newProviderKey}
                      onChange={(event) => setNewProviderKey(event.target.value)}
                      list="llm-provider-policy-suggestions"
                      placeholder="provider key (e.g. openrouter)"
                      className="min-w-0 flex-1 px-2 py-1 rounded-md border border-aegis-border bg-aegis-card text-[12px] text-aegis-text placeholder:text-aegis-text-dim"
                    />
                    <datalist id="llm-provider-policy-suggestions">
                      {providerSuggestions.map((provider) => (
                        <option key={provider} value={provider} />
                      ))}
                    </datalist>
                    <input
                      value={newProviderLimit}
                      onChange={(event) => setNewProviderLimit(event.target.value)}
                      placeholder="limit"
                      className="w-20 px-2 py-1 rounded-md border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void setPolicyLimit('provider', newProviderKey.trim().toLowerCase(), newProviderLimit).then(() => {
                          setNewProviderKey('');
                          setNewProviderLimit('');
                        });
                      }}
                      disabled={!newProviderKey || !newProviderLimit || policyBusy === 'provider:new'}
                      className="px-2 py-1 rounded-md border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
                    >
                      Add
                    </button>
                  </div>
                </div>
                {providerPolicies.length > 0 ? providerPolicies.map((item) => (
                  <div key={`provider-${item.key}`} className="rounded-lg border border-aegis-border bg-aegis-elevated p-3 space-y-2">
                    <div className="text-[12px] font-mono text-aegis-text break-all">{item.key}</div>
                    <div className="flex items-center gap-2">
                      <input
                        value={providerPolicyDrafts[item.key] ?? String(item.limit)}
                        onChange={(event) => setProviderPolicyDrafts((current) => ({ ...current, [item.key]: event.target.value }))}
                        className="w-20 px-2 py-1 rounded-md border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                      />
                      <button
                        type="button"
                        onClick={() => { void setPolicyLimit('provider', item.key, providerPolicyDrafts[item.key] ?? String(item.limit)); }}
                        disabled={policyBusy === `provider:${item.key}`}
                        className="px-2 py-1 rounded-md border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
                      >
                        {policyBusy === `provider:${item.key}` ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                    <div className="text-[11px] text-aegis-text-dim">
                      {item.updatedAt ? `Updated ${item.updatedAt}` : 'No update time'}{item.updatedBy ? ` · ${item.updatedBy}` : ''}
                    </div>
                  </div>
                )) : (
                  <div className="rounded-lg border border-dashed border-aegis-border p-3 text-[12px] text-aegis-text-dim">
                    No provider caps configured yet.
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="text-[11px] text-aegis-text-dim">Model caps</div>
                <div className="rounded-lg border border-aegis-border bg-aegis-elevated p-3 space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-aegis-text-dim">Add model cap</div>
                  <div className="flex items-center gap-2">
                    <input
                      value={newModelKey}
                      onChange={(event) => setNewModelKey(event.target.value)}
                      list="llm-model-policy-suggestions"
                      placeholder="model key (e.g. openai/gpt-4o)"
                      className="min-w-0 flex-1 px-2 py-1 rounded-md border border-aegis-border bg-aegis-card text-[12px] text-aegis-text placeholder:text-aegis-text-dim"
                    />
                    <datalist id="llm-model-policy-suggestions">
                      {modelSuggestions.map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                    <input
                      value={newModelLimit}
                      onChange={(event) => setNewModelLimit(event.target.value)}
                      placeholder="limit"
                      className="w-20 px-2 py-1 rounded-md border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void setPolicyLimit('model', newModelKey.trim().toLowerCase(), newModelLimit).then(() => {
                          setNewModelKey('');
                          setNewModelLimit('');
                        });
                      }}
                      disabled={!newModelKey || !newModelLimit || policyBusy === 'model:new'}
                      className="px-2 py-1 rounded-md border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
                    >
                      Add
                    </button>
                  </div>
                </div>
                {modelPolicies.length > 0 ? modelPolicies.map((item) => (
                  <div key={`model-${item.key}`} className="rounded-lg border border-aegis-border bg-aegis-elevated p-3 space-y-2">
                    <div className="text-[12px] font-mono text-aegis-text break-all">{item.key}</div>
                    <div className="flex items-center gap-2">
                      <input
                        value={modelPolicyDrafts[item.key] ?? String(item.limit)}
                        onChange={(event) => setModelPolicyDrafts((current) => ({ ...current, [item.key]: event.target.value }))}
                        className="w-20 px-2 py-1 rounded-md border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                      />
                      <button
                        type="button"
                        onClick={() => { void setPolicyLimit('model', item.key, modelPolicyDrafts[item.key] ?? String(item.limit)); }}
                        disabled={policyBusy === `model:${item.key}`}
                        className="px-2 py-1 rounded-md border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
                      >
                        {policyBusy === `model:${item.key}` ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                    <div className="text-[11px] text-aegis-text-dim">
                      {item.updatedAt ? `Updated ${item.updatedAt}` : 'No update time'}{item.updatedBy ? ` · ${item.updatedBy}` : ''}
                    </div>
                  </div>
                )) : (
                  <div className="rounded-lg border border-dashed border-aegis-border p-3 text-[12px] text-aegis-text-dim">
                    No model caps configured yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>

        <section className="min-h-0 rounded-xl border border-aegis-border bg-aegis-card p-4 flex flex-col overflow-hidden">
          <div className="shrink-0 flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-medium text-aegis-text">Recent Requests</h2>
            <div className="text-[11px] text-aegis-text-dim">
              {loadingGateway ? 'Loading…' : `${requestMeta.filteredCount} total · page ${requestPage + 1}/${requestPageCount}`}
            </div>
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
            {llmRequests.map((item) => (
              <div key={item.request_id} className="rounded-lg border border-aegis-border bg-aegis-elevated p-3 text-[12px]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-aegis-text break-all">{item.request_id}</div>
                    <div className="mt-1 text-aegis-text-dim break-all">{item.model || 'n/a'}</div>
                    <div className="mt-1 text-aegis-text-dim">{item.provider || 'unknown provider'} · {item.operation || 'unknown op'} · {item.phase || 'n/a'}</div>
                    {item.completed_at && <div className="mt-1 text-aegis-text-dim">Completed: {item.completed_at}</div>}
                    {item.error_message && <div className="mt-1 text-aegis-danger break-all">{item.error_message}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-aegis-text">{item.status || 'unknown'}</div>
                    {(item.status === 'queued' || item.status === 'running' || item.status === 'failed_retryable') && (
                      <button
                        type="button"
                        onClick={() => { void cancelLlmRequest(item.request_id); }}
                        disabled={llmActionBusy === `cancel:${item.request_id}`}
                        className="mt-2 px-2 py-1 rounded-md border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
                      >
                        {llmActionBusy === `cancel:${item.request_id}` ? 'Cancelling…' : 'Cancel'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!loadingGateway && llmRequests.length === 0 && (
              <div className="rounded-lg border border-dashed border-aegis-border p-3 text-[12px] text-aegis-text-dim">
                No requests match the current filter.
              </div>
            )}
          </div>
          <div className="mt-3 shrink-0 flex items-center justify-between gap-3 text-[12px]">
            <button
              type="button"
              onClick={() => setRequestPage((value) => Math.max(0, value - 1))}
              disabled={requestPage <= 0 || loadingGateway}
              className="px-3 py-2 rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
            >
              Previous
            </button>
            <div className="text-aegis-text-dim">Offset {requestMeta.offset}</div>
            <button
              type="button"
              onClick={() => setRequestPage((value) => Math.min(requestPageCount - 1, value + 1))}
              disabled={requestPage >= requestPageCount - 1 || loadingGateway}
              className="px-3 py-2 rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </section>

        <section className="min-h-0 rounded-xl border border-aegis-border bg-aegis-card p-4 flex flex-col overflow-hidden">
          <div className="shrink-0 flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-medium text-aegis-text">Dead Letters</h2>
            <div className="text-[11px] text-aegis-text-dim">
              {loadingGateway ? 'Loading…' : `${deadLetterMeta.filteredCount} total · page ${deadLetterPage + 1}/${deadLetterPageCount}`}
            </div>
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
            {llmDeadLetters.map((item) => (
              <div key={`${item.request_id}-${item.ts || ''}`} className="rounded-lg border border-aegis-danger/30 bg-aegis-danger/5 p-3 text-[12px]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-aegis-text break-all">{item.request_id}</div>
                    <div className="mt-1 text-aegis-text-dim break-all">{item.model || 'n/a'}</div>
                    <div className="mt-1 text-aegis-text-dim">{item.provider || 'unknown provider'} · {item.dead_letter_reason || 'unknown reason'}</div>
                    {item.ts && <div className="mt-1 text-aegis-text-dim">Recorded: {item.ts}</div>}
                    {item.error_message && <div className="mt-1 text-aegis-danger break-all">{item.error_message}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-aegis-danger">{item.status || 'dead'}</div>
                    <button
                      type="button"
                      onClick={() => { void requeueDeadLetter(item.request_id); }}
                      disabled={llmActionBusy === `requeue:${item.request_id}`}
                      className="mt-2 px-2 py-1 rounded-md border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
                    >
                      {llmActionBusy === `requeue:${item.request_id}` ? 'Requeueing…' : 'Requeue'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {!loadingGateway && llmDeadLetters.length === 0 && (
              <div className="rounded-lg border border-dashed border-aegis-border p-3 text-[12px] text-aegis-text-dim">
                No dead letters match the current filter.
              </div>
            )}
          </div>
          <div className="mt-3 shrink-0 flex items-center justify-between gap-3 text-[12px]">
            <button
              type="button"
              onClick={() => setDeadLetterPage((value) => Math.max(0, value - 1))}
              disabled={deadLetterPage <= 0 || loadingGateway}
              className="px-3 py-2 rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
            >
              Previous
            </button>
            <div className="text-aegis-text-dim">Offset {deadLetterMeta.offset}</div>
            <button
              type="button"
              onClick={() => setDeadLetterPage((value) => Math.min(deadLetterPageCount - 1, value + 1))}
              disabled={deadLetterPage >= deadLetterPageCount - 1 || loadingGateway}
              className="px-3 py-2 rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </section>
      </section>
    </div>
  );
}
