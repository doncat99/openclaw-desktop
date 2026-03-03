// ═══════════════════════════════════════════════════════════
// Config Manager — ProvidersTab
// Phase 2+: Unified provider management (auth + models + env)
// Design: aegis-* Tailwind classes only (no hardcoded colors)
// ═══════════════════════════════════════════════════════════

import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  ChevronRight,
  CheckCircle,
  Trash2,
  Search,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { OpenClawConfig, AuthProfile, ModelEntry, ModelProviderConfig } from './types';
import {
  PROVIDER_TEMPLATES,
  POPULAR_PROVIDER_IDS,
  getTemplateById,
  type ProviderTemplate,
} from './providerTemplates';
import { MaskedInput, ChipList, StatCard } from './components';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ProvidersTabProps {
  config: OpenClawConfig;
  onChange: (updater: (prev: OpenClawConfig) => OpenClawConfig) => void;
}


/** Unified representation of a provider from any of the 3 sources */
interface UnifiedProvider {
  key: string;           // profile key (e.g. "anthropic:my-clawdbot") or provider id
  provider: string;      // "anthropic", "nvidia", "google", etc.
  displayName: string;   // from template or provider id
  source: 'auth' | 'models-provider' | 'env-only';

  // Auth info (from auth.profiles)
  authProfile?: AuthProfile;
  profileKey?: string;

  // Models provider info (from models.providers)
  modelsProvider?: ModelProviderConfig;

  // Models in agents.defaults.models belonging to this provider
  models: Record<string, ModelEntry>;
  modelCount: number;

  // Template match
  template?: ProviderTemplate;

  // Env key detected
  envKeyFound?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getProviderFromModelId(modelId: string): string {
  // "anthropic/claude-opus-4-6" → "anthropic"
  // "nvidia/moonshotai/kimi-k2.5" → "nvidia"
  const parts = modelId.split('/');
  return parts[0] || modelId;
}

function getProviderFromProfileKey(profileKey: string): string {
  // "anthropic:my-clawdbot" → "anthropic"
  return profileKey.split(':')[0] || profileKey;
}

// Backward-compat alias
const providerFromProfileKey = getProviderFromProfileKey;

function getModelsForProvider(
  provider: string,
  models: Record<string, ModelEntry>
): Record<string, ModelEntry> {
  return Object.fromEntries(
    Object.entries(models).filter(([id]) => getProviderFromModelId(id) === provider)
  );
}

/** @deprecated use getModelsForProvider — kept for ProfileRow backward compat */
function modelsForProvider(
  profileKey: string,
  models: Record<string, ModelEntry> | undefined
): Record<string, ModelEntry> {
  if (!models) return {};
  const provider = providerFromProfileKey(profileKey);
  return Object.fromEntries(
    Object.entries(models).filter(([id]) => {
      const tmpl = getTemplateById(provider);
      if (!tmpl) return getProviderFromModelId(id) === provider;
      return (
        tmpl.popularModels.some((m) => m.id === id) ||
        id.startsWith(provider + '/') ||
        id.startsWith(provider + ':')
      );
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// buildUnifiedProviders — merge 3 sources
// ─────────────────────────────────────────────────────────────────────────────

function buildUnifiedProviders(config: OpenClawConfig): UnifiedProvider[] {
  const result: UnifiedProvider[] = [];
  const allModels = config.agents?.defaults?.models ?? {};

  // ── 1. auth.profiles ──────────────────────────────────────
  const profiles = config.auth?.profiles ?? {};
  for (const [profileKey, profile] of Object.entries(profiles)) {
    const provider = getProviderFromProfileKey(profileKey);
    const template = getTemplateById(provider);
    const models   = getModelsForProvider(provider, allModels);

    result.push({
      key:         profileKey,
      provider,
      displayName: template?.name ?? provider,
      source:      'auth',
      authProfile: profile,
      profileKey,
      models,
      modelCount:  Object.keys(models).length,
      template,
    });
  }

  // ── 2. models.providers ───────────────────────────────────
  const modelsProviders = config.models?.providers ?? {};
  for (const [providerId, modelsProvider] of Object.entries(modelsProviders)) {
    // Find auth profiles for this provider
    const existingAuthProfiles = result.filter(
      (p) => p.provider === providerId && p.source === 'auth'
    );

    if (existingAuthProfiles.length > 0) {
      // Merge modelsProvider info into all matching auth profiles
      for (const p of existingAuthProfiles) {
        p.modelsProvider = modelsProvider;
      }
    } else {
      // No auth profile → new entry
      const template = getTemplateById(providerId);
      const models   = getModelsForProvider(providerId, allModels);

      result.push({
        key:           providerId,
        provider:      providerId,
        displayName:   template?.name ?? providerId,
        source:        'models-provider',
        modelsProvider,
        models,
        modelCount:    Object.keys(models).length,
        template,
      });
    }
  }

  // ── 3. env.vars ───────────────────────────────────────────
  const envVars = config.env?.vars ?? {};
  for (const template of PROVIDER_TEMPLATES) {
    if (!template.envKey && !template.envKeyAlt?.length) continue;

    const envKeyFound =
      (!!template.envKey && template.envKey in envVars) ||
      (template.envKeyAlt?.some((k) => k in envVars) ?? false);

    if (!envKeyFound) continue;

    // Find any existing entry for this provider
    const existingIndex = result.findIndex((p) => p.provider === template.id);

    if (existingIndex !== -1) {
      result[existingIndex].envKeyFound = true;
    } else {
      const models = getModelsForProvider(template.id, allModels);

      result.push({
        key:         `env:${template.id}`,
        provider:    template.id,
        displayName: template.name,
        source:      'env-only',
        models,
        modelCount:  Object.keys(models).length,
        template,
        envKeyFound: true,
      });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Icon
// ─────────────────────────────────────────────────────────────────────────────

function ProviderIcon({ providerId, size = 'md' }: { providerId: string; size?: 'sm' | 'md' }) {
  const tmpl = getTemplateById(providerId);
  const sizeClass = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-9 h-9 text-sm';
  return (
    <div
      className={clsx(
        'flex items-center justify-center rounded-lg font-black text-aegis-btn-primary-text flex-shrink-0',
        `bg-gradient-to-br ${tmpl?.colorClass ?? 'from-slate-500 to-gray-600'}`,
        sizeClass
      )}
    >
      {tmpl?.icon ?? providerId[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Row (auth source, expandable)
// ─────────────────────────────────────────────────────────────────────────────

interface ProfileRowProps {
  profileKey: string;
  profile: AuthProfile;
  allModels: Record<string, ModelEntry> | undefined;
  primaryModel: string | undefined;
  onChange: (updater: (prev: OpenClawConfig) => OpenClawConfig) => void;
}

function ProfileRow({ profileKey, profile, allModels, primaryModel, onChange }: ProfileRowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const providerId    = providerFromProfileKey(profileKey);
  const tmpl          = getTemplateById(providerId);
  const providerModels = modelsForProvider(profileKey, allModels);
  const modelCount    = Object.keys(providerModels).length;

  // ── Inline edit state ──
  const [localProfile, setLocalProfile] = useState<string>(profile.profileName ?? profileKey);
  const [localMode, setLocalMode]       = useState<string>(profile.mode ?? tmpl?.defaultAuthMode ?? 'api_key');
  const [localKey, setLocalKey]         = useState<string>(profile.token ?? profile.apiKey ?? '');

  const updateProfile = (patch: Partial<AuthProfile>) => {
    onChange((prev) => ({
      ...prev,
      auth: {
        ...prev.auth,
        profiles: {
          ...prev.auth?.profiles,
          [profileKey]: { ...profile, ...patch },
        },
      },
    }));
  };

  const removeProfile = () => {
    onChange((prev) => {
      const profiles = { ...prev.auth?.profiles };
      delete profiles[profileKey];
      return { ...prev, auth: { ...prev.auth, profiles } };
    });
  };

  const setModelPrimary = (modelId: string) => {
    onChange((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        defaults: {
          ...prev.agents?.defaults,
          model: { ...prev.agents?.defaults?.model, primary: modelId },
        },
      },
    }));
  };

  const removeModel = (modelId: string) => {
    onChange((prev) => {
      const models = { ...prev.agents?.defaults?.models };
      delete models[modelId];
      return {
        ...prev,
        agents: { ...prev.agents, defaults: { ...prev.agents?.defaults, models } },
      };
    });
  };

  return (
    <div className="mb-2">
      {/* ── Row header ── */}
      <div
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex items-center justify-between px-3.5 py-3',
          'bg-aegis-elevated border border-aegis-border rounded-xl',
          'cursor-pointer transition-all duration-200',
          'hover:border-aegis-border-hover hover:bg-white/[0.02]',
          open && 'rounded-b-none border-aegis-primary/20'
        )}
      >
        {/* left */}
        <div className="flex items-center gap-3 min-w-0">
          <ProviderIcon providerId={providerId} />
          <div className="min-w-0">
            <div className="font-semibold text-sm text-aegis-text truncate">
              {tmpl?.name ?? providerId}
            </div>
            <div className="text-[11px] text-aegis-text-muted font-mono truncate">{profileKey}</div>
          </div>
        </div>

        {/* right */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <span className="text-[11px] text-aegis-text-muted bg-aegis-surface border border-aegis-border rounded-full px-2.5 py-0.5">
            {modelCount} {modelCount === 1 ? 'model' : 'models'}
          </span>
          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgb(var(--aegis-success)/0.5)]" />
          <ChevronRight
            size={14}
            className={clsx(
              'text-aegis-text-muted transition-transform duration-200',
              open && 'rotate-90'
            )}
          />
        </div>
      </div>

      {/* ── Expanded detail ── */}
      {open && (
        <div
          className={clsx(
            'border border-aegis-primary/20 border-t-0',
            'rounded-b-xl bg-white/[0.01] p-4 space-y-4'
          )}
        >
          {/* Profile name + Auth mode */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
                {t('config.profileName')}
              </label>
              <input
                value={localProfile}
                onChange={(e) => setLocalProfile(e.target.value)}
                onBlur={() => updateProfile({ profileName: localProfile })}
                className={clsx(
                  'bg-aegis-surface border border-aegis-border rounded-lg px-3 py-2',
                  'text-aegis-text text-sm outline-none focus:border-aegis-primary',
                  'transition-colors duration-200'
                )}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
                {t('config.authMode')}
              </label>
              <select
                value={localMode}
                onChange={(e) => {
                  setLocalMode(e.target.value);
                  updateProfile({ mode: e.target.value });
                }}
                className={clsx(
                  'bg-aegis-menu-bg border border-aegis-menu-border rounded-lg px-3 py-2',
                  'text-aegis-text text-sm outline-none focus:border-aegis-primary',
                  'transition-colors duration-200 cursor-pointer'
                )}
              >
                {(tmpl?.authModes ?? ['api_key']).map((m) => (
                  <option key={m} value={m}>
                    {m === 'api_key' ? 'API Key' : m === 'oauth' ? 'OAuth' : 'Token'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* API Key */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
              {t('config.apiKey')}
            </label>
            <MaskedInput
              value={localKey}
              onChange={(v) => {
                setLocalKey(v);
                updateProfile(localMode === 'token' ? { token: v } : { apiKey: v });
              }}
              placeholder={tmpl?.envKey ? `sk-... or set ${tmpl.envKey}` : 'Enter API key...'}
            />
            {tmpl?.envKey && (
              <p className="text-[10px] text-aegis-text-muted mt-0.5">
                {t('config.envKeyHint', { envKey: tmpl.envKey })}
              </p>
            )}
          </div>

          {/* Models */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
              {t('config.modelsAndAliases')}
            </label>
            <ChipList
              models={allModels ?? {}}
              primaryModel={primaryModel}
              onSetPrimary={setModelPrimary}
              onRemove={removeModel}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={removeProfile}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold',
                'border border-red-500/20 text-red-400 bg-red-400/5',
                'hover:bg-red-400/10 hover:border-red-500/40',
                'transition-all duration-200'
              )}
            >
              <Trash2 size={12} />{t('config.remove')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Models Provider Row (models-provider source, expandable)
// ─────────────────────────────────────────────────────────────────────────────

interface ModelsProviderRowProps {
  unifiedProvider: UnifiedProvider;
  onChange: (updater: (prev: OpenClawConfig) => OpenClawConfig) => void;
}

function ModelsProviderRow({ unifiedProvider, onChange }: ModelsProviderRowProps) {
  const [open, setOpen] = useState(false);
  const { provider, modelsProvider, modelCount, template, envKeyFound } = unifiedProvider;

  const [localBaseUrl, setLocalBaseUrl] = useState(modelsProvider?.baseUrl ?? '');

  const updateModelsProvider = (patch: Partial<ModelProviderConfig>) => {
    onChange((prev) => ({
      ...prev,
      models: {
        ...prev.models,
        providers: {
          ...prev.models?.providers,
          [provider]: {
            ...prev.models?.providers?.[provider],
            ...patch,
          },
        },
      },
    }));
  };

  const removeModelsProvider = () => {
    onChange((prev) => {
      const providers = { ...prev.models?.providers };
      delete providers[provider];
      return { ...prev, models: { ...prev.models, providers } };
    });
  };

  const envKeyName = template?.envKey;

  return (
    <div className="mb-2">
      {/* ── Row header ── */}
      <div
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex items-center justify-between px-3.5 py-3',
          'bg-aegis-elevated border border-aegis-border rounded-xl',
          'cursor-pointer transition-all duration-200',
          'hover:border-aegis-border-hover hover:bg-white/[0.02]',
          open && 'rounded-b-none border-blue-500/20'
        )}
      >
        {/* left */}
        <div className="flex items-center gap-3 min-w-0">
          <ProviderIcon providerId={provider} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-aegis-text">
                {template?.name ?? provider}
              </span>
              <span
                className={clsx(
                  'text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0',
                  'bg-blue-500/15 text-blue-400 border border-blue-500/25'
                )}
              >
                ⚡ Custom Provider
              </span>
            </div>
            <div className="text-[11px] text-aegis-text-muted font-mono truncate">
              {modelsProvider?.baseUrl ?? provider}
            </div>
          </div>
        </div>

        {/* right */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <span className="text-[11px] text-aegis-text-muted bg-aegis-surface border border-aegis-border rounded-full px-2.5 py-0.5">
            {modelCount} {modelCount === 1 ? 'model' : 'models'}
          </span>
          <ChevronRight
            size={14}
            className={clsx(
              'text-aegis-text-muted transition-transform duration-200',
              open && 'rotate-90'
            )}
          />
        </div>
      </div>

      {/* ── Expanded detail ── */}
      {open && (
        <div
          className={clsx(
            'border border-blue-500/20 border-t-0',
            'rounded-b-xl bg-white/[0.01] p-4 space-y-4'
          )}
        >
          {/* Base URL */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
              Base URL
            </label>
            <input
              value={localBaseUrl}
              onChange={(e) => setLocalBaseUrl(e.target.value)}
              onBlur={() => updateModelsProvider({ baseUrl: localBaseUrl })}
              className={clsx(
                'bg-aegis-surface border border-aegis-border rounded-lg px-3 py-2',
                'text-aegis-text text-sm font-mono outline-none focus:border-aegis-primary',
                'transition-colors duration-200'
              )}
            />
          </div>

          {/* API Type */}
          {modelsProvider?.api && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
                API
              </label>
              <div
                className={clsx(
                  'text-sm text-aegis-text-secondary font-mono',
                  'bg-aegis-surface border border-aegis-border rounded-lg px-3 py-2'
                )}
              >
                {modelsProvider.api}
              </div>
            </div>
          )}

          {/* Models list */}
          {modelsProvider?.models && modelsProvider.models.length > 0 && (
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
                Models
              </label>
              <div className="flex flex-wrap gap-2">
                {modelsProvider.models.map((m) => (
                  <span
                    key={m.id}
                    className={clsx(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium',
                      'border border-aegis-border bg-aegis-elevated text-aegis-text-secondary'
                    )}
                  >
                    {m.name ?? m.id}
                    {m.name && m.name !== m.id && (
                      <span className="text-[9px] opacity-50 font-mono">{m.id}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Env Key status */}
          {envKeyName && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
                Env Key
              </label>
              <div
                className={clsx(
                  'flex items-center gap-2 text-sm font-mono px-3 py-2 rounded-lg border',
                  envKeyFound
                    ? 'bg-aegis-success/8 border-aegis-success/20 text-aegis-success'
                    : 'bg-aegis-surface border-aegis-border text-aegis-text-muted'
                )}
              >
                <span>{envKeyFound ? '✓' : '○'}</span>
                <span>{envKeyName}</span>
                {!envKeyFound && (
                  <span className="text-[10px] opacity-60 ml-1">not set in env.vars</span>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={removeModelsProvider}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold',
                'border border-red-500/20 text-red-400 bg-red-400/5',
                'hover:bg-red-400/10 hover:border-red-500/40',
                'transition-all duration-200'
              )}
            >
              <Trash2 size={12} /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Env-Only Row (env-only source, non-expandable)
// ─────────────────────────────────────────────────────────────────────────────

interface EnvOnlyRowProps {
  unifiedProvider: UnifiedProvider;
  onConfigure: (template: ProviderTemplate) => void;
}

function EnvOnlyRow({ unifiedProvider, onConfigure }: EnvOnlyRowProps) {
  const { provider, template, modelCount } = unifiedProvider;
  const envKeyName = template?.envKey;

  return (
    <div className="mb-2">
      <div
        className={clsx(
          'flex items-center justify-between px-3.5 py-3',
          'bg-aegis-elevated border border-amber-500/20 rounded-xl',
          'transition-all duration-200'
        )}
      >
        {/* left */}
        <div className="flex items-center gap-3 min-w-0">
          <ProviderIcon providerId={provider} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-aegis-text">
                {template?.name ?? provider}
              </span>
              <span
                className={clsx(
                  'text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0',
                  'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                )}
              >
                🔑 ENV Key Only
              </span>
            </div>
            <div className="text-[11px] text-aegis-text-muted truncate">
              {envKeyName && <span className="font-mono">{envKeyName}</span>}
              {envKeyName && ' · '}
              <span>Add an auth profile for full configuration</span>
            </div>
          </div>
        </div>

        {/* right */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          {modelCount > 0 && (
            <span className="text-[11px] text-aegis-text-muted bg-aegis-surface border border-aegis-border rounded-full px-2.5 py-0.5">
              {modelCount} {modelCount === 1 ? 'model' : 'models'}
            </span>
          )}
          {template && (
            <button
              onClick={() => onConfigure(template)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold',
                'border border-aegis-primary/30 text-aegis-primary bg-aegis-primary/5',
                'hover:bg-aegis-primary/10 hover:border-aegis-primary/50',
                'transition-all duration-200'
              )}
            >
              <Plus size={11} /> Configure
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Provider Modal — Step 1: Pick template
// ─────────────────────────────────────────────────────────────────────────────

interface PickStepProps {
  onPick: (tmpl: ProviderTemplate) => void;
  onClose: () => void;
}

function PickStep({ onPick, onClose: _onClose }: PickStepProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return PROVIDER_TEMPLATES;
    const q = search.toLowerCase();
    return PROVIDER_TEMPLATES.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.includes(q)
    );
  }, [search]);

  const popular     = PROVIDER_TEMPLATES.filter((p) => POPULAR_PROVIDER_IDS.includes(p.id));
  const showPopular = !search.trim();

  return (
    <div className="flex flex-col gap-4">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-aegis-text-muted" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('config.searchProviders')}
          className={clsx(
            'w-full bg-aegis-surface border border-aegis-border rounded-lg pl-9 pr-3 py-2',
            'text-aegis-text text-sm placeholder:text-aegis-text-muted',
            'outline-none focus:border-aegis-primary transition-colors duration-200'
          )}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-aegis-text-muted hover:text-aegis-text"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Popular */}
      {showPopular && (
        <div>
          <p className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider mb-2">
            {t('config.popular')}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {popular.map((tmpl) => (
              <ProviderCard key={tmpl.id} tmpl={tmpl} onPick={onPick} compact />
            ))}
          </div>
        </div>
      )}

      {/* All providers */}
      <div>
        {showPopular && (
          <p className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider mb-2">
            {t('config.allProviders')}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
          {filtered.map((tmpl) => (
            <ProviderCard key={tmpl.id} tmpl={tmpl} onPick={onPick} />
          ))}
          {filtered.length === 0 && (
            <p className="col-span-2 text-center text-xs text-aegis-text-muted py-4">
              No providers found
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ProviderCard({
  tmpl,
  onPick,
  compact,
}: {
  tmpl: ProviderTemplate;
  onPick: (t: ProviderTemplate) => void;
  compact?: boolean;
}) {
  return (
    <button
      onClick={() => onPick(tmpl)}
      className={clsx(
        'flex items-center gap-2.5 p-2.5 rounded-xl',
        'border border-aegis-border bg-aegis-elevated text-left',
        'hover:border-aegis-border-hover hover:bg-white/[0.03]',
        'transition-all duration-200 group',
        compact && 'flex-col items-center text-center gap-1.5'
      )}
    >
      <div
        className={clsx(
          'flex items-center justify-center rounded-lg font-black text-aegis-btn-primary-text flex-shrink-0',
          `bg-gradient-to-br ${tmpl.colorClass}`,
          compact ? 'w-8 h-8 text-sm' : 'w-7 h-7 text-xs'
        )}
      >
        {tmpl.icon}
      </div>
      <div className="min-w-0">
        <div className="font-semibold text-xs text-aegis-text group-hover:text-aegis-primary transition-colors truncate">
          {tmpl.name}
        </div>
        {!compact && tmpl.envKey && (
          <div className="text-[9px] text-aegis-text-muted font-mono truncate">{tmpl.envKey}</div>
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Provider Modal — Step 2: Configure
// ─────────────────────────────────────────────────────────────────────────────

interface ConfigureStepProps {
  tmpl: ProviderTemplate;
  onBack: () => void;
  onAdd: (profileKey: string, profile: AuthProfile, selectedModels: string[]) => void;
}

function ConfigureStep({ tmpl, onBack, onAdd }: ConfigureStepProps) {
  const { t } = useTranslation();
  const [profileName, setProfileName] = useState(`${tmpl.id}:main`);
  const [apiKey, setApiKey]           = useState('');
  const [authMode, setAuthMode]       = useState(tmpl.defaultAuthMode);
  const [selectedModels, setSelectedModels] = useState<string[]>(
    tmpl.popularModels.slice(0, 2).map((m) => m.id)
  );
  const toggleModel = (id: string) => {
    setSelectedModels((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const handleAdd = () => {
    if (!profileName) return;
    const profile: AuthProfile = {
      provider: tmpl.id,
      mode: authMode,
      ...(authMode === 'token' ? { token: apiKey } : { apiKey }),
    };
    onAdd(profileName, profile, selectedModels);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Provider header */}
      <div className="flex items-center gap-3 p-3 bg-aegis-elevated border border-aegis-border rounded-xl">
        <div
          className={clsx(
            'flex items-center justify-center w-10 h-10 rounded-xl font-black text-aegis-btn-primary-text text-base flex-shrink-0',
            `bg-gradient-to-br ${tmpl.colorClass}`
          )}
        >
          {tmpl.icon}
        </div>
        <div>
          <div className="font-bold text-sm text-aegis-text">{tmpl.name}</div>
          {tmpl.docsUrl && (
            <a
              href={tmpl.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-aegis-primary hover:underline"
            >
              Docs ↗
            </a>
          )}
        </div>
      </div>

      {/* Profile name */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
          {t('config.profileName')}
        </label>
        <input
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
          className={clsx(
            'bg-aegis-surface border border-aegis-border rounded-lg px-3 py-2',
            'text-aegis-text text-sm font-mono outline-none focus:border-aegis-primary',
            'transition-colors duration-200'
          )}
        />
      </div>

      {/* Auth mode + API Key */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
            {t('config.authMode')}
          </label>
          <select
            value={authMode}
            onChange={(e) => setAuthMode(e.target.value)}
            className={clsx(
              'bg-aegis-menu-bg border border-aegis-menu-border rounded-lg px-3 py-2',
              'text-aegis-text text-sm outline-none focus:border-aegis-primary',
              'transition-colors duration-200 cursor-pointer'
            )}
          >
            {tmpl.authModes.map((m) => (
              <option key={m} value={m}>
                {m === 'api_key' ? 'API Key' : m === 'oauth' ? 'OAuth' : 'Token'}
              </option>
            ))}
          </select>
        </div>
        {authMode !== 'oauth' && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
              {t('config.apiKey')}
            </label>
            <MaskedInput
              value={apiKey}
              onChange={setApiKey}
              placeholder={tmpl.envKey || 'Enter API key...'}
            />
          </div>
        )}
      </div>

      {tmpl.envKey && (
        <p className="text-[10px] text-aegis-text-muted -mt-2">
          {t('config.envKeyHint', { envKey: tmpl.envKey })}
        </p>
      )}

      {/* Suggested models */}
      {tmpl.popularModels.length > 0 && (
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-bold text-aegis-text-muted uppercase tracking-wider">
            {t('config.suggestedModels')}
          </label>
          <div className="flex flex-wrap gap-2">
            {tmpl.popularModels.map((m) => {
              const selected = selectedModels.includes(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => toggleModel(m.id)}
                  className={clsx(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium',
                    'border transition-all duration-200',
                    selected
                      ? 'border-aegis-primary/40 bg-aegis-primary/10 text-aegis-primary'
                      : 'border-aegis-border bg-aegis-elevated text-aegis-text-secondary hover:border-aegis-border-hover'
                  )}
                >
                  {selected && <CheckCircle size={10} />}
                  <span>{m.id}</span>
                  {m.suggestedAlias && (
                    <span className="text-[9px] opacity-60">({m.suggestedAlias})</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex gap-2 pt-1 border-t border-aegis-border">
        <button
          onClick={onBack}
          className={clsx(
            'px-4 py-2 rounded-lg text-sm font-medium',
            'border border-aegis-border text-aegis-text-secondary',
            'hover:bg-white/[0.03] hover:border-aegis-border-hover',
            'transition-all duration-200'
          )}
        >
          ← Back
        </button>
        <button
          onClick={handleAdd}
          disabled={!profileName || selectedModels.length === 0}
          className={clsx(
            'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg',
            'text-sm font-bold bg-aegis-primary text-aegis-btn-primary-text',
            'hover:brightness-110 transition-all duration-200',
            'disabled:opacity-40 disabled:cursor-not-allowed'
          )}
        >
          <Plus size={14} /> Add Provider
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Provider Modal — Shell
// ─────────────────────────────────────────────────────────────────────────────

interface AddProviderModalProps {
  onClose: () => void;
  onAdd: (profileKey: string, profile: AuthProfile, models: string[]) => void;
  /** Pre-select a template and skip to the configure step */
  initialTemplate?: ProviderTemplate;
}

function AddProviderModal({ onClose, onAdd, initialTemplate }: AddProviderModalProps) {
  const { t } = useTranslation();
  const [step, setStep]               = useState<'pick' | 'configure'>(
    initialTemplate ? 'configure' : 'pick'
  );
  const [selectedTmpl, setSelectedTmpl] = useState<ProviderTemplate | null>(
    initialTemplate ?? null
  );

  const handlePick = (tmpl: ProviderTemplate) => {
    setSelectedTmpl(tmpl);
    setStep('configure');
  };

  return (
    /* backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      {/* modal */}
      <div
        className={clsx(
          'bg-aegis-card border border-aegis-border rounded-2xl w-full max-w-lg',
          'max-h-[85vh] overflow-hidden flex flex-col',
          'shadow-[0_8px_30px_rgba(0,0,0,0.5)]',
          'animate-[pop-in_0.15s_ease-out]'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-aegis-border">
          <h3 className="text-sm font-bold text-aegis-text">
            {step === 'pick'
              ? t('config.addProvider')
              : `Configure ${selectedTmpl?.name ?? 'Provider'}`}
          </h3>
          <button
            onClick={onClose}
            className="text-aegis-text-muted hover:text-aegis-text transition-colors p-1"
          >
            <X size={16} />
          </button>
        </div>

        {/* body */}
        <div className="p-5 overflow-y-auto flex-1">
          {step === 'pick' ? (
            <PickStep onPick={handlePick} onClose={onClose} />
          ) : selectedTmpl ? (
            <ConfigureStep
              tmpl={selectedTmpl}
              onBack={() => {
                // If we started from an initialTemplate, closing back goes to pick anyway
                setStep('pick');
                setSelectedTmpl(null);
              }}
              onAdd={(key, profile, models) => {
                onAdd(key, profile, models);
                onClose();
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ProvidersTab — Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function ProvidersTab({ config, onChange }: ProvidersTabProps) {
  const { t } = useTranslation();
  const [showModal, setShowModal]                   = useState(false);
  const [modalInitialTemplate, setModalInitialTemplate] = useState<ProviderTemplate | undefined>();

  const allModels    = config.agents?.defaults?.models ?? {};
  const primaryModel = config.agents?.defaults?.model?.primary;

  // ── Build unified provider list ──
  const unifiedProviders = useMemo(() => buildUnifiedProviders(config), [config]);

  // ── Stats ──
  const uniqueProviderCount = useMemo(
    () => new Set(unifiedProviders.map((p) => p.provider)).size,
    [unifiedProviders]
  );
  const modelCount = Object.keys(allModels).length;
  const aliasCount = Object.values(allModels).filter((m) => m.alias).length;

  // ── Open modal (optionally with a pre-selected template) ──
  const openModal = useCallback((template?: ProviderTemplate) => {
    setModalInitialTemplate(template);
    setShowModal(true);
  }, []);

  // ── Add provider (auth profile + models) ──
  const handleAdd = (profileKey: string, profile: AuthProfile, models: string[]) => {
    onChange((prev) => {
      const profiles = { ...prev.auth?.profiles, [profileKey]: profile };

      const providerId = getProviderFromProfileKey(profileKey);
      const tmpl       = getTemplateById(providerId);
      const existingModels = { ...prev.agents?.defaults?.models };
      for (const modelId of models) {
        const tmplModel = tmpl?.popularModels.find((m) => m.id === modelId);
        existingModels[modelId] = { alias: tmplModel?.suggestedAlias, params: {} };
      }

      return {
        ...prev,
        auth: { ...prev.auth, profiles },
        agents: {
          ...prev.agents,
          defaults: { ...prev.agents?.defaults, models: existingModels },
        },
      };
    });
  };

  return (
    <div className="flex flex-col gap-5">

      {/* ── A) Overview Hero Card ── */}
      <div
        className={clsx(
          'rounded-xl border border-aegis-border p-5',
          'bg-white/[0.02] backdrop-blur-sm'
        )}
      >
        {/* top */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-aegis-text">🤖 {t('config.providers')}</h2>
            <p className="text-xs text-aegis-text-muted mt-0.5">
              Manage providers, models, and API keys
            </p>
          </div>
          <button
            onClick={() => openModal()}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold',
              'bg-aegis-primary text-aegis-btn-primary-text',
              'hover:brightness-110 transition-all duration-200'
            )}
          >
            <Plus size={12} /> {t('config.addProvider')}
          </button>
        </div>

        {/* stats row */}
        <div className="flex gap-5 p-3.5 bg-aegis-surface border border-aegis-border rounded-xl">
          <StatCard value={uniqueProviderCount} label={t('config.providers')} colorClass="text-aegis-primary" />
          <div className="w-px bg-aegis-border" />
          <StatCard value={modelCount} label="Models"  colorClass="text-blue-400" />
          <div className="w-px bg-aegis-border" />
          <StatCard value={aliasCount} label="Aliases" colorClass="text-purple-400" />
        </div>

        {/* Primary model banner */}
        <div className="flex items-center gap-3 mt-3 p-3.5 bg-aegis-surface border border-aegis-primary/20 rounded-xl">
          <div
            className={clsx(
              'w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0',
              'bg-aegis-primary/10 border border-aegis-primary/20'
            )}
          >
            ⭐
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-aegis-text-muted uppercase tracking-wider font-bold">
              {t('config.primaryModel')}
            </div>
            <div className="text-sm font-bold text-aegis-primary truncate mt-0.5">
              {primaryModel ?? (
                <span className="text-aegis-text-muted font-normal italic">Not set</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── B) Unified Providers List ── */}
      <div className="rounded-xl border border-aegis-border bg-aegis-elevated overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-aegis-border">
          <h3 className="text-xs font-bold uppercase tracking-widest text-aegis-text-secondary">
            🔌 Providers
          </h3>
        </div>
        <div className="p-4">
          {unifiedProviders.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="text-4xl opacity-40">🤖</div>
              <p className="text-sm font-medium text-aegis-text-secondary">
                {t('config.noProviders')}
              </p>
              <p className="text-xs text-aegis-text-muted">{t('config.addFirstProvider')}</p>
              <button
                onClick={() => openModal()}
                className={clsx(
                  'mt-2 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold',
                  'bg-aegis-primary text-aegis-btn-primary-text hover:brightness-110',
                  'transition-all duration-200'
                )}
              >
                <Plus size={14} /> {t('config.addProvider')}
              </button>
            </div>
          ) : (
            <>
              {unifiedProviders.map((up) => {
                if (up.source === 'auth') {
                  return (
                    <ProfileRow
                      key={up.key}
                      profileKey={up.profileKey!}
                      profile={up.authProfile!}
                      allModels={allModels}
                      primaryModel={primaryModel}
                      onChange={onChange}
                    />
                  );
                }
                if (up.source === 'models-provider') {
                  return (
                    <ModelsProviderRow
                      key={up.key}
                      unifiedProvider={up}
                      onChange={onChange}
                    />
                  );
                }
                // env-only
                return (
                  <EnvOnlyRow
                    key={up.key}
                    unifiedProvider={up}
                    onConfigure={(tmpl) => openModal(tmpl)}
                  />
                );
              })}

              {/* Add row */}
              <button
                onClick={() => openModal()}
                className={clsx(
                  'w-full flex items-center justify-center gap-2 p-4 mt-1',
                  'border-2 border-dashed border-aegis-border rounded-xl',
                  'text-xs font-semibold text-aegis-text-muted',
                  'hover:border-aegis-primary hover:text-aegis-primary hover:bg-aegis-primary/5',
                  'transition-all duration-200 cursor-pointer'
                )}
              >
                <Plus size={13} /> {t('config.addProvider')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── C) Models & Aliases ── */}
      {modelCount > 0 && (
        <div className="rounded-xl border border-aegis-border bg-aegis-elevated overflow-hidden">
          <div className="px-5 py-3.5 border-b border-aegis-border">
            <h3 className="text-xs font-bold uppercase tracking-widest text-aegis-text-secondary">
              📝 {t('config.modelsAndAliases')}
            </h3>
          </div>
          <div className="p-4">
            <ChipList
              models={allModels}
              primaryModel={primaryModel}
              onSetPrimary={(id) => {
                onChange((prev) => ({
                  ...prev,
                  agents: {
                    ...prev.agents,
                    defaults: {
                      ...prev.agents?.defaults,
                      model: { ...prev.agents?.defaults?.model, primary: id },
                    },
                  },
                }));
              }}
              onRemove={(id) => {
                onChange((prev) => {
                  const models = { ...prev.agents?.defaults?.models };
                  delete models[id];
                  return {
                    ...prev,
                    agents: {
                      ...prev.agents,
                      defaults: { ...prev.agents?.defaults, models },
                    },
                  };
                });
              }}
            />
          </div>
        </div>
      )}

      {/* ── Add Provider Modal ── */}
      {showModal && (
        <AddProviderModal
          onClose={() => {
            setShowModal(false);
            setModalInitialTemplate(undefined);
          }}
          onAdd={handleAdd}
          initialTemplate={modalInitialTemplate}
        />
      )}
    </div>
  );
}

export default ProvidersTab;
