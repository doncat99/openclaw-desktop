import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Copy,
  Circle,
  Coins,
  Flame,
  Gift,
  Loader2,
  MailCheck,
  Plus,
  RefreshCw,
  Repeat2,
  SquareCheck,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import { PageTransition } from '@/components/shared/PageTransition';
import { MessageChannel, MessageTask, useTaskRpgStore } from '@/stores/taskRpgStore';
import { useChatStore } from '@/stores/chatStore';
import { gateway } from '@/services/gateway';
import { themeAlpha, themeHex } from '@/utils/theme-colors';
import { getStorageItem, setStorageItem, storageKey } from '@/utils/storage';

type Tone = 'accent' | 'warning' | 'primary' | 'success';
type ProviderKind = MessageChannel;
type EmailIngestionMode = 'gateway-push' | 'local-poll';

interface ProviderCard {
  id: string;
  kind: ProviderKind;
  tone: Tone;
  emoji: string;
  title: string;
  description: string;
  custom?: boolean;
  account?: string;
  pushEndpoint?: string;
  ingestionMode?: EmailIngestionMode;
}

interface CustomProviderProfile {
  id: string;
  kind: ProviderKind;
  name: string;
  account?: string;
  gcpProjectId?: string;
  pushEndpoint?: string;
  ingestionMode?: EmailIngestionMode;
  hookToken?: string;
  hookPath?: string;
  createdAt: string;
}

interface ProviderSetupState {
  phase: 'running' | 'ready' | 'error';
  message: string;
  output?: string;
}

interface OntoSynthApplication {
  id: string;
  name: string;
  relativePath?: string;
  pipeline?: OntoSynthPipelineProfile;
}

interface OntoSynthPipelineRecommendation {
  mode: 'single' | 'split';
  reason: string;
  suggestedSkills: string[];
}

interface OntoSynthPipelineProfile {
  status: 'ok' | 'missing' | 'error';
  orchestratorPath?: string;
  declaredPhases: number[];
  activePhases: number[];
  declaredPhaseLabels: string[];
  activePhaseLabels: string[];
  activePhaseCount: number;
  declaredPhaseCount: number;
  hasLearningPhase: boolean;
  hasVideoPhase: boolean;
  recommendation: OntoSynthPipelineRecommendation;
}

interface OntoSynthSkillEntry {
  slug: string;
  name: string;
  description: string;
  generated: boolean;
  generatedKind?: string;
  source: string;
  capabilityId?: string;
  capabilityTitle?: string;
  applicationId?: string;
  applicationName?: string;
  methods: string[];
  updatedAtEpoch?: number;
}

interface OntoSynthSkillsSnapshot {
  skills: OntoSynthSkillEntry[];
  totalCount: number;
  generatedCount: number;
  bundledCount: number;
  capabilityGeneratedCount: number;
  legacyGeneratedCount: number;
  knownCapabilityIds: string[];
}

interface OntoSynthHealthState {
  root: string;
  pythonVersion: string;
  duckdbAvailable: boolean;
  applicationsCount: number;
}

const providerChannelMap: Record<ProviderKind, MessageChannel> = {
  email: 'email',
  slack: 'slack',
  sms: 'sms',
  other: 'other',
};

const CUSTOM_PROVIDER_STORAGE_KEY = storageKey('assignment-message-providers');
const DEFAULT_HOOK_TOKEN = 'OPENCLAW_HOOK_TOKEN';
const GATEWAY_HOOK_BASE = 'http://127.0.0.1:18789/hooks';
const MAX_SETUP_LOG_CHARS = 120000;

function getGatewayHttpBase(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:18789';
  const stored = (getStorageItem(storageKey('gateway-http')) || '').trim();
  const raw = stored || 'http://127.0.0.1:18789';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'http://127.0.0.1:18789';
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'http://127.0.0.1:18789';
  }
}

function normalizeHookPath(pathValue?: string, fallback = 'provider'): string {
  const raw = (pathValue || fallback || 'provider').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  return raw || 'provider';
}

function buildProviderHookUrl(profile: Pick<CustomProviderProfile, 'hookPath' | 'hookToken' | 'name' | 'kind'>): string {
  const hookPath = normalizeHookPath(profile.hookPath, slugify(profile.name || profile.kind || 'provider'));
  const hookToken = (profile.hookToken || DEFAULT_HOOK_TOKEN).trim() || DEFAULT_HOOK_TOKEN;
  const base = getGatewayHttpBase();
  return `${base}/hooks/${hookPath}?token=${encodeURIComponent(hookToken)}`;
}

function resolveProviderPushEndpoint(profile: Pick<CustomProviderProfile, 'pushEndpoint' | 'hookPath' | 'hookToken' | 'name' | 'kind'>): string {
  return profile.pushEndpoint?.trim() || '';
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
  if (host.endsWith('.local')) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function isPublicHttpsPushEndpoint(value?: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (isPrivateOrLocalHost(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function resolveEmailIngestionMode(
  profile: Pick<CustomProviderProfile, 'kind' | 'ingestionMode' | 'pushEndpoint'>,
): EmailIngestionMode {
  if (profile.kind !== 'email') return 'gateway-push';
  if (profile.ingestionMode === 'local-poll' || profile.ingestionMode === 'gateway-push') {
    return profile.ingestionMode;
  }
  return isPublicHttpsPushEndpoint(profile.pushEndpoint) ? 'gateway-push' : 'local-poll';
}

function providerTone(kind: ProviderKind): Tone {
  if (kind === 'email') return 'accent';
  if (kind === 'slack') return 'success';
  if (kind === 'sms') return 'warning';
  return 'primary';
}

function providerEmoji(kind: ProviderKind): string {
  if (kind === 'email') return '📧';
  if (kind === 'slack') return '💬';
  if (kind === 'sms') return '📱';
  return '🧩';
}

function makeProviderId(): string {
  return `provider-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function slugify(input: string): string {
  const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'provider';
}

function isProviderKind(value: unknown): value is ProviderKind {
  return value === 'email'
    || value === 'slack'
    || value === 'sms'
    || value === 'other';
}

function loadCustomProviders(): CustomProviderProfile[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = getStorageItem(CUSTOM_PROVIDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CustomProviderProfile => (
      item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      isProviderKind((item as { kind?: unknown }).kind) &&
      typeof item.name === 'string'
    ));
  } catch {
    return [];
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function withProviderSetupEnv(command: string): string {
  const isWindows = /\bWindows\b/i.test(window.navigator.userAgent);
  if (isWindows) return command;
  const exports = [
    'export PATH="$HOME/Library/pnpm:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"',
    'export HOMEBREW_NO_AUTO_UPDATE=1',
    'for p in /opt/homebrew/opt/python@3.12/bin/python3.12 /opt/homebrew/opt/python@3.11/bin/python3.11 /usr/local/opt/python@3.12/bin/python3.12 /usr/local/opt/python@3.11/bin/python3.11 /opt/homebrew/bin/python3 /usr/local/bin/python3 "$(command -v python3 2>/dev/null)" /usr/bin/python3; do if [ -n "$p" ] && [ -x "$p" ] && "$p" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >/dev/null 2>&1; then export CLOUDSDK_PYTHON="$p"; break; fi; done',
  ];
  return `${exports.join(' && ')} && ${command}`;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

function sanitizeSetupChunk(chunk: string): string {
  if (!chunk) return '';
  return stripAnsi(chunk)
    .replace(/\r/g, '')
    .replace(/(?:^|\n)sh-[\w.\-]+\$ ?/g, '\n')
    .replace(/(?:^|\n)bash-[\w.\-]+[$#] ?/g, '\n')
    .replace(/sh:\sno job control in this shell\s*\n?/gi, '')
    .replace(/__ONTOSYNTH_CMD_DONE__:\d+\s*/g, '');
}

function parseGoogleProjectId(raw: string): string {
  const lines = sanitizeSetupChunk(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => line !== '(unset)' && /^[a-z][a-z0-9-]{2,}$/i.test(line)) || '';
}

function parseGoogleProjectIds(raw: string): string[] {
  const seen = new Set<string>();
  const lines = sanitizeSetupChunk(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[a-z][a-z0-9-]{2,}$/i.test(line));
  for (const line of lines) seen.add(line);
  return [...seen];
}

function parseJsonFromCommandOutput(raw: string): unknown {
  const text = sanitizeSetupChunk(raw).trim();
  if (!text) return null;

  const candidates = [text];
  const objStart = text.indexOf('{');
  const objEnd = text.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    candidates.push(text.slice(objStart, objEnd + 1));
  }
  const arrStart = text.indexOf('[');
  const arrEnd = text.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    candidates.push(text.slice(arrStart, arrEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try next candidate
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return '';
}

function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        const ms = parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
      }
    }
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

function extractHeaderValue(value: Record<string, unknown>, headerName: string): string {
  const headerKey = headerName.toLowerCase();
  const candidates: unknown[] = [];

  candidates.push(value.headers);
  const payload = asRecord(value.payload);
  if (payload) candidates.push(payload.headers);
  const metadata = asRecord(value.metadata);
  if (metadata) candidates.push(metadata.headers);

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const entry of candidate) {
      const record = asRecord(entry);
      if (!record) continue;
      const name = String(record.name || '').toLowerCase();
      const field = String(record.key || '').toLowerCase();
      if (name === headerKey || field === headerKey) {
        const raw = record.value;
        if (typeof raw === 'string' && raw.trim()) return raw.trim();
      }
    }
  }
  return '';
}

function collectMessageItems(payload: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 5 || payload == null) return [];
  if (Array.isArray(payload)) {
    return payload.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => !!item);
  }

  const record = asRecord(payload);
  if (!record) return [];

  for (const key of ['messages', 'items', 'results', 'threads', 'data']) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => !!item);
    }
  }

  for (const key of ['result', 'response', 'payload']) {
    const nested = collectMessageItems(record[key], depth + 1);
    if (nested.length > 0) return nested;
  }

  const id = pickString(record, ['id', 'messageId', 'msgId', 'threadId']);
  if (id) return [record];
  return [];
}

interface LocalGmailMessage {
  id: string;
  subject: string;
  snippet: string;
  from: string;
  receivedAt?: string;
  unread: boolean;
}

function parseGmailExternalKey(value?: string): { account: string; messageId: string } | null {
  if (!value) return null;
  const match = value.match(/^gmail:([^:]+):(.+)$/i);
  if (!match) return null;
  const account = match[1]?.trim();
  const messageId = match[2]?.trim();
  if (!account || !messageId) return null;
  return { account, messageId };
}

function pickThreadIdFromMessagePayload(payload: unknown): string {
  const record = asRecord(payload);
  if (!record) return '';

  const topLevel = pickString(record, ['threadId', 'message.threadId']);
  if (topLevel) return topLevel;

  const nestedMessage = asRecord(record.message);
  if (nestedMessage) {
    const nested = pickString(nestedMessage, ['threadId']);
    if (nested) return nested;
  }
  return '';
}

function normalizeGmailMessages(payload: unknown): LocalGmailMessage[] {
  const items = collectMessageItems(payload);
  const unique = new Set<string>();
  const output: LocalGmailMessage[] = [];

  for (const item of items) {
    const id = pickString(item, ['id', 'messageId', 'msgId', 'threadId']);
    if (!id || unique.has(id)) continue;

    const subject = pickString(item, ['subject', 'title']) || extractHeaderValue(item, 'subject');
    const snippet = pickString(item, ['snippet', 'bodyPreview', 'preview', 'summary']);
    const from = pickString(item, ['from', 'sender', 'author']) || extractHeaderValue(item, 'from');
    const receivedAt = toIsoTimestamp(item.internalDate ?? item.receivedAt ?? item.timestamp ?? item.date);
    const labelsRaw = item.labelIds ?? item.labels;
    const labelList = Array.isArray(labelsRaw) ? labelsRaw.map((v) => String(v).toUpperCase()) : [];
    const unread = typeof item.unread === 'boolean' ? item.unread : labelList.includes('UNREAD');

    unique.add(id);
    output.push({
      id,
      subject,
      snippet,
      from,
      receivedAt,
      unread,
    });
  }

  return output;
}

function pickNumber(value: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function pickStringArray(value: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const raw = value[key];
    if (!Array.isArray(raw)) continue;
    const items = raw
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
    if (items.length > 0) return items;
  }
  return [];
}

function normalizeCapabilityId(capabilityId: string): string {
  return capabilityId
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toCapabilitySkillSlug(capabilityId: string): string {
  const normalized = normalizeCapabilityId(capabilityId);
  return `ontosynth-capability-${normalized}`;
}

function formatCapabilityLabel(capabilityId: string): string {
  return capabilityId
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parsePipelineRecommendation(payload: unknown): OntoSynthPipelineRecommendation {
  const record = asRecord(payload) || {};
  const modeRaw = pickString(record, ['mode']);
  const mode: OntoSynthPipelineRecommendation['mode'] = modeRaw === 'split' ? 'split' : 'single';
  const reason = pickString(record, ['reason']);
  const suggestedSkills = pickStringArray(record, ['suggested_skills', 'suggestedSkills']);
  return { mode, reason, suggestedSkills };
}

function parseOntoSynthPipelineProfile(payload: unknown): OntoSynthPipelineProfile | undefined {
  const record = asRecord(payload);
  if (!record) return undefined;
  const statusRaw = pickString(record, ['status']);
  const status: OntoSynthPipelineProfile['status'] =
    statusRaw === 'ok' || statusRaw === 'missing' || statusRaw === 'error'
      ? statusRaw
      : 'missing';
  const declaredPhases = (Array.isArray(record.declared_phases) ? record.declared_phases : [])
    .map((entry) => (typeof entry === 'number' ? entry : Number(entry)))
    .filter((entry) => Number.isFinite(entry))
    .map((entry) => Number(entry));
  const activePhases = (Array.isArray(record.active_phases) ? record.active_phases : [])
    .map((entry) => (typeof entry === 'number' ? entry : Number(entry)))
    .filter((entry) => Number.isFinite(entry))
    .map((entry) => Number(entry));
  const declaredPhaseLabels = pickStringArray(record, ['declared_phase_labels', 'declaredPhaseLabels']);
  const activePhaseLabels = pickStringArray(record, ['active_phase_labels', 'activePhaseLabels']);
  const activePhaseCount = pickNumber(record, ['active_phase_count', 'activePhaseCount']) ?? activePhases.length;
  const declaredPhaseCount = pickNumber(record, ['declared_phase_count', 'declaredPhaseCount']) ?? declaredPhases.length;
  return {
    status,
    orchestratorPath: pickString(record, ['orchestrator_path', 'orchestratorPath']) || undefined,
    declaredPhases,
    activePhases,
    declaredPhaseLabels,
    activePhaseLabels,
    activePhaseCount,
    declaredPhaseCount,
    hasLearningPhase: !!record.has_learning_phase || !!record.hasLearningPhase,
    hasVideoPhase: !!record.has_video_phase || !!record.hasVideoPhase,
    recommendation: parsePipelineRecommendation(record.skill_recommendation ?? record.skillRecommendation),
  };
}

function parseOntoSynthApplications(payload: unknown): OntoSynthApplication[] {
  const record = asRecord(payload);
  if (!record) return [];
  const rawApplications = Array.isArray(record.applications) ? record.applications : [];

  return rawApplications.map((item) => {
    const app = asRecord(item);
    if (!app) return null;
    const id = pickString(app, ['id']);
    const name = pickString(app, ['name']) || id;
    if (!id) return null;
    return {
      id,
      name,
      relativePath: pickString(app, ['relative_path']) || undefined,
      pipeline: parseOntoSynthPipelineProfile(app.pipeline),
    } satisfies OntoSynthApplication;
  }).filter((item): item is OntoSynthApplication => !!item);
}

function parseOntoSynthSkills(payload: unknown): OntoSynthSkillsSnapshot {
  const record = asRecord(payload);
  if (!record) {
    return {
      skills: [],
      totalCount: 0,
      generatedCount: 0,
      bundledCount: 0,
      capabilityGeneratedCount: 0,
      legacyGeneratedCount: 0,
      knownCapabilityIds: [],
    };
  }

  const rawSkills = Array.isArray(record.skills) ? record.skills : [];
  const skills = rawSkills.map((item) => {
    const skill = asRecord(item);
    if (!skill) return null;
    const slug = pickString(skill, ['slug', 'id']);
    if (!slug) return null;
    return {
      slug,
      name: pickString(skill, ['name']) || slug,
      description: pickString(skill, ['description']),
      generated: !!skill.generated,
      generatedKind: pickString(skill, ['generated_kind', 'generatedKind']) || undefined,
      source: pickString(skill, ['source']) || 'unknown',
      capabilityId: pickString(skill, ['capability_id', 'capabilityId']) || undefined,
      capabilityTitle: pickString(skill, ['capability_title', 'capabilityTitle']) || undefined,
      applicationId: pickString(skill, ['application_id', 'applicationId']) || undefined,
      applicationName: pickString(skill, ['application_name', 'applicationName']) || undefined,
      methods: pickStringArray(skill, ['methods']),
      updatedAtEpoch: pickNumber(skill, ['updated_at_epoch', 'updatedAtEpoch']),
    } satisfies OntoSynthSkillEntry;
  }).filter((item): item is OntoSynthSkillEntry => !!item);

  const knownCapabilityIds = pickStringArray(record, ['known_capability_ids', 'knownCapabilityIds'])
    .map((capabilityId) => normalizeCapabilityId(capabilityId));

  return {
    skills,
    totalCount: pickNumber(record, ['skills_count', 'skillsCount']) ?? skills.length,
    generatedCount: pickNumber(record, ['generated_count', 'generatedCount']) ?? skills.filter((item) => item.generated).length,
    bundledCount: pickNumber(record, ['bundled_count', 'bundledCount']) ?? skills.filter((item) => !item.generated).length,
    capabilityGeneratedCount: pickNumber(record, ['capability_generated_count', 'capabilityGeneratedCount'])
      ?? skills.filter((item) => item.generatedKind === 'capability').length,
    legacyGeneratedCount: pickNumber(record, ['legacy_generated_count', 'legacyGeneratedCount'])
      ?? skills.filter((item) => item.generatedKind === 'legacy_application').length,
    knownCapabilityIds,
  };
}

function formatTimestamp(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function extractGatewayErrorMessage(error: unknown): string {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error.trim() || 'unknown error';
  if (error instanceof Error) return error.message || 'unknown error';
  return String(error);
}

function classifySetupError(raw: string, timedOut: boolean, t: (key: string) => string): string {
  const text = raw.toLowerCase();
  if (timedOut) return t('taskRpg.providerSetupErrorInteractive');
  if (
    text.includes('oauth client credentials missing')
    || text.includes('missing oauth client credentials')
    || text.includes('gog auth credentials')
    || text.includes('invalid credentials.json')
    || text.includes('expected installed/web client_id and client_secret')
  ) {
    return t('taskRpg.providerSetupNeedsGogCredentials');
  }
  if (text.includes('run: gog auth add') || text.includes('authorize and store a refresh token')) {
    return t('taskRpg.providerSetupNeedsGogAuth');
  }
  if (
    text.includes('error 403: access_denied')
    || text.includes('has not completed the google verification process')
    || text.includes('can only be accessed by developer-approved testers')
  ) {
    return t('taskRpg.providerSetupNeedsGogTestUser');
  }
  if (text.includes('tailscale status --json failed') || text.includes('failed to connect to local tailscale service')) {
    return t('taskRpg.providerSetupNeedsTailscaleRunning');
  }
  if (text.includes('project id required') || text.includes('use --project')) {
    return t('taskRpg.providerSetupNeedsProject');
  }
  if (text.includes('invalid push endpoint') || text.includes('push endpoint required')) {
    return t('taskRpg.providerSetupNeedsPushEndpoint');
  }
  if (
    text.includes('brew install failed')
    || text.includes('operation not permitted')
    || text.includes('not found')
    || text.includes('posix_spawnp failed')
    || text.includes('unable to create pty')
  ) {
    return t('taskRpg.providerSetupErrorDeps');
  }
  if (text.includes('gcloud auth') || text.includes('login') || text.includes('oauth')) {
    return t('taskRpg.providerSetupErrorAuth');
  }
  return t('taskRpg.providerSetupError');
}

function brewInstallWithLockRetry(command: string): string {
  return `attempt=1; max=8; while [ $attempt -le $max ]; do out="$(${command} 2>&1)" && { echo "$out"; exit 0; }; code=$?; echo "$out"; if echo "$out" | grep -Eqi "already locked|Please wait for it to finish|another operation is already in progress"; then echo "[brew-lock] waiting 10s before retry ($attempt/$max)"; sleep 10; attempt=$((attempt+1)); continue; fi; exit $code; done; echo "[brew-lock] retries exhausted"; exit 1`;
}

function appendLogTail(existing: string | undefined, chunk: string): string {
  const cleaned = sanitizeSetupChunk(chunk);
  const merged = `${existing || ''}${cleaned}`;
  if (merged.length <= MAX_SETUP_LOG_CHARS) return merged;
  return merged.slice(-MAX_SETUP_LOG_CHARS);
}

async function runCommandViaPty(command: string, timeoutMs = 180000): Promise<{ ok: boolean; output: string; exitCode: number }> {
  const runFallback = async (): Promise<{ ok: boolean; output: string; exitCode: number }> => {
    const runner = window.aegis?.system?.run;
    if (!runner) return { ok: false, output: 'Command runner unavailable', exitCode: 1 };
    const res = await runner(command, timeoutMs);
    const output = `${res.output || ''}${res.error ? `\n${res.error}` : ''}`.trim();
    return {
      ok: !!res.ok,
      output,
      exitCode: Number.isFinite(res.exitCode) ? Number(res.exitCode) : (res.ok ? 0 : 1),
    };
  };

  const terminal = window.aegis?.terminal;
  if (!terminal) return await runFallback();

  const created = await terminal.create({ cols: 80, rows: 24 });
  if (!created?.id) {
    const fallback = await runFallback();
    if (fallback.ok || /posix_spawnp failed|pty create failed/i.test(String(created?.error || ''))) {
      return fallback;
    }
    return { ok: false, output: created?.error || fallback.output || 'PTY create failed', exitCode: 1 };
  }

  const id = created.id;
  const isWindows = /\bWindows\b/i.test(window.navigator.userAgent);
  const marker = '__ONTOSYNTH_CMD_DONE__';
  let output = '';
  let markerExit: number | null = null;
  let finished = false;

  return new Promise((resolve) => {
    let timeout: number | undefined;

    const cleanupData = terminal.onData((pid: string, data: string) => {
      if (pid !== id) return;
      output += data;
      const match = output.match(new RegExp(`${marker}:(\\d+)`));
      if (match) markerExit = Number(match[1]);
    });

    const settle = async (exitCode: number, forcedOutput?: string) => {
      if (finished) return;
      finished = true;
      if (timeout) window.clearTimeout(timeout);
      cleanupData();
      cleanupExit();
      await terminal.kill(id).catch(() => {});
      const finalCode = Number.isFinite(markerExit) ? Number(markerExit) : exitCode;
      resolve({
        ok: finalCode === 0,
        output: forcedOutput ?? output,
        exitCode: finalCode,
      });
    };

    const cleanupExit = terminal.onExit((pid: string, exitCode: number) => {
      if (pid !== id) return;
      void settle(exitCode);
    });

    timeout = window.setTimeout(() => {
      void settle(124, `${output}\n[timeout] command exceeded ${Math.round(timeoutMs / 1000)}s`);
    }, timeoutMs);

    const finalize = isWindows
      ? `Write-Output "${marker}:$LASTEXITCODE"; exit $LASTEXITCODE\n`
      : `echo ${marker}:$?\nexit\n`;
    terminal.write(id, `${command}\n${finalize}`).catch(async (err: any) => {
      await terminal.kill(id).catch(() => {});
      const fallback = await runFallback();
      const mergedOutput = `${output}\n${String(err?.message || err)}\n${fallback.output}`.trim();
      void settle(fallback.exitCode, mergedOutput);
    });
  });
}

async function runCommandViaSystem(command: string, timeoutMs = 180000): Promise<{ ok: boolean; output: string; exitCode: number }> {
  const runner = window.aegis?.system?.run;
  if (!runner) return runCommandViaPty(command, timeoutMs);
  const result = await runner(command, timeoutMs);
  const output = `${result.output || ''}${result.error ? `\n${result.error}` : ''}`.trim();
  return {
    ok: !!result.ok,
    output,
    exitCode: Number.isFinite(result.exitCode) ? Number(result.exitCode) : (result.ok ? 0 : 1),
  };
}

async function runCommandViaShellStream(
  command: string,
  timeoutMs = 180000,
  onData?: (chunk: string) => void,
): Promise<{ ok: boolean; output: string; exitCode: number }> {
  const shell = window.aegis?.shell;
  const runFallback = async (): Promise<{ ok: boolean; output: string; exitCode: number }> => {
    const result = await runCommandViaSystem(command, timeoutMs);
    if (onData && result.output) onData(`${result.output}\n`);
    return result;
  };

  if (!shell) return runFallback();

  const created = await shell.create({ interactive: false });
  if (!created?.id) return runFallback();

  const id = created.id;
  const marker = '__ONTOSYNTH_CMD_DONE__';
  let output = '';
  let markerExit: number | null = null;
  let finished = false;

  return new Promise((resolve) => {
    let timeout: number | undefined;

    const cleanupData = shell.onData((sessionId: string, data: string) => {
      if (sessionId !== id) return;
      output += data;
      onData?.(data);
      const match = output.match(new RegExp(`${marker}:(\\d+)`));
      if (match) markerExit = Number(match[1]);
    });

    const settle = async (exitCode: number, forcedOutput?: string) => {
      if (finished) return;
      finished = true;
      if (timeout) window.clearTimeout(timeout);
      cleanupData();
      cleanupExit();
      await shell.kill(id).catch(() => {});
      const finalCode = Number.isFinite(markerExit) ? Number(markerExit) : exitCode;
      resolve({
        ok: finalCode === 0,
        output: forcedOutput ?? output,
        exitCode: finalCode,
      });
    };

    const cleanupExit = shell.onExit((sessionId: string, exitCode: number) => {
      if (sessionId !== id) return;
      void settle(exitCode);
    });

    timeout = window.setTimeout(() => {
      void settle(124, `${output}\n[timeout] command exceeded ${Math.round(timeoutMs / 1000)}s`);
    }, timeoutMs);

    const finalize = `__aegis_exit=$?\necho ${marker}:$__aegis_exit\nexit $__aegis_exit\n`;
    shell.write(id, `${command}\n${finalize}`).catch(async (err: any) => {
      await shell.kill(id).catch(() => {});
      const fallback = await runFallback();
      const mergedOutput = `${output}\n${String(err?.message || err)}\n${fallback.output}`.trim();
      void settle(fallback.exitCode, mergedOutput);
    });
  });
}

function formatDueDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts = content
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const text = (entry as { text?: string }).text;
      return typeof text === 'string' ? text : '';
    })
    .filter(Boolean);
  return parts.join(' ').trim();
}

function mapSessionToChannel(text: string): MessageChannel {
  const raw = text.toLowerCase();
  if (raw.includes('slack')) return 'slack';
  if (raw.includes('sms') || raw.includes('signal') || raw.includes('whatsapp') || raw.includes('imessage')) return 'sms';
  if (raw.includes('email')) return 'email';
  return 'other';
}

function buildTaskTitle(label: string, body: string): string {
  const clean = body.replace(/\s+/g, ' ').trim();
  const snippet = clean.length > 96 ? `${clean.slice(0, 93)}...` : clean;
  return `[${label}] ${snippet || 'New message'}`;
}

function inferProviderFromMessage(item: MessageTask): ProviderKind {
  if (item.channel === 'slack') return 'slack';
  if (item.channel === 'sms') return 'sms';
  if (item.channel === 'other') return 'other';
  return 'email';
}

function SectionShell({
  title,
  tone,
  icon,
  count,
  children,
}: {
  title: string;
  tone: Tone;
  icon: ReactNode;
  count: number;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-[14px] border overflow-hidden min-h-[360px] flex flex-col"
      style={{
        background: 'rgb(var(--aegis-overlay) / 0.025)',
        borderColor: 'rgb(var(--aegis-overlay) / 0.07)',
      }}
    >
      <header className="p-3.5 flex items-center justify-between border-b border-[rgb(var(--aegis-overlay)/0.06)]">
        <h2 className="text-[13px] font-semibold text-aegis-text flex items-center gap-2">
          {icon}
          {title}
        </h2>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-md tabular-nums"
          style={{
            color: themeHex(tone),
            background: themeAlpha(tone, 0.12),
            border: `1px solid ${themeAlpha(tone, 0.2)}`,
          }}
        >
          {count}
        </span>
      </header>
      {children}
    </section>
  );
}

export function TaskRpgPage() {
  const { t } = useTranslation();
  const {
    points,
    messages,
    dailies,
    todos,
    rewards,
    addMessage,
    addDaily,
    addTodo,
    addReward,
    deleteMessage,
    deleteDaily,
    deleteTodo,
    deleteReward,
    scoreMessage,
    importExternalMessages,
    toggleDaily,
    toggleTodo,
    redeemReward,
    runDailyResetIfNeeded,
  } = useTaskRpgStore();
  const { connected } = useChatStore();

  const [messageTitle, setMessageTitle] = useState('');
  const [customProviders, setCustomProviders] = useState<CustomProviderProfile[]>(loadCustomProviders);
  const [activeProviderId, setActiveProviderId] = useState('');
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [providerKindDraft, setProviderKindDraft] = useState<ProviderKind>('email');
  const [providerNameDraft, setProviderNameDraft] = useState('');
  const [providerAccountDraft, setProviderAccountDraft] = useState('');
  const [providerProjectIdDraft, setProviderProjectIdDraft] = useState('');
  const [providerPushEndpointDraft, setProviderPushEndpointDraft] = useState('');
  const [providerHookTokenDraft, setProviderHookTokenDraft] = useState(DEFAULT_HOOK_TOKEN);
  const [providerHookPathDraft, setProviderHookPathDraft] = useState('');
  const [copiedItem, setCopiedItem] = useState('');
  const [providerSetupState, setProviderSetupState] = useState<Record<string, ProviderSetupState>>({});
  const [providerPushEndpointInputs, setProviderPushEndpointInputs] = useState<Record<string, string>>({});
  const [setupConsoleOpen, setSetupConsoleOpen] = useState(false);
  const [setupConsoleTitle, setSetupConsoleTitle] = useState('');
  const [setupConsoleSessionId, setSetupConsoleSessionId] = useState('');
  const [setupConsoleTransport, setSetupConsoleTransport] = useState<'pty' | 'shell' | ''>('');
  const [setupConsoleOutput, setSetupConsoleOutput] = useState('');
  const [setupConsoleInput, setSetupConsoleInput] = useState('');
  const [setupConsoleRunning, setSetupConsoleRunning] = useState(false);
  const [setupConsoleBooting, setSetupConsoleBooting] = useState(false);
  const [setupLogModalProviderId, setSetupLogModalProviderId] = useState('');
  const setupConsoleUnsubDataRef = useRef<(() => void) | null>(null);
  const setupConsoleUnsubExitRef = useRef<(() => void) | null>(null);
  const [dailyTitle, setDailyTitle] = useState('');
  const [todoTitle, setTodoTitle] = useState('');
  const [todoDueDate, setTodoDueDate] = useState('');
  const [rewardTitle, setRewardTitle] = useState('');
  const [rewardCost, setRewardCost] = useState('10');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState('');
  const [deletingMessageId, setDeletingMessageId] = useState('');
  const [ontoSynthLoading, setOntoSynthLoading] = useState(false);
  const [ontoSynthHealth, setOntoSynthHealth] = useState<OntoSynthHealthState | null>(null);
  const [ontoSynthApplications, setOntoSynthApplications] = useState<OntoSynthApplication[]>([]);
  const [ontoSynthSelectedApplication, setOntoSynthSelectedApplication] = useState('');
  const [ontoSynthError, setOntoSynthError] = useState('');
  const [ontoSynthSkills, setOntoSynthSkills] = useState<OntoSynthSkillEntry[]>([]);
  const [ontoSynthSkillsTotalCount, setOntoSynthSkillsTotalCount] = useState(0);
  const [ontoSynthSkillsGeneratedCount, setOntoSynthSkillsGeneratedCount] = useState(0);
  const [ontoSynthSkillsBundledCount, setOntoSynthSkillsBundledCount] = useState(0);
  const [ontoSynthKnownCapabilityIds, setOntoSynthKnownCapabilityIds] = useState<string[]>([]);
  const [ontoSynthSkillsLoading, setOntoSynthSkillsLoading] = useState(false);
  const [ontoSynthSkillsBusyAction, setOntoSynthSkillsBusyAction] = useState<'refresh' | 'sync' | 'install' | 'remove' | ''>('');
  const [ontoSynthSkillsError, setOntoSynthSkillsError] = useState('');
  const [ontoSynthSkillsStatus, setOntoSynthSkillsStatus] = useState('');
  const [ontoSynthLastUpdated, setOntoSynthLastUpdated] = useState('');
  const ontoSynthBootstrappedRef = useRef(false);

  useEffect(() => {
    runDailyResetIfNeeded();
  }, [runDailyResetIfNeeded]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setStorageItem(CUSTOM_PROVIDER_STORAGE_KEY, JSON.stringify(customProviders));
  }, [customProviders]);

  useEffect(() => {
    setProviderPushEndpointInputs((prev) => {
      const next: Record<string, string> = {};
      for (const item of customProviders) {
        next[item.id] = prev[item.id] ?? item.pushEndpoint ?? '';
      }
      return next;
    });
  }, [customProviders]);

  useEffect(() => () => {
    setupConsoleUnsubDataRef.current?.();
    setupConsoleUnsubExitRef.current?.();
    if (setupConsoleSessionId) {
      window.aegis?.terminal?.kill(setupConsoleSessionId).catch(() => {});
      window.aegis?.shell?.kill(setupConsoleSessionId).catch(() => {});
    }
  }, [setupConsoleSessionId]);

  useEffect(() => {
    if (!ontoSynthSkillsStatus) return;
    const timer = window.setTimeout(() => setOntoSynthSkillsStatus(''), 5000);
    return () => window.clearTimeout(timer);
  }, [ontoSynthSkillsStatus]);

  const channelLabels: Record<MessageChannel, string> = {
    email: t('taskRpg.channels.email'),
    sms: t('taskRpg.channels.sms'),
    slack: t('taskRpg.channels.slack'),
    other: t('taskRpg.channels.other'),
  };

  const defaultProviderName = (kind: ProviderKind): string => channelLabels[kind];

  const defaultProviderDescription = (kind: ProviderKind): string => {
    if (kind === 'email') return t('taskRpg.providers.email.description');
    if (kind === 'slack') return t('taskRpg.providers.slack.description');
    if (kind === 'sms') return t('taskRpg.providers.sms.description');
    return t('taskRpg.providers.other.description');
  };

  const providerCards = useMemo<ProviderCard[]>(() => (
    customProviders.map((provider) => ({
      id: provider.id,
      kind: provider.kind,
      emoji: providerEmoji(provider.kind),
      tone: providerTone(provider.kind),
      title: provider.name,
      description: provider.account
        ? `${defaultProviderDescription(provider.kind)} · ${provider.account}`
        : defaultProviderDescription(provider.kind),
      custom: true,
      account: provider.account,
      pushEndpoint: provider.pushEndpoint,
      ingestionMode: resolveEmailIngestionMode(provider),
    }))
  ), [customProviders, t, channelLabels.email, channelLabels.sms, channelLabels.slack, channelLabels.other]);

  useEffect(() => {
    if (!providerCards.length) {
      setActiveProviderId('');
      return;
    }
    if (!providerCards.some((provider) => provider.id === activeProviderId)) {
      setActiveProviderId(providerCards[0].id);
    }
  }, [providerCards, activeProviderId]);

  const providerStats = useMemo(() => {
    const base: Record<string, { total: number; unread: number }> = {};
    for (const provider of providerCards) {
      base[provider.id] = { total: 0, unread: 0 };
    }

    for (const item of messages) {
      const direct = item.providerId && base[item.providerId] ? item.providerId : '';
      const matched = direct || providerCards.find((provider) => {
        if (provider.kind !== inferProviderFromMessage(item)) return false;
        const raw = `${item.title} ${item.externalKey || ''}`.toLowerCase();
        return raw.includes(provider.title.toLowerCase());
      })?.id;
      if (!matched || !base[matched]) continue;
      base[matched].total += 1;
      if (item.unread) base[matched].unread += 1;
    }

    return base;
  }, [messages, providerCards]);

  const activeProviderMeta = providerCards.find((provider) => provider.id === activeProviderId) ?? null;
  const selectedOntoSynthApp = useMemo(
    () => ontoSynthApplications.find((item) => item.id === ontoSynthSelectedApplication) || null,
    [ontoSynthApplications, ontoSynthSelectedApplication],
  );
  const selectedOntoSynthPipeline = selectedOntoSynthApp?.pipeline;
  const selectedOntoSynthRecommendedCapabilities = useMemo(() => {
    const fallback = ['foundation-core'];
    const known = new Set(ontoSynthKnownCapabilityIds.map((id) => normalizeCapabilityId(id)));
    const fromPipeline = (selectedOntoSynthPipeline?.recommendation.suggestedSkills || [])
      .map((entry) => normalizeCapabilityId(entry))
      .filter(Boolean);
    const filtered = fromPipeline.filter((entry) => known.size === 0 || known.has(entry));
    if (filtered.length > 0) return [...new Set(filtered)];
    if (known.size === 0 || known.has(fallback[0])) return fallback;
    return [Array.from(known)[0]];
  }, [selectedOntoSynthPipeline, ontoSynthKnownCapabilityIds]);
  const selectedOntoSynthRecommendedCapabilitySlugs = useMemo(
    () => selectedOntoSynthRecommendedCapabilities.map((capabilityId) => toCapabilitySkillSlug(capabilityId)),
    [selectedOntoSynthRecommendedCapabilities],
  );
  const selectedOntoSynthInstalledCapabilities = useMemo(() => {
    const desired = new Set(selectedOntoSynthRecommendedCapabilities);
    const desiredSlugs = new Set(selectedOntoSynthRecommendedCapabilitySlugs);
    const installed = new Set<string>();
    for (const skill of ontoSynthSkills) {
      const capabilityId = skill.capabilityId ? normalizeCapabilityId(skill.capabilityId) : '';
      if (capabilityId && desired.has(capabilityId)) {
        installed.add(capabilityId);
        continue;
      }
      if (desiredSlugs.has(skill.slug)) {
        const inferred = normalizeCapabilityId(skill.slug.replace(/^ontosynth-capability-/, ''));
        if (inferred && desired.has(inferred)) installed.add(inferred);
      }
    }
    return Array.from(installed);
  }, [ontoSynthSkills, selectedOntoSynthRecommendedCapabilities, selectedOntoSynthRecommendedCapabilitySlugs]);
  const selectedOntoSynthInstalledCount = selectedOntoSynthInstalledCapabilities.length;
  const selectedOntoSynthRequiredCount = selectedOntoSynthRecommendedCapabilities.length;
  const selectedOntoSynthHasInstalledCapability = selectedOntoSynthInstalledCount > 0;
  const selectedOntoSynthCoverageComplete =
    selectedOntoSynthRequiredCount > 0 && selectedOntoSynthInstalledCount >= selectedOntoSynthRequiredCount;
  const ontoSynthSkillsBusy = ontoSynthSkillsLoading || !!ontoSynthSkillsBusyAction;

  const providerHookTokenValue = providerHookTokenDraft.trim() || DEFAULT_HOOK_TOKEN;
  const providerAccountValue = providerAccountDraft.trim() || 'provider-account';
  const providerProjectValue = providerProjectIdDraft.trim();
  const providerHookPathValue = providerHookPathDraft.trim() || slugify(providerNameDraft || providerKindDraft);
  const providerPushEndpointValue = providerPushEndpointDraft.trim();
  const draftEmailIngestionMode: EmailIngestionMode = providerKindDraft === 'email'
    ? (isPublicHttpsPushEndpoint(providerPushEndpointValue) ? 'gateway-push' : 'local-poll')
    : 'gateway-push';

  const generatedConfigSnippet = `{
  hooks: {
    enabled: true,
    token: "${providerHookTokenValue}",
    path: "/hooks",
    mappings: [
      {
        match: { path: "${providerHookPathValue}" },
        action: "agent",
        name: "${providerNameDraft.trim() || defaultProviderName(providerKindDraft)}",
        wakeMode: "now",
        sessionKey: "hook:${providerHookPathValue}:<message-id>",
        messageTemplate: "New message from <sender>\\nSubject: <subject>\\n<snippet>"
      }
    ]
  }
}`;

const generatedCommands = `openclaw gateway
# Configure your bridge to POST here:
${GATEWAY_HOOK_BASE}/${providerHookPathValue}?token=${providerHookTokenValue}
# Email ingestion mode:
${providerKindDraft === 'email' ? (draftEmailIngestionMode === 'local-poll' ? 'local-poll (no public URL)' : 'gateway-push (public HTTPS)') : 'n/a'}
# Pub/Sub push endpoint:
${providerPushEndpointValue || 'optional (leave empty for local-poll mode)'}
# Provider account: ${providerAccountValue}
# ${providerKindDraft === 'email' ? `Google project: ${providerProjectValue || 'auto-detect from gcloud config'}` : 'Google project: n/a'}
# Local poll test (optional):
${providerKindDraft === 'email' ? `gog gmail messages search 'in:inbox is:unread' --account ${providerAccountValue} --max 5 --json --results-only` : '# n/a'}
# Then verify by sending a test webhook payload`;

  const handleAddMessage = (e: FormEvent) => {
    e.preventDefault();
    if (!activeProviderMeta) {
      setSyncResult(t('taskRpg.addProviderFirst'));
      return;
    }
    addMessage(messageTitle, providerChannelMap[activeProviderMeta.kind], activeProviderMeta.id);
    setMessageTitle('');
  };

  const handleAddDaily = (e: FormEvent) => {
    e.preventDefault();
    addDaily(dailyTitle);
    setDailyTitle('');
  };

  const handleAddTodo = (e: FormEvent) => {
    e.preventDefault();
    addTodo(todoTitle, todoDueDate);
    setTodoTitle('');
    setTodoDueDate('');
  };

  const handleAddReward = (e: FormEvent) => {
    e.preventDefault();
    addReward(rewardTitle, Number(rewardCost));
    setRewardTitle('');
  };

  const handleDeleteMessage = async (item: MessageTask) => {
    const gmailRef = parseGmailExternalKey(item.externalKey);
    if (!gmailRef) {
      deleteMessage(item.id);
      return;
    }

    const confirmed = window.confirm(t('taskRpg.deleteMessageConfirmGmail'));
    if (!confirmed) return;

    setDeletingMessageId(item.id);
    try {
      let threadId = '';
      const getMessageCmd = withProviderSetupEnv(
        `gog gmail get ${shellQuote(gmailRef.messageId)} --account ${shellQuote(gmailRef.account)} --format metadata --json --results-only --no-input --select message.threadId,threadId`
      );
      const messageInfo = await runCommandViaSystem(getMessageCmd, 120000);
      if (messageInfo.ok) {
        const parsed = parseJsonFromCommandOutput(messageInfo.output);
        threadId = pickThreadIdFromMessagePayload(parsed);
      }

      const tryArchive = async (command: string): Promise<{ ok: boolean; output: string; exitCode: number }> => {
        const result = await runCommandViaSystem(command, 120000);
        if (result.ok) return result;
        return result;
      };

      let archiveResult: { ok: boolean; output: string; exitCode: number } | null = null;
      if (threadId) {
        const threadArchiveCmd = withProviderSetupEnv(
          `gog gmail thread modify ${shellQuote(threadId)} --account ${shellQuote(gmailRef.account)} --remove INBOX --force --no-input --json --results-only`
        );
        archiveResult = await tryArchive(threadArchiveCmd);
      }

      if (!archiveResult || !archiveResult.ok) {
        const messageArchiveCmd = withProviderSetupEnv(
          `gog gmail batch modify ${shellQuote(gmailRef.messageId)} --account ${shellQuote(gmailRef.account)} --remove INBOX --force --no-input --json --results-only`
        );
        archiveResult = await tryArchive(messageArchiveCmd);
      }

      if (!archiveResult.ok) {
        const cleaned = sanitizeSetupChunk(archiveResult.output || '').trim();
        const detail = cleaned || `exit ${archiveResult.exitCode}`;
        throw new Error(detail);
      }

      deleteMessage(item.id);
      setSyncResult(t('taskRpg.deleteMessageGmailSuccess'));
    } catch (err: any) {
      const raw = typeof err?.message === 'string' ? err.message : String(err || '');
      const details = sanitizeSetupChunk(raw)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-2)
        .join(' ');
      setSyncResult(t('taskRpg.deleteMessageGmailFailed', { error: details || 'unknown error' }));
    } finally {
      setDeletingMessageId((current) => (current === item.id ? '' : current));
    }
  };

  const openProviderSetup = () => {
    setProviderModalOpen(true);
    setProviderKindDraft('email');
    setProviderNameDraft('');
    setProviderAccountDraft('');
    setProviderProjectIdDraft('');
    setProviderPushEndpointDraft('');
    setProviderHookTokenDraft(DEFAULT_HOOK_TOKEN);
    setProviderHookPathDraft('');
    setCopiedItem('');
  };

  const setProviderKind = (kind: ProviderKind) => {
    setProviderKindDraft(kind);
    setProviderHookPathDraft(slugify(providerNameDraft || kind));
  };

  const copyText = async (copyId: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedItem(copyId);
      window.setTimeout(() => setCopiedItem((current) => (current === copyId ? '' : current)), 1200);
    } catch {
      setSyncResult(t('taskRpg.providerCopyFailed'));
    }
  };

  const saveProviderProfile = () => {
    const kind = providerKindDraft;
    const pushEndpoint = providerPushEndpointDraft.trim();
    if (kind === 'email' && pushEndpoint && !isPublicHttpsPushEndpoint(pushEndpoint)) {
      setSyncResult(t('taskRpg.providerPushEndpointInvalid'));
      return;
    }
    const cleanName = providerNameDraft.trim() || defaultProviderName(kind);
    const ingestionMode: EmailIngestionMode | undefined = kind === 'email'
      ? (isPublicHttpsPushEndpoint(pushEndpoint) ? 'gateway-push' : 'local-poll')
      : undefined;
    const profile: CustomProviderProfile = {
      id: makeProviderId(),
      kind,
      name: cleanName,
      account: providerAccountDraft.trim() || undefined,
      gcpProjectId: providerProjectIdDraft.trim() || undefined,
      pushEndpoint: pushEndpoint || undefined,
      ingestionMode,
      hookToken: providerHookTokenValue,
      hookPath: providerHookPathValue,
      createdAt: new Date().toISOString(),
    };

    setCustomProviders((prev) => [...prev, profile]);
    setExpandedProviders((prev) => ({ ...prev, [profile.id]: true }));
    setActiveProviderId(profile.id);
    setProviderModalOpen(false);
    setSyncResult(t('taskRpg.providerAdded', { name: cleanName }));
    void setupProviderInBackground(profile);
  };

  const saveProviderPushEndpoint = (providerId: string) => {
    const value = (providerPushEndpointInputs[providerId] || '').trim();
    if (value && !isPublicHttpsPushEndpoint(value)) {
      setSyncResult(t('taskRpg.providerPushEndpointInvalid'));
      return;
    }
    setCustomProviders((prev) => prev.map((item) => (
      item.id === providerId
        ? {
            ...item,
            pushEndpoint: value || undefined,
            ingestionMode: item.kind === 'email'
              ? (value ? 'gateway-push' : 'local-poll')
              : item.ingestionMode,
          }
        : item
    )));
    setSyncResult(value ? t('taskRpg.providerPushEndpointSaved') : t('taskRpg.providerPushEndpointCleared'));
  };

  const removeCustomProvider = (providerId: string) => {
    setCustomProviders((prev) => prev.filter((item) => item.id !== providerId));
    setExpandedProviders((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
    if (activeProviderId === providerId) {
      setActiveProviderId('');
    }
    setProviderSetupState((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
  };

  const rerunProviderSetup = (providerId: string) => {
    const profile = customProviders.find((item) => item.id === providerId);
    if (!profile) return;
    void setupProviderInBackground(profile);
  };

  const syncMessagesFromLocalGmail = async (profile: CustomProviderProfile): Promise<{ added: number }> => {
    if (!profile.account) {
      throw new Error(t('taskRpg.providerSetupNoAccount'));
    }

    const query = 'in:inbox is:unread';
    const syncCmd = withProviderSetupEnv(
      `gog gmail messages search ${shellQuote(query)} --account ${shellQuote(profile.account)} --max 30 --json --results-only --no-input`
    );
    const searchResult = await runCommandViaSystem(syncCmd, 180000);
    if (!searchResult.ok) {
      throw new Error(classifySetupError(searchResult.output || '', searchResult.exitCode === 124, t));
    }

    const parsed = parseJsonFromCommandOutput(searchResult.output);
    const messages = normalizeGmailMessages(parsed);
    const imports = messages.map((message) => {
      const summary = message.subject || message.snippet || 'New message';
      const from = message.from ? `${message.from} · ` : '';
      return {
        title: buildTaskTitle('Gmail', `${from}${summary}`),
        channel: 'email' as const,
        providerId: profile.id,
        source: 'provider' as const,
        externalKey: `gmail:${profile.account}:${message.id}`,
        receivedAt: message.receivedAt,
        unread: message.unread,
      };
    });
    return importExternalMessages(imports);
  };

  const syncMessagesFromGateway = async (provider?: ProviderCard) => {
    const providerProfile = provider?.custom
      ? customProviders.find((item) => item.id === provider.id)
      : undefined;
    const providerLocalPoll = !!providerProfile
      && providerProfile.kind === 'email'
      && resolveEmailIngestionMode(providerProfile) === 'local-poll';

    if (!providerLocalPoll && !connected) {
      setSyncResult(t('taskRpg.syncDisconnected'));
      return;
    }
    if (provider) {
      const setup = providerSetupState[provider.id];
      if (setup?.phase === 'running') {
        setSyncResult(t('taskRpg.syncWaitSetup'));
        return;
      }
    }

    setIsSyncing(true);
    setSyncResult('');

    try {
      if (providerLocalPoll && providerProfile) {
        const result = await syncMessagesFromLocalGmail(providerProfile);
        setSyncResult(result.added > 0 ? t('taskRpg.syncAdded', { count: result.added }) : t('taskRpg.syncNoNew'));
        return;
      }

      const sessionsRes = await gateway.getSessions();
      const rawSessions = Array.isArray(sessionsRes?.sessions) ? sessionsRes.sessions : [];
      const sessions = rawSessions
        .map((session: any) => ({
          key: session.key || session.sessionKey || '',
          label: session.label || session.name || session.key || 'Session',
          kind: session.kind || '',
          updatedAt: session.updatedAt || session.lastMessage?.timestamp || '',
        }))
        .filter((session) => session.key && session.key !== 'agent:main:main')
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, 12);

      const imports: Array<{
        title: string;
        channel: MessageChannel;
        providerId?: string;
        externalKey: string;
        receivedAt?: string;
        unread?: boolean;
      }> = [];

      for (const session of sessions) {
        try {
          const history = await gateway.getHistory(session.key, 30);
          const items = Array.isArray(history?.messages) ? history.messages : [];
          const recentUser = [...items].reverse().find((msg: any) => msg?.role === 'user');
          if (!recentUser) continue;
          const text = contentToText(recentUser.content);
          if (!text) continue;

          const sourceText = `${session.key} ${session.label} ${session.kind}`;
          const channel = mapSessionToChannel(sourceText);
          const stableId = String(
            recentUser.id ||
            recentUser.messageId ||
            recentUser.ts ||
            recentUser.timestamp ||
            text.slice(0, 48)
          );

          imports.push({
            title: buildTaskTitle(String(session.label), text),
            channel,
            providerId: provider?.id,
            externalKey: `${session.key}:${stableId}`,
            receivedAt: typeof recentUser.timestamp === 'string' ? recentUser.timestamp : undefined,
            unread: true,
          });
        } catch {
          // Keep syncing other sessions when one fails.
        }
      }

      const result = importExternalMessages(imports);
      setSyncResult(result.added > 0 ? t('taskRpg.syncAdded', { count: result.added }) : t('taskRpg.syncNoNew'));
    } catch (err: any) {
      const message = typeof err?.message === 'string' && err.message.trim() ? err.message.trim() : 'Gateway sync failed';
      setSyncResult(t('taskRpg.syncFailed', { error: message }));
    } finally {
      setIsSyncing(false);
    }
  };

  const refreshOntoSynthBridge = async () => {
    if (!connected) {
      setOntoSynthError(t('taskRpg.ontoSynthErrorDisconnected'));
      return;
    }

    setOntoSynthLoading(true);
    setOntoSynthError('');
    try {
      const [healthRaw, appsRaw, skillsRaw] = await Promise.all([
        gateway.getOntoSynthHealth({}),
        gateway.getOntoSynthApplications({}),
        gateway.getOntoSynthSkills({}),
      ]);

      const health = asRecord(healthRaw);
      const appsPayload = asRecord(appsRaw);
      const skillsPayload = asRecord(skillsRaw);

      if (!health || health.status === 'error') {
        throw new Error(pickString(health || {}, ['error']) || 'ontosynth.health failed');
      }
      if (!appsPayload || appsPayload.status === 'error') {
        throw new Error(pickString(appsPayload || {}, ['error']) || 'ontosynth.applications.list failed');
      }
      if (!skillsPayload || skillsPayload.status === 'error') {
        throw new Error(pickString(skillsPayload || {}, ['error']) || 'ontosynth.skills.list failed');
      }

      const knowledge = asRecord(health.knowledge);
      const applications = parseOntoSynthApplications(appsPayload);
      const snapshot = parseOntoSynthSkills(skillsPayload);
      setOntoSynthHealth({
        root: pickString(health, ['root']),
        pythonVersion: pickString(knowledge || {}, ['python_version']),
        duckdbAvailable: !!knowledge?.duckdb_available,
        applicationsCount: applications.length,
      });
      setOntoSynthApplications(applications);
      setOntoSynthSkills(snapshot.skills);
      setOntoSynthSkillsTotalCount(snapshot.totalCount);
      setOntoSynthSkillsGeneratedCount(snapshot.generatedCount);
      setOntoSynthSkillsBundledCount(snapshot.bundledCount);
      setOntoSynthKnownCapabilityIds(snapshot.knownCapabilityIds);
      setOntoSynthSkillsError('');
      setOntoSynthLastUpdated(new Date().toISOString());

      const preferred = applications.find((item) => item.id === ontoSynthSelectedApplication);
      const fallback = preferred?.id || applications[0]?.id || '';
      setOntoSynthSelectedApplication(fallback);
    } catch (error) {
      setOntoSynthError(t('taskRpg.ontoSynthLoadFailed', { error: extractGatewayErrorMessage(error) }));
    } finally {
      setOntoSynthLoading(false);
    }
  };

  const refreshOntoSynthSkills = async (silent = false) => {
    if (!connected) {
      setOntoSynthSkillsError(t('taskRpg.ontoSynthErrorDisconnected'));
      return;
    }
    if (!silent) setOntoSynthSkillsLoading(true);
    setOntoSynthSkillsError('');
    try {
      const raw = await gateway.getOntoSynthSkills({});
      const payload = asRecord(raw);
      if (!payload || payload.status === 'error') {
        throw new Error(pickString(payload || {}, ['error']) || 'ontosynth.skills.list failed');
      }
      const snapshot = parseOntoSynthSkills(payload);
      setOntoSynthSkills(snapshot.skills);
      setOntoSynthSkillsTotalCount(snapshot.totalCount);
      setOntoSynthSkillsGeneratedCount(snapshot.generatedCount);
      setOntoSynthSkillsBundledCount(snapshot.bundledCount);
      setOntoSynthKnownCapabilityIds(snapshot.knownCapabilityIds);
      if (!silent) {
        setOntoSynthSkillsStatus(
          t('taskRpg.ontoSynthSkillsRefreshed', {
            total: snapshot.totalCount,
            generated: snapshot.generatedCount,
          })
        );
      }
    } catch (error) {
      setOntoSynthSkillsError(t('taskRpg.ontoSynthSkillsRefreshFailed', { error: extractGatewayErrorMessage(error) }));
    } finally {
      if (!silent) setOntoSynthSkillsLoading(false);
    }
  };

  const syncOntoSynthSkills = async () => {
    if (!connected) {
      setOntoSynthSkillsError(t('taskRpg.ontoSynthErrorDisconnected'));
      return;
    }
    setOntoSynthSkillsBusyAction('sync');
    setOntoSynthSkillsError('');
    try {
      const raw = await gateway.syncOntoSynthSkills({ overwrite: true });
      const payload = asRecord(raw);
      if (!payload || payload.status === 'error') {
        throw new Error(pickString(payload || {}, ['error']) || 'ontosynth.skills.sync failed');
      }

      const created = pickNumber(payload, ['created']) ?? 0;
      const updated = pickNumber(payload, ['updated']) ?? 0;
      const unchanged = pickNumber(payload, ['unchanged']) ?? 0;
      setOntoSynthSkillsStatus(
        t('taskRpg.ontoSynthSkillsSyncDone', {
          created,
          updated,
          unchanged,
        })
      );
      await refreshOntoSynthSkills(true);
    } catch (error) {
      setOntoSynthSkillsError(t('taskRpg.ontoSynthSkillsSyncFailed', { error: extractGatewayErrorMessage(error) }));
    } finally {
      setOntoSynthSkillsBusyAction('');
    }
  };

  const installSelectedOntoSynthSkill = async () => {
    if (!connected) {
      setOntoSynthSkillsError(t('taskRpg.ontoSynthErrorDisconnected'));
      return;
    }
    if (!ontoSynthSelectedApplication) {
      setOntoSynthSkillsError(t('taskRpg.ontoSynthSkillsSelectApplication'));
      return;
    }
    setOntoSynthSkillsBusyAction('install');
    setOntoSynthSkillsError('');
    try {
      const raw = await gateway.installOntoSynthSkill({
        applicationId: ontoSynthSelectedApplication,
        overwrite: true,
      });
      const payload = asRecord(raw);
      if (!payload || payload.status === 'error') {
        throw new Error(pickString(payload || {}, ['error']) || 'ontosynth.skills.install failed');
      }
      const installedCapabilities = pickStringArray(payload, ['capability_ids', 'capabilityIds'])
        .map((id) => normalizeCapabilityId(id))
        .filter(Boolean);
      const capabilityLabels = (installedCapabilities.length > 0
        ? installedCapabilities
        : selectedOntoSynthRecommendedCapabilities
      )
        .map((capabilityId) => formatCapabilityLabel(capabilityId))
        .join(', ');
      setOntoSynthSkillsStatus(t('taskRpg.ontoSynthSkillsInstallDone', { capabilities: capabilityLabels }));
      await refreshOntoSynthSkills(true);
    } catch (error) {
      setOntoSynthSkillsError(t('taskRpg.ontoSynthSkillsInstallFailed', { error: extractGatewayErrorMessage(error) }));
    } finally {
      setOntoSynthSkillsBusyAction('');
    }
  };

  const removeSelectedOntoSynthSkill = async () => {
    if (!connected) {
      setOntoSynthSkillsError(t('taskRpg.ontoSynthErrorDisconnected'));
      return;
    }
    if (!ontoSynthSelectedApplication) {
      setOntoSynthSkillsError(t('taskRpg.ontoSynthSkillsSelectApplication'));
      return;
    }
    if (!selectedOntoSynthHasInstalledCapability) {
      setOntoSynthSkillsError(t('taskRpg.ontoSynthSkillsNothingToRemove'));
      return;
    }

    const selectedAppName = selectedOntoSynthApp?.name || ontoSynthSelectedApplication;
    const capabilityLabels = selectedOntoSynthRecommendedCapabilities
      .map((capabilityId) => formatCapabilityLabel(capabilityId))
      .join(', ');
    const confirmed = window.confirm(
      t('taskRpg.ontoSynthSkillsRemoveConfirm', {
        application: selectedAppName,
        capabilities: capabilityLabels,
      })
    );
    if (!confirmed) return;

    setOntoSynthSkillsBusyAction('remove');
    setOntoSynthSkillsError('');
    try {
      const raw = await gateway.removeOntoSynthSkill({
        applicationId: ontoSynthSelectedApplication,
        removeLegacy: true,
      });
      const payload = asRecord(raw);
      if (!payload || payload.status === 'error') {
        throw new Error(pickString(payload || {}, ['error']) || 'ontosynth.skills.remove failed');
      }
      const removedCount = pickNumber(payload, ['removed_count', 'removedCount']) ?? (payload.removed ? 1 : 0);
      if (removedCount <= 0) {
        throw new Error(pickString(payload, ['reason']) || 'remove skipped');
      }

      setOntoSynthSkillsStatus(t('taskRpg.ontoSynthSkillsRemoveDone', { application: selectedAppName, count: removedCount }));
      await refreshOntoSynthSkills(true);
    } catch (error) {
      setOntoSynthSkillsError(t('taskRpg.ontoSynthSkillsRemoveFailed', { error: extractGatewayErrorMessage(error) }));
    } finally {
      setOntoSynthSkillsBusyAction('');
    }
  };

  useEffect(() => {
    if (!connected || ontoSynthBootstrappedRef.current) return;
    ontoSynthBootstrappedRef.current = true;
    void refreshOntoSynthBridge();
  }, [connected]);

  const isAutoGmailProvider = (profile: CustomProviderProfile): boolean => {
    if (profile.kind !== 'email') return false;
    const name = profile.name.toLowerCase();
    const account = (profile.account || '').toLowerCase();
    return account.endsWith('@gmail.com') || (name.includes('gmail') && account.includes('@'));
  };

  const buildSetupCommand = (profile: CustomProviderProfile): string => {
    const steps = ['openclaw gateway start'];
    if (isAutoGmailProvider(profile) && profile.account) {
      const emailMode = resolveEmailIngestionMode(profile);
      const hookUrl = buildProviderHookUrl(profile);
      const hookToken = (profile.hookToken || DEFAULT_HOOK_TOKEN).trim() || DEFAULT_HOOK_TOKEN;
      const pushEndpoint = resolveProviderPushEndpoint(profile);
      const hasPublicPushEndpoint = isPublicHttpsPushEndpoint(pushEndpoint);
      if (emailMode === 'local-poll') {
        steps.push('cred_imported=""');
        steps.push('for cred_path in "$(ls -t "$HOME"/Downloads/client_secret*.json "$HOME"/Downloads/*credentials*.json 2>/dev/null | head -n1)" "$(ls -t "$HOME"/Desktop/client_secret*.json "$HOME"/Desktop/*credentials*.json 2>/dev/null | head -n1)" "$HOME/Library/Application Support/gogcli/credentials.json"; do if [ -z "$cred_path" ] || [ ! -f "$cred_path" ]; then continue; fi; if ! grep -Eq "\\"(installed|web)\\"" "$cred_path"; then continue; fi; echo "[oauth] importing client credentials: $cred_path"; if gog auth credentials set "$cred_path" --no-input; then cred_imported=1; break; fi; done');
        steps.push('if gog auth credentials list --json --results-only --no-input | tr -d "\\n\\r\\t " | grep -q "^\\[\\]$"; then echo "[oauth] missing OAuth client credentials"; exit 1; fi');
        steps.push(`if ! gog auth add ${shellQuote(profile.account)}; then exit 1; fi`);
        steps.push(`gog gmail messages search ${shellQuote('in:inbox is:unread')} --account ${shellQuote(profile.account)} --max 1 --json --results-only --no-input`);
        return withProviderSetupEnv(steps.join(' && '));
      }
      steps.push('if ! gcloud auth list --format="value(account)" | grep -Eiq "^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$"; then echo "[auth] No Google account signed in. Starting gcloud auth login..."; gcloud auth login || exit $?; fi');
      if (profile.gcpProjectId?.trim()) {
        steps.push(`project_id=${shellQuote(profile.gcpProjectId.trim())}`);
      } else {
        steps.push('project_id="$(gcloud config get-value project --quiet 2>/dev/null || true)"');
        steps.push('if [ -z "$project_id" ] || [ "$project_id" = "(unset)" ]; then project_id="$(gcloud projects list --format=\\"value(projectId)\\" --limit=1 2>/dev/null | head -n1)"; fi');
      }
      steps.push('if [ -z "$project_id" ] || [ "$project_id" = "(unset)" ]; then echo "[project] Missing Google Cloud project id. Set one with: gcloud config set project <PROJECT_ID>"; exit 1; fi');
      steps.push('echo "[project] Using project: $project_id"');
      if (!hasPublicPushEndpoint) {
        steps.push('echo "[push] Missing public HTTPS push endpoint. Set it in provider settings."');
        steps.push('exit 1');
      }
      steps.push(`openclaw webhooks gmail setup --tailscale off --account ${shellQuote(profile.account)} --project "$project_id" --hook-url ${shellQuote(hookUrl)} --hook-token ${shellQuote(hookToken)} --push-endpoint ${shellQuote(pushEndpoint)}`);
    }
    return withProviderSetupEnv(steps.join(' && '));
  };

  const closeSetupConsole = async () => {
    setupConsoleUnsubDataRef.current?.();
    setupConsoleUnsubDataRef.current = null;
    setupConsoleUnsubExitRef.current?.();
    setupConsoleUnsubExitRef.current = null;
    if (setupConsoleSessionId) {
      if (setupConsoleTransport === 'pty') {
        await window.aegis?.terminal?.kill(setupConsoleSessionId).catch(() => {});
      } else if (setupConsoleTransport === 'shell') {
        await window.aegis?.shell?.kill(setupConsoleSessionId).catch(() => {});
      } else {
        await window.aegis?.terminal?.kill(setupConsoleSessionId).catch(() => {});
        await window.aegis?.shell?.kill(setupConsoleSessionId).catch(() => {});
      }
    }
    setSetupConsoleSessionId('');
    setSetupConsoleTransport('');
    setSetupConsoleRunning(false);
    setSetupConsoleBooting(false);
    setSetupConsoleOpen(false);
  };

  const sendSetupConsoleInput = async () => {
    const line = setupConsoleInput.trim();
    if (!line || !setupConsoleSessionId) return;
    if (setupConsoleTransport === 'shell') {
      await window.aegis?.shell?.write(setupConsoleSessionId, `${line}\n`);
    } else {
      await window.aegis?.terminal?.write(setupConsoleSessionId, `${line}\n`);
    }
    setSetupConsoleInput('');
  };

  const interruptSetupConsole = async () => {
    if (!setupConsoleSessionId) return;
    if (setupConsoleTransport === 'shell') {
      await window.aegis?.shell?.write(setupConsoleSessionId, '\u0003');
    } else {
      await window.aegis?.terminal?.write(setupConsoleSessionId, '\u0003');
    }
  };

  const launchInteractiveSetupConsole = async (profile: CustomProviderProfile) => {
    const terminal = window.aegis?.terminal;
    const shell = window.aegis?.shell;
    if (!terminal && !shell) {
      setSyncResult(t('taskRpg.providerConsoleUnavailable'));
      return;
    }

    await closeSetupConsole();
    setSetupConsoleTitle(profile.name);
    setSetupConsoleOutput('');
    setSetupConsoleInput('');
    setSetupConsoleOpen(true);
    setSetupConsoleBooting(true);

    let sessionId = '';
    let transport: 'pty' | 'shell' | '' = '';
    let createError = '';

    if (shell) {
      const created = await shell.create({ interactive: false });
      if (created?.id) {
        sessionId = created.id;
        transport = 'shell';
      } else {
        createError = `${createError}\n${created?.error || 'Shell create failed'}`.trim();
      }
    }

    if (!sessionId && terminal) {
      const created = await terminal.create({ cols: 100, rows: 30 });
      if (created?.id) {
        sessionId = created.id;
        transport = 'pty';
      } else {
        createError = `${createError}\n${created?.error || 'PTY create failed'}`.trim();
      }
    }

    if (!sessionId || !transport) {
      setSetupConsoleBooting(false);
      setSetupConsoleOutput(createError || 'Console session create failed');
      return;
    }

    setSetupConsoleSessionId(sessionId);
    setSetupConsoleTransport(transport);
    setSetupConsoleRunning(true);
    setSetupConsoleBooting(false);
    let liveOutput = '';

    if (profile.id !== 'draft') {
      setProviderSetupState((prev) => ({
        ...prev,
        [profile.id]: { phase: 'running', message: t('taskRpg.providerSetupRunning') },
      }));
    }

    setupConsoleUnsubDataRef.current = (transport === 'shell' ? shell?.onData : terminal?.onData)?.((id, data) => {
      if (id !== sessionId) return;
      liveOutput += data;
      setSetupConsoleOutput((prev) => {
        const next = `${prev}${data}`;
        return next.length > 120000 ? next.slice(-120000) : next;
      });
    }) || null;
    setupConsoleUnsubExitRef.current = (transport === 'shell' ? shell?.onExit : terminal?.onExit)?.((id, exitCode) => {
      if (id !== sessionId) return;
      setSetupConsoleRunning(false);
      setSetupConsoleOutput((prev) => `${prev}\n\n[process exited: ${exitCode}]`);
      if (profile.id === 'draft') return;

      if (exitCode === 0) {
        const readyMessage = isAutoGmailProvider(profile)
          ? (resolveEmailIngestionMode(profile) === 'local-poll'
            ? t('taskRpg.providerSetupReadyLocal')
            : t('taskRpg.providerSetupReady'))
          : t('taskRpg.providerSetupReadyManual');
        setProviderSetupState((prev) => ({
          ...prev,
          [profile.id]: { phase: 'ready', message: readyMessage },
        }));
        if (isAutoGmailProvider(profile)) {
          void syncMessagesFromGateway({
            id: profile.id,
            kind: profile.kind,
            tone: providerTone(profile.kind),
            emoji: providerEmoji(profile.kind),
            title: profile.name,
            description: '',
            custom: true,
            account: profile.account,
            ingestionMode: profile.kind === 'email' ? resolveEmailIngestionMode(profile) : undefined,
          });
        }
        return;
      }

      setProviderSetupState((prev) => ({
        ...prev,
        [profile.id]: {
          phase: 'error',
          message: classifySetupError(liveOutput, false, t),
          output: appendLogTail('', liveOutput),
        },
      }));
    }) || null;

    const command = buildSetupCommand(profile);
    const bootCommand = `echo "Starting provider setup..."\n${command}\n`;
    if (transport === 'shell') {
      await shell?.write(sessionId, bootCommand);
    } else {
      await terminal?.write(sessionId, bootCommand);
    }
  };

  const launchInteractiveSetupForProvider = async (providerId: string) => {
    const profile = customProviders.find((item) => item.id === providerId);
    if (!profile) return;
    await launchInteractiveSetupConsole(profile);
  };

  const openSetupLogModal = (providerId: string) => {
    setSetupLogModalProviderId(providerId);
  };

  const closeSetupLogModal = () => {
    setSetupLogModalProviderId('');
  };

  const launchInteractiveSetupForDraft = async () => {
    if (!providerNameDraft.trim() || !providerAccountDraft.trim()) {
      setSyncResult(t('taskRpg.providerConsoleNeedFields'));
      return;
    }
    if (providerKindDraft === 'email' && providerPushEndpointDraft.trim() && !isPublicHttpsPushEndpoint(providerPushEndpointDraft.trim())) {
      setSyncResult(t('taskRpg.providerPushEndpointInvalid'));
      return;
    }
    const draftMode: EmailIngestionMode = isPublicHttpsPushEndpoint(providerPushEndpointDraft.trim()) ? 'gateway-push' : 'local-poll';
    await launchInteractiveSetupConsole({
      id: 'draft',
      kind: providerKindDraft,
      name: providerNameDraft.trim(),
      account: providerAccountDraft.trim(),
      gcpProjectId: providerProjectIdDraft.trim() || undefined,
      pushEndpoint: providerPushEndpointDraft.trim() || undefined,
      ingestionMode: providerKindDraft === 'email' ? draftMode : undefined,
      hookToken: providerHookTokenValue,
      hookPath: providerHookPathValue,
      createdAt: new Date().toISOString(),
    });
  };

  const setupProviderInBackground = async (profile: CustomProviderProfile) => {
    if (providerSetupState[profile.id]?.phase === 'running') return;

    const setStatus = (phase: ProviderSetupState['phase'], message: string, output?: string) => {
      const normalizedOutput = typeof output === 'string' ? appendLogTail('', output) : undefined;
      console.info('[AssignmentSetup]', profile.id, phase, message);
      if (normalizedOutput && normalizedOutput.trim()) {
        const lines = normalizedOutput.split(/\r?\n/).filter(Boolean);
        const tail = lines.slice(-20).join('\n');
        console.info('[AssignmentSetup][output]', profile.id, tail);
      }
      setProviderSetupState((prev) => ({
        ...prev,
        [profile.id]: {
          phase,
          message,
          output: normalizedOutput !== undefined ? normalizedOutput : prev[profile.id]?.output,
        },
      }));
    };

    const appendSetupOutput = (chunk: string) => {
      const cleanedChunk = sanitizeSetupChunk(chunk);
      if (!cleanedChunk) return;
      setProviderSetupState((prev) => {
        const current = prev[profile.id] || { phase: 'running', message: '', output: '' };
        return {
          ...prev,
          [profile.id]: {
            ...current,
            output: appendLogTail(current.output, cleanedChunk),
          },
        };
      });
    };

    const runSetupCommand = async (command: string, timeoutMs: number) => runCommandViaShellStream(
      command,
      timeoutMs,
      (chunk) => appendSetupOutput(chunk),
    );

    console.info('[AssignmentSetup][cmd]', profile.id, 'openclaw gateway start');
    setStatus('running', t('taskRpg.providerSetupGateway'), '');
    const gatewayStart = await runSetupCommand(withProviderSetupEnv('openclaw gateway start'), 120000);
    if (!gatewayStart.ok && !/already running|running|started/i.test(gatewayStart.output.toLowerCase())) {
      setStatus('error', classifySetupError(gatewayStart.output, gatewayStart.exitCode === 124, t), gatewayStart.output);
      return;
    }

    if (isAutoGmailProvider(profile)) {
      if (!profile.account) {
        setStatus('error', t('taskRpg.providerSetupNoAccount'));
        return;
      }

      const emailMode = resolveEmailIngestionMode(profile);

      const gogCheck = await runSetupCommand(withProviderSetupEnv('command -v gog >/dev/null 2>&1'), 10000);
      if (!gogCheck.ok) {
        const isMac = /\bMac OS X\b|\bMacintosh\b/i.test(window.navigator.userAgent);
        if (!isMac) {
          setStatus('error', t('taskRpg.providerSetupErrorDeps'), 'gogcli is missing. Install gogcli and retry.');
          return;
        }
        setStatus('running', t('taskRpg.providerSetupInstallGog'));
        console.info('[AssignmentSetup][cmd]', profile.id, 'brew install gogcli');
        const installGog = await runSetupCommand(
          withProviderSetupEnv(brewInstallWithLockRetry('brew install gogcli')),
          1800000,
        );
        if (!installGog.ok) {
          setStatus('error', t('taskRpg.providerSetupErrorDeps'), installGog.output);
          return;
        }
        const gogCheckAfter = await runSetupCommand(withProviderSetupEnv('command -v gog >/dev/null 2>&1'), 10000);
        if (!gogCheckAfter.ok) {
          setStatus('error', t('taskRpg.providerSetupErrorDeps'), 'gogcli install finished but command is still unavailable.');
          return;
        }
      }

      if (emailMode === 'local-poll') {
        setStatus('running', t('taskRpg.providerSetupLocalPoller'));
        const importCredentials = await runSetupCommand(
          withProviderSetupEnv([
            'cred_imported=""',
            'for cred_path in "$(ls -t "$HOME"/Downloads/client_secret*.json "$HOME"/Downloads/*credentials*.json 2>/dev/null | head -n1)" "$(ls -t "$HOME"/Desktop/client_secret*.json "$HOME"/Desktop/*credentials*.json 2>/dev/null | head -n1)" "$HOME/Library/Application Support/gogcli/credentials.json"; do if [ -z "$cred_path" ] || [ ! -f "$cred_path" ]; then continue; fi; if ! grep -Eq "\\"(installed|web)\\"" "$cred_path"; then continue; fi; echo "[oauth] importing client credentials: $cred_path"; if gog auth credentials set "$cred_path" --no-input; then cred_imported=1; break; fi; done',
            'if gog auth credentials list --json --results-only --no-input | tr -d "\\n\\r\\t " | grep -q "^\\[\\]$"; then echo "[oauth] missing OAuth client credentials"; exit 1; fi',
          ].join(' && ')),
          120000,
        );
        if (!importCredentials.ok) {
          setStatus('error', classifySetupError(importCredentials.output, importCredentials.exitCode === 124, t), importCredentials.output);
          return;
        }
        const gmailProbe = await runSetupCommand(
          withProviderSetupEnv(
            `gog gmail messages search ${shellQuote('in:inbox is:unread')} --account ${shellQuote(profile.account)} --max 1 --json --results-only --no-input`
          ),
          120000,
        );
        if (!gmailProbe.ok) {
          setStatus('error', classifySetupError(gmailProbe.output, gmailProbe.exitCode === 124, t), gmailProbe.output);
          return;
        }
        setStatus('ready', t('taskRpg.providerSetupReadyLocal'));
        return;
      }

      const gcloudCheck = await runSetupCommand(withProviderSetupEnv('command -v gcloud >/dev/null 2>&1'), 10000);
      if (!gcloudCheck.ok) {
        const isMac = /\bMac OS X\b|\bMacintosh\b/i.test(window.navigator.userAgent);
        if (!isMac) {
          setStatus('error', t('taskRpg.providerSetupErrorDeps'), 'gcloud CLI not found. Install gcloud and retry.');
          return;
        }

        const brewCheck = await runSetupCommand(withProviderSetupEnv('command -v brew >/dev/null 2>&1'), 10000);
        if (!brewCheck.ok) {
          setStatus('error', t('taskRpg.providerSetupErrorDeps'), 'Homebrew not found. Install Homebrew, then retry.');
          return;
        }

        setStatus('running', t('taskRpg.providerSetupInstallGcloud'));
        console.info('[AssignmentSetup][cmd]', profile.id, 'brew install --cask gcloud-cli');
        const installGcloud = await runSetupCommand(
          withProviderSetupEnv(brewInstallWithLockRetry('brew install --cask gcloud-cli')),
          1800000,
        );
        if (!installGcloud.ok) {
          setStatus('error', t('taskRpg.providerSetupErrorDeps'), installGcloud.output);
          return;
        }

        const gcloudCheckAfter = await runSetupCommand(withProviderSetupEnv('command -v gcloud >/dev/null 2>&1'), 10000);
        if (!gcloudCheckAfter.ok) {
          setStatus('error', t('taskRpg.providerSetupErrorDeps'), 'gcloud install finished but command is still unavailable.');
          return;
        }
      }

      const gcloudAuth = await runSetupCommand(
        withProviderSetupEnv('gcloud auth list --format="value(account)"'),
        20000,
      );
      const activeAccount = (gcloudAuth.output || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(line));
      if (!activeAccount) {
        setStatus('error', t('taskRpg.providerSetupNeedsGoogleAuth'), gcloudAuth.output);
        return;
      }

      let projectId = profile.gcpProjectId?.trim() || '';
      if (!projectId) {
        setStatus('running', t('taskRpg.providerSetupProjectDetect'));
        const configuredProject = await runSetupCommand(
          withProviderSetupEnv('gcloud config get-value project --quiet 2>/dev/null || true'),
          20000,
        );
        projectId = parseGoogleProjectId(configuredProject.output);
        if (!projectId) {
          const listedProjects = await runSetupCommand(
            withProviderSetupEnv('gcloud projects list --format="value(projectId)" --limit=5 2>/dev/null || true'),
            30000,
          );
          const projectIds = parseGoogleProjectIds(listedProjects.output);
          if (projectIds.length > 0) {
            projectId = projectIds[0];
            if (projectIds.length === 1) {
              appendSetupOutput(`[project] Using detected project: ${projectId}\n`);
            } else {
              appendSetupOutput(`[project] Multiple projects detected: ${projectIds.join(', ')}\n`);
              appendSetupOutput(`[project] Auto-selected project: ${projectId}\n`);
            }
          }
        }
      } else {
        appendSetupOutput(`[project] Using provider project: ${projectId}\n`);
      }

      if (!projectId) {
        setStatus('error', t('taskRpg.providerSetupNeedsProject'));
        return;
      }

      if (!profile.gcpProjectId || profile.gcpProjectId !== projectId) {
        setCustomProviders((prev) => prev.map((item) => (
          item.id === profile.id ? { ...item, gcpProjectId: projectId } : item
        )));
      }

      const hookUrl = buildProviderHookUrl(profile);
      const hookToken = (profile.hookToken || DEFAULT_HOOK_TOKEN).trim() || DEFAULT_HOOK_TOKEN;
      const pushEndpoint = resolveProviderPushEndpoint(profile);
      const hasPublicPushEndpoint = isPublicHttpsPushEndpoint(pushEndpoint);
      if (hasPublicPushEndpoint) {
        appendSetupOutput(`[push] Using explicit public endpoint: ${pushEndpoint}\n`);
      } else {
        setStatus('error', t('taskRpg.providerSetupNeedsPushEndpoint'));
        return;
      }

      setStatus('running', t('taskRpg.providerSetupGmail'));
      console.info('[AssignmentSetup][cmd]', profile.id, `openclaw webhooks gmail setup --account ${profile.account} --project ${projectId}`);
      const gmailSetup = await runSetupCommand(
        withProviderSetupEnv(
          `openclaw webhooks gmail setup --tailscale off --account ${shellQuote(profile.account)} --project ${shellQuote(projectId)} --hook-url ${shellQuote(hookUrl)} --hook-token ${shellQuote(hookToken)} --push-endpoint ${shellQuote(pushEndpoint)}`
        ),
        900000,
      );
      if (!gmailSetup.ok) {
        setStatus('error', classifySetupError(gmailSetup.output, gmailSetup.exitCode === 124, t), gmailSetup.output);
        return;
      }

      setStatus('ready', t('taskRpg.providerSetupReady'));
      await syncMessagesFromGateway({
        id: profile.id,
        kind: profile.kind,
        tone: providerTone(profile.kind),
        emoji: providerEmoji(profile.kind),
        title: profile.name,
        description: '',
        custom: true,
        account: profile.account,
        ingestionMode: emailMode,
      });
      return;
    }

    setStatus('ready', t('taskRpg.providerSetupReadyManual'));
  };

  return (
    <PageTransition className="p-5 lg:p-6 h-full min-h-0 flex flex-col">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-aegis-text">{t('taskRpg.title')}</h1>
          <p className="text-[12px] text-aegis-text-muted mt-1">{t('taskRpg.subtitle')}</p>
        </div>
      </div>

      <div className="grid gap-3 min-h-0 flex-1 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        <SectionShell
          title={t('taskRpg.messages')}
          tone="accent"
          icon={<MailCheck size={16} style={{ color: themeHex('accent') }} />}
          count={messages.length}
        >
          <div className="flex flex-col min-h-0 flex-1 overflow-y-auto">
            <div className="p-3 border-b border-[rgb(var(--aegis-overlay)/0.06)] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-aegis-text-dim">{t('taskRpg.providersTitle')}</div>
              <button
                type="button"
                onClick={openProviderSetup}
                className="px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1"
                style={{
                  color: themeHex('accent'),
                  background: themeAlpha('accent', 0.14),
                  border: `1px solid ${themeAlpha('accent', 0.2)}`,
                }}
              >
                <Plus size={11} />
                {t('taskRpg.addProvider')}
              </button>
            </div>

            <div className="space-y-2">
              {providerCards.length === 0 && (
                <div
                  className="rounded-xl border p-3 text-[11px] text-aegis-text-dim"
                  style={{ background: 'rgb(var(--aegis-overlay) / 0.02)', borderColor: 'rgb(var(--aegis-overlay) / 0.08)' }}
                >
                  {t('taskRpg.noProviders')}
                </div>
              )}
              {providerCards.map((provider) => {
                const expanded = expandedProviders[provider.id] ?? false;
                const active = activeProviderId === provider.id;
                const stats = providerStats[provider.id] || { total: 0, unread: 0 };
                const setup = providerSetupState[provider.id];
                const setupRunning = setup?.phase === 'running';
                const providerNeedsGateway = !(provider.kind === 'email' && provider.ingestionMode === 'local-poll');
                const canSyncProvider = !isSyncing && !setupRunning && (!providerNeedsGateway || connected);
                return (
                  <div
                    key={provider.id}
                    className="rounded-xl border overflow-hidden"
                    style={{
                      background: 'rgb(var(--aegis-overlay) / 0.03)',
                      borderColor: active ? themeAlpha(provider.tone, 0.32) : 'rgb(var(--aegis-overlay) / 0.08)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedProviders((prev) => ({ ...prev, [provider.id]: !(prev[provider.id] ?? false) }))}
                      className="w-full px-3 py-2.5 text-left flex items-center gap-2.5"
                    >
                      <div
                        className="w-8 h-8 rounded-[10px] flex items-center justify-center text-[14px] shrink-0"
                        style={{
                          background: themeAlpha(provider.tone, 0.12),
                          border: `1px solid ${themeAlpha(provider.tone, 0.2)}`,
                        }}
                      >
                        {provider.emoji}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-semibold text-aegis-text">{provider.title}</span>
                          {active && (
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded-md font-semibold uppercase tracking-wide"
                              style={{
                                color: themeHex(provider.tone),
                                background: themeAlpha(provider.tone, 0.12),
                                border: `1px solid ${themeAlpha(provider.tone, 0.2)}`,
                              }}
                            >
                              {t('taskRpg.providerActive')}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-aegis-text-dim truncate">{provider.description}</div>
                      </div>

                      <div className="text-end shrink-0">
                        <div className="text-[12px] leading-none font-bold tabular-nums" style={{ color: themeHex(provider.tone) }}>
                          {stats.total}
                        </div>
                        <div className="text-[9px] text-aegis-text-dim uppercase tracking-wide">{t('taskRpg.providerItems')}</div>
                      </div>

                      <div className="text-aegis-text-dim shrink-0">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </div>
                    </button>

                    {expanded && (
                      <div className="px-3 pb-2.5 pt-2 border-t border-[rgb(var(--aegis-overlay)/0.08)] space-y-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setActiveProviderId(provider.id)}
                            className={clsx(
                              'px-2.5 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wide',
                              active ? 'cursor-default' : '',
                            )}
                            style={active
                              ? {
                                  color: themeHex(provider.tone),
                                  background: themeAlpha(provider.tone, 0.12),
                                  border: `1px solid ${themeAlpha(provider.tone, 0.2)}`,
                                }
                              : {
                                  color: 'rgb(var(--aegis-text-dim))',
                                  background: 'rgb(var(--aegis-overlay) / 0.04)',
                                  border: '1px solid rgb(var(--aegis-overlay) / 0.08)',
                                }
                            }
                          >
                            {active ? t('taskRpg.providerInUse') : t('taskRpg.providerUse')}
                          </button>
                          <button
                            type="button"
                            onClick={() => syncMessagesFromGateway(provider)}
                            disabled={!canSyncProvider}
                            className={clsx(
                              'ms-auto px-2.5 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5',
                              canSyncProvider
                                ? 'bg-aegis-accent/20 text-aegis-accent hover:bg-aegis-accent/30'
                                : 'bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-dim cursor-not-allowed',
                            )}
                          >
                            {isSyncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                            {providerNeedsGateway ? t('taskRpg.syncGateway') : t('taskRpg.syncProvider')}
                          </button>
                        </div>
                        <div className="text-[10px] text-aegis-text-dim flex items-center justify-between gap-2">
                          <span>
                            {providerNeedsGateway
                              ? (connected ? t('taskRpg.providerGatewayReady') : t('taskRpg.providerGatewayOffline'))
                              : t('taskRpg.providerLocalMode')}
                          </span>
                          <span className="tabular-nums">{t('taskRpg.providerUnread', { count: stats.unread })}</span>
                        </div>
                        {setup && (
                          <div
                            className="text-[10px] rounded-md px-2 py-1.5"
                            style={{
                              color: setup.phase === 'error' ? themeHex('danger') : setup.phase === 'ready' ? themeHex('success') : themeHex('warning'),
                              background: setup.phase === 'error'
                                ? themeAlpha('danger', 0.12)
                                : setup.phase === 'ready'
                                  ? themeAlpha('success', 0.12)
                                  : themeAlpha('warning', 0.12),
                              border: `1px solid ${setup.phase === 'error'
                                ? themeAlpha('danger', 0.22)
                                : setup.phase === 'ready'
                                  ? themeAlpha('success', 0.22)
                                  : themeAlpha('warning', 0.22)}`,
                            }}
                          >
                            {setup.message}
                          </div>
                        )}
                        {!!setup?.output && (
                          <pre className="text-[10px] text-aegis-text-dim bg-[rgb(var(--aegis-overlay)/0.04)] border border-[rgb(var(--aegis-overlay)/0.08)] rounded-md p-2 whitespace-pre-wrap break-words max-h-[120px] overflow-y-auto">
                            {setup.output.split(/\r?\n/).filter(Boolean).slice(-8).join('\n')}
                          </pre>
                        )}
                        {!!setup?.output && (
                          <button
                            type="button"
                            onClick={() => openSetupLogModal(provider.id)}
                            className="block text-left text-[10px] text-aegis-text-dim hover:text-aegis-text font-semibold uppercase tracking-wide"
                          >
                            {t('taskRpg.providerSetupLogView')}
                          </button>
                        )}
                        {setupRunning && (
                          <div className="text-[10px] text-aegis-text-dim">{t('taskRpg.syncWaitSetup')}</div>
                        )}
                        {active && syncResult && (
                          <div className="text-[10px] text-aegis-text-dim">{syncResult}</div>
                        )}
                        {provider.custom && provider.kind === 'email' && (
                          <div className="rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] p-2.5 space-y-1.5">
                            <div className="text-[10px] uppercase tracking-wide text-aegis-text-dim">{t('taskRpg.providerPushEndpoint')}</div>
                            <input
                              value={providerPushEndpointInputs[provider.id] ?? ''}
                              onChange={(e) => setProviderPushEndpointInputs((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                              placeholder={t('taskRpg.providerPushEndpointPlaceholder')}
                              className="w-full px-2.5 py-2 rounded-md text-[11px] bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text outline-none focus:border-aegis-accent/50"
                            />
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] text-aegis-text-dim">{t('taskRpg.providerPushEndpointHint')}</span>
                              <button
                                type="button"
                                onClick={() => saveProviderPushEndpoint(provider.id)}
                                className="px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wide bg-aegis-accent/20 text-aegis-accent hover:bg-aegis-accent/30"
                              >
                                {t('taskRpg.providerPushEndpointSave')}
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="flex flex-col items-start gap-1">
                          <button
                            type="button"
                            onClick={() => rerunProviderSetup(provider.id)}
                            disabled={setupRunning}
                            className={clsx(
                              'block text-left text-[10px] font-semibold uppercase tracking-wide',
                              setupRunning
                                ? 'text-aegis-text-dim cursor-not-allowed'
                                : 'text-aegis-accent hover:text-aegis-accent/80',
                            )}
                          >
                            {setupRunning ? t('taskRpg.providerSetupRunning') : t('taskRpg.providerSetupRetry')}
                          </button>
                          <button
                            type="button"
                            onClick={() => launchInteractiveSetupForProvider(provider.id)}
                            className="block text-left text-[10px] text-aegis-primary hover:text-aegis-primary/80 font-semibold uppercase tracking-wide"
                          >
                            {t('taskRpg.providerSetupConsole')}
                          </button>
                          {provider.custom && (
                            <button
                              type="button"
                              onClick={() => removeCustomProvider(provider.id)}
                              className="block text-left text-[10px] text-aegis-danger hover:text-aegis-danger/80 font-semibold uppercase tracking-wide"
                            >
                              {t('taskRpg.removeProvider')}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="text-[10px] text-aegis-text-dim">{isSyncing ? t('taskRpg.syncing') : (syncResult || t('taskRpg.syncHint'))}</div>
            </div>

            <form onSubmit={handleAddMessage} className="p-3 border-b border-[rgb(var(--aegis-overlay)/0.06)] space-y-2">
              <input
                value={messageTitle}
                onChange={(e) => setMessageTitle(e.target.value)}
                placeholder={t('taskRpg.messagePlaceholder')}
                className="w-full px-3 py-2 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text placeholder:text-aegis-text-dim outline-none focus:border-aegis-accent/50"
              />
              <div className="flex items-center gap-2">
                <div
                  className="flex-1 px-2.5 py-2 rounded-lg text-[11px] border text-aegis-text-dim flex items-center justify-between gap-2"
                  style={{ background: 'rgb(var(--aegis-overlay) / 0.03)', borderColor: 'rgb(var(--aegis-overlay) / 0.1)' }}
                >
                  <span className="uppercase tracking-wide">{t('taskRpg.providerLabel')}</span>
                  <span className="font-semibold text-aegis-text">
                    {activeProviderMeta?.title || t('taskRpg.providerNone')}
                  </span>
                </div>
                <button
                  type="submit"
                  disabled={!activeProviderMeta}
                  className={clsx(
                    'px-2.5 py-2 rounded-lg text-[12px] font-medium',
                    activeProviderMeta
                      ? 'bg-aegis-accent/20 text-aegis-accent hover:bg-aegis-accent/30'
                      : 'bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-dim cursor-not-allowed',
                  )}
                >
                  <Plus size={14} />
                </button>
              </div>
            </form>

            <div className="p-2.5 space-y-2">
              {messages.length === 0 && <p className="text-[12px] text-aegis-text-dim px-1">{t('taskRpg.emptyMessages')}</p>}
              {messages.map((item) => (
                <article
                  key={item.id}
                  className="relative rounded-xl border p-3 ps-4"
                  style={{ background: 'rgb(var(--aegis-overlay) / 0.025)', borderColor: 'rgb(var(--aegis-overlay) / 0.07)' }}
                >
                  <div className="absolute top-0 start-0 w-[3px] h-full rounded-s-xl" style={{ background: themeHex('accent') }} />
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[12px] text-aegis-text font-medium">{item.title}</div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteMessage(item)}
                      disabled={deletingMessageId === item.id}
                      className={clsx(
                        'text-aegis-text-dim hover:text-aegis-danger',
                        deletingMessageId === item.id && 'cursor-not-allowed opacity-70'
                      )}
                    >
                      {deletingMessageId === item.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </div>
                  <div className="text-[10px] text-aegis-text-dim mt-1">{channelLabels[item.channel]}</div>
                  {item.source === 'gateway' && <div className="text-[10px] mt-1" style={{ color: themeHex('accent') }}>{t('taskRpg.sourceGateway')}</div>}
                  {item.source === 'provider' && <div className="text-[10px] mt-1" style={{ color: themeHex('success') }}>{t('taskRpg.sourceProvider')}</div>}
                  <div className="flex items-center gap-2 mt-2">
                    <button type="button" onClick={() => scoreMessage(item.id, 'up')} className="px-2 py-1 rounded-md text-[10px]" style={{ background: themeAlpha('success', 0.14), color: themeHex('success') }}>
                      + {t('taskRpg.scoreUp')}
                    </button>
                    <button type="button" onClick={() => scoreMessage(item.id, 'down')} className="px-2 py-1 rounded-md text-[10px]" style={{ background: themeAlpha('danger', 0.14), color: themeHex('danger') }}>
                      - {t('taskRpg.scoreDown')}
                    </button>
                    <span className="ms-auto text-[10px] text-aegis-text-dim tabular-nums">{item.upCount} / {item.downCount}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </SectionShell>

        <SectionShell
          title={t('taskRpg.dailies')}
          tone="warning"
          icon={<Repeat2 size={16} style={{ color: themeHex('warning') }} />}
          count={dailies.length}
        >
          <form onSubmit={handleAddDaily} className="p-3 border-b border-[rgb(var(--aegis-overlay)/0.06)] flex items-center gap-2">
            <input
              value={dailyTitle}
              onChange={(e) => setDailyTitle(e.target.value)}
              placeholder={t('taskRpg.dailyPlaceholder')}
              className="flex-1 px-3 py-2 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text placeholder:text-aegis-text-dim outline-none focus:border-aegis-warning/50"
            />
            <button type="submit" className="px-2.5 py-2 rounded-lg text-[12px] font-medium bg-aegis-warning/20 text-aegis-warning hover:bg-aegis-warning/30">
              <Plus size={14} />
            </button>
          </form>

          <div className="p-2.5 space-y-2 overflow-y-auto flex-1 min-h-0">
            {dailies.length === 0 && <p className="text-[12px] text-aegis-text-dim px-1">{t('taskRpg.emptyDailies')}</p>}
            {dailies.map((item) => (
              <article
                key={item.id}
                className="relative rounded-xl border p-3 ps-4"
                style={{ background: 'rgb(var(--aegis-overlay) / 0.025)', borderColor: 'rgb(var(--aegis-overlay) / 0.07)' }}
              >
                <div className="absolute top-0 start-0 w-[3px] h-full rounded-s-xl" style={{ background: themeHex('warning') }} />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => toggleDaily(item.id, !item.done)} className="text-aegis-text-dim hover:text-aegis-success">
                    {item.done ? <CheckCircle2 size={16} className="text-aegis-success" /> : <Circle size={16} />}
                  </button>
                  <div className={clsx('text-[12px] text-aegis-text font-medium flex-1', item.done && 'line-through text-aegis-text-dim')}>
                    {item.title}
                  </div>
                  <button type="button" onClick={() => deleteDaily(item.id)} className="text-aegis-text-dim hover:text-aegis-danger">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="mt-2 text-[10px] text-aegis-text-dim flex items-center gap-1">
                  <Flame size={11} style={{ color: themeHex('warning') }} />
                  {t('taskRpg.streak')}: {item.streak}
                </div>
              </article>
            ))}
          </div>
        </SectionShell>

        <SectionShell
          title={t('taskRpg.todos')}
          tone="primary"
          icon={<SquareCheck size={16} style={{ color: themeHex('primary') }} />}
          count={todos.length}
        >
          <form onSubmit={handleAddTodo} className="p-3 border-b border-[rgb(var(--aegis-overlay)/0.06)] space-y-2">
            <input
              value={todoTitle}
              onChange={(e) => setTodoTitle(e.target.value)}
              placeholder={t('taskRpg.todoPlaceholder')}
              className="w-full px-3 py-2 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text placeholder:text-aegis-text-dim outline-none focus:border-aegis-primary/50"
            />
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={todoDueDate}
                onChange={(e) => setTodoDueDate(e.target.value)}
                className="flex-1 px-2.5 py-2 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text outline-none focus:border-aegis-primary/50"
              />
              <button type="submit" className="px-2.5 py-2 rounded-lg text-[12px] font-medium bg-aegis-primary/20 text-aegis-primary hover:bg-aegis-primary/30">
                <Plus size={14} />
              </button>
            </div>
          </form>

          <div className="p-2.5 space-y-2 overflow-y-auto flex-1 min-h-0">
            {todos.length === 0 && <p className="text-[12px] text-aegis-text-dim px-1">{t('taskRpg.emptyTodos')}</p>}
            {todos.map((item) => (
              <article
                key={item.id}
                className="relative rounded-xl border p-3 ps-4"
                style={{ background: 'rgb(var(--aegis-overlay) / 0.025)', borderColor: 'rgb(var(--aegis-overlay) / 0.07)' }}
              >
                <div className="absolute top-0 start-0 w-[3px] h-full rounded-s-xl" style={{ background: themeHex('primary') }} />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => toggleTodo(item.id, !item.completed)} className="text-aegis-text-dim hover:text-aegis-success">
                    {item.completed ? <CheckCircle2 size={16} className="text-aegis-success" /> : <Circle size={16} />}
                  </button>
                  <div className={clsx('text-[12px] text-aegis-text font-medium flex-1', item.completed && 'line-through text-aegis-text-dim')}>
                    {item.title}
                  </div>
                  <button type="button" onClick={() => deleteTodo(item.id)} className="text-aegis-text-dim hover:text-aegis-danger">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="mt-2 text-[10px] text-aegis-text-dim flex items-center gap-1">
                  <CalendarDays size={11} />
                  {t('taskRpg.dueDate')}: {formatDueDate(item.dueDate)}
                </div>
              </article>
            ))}
          </div>
        </SectionShell>

        <SectionShell
          title={t('taskRpg.rewards')}
          tone="success"
          icon={<Gift size={16} style={{ color: themeHex('success') }} />}
          count={rewards.length}
        >
          <form onSubmit={handleAddReward} className="p-3 border-b border-[rgb(var(--aegis-overlay)/0.06)] space-y-2">
            <input
              value={rewardTitle}
              onChange={(e) => setRewardTitle(e.target.value)}
              placeholder={t('taskRpg.rewardPlaceholder')}
              className="w-full px-3 py-2 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text placeholder:text-aegis-text-dim outline-none focus:border-aegis-success/50"
            />
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={rewardCost}
                onChange={(e) => setRewardCost(e.target.value)}
                className="flex-1 px-2.5 py-2 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text outline-none focus:border-aegis-success/50"
                placeholder={t('taskRpg.cost')}
              />
              <button type="submit" className="px-2.5 py-2 rounded-lg text-[12px] font-medium bg-aegis-success/20 text-aegis-success hover:bg-aegis-success/30">
                <Plus size={14} />
              </button>
            </div>
          </form>

          <div className="p-2.5 space-y-2 overflow-y-auto flex-1 min-h-0">
            {rewards.length === 0 && <p className="text-[12px] text-aegis-text-dim px-1">{t('taskRpg.emptyRewards')}</p>}
            {rewards.map((item) => {
              const affordable = points >= item.cost;
              return (
                <article
                  key={item.id}
                  className="relative rounded-xl border p-3 ps-4"
                  style={{ background: 'rgb(var(--aegis-overlay) / 0.025)', borderColor: 'rgb(var(--aegis-overlay) / 0.07)' }}
                >
                  <div className="absolute top-0 start-0 w-[3px] h-full rounded-s-xl" style={{ background: themeHex('success') }} />
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[12px] text-aegis-text font-medium">{item.title}</div>
                      <div className="text-[10px] mt-1 flex items-center gap-1" style={{ color: themeHex('warning') }}>
                        <Coins size={11} />
                        {item.cost}
                      </div>
                    </div>
                    <button type="button" onClick={() => deleteReward(item.id)} className="text-aegis-text-dim hover:text-aegis-danger">
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-aegis-text-dim">{t('taskRpg.timesRedeemed')}: {item.redeemedCount}</span>
                    <button
                      type="button"
                      onClick={() => redeemReward(item.id)}
                      disabled={!affordable}
                      className={clsx(
                        'px-2 py-1 rounded-md text-[10px] font-medium',
                        affordable
                          ? 'bg-aegis-success/20 text-aegis-success hover:bg-aegis-success/30'
                          : 'bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-dim cursor-not-allowed',
                      )}
                    >
                      {t('taskRpg.redeem')}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </SectionShell>
      </div>

      {providerModalOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4"
          onClick={() => setProviderModalOpen(false)}
        >
          <div
            className="w-full max-w-[760px] rounded-2xl border p-4 md:p-5 max-h-[90vh] overflow-y-auto"
            style={{ background: 'var(--aegis-bg)', borderColor: 'rgb(var(--aegis-overlay) / 0.08)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold text-aegis-text">{t('taskRpg.addProviderTitle')}</h3>
                <p className="text-[11px] text-aegis-text-dim mt-1">{t('taskRpg.providerModalSubtitle')}</p>
              </div>
              <button
                type="button"
                onClick={() => setProviderModalOpen(false)}
                className="px-2 py-1 rounded-md text-[11px] text-aegis-text-dim hover:text-aegis-text"
              >
                {t('taskRpg.providerClose')}
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wide text-aegis-text-dim">{t('taskRpg.providerType')}</div>
                <div className="flex flex-wrap gap-2">
                  {(['email', 'slack', 'sms', 'other'] as ProviderKind[]).map((kind) => {
                    const active = providerKindDraft === kind;
                    const tone = providerTone(kind);
                    return (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => setProviderKind(kind)}
                        className="px-3 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wide"
                        style={active
                          ? {
                              color: themeHex(tone),
                              background: themeAlpha(tone, 0.14),
                              border: `1px solid ${themeAlpha(tone, 0.24)}`,
                            }
                          : {
                              color: 'rgb(var(--aegis-text-dim))',
                              background: 'rgb(var(--aegis-overlay) / 0.04)',
                              border: '1px solid rgb(var(--aegis-overlay) / 0.08)',
                            }
                        }
                      >
                        {defaultProviderName(kind)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-aegis-text-dim">{t('taskRpg.providerName')}</div>
                  <input
                    value={providerNameDraft}
                    onChange={(e) => setProviderNameDraft(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text outline-none focus:border-aegis-accent/50"
                  />
                </label>

                <label className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-aegis-text-dim">{t('taskRpg.providerAccount')}</div>
                  <input
                    value={providerAccountDraft}
                    onChange={(e) => setProviderAccountDraft(e.target.value)}
                    placeholder={t('taskRpg.providerAccountPlaceholder')}
                    className="w-full px-3 py-2 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text outline-none focus:border-aegis-accent/50"
                  />
                </label>

                {providerKindDraft === 'email' && (
                  <label className="space-y-1.5 md:col-span-2">
                    <div className="text-[10px] uppercase tracking-wide text-aegis-text-dim">{t('taskRpg.providerProjectId')}</div>
                    <input
                      value={providerProjectIdDraft}
                      onChange={(e) => setProviderProjectIdDraft(e.target.value)}
                      placeholder={t('taskRpg.providerProjectPlaceholder')}
                      className="w-full px-3 py-2 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text outline-none focus:border-aegis-accent/50"
                    />
                  </label>
                )}
                {providerKindDraft === 'email' && (
                  <label className="space-y-1.5 md:col-span-2">
                    <div className="text-[10px] uppercase tracking-wide text-aegis-text-dim">{t('taskRpg.providerPushEndpoint')}</div>
                    <input
                      value={providerPushEndpointDraft}
                      onChange={(e) => setProviderPushEndpointDraft(e.target.value)}
                      placeholder={t('taskRpg.providerPushEndpointPlaceholder')}
                      className="w-full px-3 py-2 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text outline-none focus:border-aegis-accent/50"
                    />
                  </label>
                )}

                <label className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-aegis-text-dim">{t('taskRpg.providerHookToken')}</div>
                  <input
                    value={providerHookTokenDraft}
                    onChange={(e) => setProviderHookTokenDraft(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text outline-none focus:border-aegis-accent/50"
                  />
                </label>

                <label className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-aegis-text-dim">{t('taskRpg.providerHookPath')}</div>
                  <input
                    value={providerHookPathDraft}
                    onChange={(e) => setProviderHookPathDraft(slugify(e.target.value))}
                    placeholder="mail-provider"
                    className="w-full px-3 py-2 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text outline-none focus:border-aegis-accent/50"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] overflow-hidden">
                <div className="px-3 py-2 border-b border-[rgb(var(--aegis-overlay)/0.08)] text-[11px] font-semibold text-aegis-text flex items-center justify-between gap-2">
                  <span>{t('taskRpg.providerGeneratedConfig')}</span>
                  <button
                    type="button"
                    onClick={() => copyText('provider-config', generatedConfigSnippet)}
                    className="text-[10px] px-2 py-1 rounded-md border border-[rgb(var(--aegis-overlay)/0.12)] text-aegis-text-dim hover:text-aegis-text flex items-center gap-1"
                  >
                    {copiedItem === 'provider-config' ? <Check size={11} /> : <Copy size={11} />}
                    {copiedItem === 'provider-config' ? t('taskRpg.providerCopied') : t('taskRpg.providerCopy')}
                  </button>
                </div>
                <pre className="p-3 text-[11px] leading-relaxed text-aegis-text-muted overflow-x-auto whitespace-pre-wrap break-words">{generatedConfigSnippet}</pre>
              </div>

              <div className="rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] overflow-hidden">
                <div className="px-3 py-2 border-b border-[rgb(var(--aegis-overlay)/0.08)] text-[11px] font-semibold text-aegis-text flex items-center justify-between gap-2">
                  <span>{t('taskRpg.providerGeneratedCommands')}</span>
                  <button
                    type="button"
                    onClick={() => copyText('provider-commands', generatedCommands)}
                    className="text-[10px] px-2 py-1 rounded-md border border-[rgb(var(--aegis-overlay)/0.12)] text-aegis-text-dim hover:text-aegis-text flex items-center gap-1"
                  >
                    {copiedItem === 'provider-commands' ? <Check size={11} /> : <Copy size={11} />}
                    {copiedItem === 'provider-commands' ? t('taskRpg.providerCopied') : t('taskRpg.providerCopy')}
                  </button>
                </div>
                <pre className="p-3 text-[11px] leading-relaxed text-aegis-text-muted overflow-x-auto whitespace-pre-wrap break-words">{generatedCommands}</pre>
              </div>

              <div className="rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] p-3 text-[11px] text-aegis-text-muted space-y-1.5">
                <div className="font-semibold text-aegis-text">{t('taskRpg.providerHowItWorks')}</div>
                <p>{t('taskRpg.providerManualHow1')}</p>
                <p>{t('taskRpg.providerManualHow2')}</p>
                <p>{t('taskRpg.providerManualHow3')}</p>
              </div>

              <div className="rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] p-3 flex items-center justify-between gap-3">
                <div className="text-[11px] text-aegis-text-dim">{t('taskRpg.providerConsoleHint')}</div>
                <button
                  type="button"
                  onClick={() => { void launchInteractiveSetupForDraft(); }}
                  disabled={!providerNameDraft.trim() || !providerAccountDraft.trim() || setupConsoleBooting}
                  className={clsx(
                    'px-2.5 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wide',
                    (!providerNameDraft.trim() || !providerAccountDraft.trim() || setupConsoleBooting)
                      ? 'bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-dim cursor-not-allowed'
                      : 'bg-aegis-primary/20 text-aegis-primary hover:bg-aegis-primary/30',
                  )}
                >
                  {t('taskRpg.providerSetupConsole')}
                </button>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setProviderModalOpen(false)}
                className="px-3 py-2 rounded-lg text-[12px] text-aegis-text-dim hover:text-aegis-text"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={saveProviderProfile}
                disabled={!providerNameDraft.trim() || !providerAccountDraft.trim()}
                className="px-3 py-2 rounded-lg text-[12px] font-semibold"
                style={{
                  color: !providerNameDraft.trim() || !providerAccountDraft.trim() ? 'rgb(var(--aegis-text-dim))' : themeHex('accent'),
                  background: !providerNameDraft.trim() || !providerAccountDraft.trim() ? 'rgb(var(--aegis-overlay) / 0.06)' : themeAlpha('accent', 0.16),
                }}
              >
                {t('taskRpg.providerCreate')}
              </button>
            </div>
          </div>
        </div>
      )}

      {setupConsoleOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
          onClick={() => { void closeSetupConsole(); }}
        >
          <div
            className="w-full max-w-[980px] rounded-2xl border p-4 md:p-5 max-h-[90vh] flex flex-col"
            style={{ background: 'var(--aegis-bg)', borderColor: 'rgb(var(--aegis-overlay) / 0.08)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-[15px] font-semibold text-aegis-text">{t('taskRpg.providerSetupConsoleTitle')}</h3>
                <p className="text-[11px] text-aegis-text-dim mt-1">{setupConsoleTitle || t('taskRpg.providerLabel')}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { void interruptSetupConsole(); }}
                  disabled={!setupConsoleRunning}
                  className={clsx(
                    'px-2.5 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wide',
                    setupConsoleRunning
                      ? 'bg-aegis-warning/20 text-aegis-warning hover:bg-aegis-warning/30'
                      : 'bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-dim cursor-not-allowed',
                  )}
                >
                  {t('taskRpg.providerSetupConsoleStop')}
                </button>
                <button
                  type="button"
                  onClick={() => { void closeSetupConsole(); }}
                  className="px-2.5 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wide bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-dim hover:text-aegis-text"
                >
                  {t('taskRpg.providerSetupConsoleClose')}
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] overflow-hidden">
              <pre className="h-full max-h-[52vh] overflow-y-auto p-3 text-[11px] leading-relaxed text-aegis-text-muted whitespace-pre-wrap break-words bg-[rgb(var(--aegis-overlay)/0.03)]">
                {setupConsoleOutput || t('taskRpg.providerSetupConsoleStarting')}
              </pre>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                value={setupConsoleInput}
                onChange={(e) => setSetupConsoleInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void sendSetupConsoleInput(); } }}
                placeholder={t('taskRpg.providerSetupConsoleInput')}
                className="flex-1 px-3 py-2 rounded-lg text-[12px] bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text outline-none focus:border-aegis-primary/50"
              />
              <button
                type="button"
                onClick={() => { void sendSetupConsoleInput(); }}
                disabled={!setupConsoleSessionId || !setupConsoleInput.trim() || !setupConsoleRunning}
                className={clsx(
                  'px-3 py-2 rounded-lg text-[12px] font-semibold',
                  (setupConsoleSessionId && setupConsoleInput.trim() && setupConsoleRunning)
                    ? 'bg-aegis-primary/20 text-aegis-primary hover:bg-aegis-primary/30'
                    : 'bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-dim cursor-not-allowed',
                )}
              >
                {t('taskRpg.providerSetupConsoleSend')}
              </button>
            </div>
          </div>
        </div>
      )}

      {setupLogModalProviderId && (
        <div
          className="fixed inset-0 z-[82] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
          onClick={closeSetupLogModal}
        >
          <div
            className="w-full max-w-[980px] rounded-2xl border p-4 md:p-5 max-h-[90vh] flex flex-col"
            style={{ background: 'var(--aegis-bg)', borderColor: 'rgb(var(--aegis-overlay) / 0.08)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-[15px] font-semibold text-aegis-text">{t('taskRpg.providerSetupLogTitle')}</h3>
                <p className="text-[11px] text-aegis-text-dim mt-1">
                  {providerCards.find((provider) => provider.id === setupLogModalProviderId)?.title || t('taskRpg.providerLabel')}
                </p>
              </div>
              <button
                type="button"
                onClick={closeSetupLogModal}
                className="px-2.5 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wide text-aegis-text-dim hover:text-aegis-text border border-[rgb(var(--aegis-overlay)/0.12)]"
              >
                {t('taskRpg.providerSetupLogClose')}
              </button>
            </div>

            <pre className="flex-1 min-h-0 text-[11px] leading-relaxed text-aegis-text-muted overflow-auto whitespace-pre-wrap break-words bg-[rgb(var(--aegis-overlay)/0.04)] border border-[rgb(var(--aegis-overlay)/0.08)] rounded-md p-3">
              {providerSetupState[setupLogModalProviderId]?.output?.trim() || t('taskRpg.providerSetupLogEmpty')}
            </pre>
          </div>
        </div>
      )}
    </PageTransition>
  );
}
