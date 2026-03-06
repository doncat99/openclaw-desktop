import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  Activity,
  Bot,
  Copy,
  Check,
  ExternalLink,
  Info,
  Loader2,
  MessageCircle,
  Network,
  RefreshCw,
  RotateCcw,
  Settings2,
  Send,
  ShieldCheck,
  Users2,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { PageTransition } from '@/components/shared/PageTransition';
import { GlassCard } from '@/components/shared/GlassCard';
import { StatusDot } from '@/components/shared/StatusDot';
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';
import { refreshAll, refreshGroup, useGatewayDataStore } from '@/stores/gatewayDataStore';
import {
  getTeamDefinitions,
  getTeamInteractions,
  isProvisionable,
  resolveTeamMembers,
  TeamInteractionDefinition,
  TeamMemberDefinition,
} from '@/config/agentTeamRegistry';
import {
  TeamAgentProfile,
  TeamEvolutionAnalysis,
  TeamEvolutionProposal,
  TeamEvolutionProposalDraft,
  useTeamStudioStore,
} from '@/stores/teamStudioStore';
import { themeAlpha, themeHex } from '@/utils/theme-colors';

interface TeamChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

type DelegationRunStatus = 'running' | 'completed' | 'failed' | 'timed_out' | 'blocked';

interface DelegationRun {
  key: string;
  intentKey: string;
  runId: string;
  agentId: string;
  agentTitle: string;
  childSessionKey: string;
  task: string;
  label: string;
  spawnedAt: string;
  completedAt?: string;
  status: DelegationRunStatus;
  timeoutSeconds: number;
  resultSnippet?: string;
  errorText?: string;
  runtimeSeconds?: number;
}

interface RoleDraft {
  role: string;
  responsibilities: string;
  model: string;
  skills: string[];
  outputs: string;
}

interface HubSkillCandidate {
  slug: string;
  name: string;
  summary: string;
  owner: string;
  installs: number;
  stars: number;
}

interface HubSkillDetail extends HubSkillCandidate {
  readme: string;
  requirements: string[];
}

interface SkillQualification {
  slug: string;
  score: number;
  qualified: boolean;
  roleCoverage: number;
  responsibilityCoverage: number;
  outputCoverage: number;
  reason: string;
}

interface ModelOption {
  id: string;
  label: string;
  provider: string;
}

interface SaveProfileResult {
  ok: boolean;
  configApplied: boolean;
  message: string;
  error?: string;
}

interface AutoRetryMetaEntry {
  attempts: number;
  lastRetryAt?: number;
  finalTimeout?: boolean;
}

const CLAWHUB_API = 'https://clawhub.ai/api/v1';
const hubSkillSearchCache = new Map<string, HubSkillCandidate[]>();
const hubSkillDetailCache = new Map<string, HubSkillDetail>();
const AUTO_RETRY_COOLDOWN_MS = 12_000;

const STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'that', 'this', 'into', 'your', 'you', 'are', 'not', 'all',
  'will', 'have', 'has', 'had', 'can', 'should', 'must', 'use', 'using', 'per', 'via', 'to', 'of', 'on',
  'in', 'as', 'an', 'a', 'be', 'or', 'by', 'at', 'it', 'its', 'their', 'them', 'our', 'we', 'is',
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toEpochMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = value.trim();
    if (/^\d{10,}$/.test(numeric)) {
      const parsedNum = Number(numeric);
      if (Number.isFinite(parsedNum)) return parsedNum;
    }
    const ts = Date.parse(value);
    if (!Number.isNaN(ts)) return ts;
  }
  return 0;
}

function timeAgo(value: unknown): string {
  const ts = toEpochMs(value);
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, idx) => item === b[idx]);
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clipText(value: string, max = 260): string {
  const clean = compactText(value);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function tokenizeTask(value: string): Set<string> {
  const tokens = compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

function taskSimilarity(a: string, b: string): number {
  const as = tokenizeTask(a);
  const bs = tokenizeTask(b);
  if (as.size === 0 || bs.size === 0) return 0;
  let common = 0;
  as.forEach((token) => {
    if (bs.has(token)) common += 1;
  });
  const denom = Math.min(as.size, bs.size);
  return denom > 0 ? common / denom : 0;
}

function modelDisplayName(modelId: string): string {
  const clean = compactText(modelId);
  if (!clean) return '';
  const tail = clean.includes('/') ? clean.split('/').pop() || clean : clean;
  return tail.replace(/[-_]+/g, ' ');
}

function normalizeOpenRouterModelRef(value: string): string {
  const clean = compactText(value);
  if (!clean) return '';
  if (clean.startsWith('openrouter/')) return clean;
  // OpenRouter catalog ids look like "openai/gpt-4.1-mini"; gateway expects "openrouter/<id>".
  return `openrouter/${clean}`;
}

function parseOpenRouterModels(payload: any): ModelOption[] {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const out: ModelOption[] = rows
    .map((row: any) => {
      const rawId = String(row?.id || '').trim();
      if (!rawId) return null;
      const id = normalizeOpenRouterModelRef(rawId);
      const name = String(row?.name || '').trim();
      const label = name ? `${name} — ${rawId}` : `${modelDisplayName(rawId)} — ${rawId}`;
      const provider = rawId.includes('/') ? String(rawId.split('/')[0] || 'unknown').toLowerCase() : 'unknown';
      return { id, label, provider } as ModelOption;
    })
    .filter((item: ModelOption | null): item is ModelOption => !!item);
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function parseGatewayModels(payload: any): ModelOption[] {
  const models = payload?.models;
  const out: ModelOption[] = [];
  if (Array.isArray(models)) {
    for (const row of models) {
      const id = String(row?.id || row?.model || '').trim();
      if (!id) continue;
      if (id === 'openrouter/auto') continue;
      const alias = String(row?.alias || '').trim();
      const provider = id.includes('/') ? String(id.split('/')[0] || 'unknown').toLowerCase() : 'unknown';
      out.push({ id, label: alias ? `${alias} — ${id}` : `${modelDisplayName(id)} — ${id}`, provider });
    }
  } else if (models && typeof models === 'object') {
    for (const [id, row] of Object.entries(models as Record<string, any>)) {
      const clean = String(id || '').trim();
      if (!clean) continue;
      if (clean === 'openrouter/auto') continue;
      const alias = String(row?.alias || '').trim();
      const provider = clean.includes('/') ? String(clean.split('/')[0] || 'unknown').toLowerCase() : 'unknown';
      out.push({ id: clean, label: alias ? `${alias} — ${clean}` : `${modelDisplayName(clean)} — ${clean}`, provider });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

async function searchClawHubSkills(query: string): Promise<HubSkillCandidate[]> {
  const q = compactText(query);
  if (!q) return [];
  const cached = hubSkillSearchCache.get(q.toLowerCase());
  if (cached) return cached;
  try {
    const response = await fetch(`${CLAWHUB_API}/search?q=${encodeURIComponent(q)}`);
    if (!response.ok) return [];
    const payload = await response.json();
    const entries = Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.skills)
        ? payload.skills
        : [];
    const mapped = entries
      .map((raw: any) => {
        const stats = raw?.stats || {};
        const slug = String(raw?.slug || raw?.name || '').trim();
        if (!slug) return null;
        return {
          slug,
          name: String(raw?.displayName || raw?.name || slug),
          summary: String(raw?.summary || raw?.description || ''),
          owner: String(raw?.owner?.displayName || raw?.owner?.handle || raw?.author || ''),
          installs: Number(stats?.installsAllTime ?? stats?.installsCurrent ?? raw?.installs ?? 0),
          stars: Number(stats?.stars ?? raw?.stars ?? 0),
        } as HubSkillCandidate;
      })
      .filter((item: HubSkillCandidate | null): item is HubSkillCandidate => !!item)
      .slice(0, 12);
    hubSkillSearchCache.set(q.toLowerCase(), mapped);
    return mapped;
  } catch {
    return [];
  }
}

async function fetchClawHubSkillDetail(slug: string): Promise<HubSkillDetail | null> {
  const clean = compactText(slug);
  if (!clean) return null;
  const cacheKey = clean.toLowerCase();
  const cached = hubSkillDetailCache.get(cacheKey);
  if (cached) return cached;
  try {
    const response = await fetch(`${CLAWHUB_API}/skills/${encodeURIComponent(clean)}`);
    if (!response.ok) return null;
    const payload = await response.json();
    const skill = payload?.skill || payload;
    const stats = skill?.stats || {};
    const resolvedSlug = String(skill?.slug || clean).trim();
    const detail: HubSkillDetail = {
      slug: resolvedSlug,
      name: String(skill?.displayName || skill?.name || resolvedSlug),
      summary: String(skill?.summary || skill?.description || ''),
      owner: String(skill?.owner?.displayName || skill?.owner?.handle || skill?.author || ''),
      installs: Number(stats?.installsAllTime ?? stats?.installsCurrent ?? skill?.installs ?? 0),
      stars: Number(stats?.stars ?? skill?.stars ?? 0),
      readme: String(skill?.readme || ''),
      requirements: [
        ...(Array.isArray(skill?.requirements?.env) ? skill.requirements.env : []),
        ...(Array.isArray(skill?.requirements?.bin) ? skill.requirements.bin : []),
      ].map((item: any) => String(item).trim()).filter(Boolean),
    };
    hubSkillDetailCache.set(cacheKey, detail);
    return detail;
  } catch {
    return null;
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\\s]/g, ' ')
    .split(/\\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function termCoverage(terms: string[], haystack: string): number {
  if (terms.length === 0) return 0;
  const text = haystack.toLowerCase();
  const hitCount = terms.filter((term) => text.includes(term)).length;
  return hitCount / terms.length;
}

function lineCoverage(lines: string[], haystack: string): number {
  if (lines.length === 0) return 0;
  let hit = 0;
  for (const line of lines) {
    const terms = tokenize(line).slice(0, 10);
    if (terms.length === 0) continue;
    const matched = terms.some((term) => haystack.includes(term));
    if (matched) hit += 1;
  }
  return hit / lines.length;
}

function buildIntentQueries(draft: RoleDraft): string[] {
  const role = compactText(draft.role);
  const responsibilities = splitLines(draft.responsibilities).slice(0, 4);
  const outputs = splitLines(draft.outputs).slice(0, 3);
  const q = new Set<string>();

  if (role) q.add(role);
  responsibilities.forEach((line) => {
    q.add(`${role} ${compactText(line)}`.trim());
    q.add(compactText(line));
  });
  outputs.forEach((line) => {
    q.add(`${role} ${compactText(line)}`.trim());
  });

  const combined = [role, ...responsibilities.slice(0, 2), ...outputs.slice(0, 1)]
    .map((part) => compactText(part))
    .filter(Boolean)
    .join(' ');
  if (combined) q.add(combined);

  return Array.from(q).filter((item) => item.length >= 3);
}

function qualifySkill(detail: HubSkillDetail, draft: RoleDraft): SkillQualification {
  const roleTerms = tokenize(draft.role).slice(0, 12);
  const responsibilities = splitLines(draft.responsibilities);
  const outputs = splitLines(draft.outputs);
  const fullText = [
    detail.slug,
    detail.name,
    detail.summary,
    detail.readme.slice(0, 4000),
    detail.requirements.join(' '),
  ]
    .join(' ')
    .toLowerCase();

  const roleCoverage = termCoverage(roleTerms, fullText);
  const responsibilityCoverage = lineCoverage(responsibilities, fullText);
  const outputCoverage = lineCoverage(outputs, fullText);

  const popularityBonus = Math.min(1.5, Math.log10(detail.installs + 1) * 0.35 + Math.log10(detail.stars + 1) * 0.45);
  const score = roleCoverage * 4.2 + responsibilityCoverage * 4.8 + outputCoverage * 3.2 + popularityBonus;
  const qualified = score >= 3.2 && (responsibilityCoverage >= 0.34 || outputCoverage >= 0.34 || roleCoverage >= 0.45);

  const reason = [
    `role ${(roleCoverage * 100).toFixed(0)}%`,
    `responsibility ${(responsibilityCoverage * 100).toFixed(0)}%`,
    `output ${(outputCoverage * 100).toFixed(0)}%`,
    `score ${score.toFixed(2)}`,
  ].join(' · ');

  return {
    slug: detail.slug,
    score,
    qualified,
    roleCoverage,
    responsibilityCoverage,
    outputCoverage,
    reason,
  };
}

async function findQualifiedSkills(
  draft: RoleDraft,
  existingSkills: string[],
): Promise<{
  evaluations: Map<string, SkillQualification>;
  orderedQualified: string[];
  selectedSkills: string[];
  rounds: number;
}> {
  const queryPool = buildIntentQueries(draft);
  const evaluations = new Map<string, SkillQualification>();
  const detailBySlug = new Map<string, HubSkillDetail>();
  const selected = [...existingSkills];
  const selectedSet = new Set(selected.map((item) => item.toLowerCase()));
  const targetCount = Math.min(8, Math.max(3, selected.length));

  let rounds = 0;
  let startIndex = 0;

  while (rounds < 3) {
    rounds += 1;
    const activeQueries = queryPool.slice(startIndex, startIndex + 4);
    startIndex += activeQueries.length;
    if (activeQueries.length === 0) break;

    const resultsList = await Promise.all(activeQueries.map((query) => searchClawHubSkills(query)));
    const slugs = new Set<string>();
    existingSkills.forEach((skill) => slugs.add(skill));
    resultsList.forEach((list) => list.forEach((entry) => slugs.add(entry.slug)));

    const details = await Promise.all(Array.from(slugs).map((slug) => fetchClawHubSkillDetail(slug)));
    details.forEach((detail) => {
      if (!detail) return;
      detailBySlug.set(detail.slug, detail);
      evaluations.set(detail.slug, qualifySkill(detail, draft));
    });

    const qualifiedOrdered = Array.from(evaluations.values())
      .filter((item) => item.qualified)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.slug);

    const selectedQualified = selected.filter((slug) => evaluations.get(slug)?.qualified);
    if (selectedQualified.length >= Math.min(selected.length, 2) && selectedQualified.length > 0) {
      const fill = qualifiedOrdered.filter((slug) => !selectedSet.has(slug.toLowerCase()));
      const merged = [...selectedQualified];
      for (const slug of fill) {
        if (merged.length >= targetCount) break;
        merged.push(slug);
      }
      return {
        evaluations,
        orderedQualified: qualifiedOrdered,
        selectedSkills: merged,
        rounds,
      };
    }

    if (qualifiedOrdered.length >= targetCount) {
      return {
        evaluations,
        orderedQualified: qualifiedOrdered,
        selectedSkills: qualifiedOrdered.slice(0, targetCount),
        rounds,
      };
    }
  }

  const ranked = Array.from(evaluations.values()).sort((a, b) => b.score - a.score);
  const fallback = ranked.slice(0, Math.min(targetCount, Math.max(2, ranked.length))).map((item) => item.slug);
  return {
    evaluations,
    orderedQualified: ranked.filter((item) => item.qualified).map((item) => item.slug),
    selectedSkills: fallback,
    rounds: Math.max(1, rounds),
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function getSessionAgentId(session: any): string {
  const direct = typeof session?.agentId === 'string' ? session.agentId.trim() : '';
  if (direct) return direct;
  const key = typeof session?.key === 'string' ? session.key : '';
  const parts = key.split(':');
  return parts[1] || '';
}

function inferCronAgentId(job: any): string {
  const direct = typeof job?.agentId === 'string' ? job.agentId.trim() : '';
  if (direct) return direct;
  const payload = job?.payload || {};
  const fromPayload = typeof payload?.agentId === 'string' ? payload.agentId.trim() : '';
  if (fromPayload) return fromPayload;
  const fromParams = typeof payload?.params?.agentId === 'string' ? payload.params.agentId.trim() : '';
  if (fromParams) return fromParams;
  return 'main';
}

function buildSessionKey(agentId: string): string {
  const clean = agentId.trim() || 'main';
  return `agent:${clean}:team-studio`;
}

function extractText(value: any): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value
      .map((item: any) => {
        if (typeof item === 'string') return item;
        if (item?.type === 'text' && typeof item.text === 'string') return item.text;
        if (typeof item?.text === 'string') return item.text;
        return '';
      })
      .join('');
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    if (Array.isArray(value.content)) return extractText(value.content);
  }
  return String(value);
}

function parseHistory(raw: any[]): TeamChatMessage[] {
  return raw
    .map((item: any) => {
      const role = typeof item?.role === 'string' ? item.role : '';
      if (role !== 'user' && role !== 'assistant' && role !== 'system') return null;
      const content = extractText(item?.content).trim();
      if (!content) return null;
      if (role === 'system' && !/compact/i.test(content)) return null;
      if (/^Reasoning:/i.test(content)) return null;
      return {
        id: String(item?.id || item?.messageId || `${role}-${Math.random().toString(36).slice(2)}`),
        role,
        content,
        timestamp: String(item?.timestamp || item?.createdAt || new Date().toISOString()),
      } as TeamChatMessage;
    })
    .filter(Boolean) as TeamChatMessage[];
}

function inferAgentIdFromSubagentSessionKey(sessionKey: string): string {
  const match = sessionKey.match(/^agent:([^:]+):subagent:/i);
  return match?.[1]?.trim() || '';
}

function parseSubagentCompletionEvent(text: string): {
  sessionKey: string;
  status: string;
  task: string;
  result: string;
  runtimeSeconds?: number;
} | null {
  if (!text || !text.includes('[Internal task completion event]')) return null;
  if (!/source:\s*subagent/i.test(text)) return null;

  const sessionKey = text.match(/session_key:\s*([^\n\r]+)/i)?.[1]?.trim() || '';
  if (!sessionKey) return null;

  const status = text.match(/status:\s*([^\n\r]+)/i)?.[1]?.trim() || '';
  const task = text.match(/task:\s*([^\n\r]+)/i)?.[1]?.trim() || '';
  const result = (
    text.match(/Result\s*\(untrusted content[\s\S]*?\):\s*([\s\S]*?)(?:\n\nStats:|\nStats:|$)/i)?.[1] || ''
  ).trim();
  const runtimeSeconds = Number(text.match(/runtime\s+(\d+)s/i)?.[1] || 0);

  return {
    sessionKey,
    status,
    task,
    result,
    runtimeSeconds: Number.isFinite(runtimeSeconds) && runtimeSeconds > 0 ? runtimeSeconds : undefined,
  };
}

function buildDelegationIntentKey(agentId: string, task: string): string {
  const agent = compactText(agentId).toLowerCase();
  const normalizedTask = compactText(task).toLowerCase().slice(0, 900);
  return `${agent}::${normalizedTask}`;
}

function delegationStatusMeta(status: DelegationRunStatus): { label: string; className: string } {
  switch (status) {
    case 'completed':
      return { label: 'COMPLETED', className: 'text-aegis-success border-aegis-success/25 bg-aegis-success/10' };
    case 'blocked':
      return { label: 'BLOCKED', className: 'text-aegis-warning border-aegis-warning/25 bg-aegis-warning/10' };
    case 'failed':
      return { label: 'FAILED', className: 'text-aegis-danger border-aegis-danger/25 bg-aegis-danger/10' };
    case 'timed_out':
      return { label: 'TIMEOUT', className: 'text-aegis-warning border-aegis-warning/25 bg-aegis-warning/10' };
    default:
      return { label: 'RUNNING', className: 'text-aegis-primary border-aegis-primary/25 bg-aegis-primary/10' };
  }
}

function deriveDelegationRuns(
  rawMessages: any[],
  definitions: TeamMemberDefinition[],
  historyFresh = true,
): DelegationRun[] {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) return [];

  const agentTitleById = new Map<string, string>();
  definitions.forEach((def) => {
    agentTitleById.set(def.openclawAgentId, def.title);
  });

  const spawnCallsById = new Map<string, {
    agentId: string;
    task: string;
    label: string;
    runTimeoutSeconds: number;
  }>();

  const runsByKey = new Map<string, DelegationRun>();

  rawMessages.forEach((message: any, index: number) => {
    const ts = String(message?.timestamp || new Date().toISOString());
    const role = String(message?.role || '').toLowerCase();

    if (role === 'assistant' && Array.isArray(message?.content)) {
      message.content.forEach((part: any, partIndex: number) => {
        if (String(part?.type || '') !== 'toolCall') return;
        if (String(part?.name || '') !== 'sessions_spawn') return;

        const callId = String(part?.id || `sessions-spawn-${index}-${partIndex}`);
        let args: any = {};
        if (part?.arguments && typeof part.arguments === 'object') {
          args = part.arguments;
        } else if (typeof part?.arguments === 'string') {
          args = parseJsonObject(part.arguments) || {};
        }

        const timeoutRaw = Number(args?.runTimeoutSeconds);
        spawnCallsById.set(callId, {
          agentId: String(args?.agentId || '').trim(),
          task: compactText(String(args?.task || '')),
          label: compactText(String(args?.label || '')),
          runTimeoutSeconds: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 300,
        });
      });
      return;
    }

    if (role === 'toolresult' && String(message?.toolName || '') === 'sessions_spawn') {
      const callId = String(message?.toolCallId || '');
      const callInfo = spawnCallsById.get(callId);
      const payload = parseJsonObject(extractText(message?.content).trim()) || {};
      const accepted = String(payload?.status || '').toLowerCase() === 'accepted';

      if (accepted) {
        const childSessionKey = String(payload?.childSessionKey || '').trim();
        const runId = String(payload?.runId || '').trim() || `run-${callId || index}`;
        const agentId = inferAgentIdFromSubagentSessionKey(childSessionKey) || callInfo?.agentId || '';
        const key = runId || childSessionKey || `spawn-${index}`;
        const existing = runsByKey.get(key);
        const task = callInfo?.task || existing?.task || '';
        const intentKey = buildDelegationIntentKey(agentId, task);
        runsByKey.set(key, {
          key,
          intentKey: existing?.intentKey || intentKey,
          runId,
          agentId,
          agentTitle: agentTitleById.get(agentId) || agentId || 'Unknown agent',
          childSessionKey,
          task,
          label: callInfo?.label || existing?.label || '',
          spawnedAt: existing?.spawnedAt || ts,
          completedAt: existing?.completedAt,
          status: existing?.status || 'running',
          timeoutSeconds: callInfo?.runTimeoutSeconds || existing?.timeoutSeconds || 300,
          resultSnippet: existing?.resultSnippet,
          errorText: existing?.errorText,
          runtimeSeconds: existing?.runtimeSeconds,
        });
      } else {
        const agentId = callInfo?.agentId || '';
        const errText = compactText(String(payload?.error || payload?.message || extractText(message?.content) || 'Spawn failed'));
        const blocked = /not allowed for sessions_spawn|forbidden/i.test(errText);
        const key = `spawn-failed-${callId || index}`;
        const task = callInfo?.task || '';
        runsByKey.set(key, {
          key,
          intentKey: buildDelegationIntentKey(agentId, task),
          runId: '',
          agentId,
          agentTitle: agentTitleById.get(agentId) || agentId || 'Unknown agent',
          childSessionKey: '',
          task,
          label: callInfo?.label || '',
          spawnedAt: ts,
          status: blocked ? 'blocked' : 'failed',
          timeoutSeconds: callInfo?.runTimeoutSeconds || 300,
          errorText: errText,
        });
      }
      return;
    }

    if (role !== 'user') return;
    const content = extractText(message?.content);
    const event = parseSubagentCompletionEvent(content);
    if (!event) return;

    const matched = Array.from(runsByKey.values()).find((run) => run.childSessionKey === event.sessionKey);
    const matchKey = matched?.key || event.sessionKey;
    const agentId = matched?.agentId || inferAgentIdFromSubagentSessionKey(event.sessionKey) || '';
    const task = matched?.task || event.task || '';
    const intentKey = matched?.intentKey || buildDelegationIntentKey(agentId, task);
    const normalizedStatus = compactText(event.status).toLowerCase();
    const completed = normalizedStatus.includes('completed successfully');
    const status: DelegationRunStatus = completed ? 'completed' : 'failed';

    runsByKey.set(matchKey, {
      key: matchKey,
      intentKey,
      runId: matched?.runId || '',
      agentId,
      agentTitle: matched?.agentTitle || agentTitleById.get(agentId) || agentId || 'Unknown agent',
      childSessionKey: event.sessionKey,
      task,
      label: matched?.label || '',
      spawnedAt: matched?.spawnedAt || ts,
      completedAt: ts,
      status,
      timeoutSeconds: matched?.timeoutSeconds || 300,
      resultSnippet: clipText(event.result || '', 360),
      errorText: completed ? '' : (event.result || normalizedStatus || 'Subagent reported failure'),
      runtimeSeconds: event.runtimeSeconds || matched?.runtimeSeconds,
    });
  });

  const now = Date.now();
  return Array.from(runsByKey.values())
    .map((run) => {
      if (!historyFresh) return run;
      if (run.status !== 'running') return run;
      const started = toEpochMs(run.spawnedAt);
      if (!started) return run;
      const ageMs = now - started;
      if (ageMs > run.timeoutSeconds * 1000) {
        return {
          ...run,
          status: 'timed_out' as const,
          errorText: run.errorText || `No completion callback after ${run.timeoutSeconds}s.`,
        };
      }
      return run;
    })
    .sort((a, b) => toEpochMs(b.spawnedAt) - toEpochMs(a.spawnedAt));
}

function sameHistory(a: TeamChatMessage[], b: TeamChatMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.role !== right.role ||
      left.content !== right.content ||
      left.timestamp !== right.timestamp
    ) {
      return false;
    }
  }
  return true;
}

function parseJsonObject(raw: string): Record<string, any> | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>;
  } catch {
    // fall through
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>;
    } catch {
      // no-op
    }
  }
  return null;
}

function toStringList(value: any): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return splitLines(value);
  }
  return [];
}

function buildDraftFromPayload(payload: Record<string, any>, fallback: RoleDraft): RoleDraft {
  const role = compactText(String(payload.role || fallback.role || ''));
  const responsibilities = toStringList(payload.responsibilities);
  const skills = toStringList(payload.skills);
  const outputs = toStringList(payload.outputs);
  const model = normalizeOpenRouterModelRef(String(payload.model || fallback.model || ''));

  return {
    role: role || fallback.role,
    responsibilities: (responsibilities.length > 0 ? responsibilities : splitLines(fallback.responsibilities)).join('\n'),
    model: model || fallback.model,
    skills: skills.length > 0 ? skills : [...fallback.skills],
    outputs: (outputs.length > 0 ? outputs : splitLines(fallback.outputs)).join('\n'),
  };
}

function draftFingerprint(draft: RoleDraft): string {
  const role = compactText(draft.role).toLowerCase();
  const responsibilities = splitLines(draft.responsibilities).map((line) => compactText(line).toLowerCase());
  const skills = Array.from(new Set(draft.skills.map((item) => compactText(item).toLowerCase()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  const outputs = splitLines(draft.outputs).map((line) => compactText(line).toLowerCase());
  const model = normalizeOpenRouterModelRef(draft.model || '').toLowerCase();
  return JSON.stringify({ role, responsibilities, skills, outputs, model });
}

function buildDraft(profile: TeamAgentProfile): RoleDraft {
  return {
    role: profile.role,
    responsibilities: profile.responsibilities.join('\n'),
    model: profile.model || '',
    skills: [...profile.skills],
    outputs: profile.outputs.join('\n'),
  };
}

function normalizeList(value: any, fallback: string[] = [], max = 8): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(value.map((item) => compactText(String(item || ''))).filter(Boolean))
    ).slice(0, max);
  }
  if (typeof value === 'string') {
    return Array.from(new Set(splitLines(value))).slice(0, max);
  }
  return [...fallback].slice(0, max);
}

function toProposalDraft(draft: RoleDraft): TeamEvolutionProposalDraft {
  return {
    role: compactText(draft.role),
    responsibilities: normalizeList(draft.responsibilities, [], 12),
    model: normalizeOpenRouterModelRef(draft.model || ''),
    skills: normalizeList(draft.skills, [], 12),
    outputs: normalizeList(draft.outputs, [], 12),
  };
}

function fromProposalDraft(draft: TeamEvolutionProposalDraft): RoleDraft {
  return {
    role: draft.role || '',
    responsibilities: normalizeList(draft.responsibilities, [], 12).join('\n'),
    model: normalizeOpenRouterModelRef(draft.model || ''),
    skills: normalizeList(draft.skills, [], 12),
    outputs: normalizeList(draft.outputs, [], 12).join('\n'),
  };
}

function normalizeAnalysis(value: any): TeamEvolutionAnalysis {
  const src = value && typeof value === 'object' ? value : {};
  return {
    summary: compactText(String(src.summary || src.overview || '')),
    strengths: normalizeList(src.strengths, [], 6),
    gaps: normalizeList(src.gaps, [], 6),
    risks: normalizeList(src.risks, [], 6),
    recommendations: normalizeList(src.recommendations, [], 8),
  };
}

function extractProposalSummary(proposal: TeamEvolutionProposal): string {
  const analysis = proposal.analysis;
  if (analysis.summary) return analysis.summary;
  if (analysis.recommendations.length > 0) return analysis.recommendations[0];
  return proposal.rationale || 'No summary';
}

function summarizeDiff(
  current: TeamEvolutionProposalDraft,
  proposed: TeamEvolutionProposalDraft,
): string[] {
  const out: string[] = [];
  if (compactText(current.role) !== compactText(proposed.role)) {
    out.push(`Role: "${current.role}" -> "${proposed.role}"`);
  }
  if (normalizeOpenRouterModelRef(current.model || '') !== normalizeOpenRouterModelRef(proposed.model || '')) {
    out.push(`Model: ${current.model || '(unchanged)'} -> ${proposed.model || '(unchanged)'}`);
  }
  const addedSkills = proposed.skills.filter((skill) => !current.skills.includes(skill));
  const removedSkills = current.skills.filter((skill) => !proposed.skills.includes(skill));
  if (addedSkills.length > 0) out.push(`Add skills: ${addedSkills.slice(0, 4).join(', ')}`);
  if (removedSkills.length > 0) out.push(`Remove skills: ${removedSkills.slice(0, 4).join(', ')}`);
  if (out.length === 0) out.push('No structural diff detected. Proposal mainly clarifies contract text.');
  return out;
}

function buildTeamCharter(
  lead: TeamMemberDefinition,
  profiles: Record<string, TeamAgentProfile>,
  definitions: TeamMemberDefinition[],
  interactions: TeamInteractionDefinition[],
  resolvedAgentByKey: Map<string, string>,
  allowedDelegates: string[] = [],
): string {
  const roster = definitions
    .filter((def) => def.key !== 'controller')
    .map((def) => {
      const profile = profiles[def.key] || {
        key: def.key,
        title: def.title,
        role: def.role,
        responsibilities: def.responsibilities,
        skills: def.skillSet,
        outputs: def.outputs,
      };
      return {
        key: def.key,
        agentId: resolvedAgentByKey.get(def.key) || def.openclawAgentId,
        title: profile.title,
        role: profile.role,
        responsibilities: profile.responsibilities,
        model: profile.model || '',
        skills: profile.skills,
        outputs: profile.outputs,
      };
    });

  const handoffMatrix = interactions.map((edge) => ({
    from: edge.from,
    to: edge.to,
    mode: edge.mode,
    purpose: edge.purpose,
  }));

  const policyList = allowedDelegates.filter(Boolean);

  return [
    '[TEAM_STUDIO_CHARTER]',
    `You are ${profiles[lead.key]?.title || lead.title}, the lead for this team session.`,
    'Operate in dialog-first cowork mode:',
    '1) Keep role specialization strict; do not collapse all work into one agent.',
    '2) Delegate with sessions_spawn / sessions_send when specialist execution is needed.',
    '3) Maintain shared state in TEAM_STATE.yaml style (owner, status, blockers, artifacts).',
    '4) Return concise handoff logs after every delegation step.',
    '5) Ask for human approval before irreversible operations.',
    '6) Default to decisive planning and concrete execution proposals from available context.',
    '7) Ask at most one blocking clarification question; do not return a long questionnaire.',
    policyList.length > 0 ? `8) sessions_spawn hard policy: you may spawn ONLY these agent IDs: ${policyList.join(', ')}.` : '',
    policyList.length > 0 ? '9) If a role is outside the allowed spawn list, do not call sessions_spawn for it; report it as blocked and continue with allowed agents.' : '',
    '10) Intern routing rule: do not spawn team-intern-research directly unless policy explicitly allows it. Route research via COO (team-coo-operations) and ask COO to delegate to Intern.',
    'Required response format:',
    '- Decision summary',
    '- Delegations (agent -> task -> expected output)',
    '- Current blockers',
    '- Next checkpoint',
    `Team roster JSON: ${JSON.stringify(roster)}`,
    `Interaction matrix JSON: ${JSON.stringify(handoffMatrix)}`,
    '[/TEAM_STUDIO_CHARTER]',
  ].join('\n');
}

function buildResumePrompt(lastUserRequest: string, reason?: string, lastAssistantSnippet?: string): string {
  const lines = [
    '[TEAM_STUDIO_RESUME]',
    'The previous run in this same session was interrupted.',
    reason ? `Interruption reason: ${reason}` : '',
    `Original user request: ${lastUserRequest}`,
    lastAssistantSnippet ? `Last visible assistant progress: ${lastAssistantSnippet}` : '',
    'Continue from the last completed checkpoint. Do not restart from scratch.',
    'Return the standard Team Studio format:',
    '- Decision summary',
    '- Delegations (agent -> task -> expected output)',
    '- Current blockers',
    '- Next checkpoint',
    '[/TEAM_STUDIO_RESUME]',
  ].filter(Boolean);
  return lines.join('\n');
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-aegis-text-dim">
      <StatusDot status={active ? 'active' : 'idle'} size={7} glow={active} beacon={active} />
      {active ? 'Active' : 'Idle'}
    </div>
  );
}

function ActionHint({ text }: { text: string }) {
  return (
    <button
      type="button"
      title={text}
      aria-label={text}
      className="w-6 h-6 rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-dim hover:text-aegis-text flex items-center justify-center"
      style={{ background: 'rgb(var(--aegis-overlay) / 0.02)' }}
    >
      <Info size={11} />
    </button>
  );
}

function RoleEditorCard({
  definition,
  profile,
  modelOptions,
  modelsLoading,
  modelsError,
  onLearnFromConversation,
  onAnalyzePropose,
  onSave,
  onReset,
}: {
  definition: TeamMemberDefinition;
  profile: TeamAgentProfile;
  modelOptions: ModelOption[];
  modelsLoading: boolean;
  modelsError: string;
  onLearnFromConversation: (key: string, currentDraft: RoleDraft) => Promise<RoleDraft | null>;
  onAnalyzePropose: (key: string, currentDraft: RoleDraft) => Promise<void>;
  onSave: (key: string, draft: RoleDraft) => Promise<SaveProfileResult> | SaveProfileResult;
  onReset: (key: string) => void;
}) {
  const [draft, setDraft] = useState<RoleDraft>(buildDraft(profile));
  const [learningContract, setLearningContract] = useState(false);
  const [applyingLearned, setApplyingLearned] = useState(false);
  const [analyzingContract, setAnalyzingContract] = useState(false);
  const [autoApplyEnabled, setAutoApplyEnabled] = useState(false);
  const [confirmStreak, setConfirmStreak] = useState(0);
  const [lastProposalFingerprint, setLastProposalFingerprint] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [skillQuery, setSkillQuery] = useState('');
  const [skillResults, setSkillResults] = useState<HubSkillCandidate[]>([]);
  const [searchingSkills, setSearchingSkills] = useState(false);
  const [skillSearchError, setSkillSearchError] = useState('');
  const [suggestingSkills, setSuggestingSkills] = useState(false);
  const [qualifyingSkills, setQualifyingSkills] = useState(false);
  const [qualificationNote, setQualificationNote] = useState('');
  const [lastQualifiedAt, setLastQualifiedAt] = useState('');
  const [autoMaintain, setAutoMaintain] = useState(true);
  const [qualityBySlug, setQualityBySlug] = useState<Record<string, SkillQualification>>({});

  useEffect(() => {
    setDraft(buildDraft(profile));
    setModelFilter('');
    setProviderFilter('all');
    setSkillResults([]);
    setSkillQuery('');
    setSkillSearchError('');
    setQualificationNote('');
    setLastQualifiedAt('');
    setQualityBySlug({});
    setApplyingLearned(false);
    setConfirmStreak(0);
    setLastProposalFingerprint('');
  }, [profile]);

  useEffect(() => {
    const query = compactText(skillQuery);
    if (query.length < 2) {
      setSkillResults([]);
      setSearchingSkills(false);
      setSkillSearchError('');
      return;
    }

    let canceled = false;
    const timer = window.setTimeout(async () => {
      setSearchingSkills(true);
      setSkillSearchError('');
      const found = await searchClawHubSkills(query);
      if (canceled) return;
      setSkillResults(found.filter((item) => !draft.skills.includes(item.slug)));
      if (found.length === 0) {
        setSkillSearchError('No matching ClawHub skills found for this query.');
      }
      setSearchingSkills(false);
    }, 320);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [skillQuery, draft.skills]);

  const dirty =
    draft.role !== profile.role ||
    splitLines(draft.responsibilities).join('|') !== profile.responsibilities.join('|') ||
    draft.model !== (profile.model || '') ||
    !arraysEqual(draft.skills, profile.skills) ||
    splitLines(draft.outputs).join('|') !== profile.outputs.join('|');

  const filteredModels = useMemo(() => {
    const q = compactText(modelFilter).toLowerCase();
    return modelOptions.filter((item) => {
      const providerOk = providerFilter === 'all' || item.provider === providerFilter;
      if (!providerOk) return false;
      if (!q) return true;
      return item.id.toLowerCase().includes(q) || item.label.toLowerCase().includes(q);
    });
  }, [modelFilter, providerFilter, modelOptions]);

  const providerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of modelOptions) set.add(item.provider || 'unknown');
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [modelOptions]);

  const addSkill = (slug: string) => {
    setDraft((state) => {
      if (state.skills.includes(slug)) return state;
      return { ...state, skills: [...state.skills, slug] };
    });
    setSkillResults((prev) => prev.filter((entry) => entry.slug !== slug));
  };

  const removeSkill = (slug: string) => {
    setDraft((state) => ({ ...state, skills: state.skills.filter((item) => item !== slug) }));
  };

  const suggestSkills = async () => {
    const base = [
      draft.role,
      ...splitLines(draft.responsibilities).slice(0, 2),
    ]
      .map((item) => compactText(item))
      .filter(Boolean)
      .join(' ');
    if (!base) return;
    setSuggestingSkills(true);
    setSkillQuery(base);
    setSearchingSkills(true);
    setSkillSearchError('');
    const found = await searchClawHubSkills(base);
    setSkillResults(found.filter((item) => !draft.skills.includes(item.slug)));
    if (found.length === 0) setSkillSearchError('No matching ClawHub skills found for this role.');
    setSearchingSkills(false);
    setSuggestingSkills(false);
  };

  const qualifyAndMaintain = useCallback(
    async (autoUpdate: boolean) => {
      const snapshot: RoleDraft = {
        role: draft.role,
        responsibilities: draft.responsibilities,
        model: draft.model,
        skills: [...draft.skills],
        outputs: draft.outputs,
      };
      if (!compactText(snapshot.role) && splitLines(snapshot.responsibilities).length === 0) {
        setQualificationNote('Add role or responsibilities first to evaluate skills.');
        return snapshot;
      }

      setQualifyingSkills(true);
      setQualificationNote('');
      try {
        const result = await findQualifiedSkills(snapshot, snapshot.skills);
        const qualityObject = Object.fromEntries(Array.from(result.evaluations.entries()));
        setQualityBySlug(qualityObject);
        setLastQualifiedAt(new Date().toISOString());

        const unqualifiedCurrent = snapshot.skills.filter((slug) => !result.evaluations.get(slug)?.qualified);
        const shouldReplace = autoUpdate && (unqualifiedCurrent.length > 0 || snapshot.skills.length < 2);
        const nextSkills = shouldReplace ? result.selectedSkills : snapshot.skills;

        if (shouldReplace && !arraysEqual(nextSkills, snapshot.skills)) {
          setDraft((prev) => ({ ...prev, skills: nextSkills }));
        }

        const qualifiedCount = nextSkills.filter((slug) => result.evaluations.get(slug)?.qualified).length;
        const roundInfo = `${result.rounds} round${result.rounds > 1 ? 's' : ''}`;
        if (shouldReplace) {
          setQualificationNote(`Re-qualified (${roundInfo}). Qualified ${qualifiedCount}/${nextSkills.length}; updated weak skills automatically.`);
        } else {
          setQualificationNote(`Re-qualified (${roundInfo}). Qualified ${qualifiedCount}/${nextSkills.length}.`);
        }

        return {
          ...snapshot,
          skills: nextSkills,
        };
      } catch (error: any) {
        setQualificationNote(`Qualification failed: ${error?.message || String(error)}`);
        return snapshot;
      } finally {
        setQualifyingSkills(false);
      }
    },
    [draft],
  );

  useEffect(() => {
    if (!autoMaintain) return;
    const timer = window.setInterval(() => {
      void qualifyAndMaintain(true);
    }, 120000);
    return () => window.clearInterval(timer);
  }, [autoMaintain, qualifyAndMaintain]);

  useEffect(() => {
    if (!autoMaintain) return;
    const hasIntent = compactText(draft.role) || splitLines(draft.responsibilities).length > 0;
    if (!hasIntent) return;
    const timer = window.setTimeout(() => {
      void qualifyAndMaintain(true);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [autoMaintain, draft.role, draft.responsibilities, draft.outputs, draft.skills.join('|'), qualifyAndMaintain]);

  const handleSave = async () => {
    const finalDraft = await qualifyAndMaintain(true);
    await onSave(definition.key, finalDraft);
    setConfirmStreak(0);
    setLastProposalFingerprint('');
  };

  const handleLearnFromConversation = async () => {
    setLearningContract(true);
    try {
      const proposed = await onLearnFromConversation(definition.key, draft);
      if (!proposed) return;
      setDraft(proposed);
      const proposalFingerprint = draftFingerprint(proposed);
      const nextStreak = proposalFingerprint === lastProposalFingerprint ? confirmStreak + 1 : 1;
      setLastProposalFingerprint(proposalFingerprint);
      setConfirmStreak(nextStreak);

      if (autoApplyEnabled && nextStreak >= 2) {
        setApplyingLearned(true);
        try {
          await onSave(definition.key, proposed);
          setQualificationNote('Auto-applied after 2 matching refinements. Contract saved to gateway.');
          setConfirmStreak(0);
          setLastProposalFingerprint('');
        } catch (error: any) {
          setQualificationNote(`Auto-apply failed: ${error?.message || String(error)}`);
        } finally {
          setApplyingLearned(false);
        }
        return;
      }

      if (autoApplyEnabled) {
        setQualificationNote(
          nextStreak >= 1
            ? `Matching refinement confirmation ${nextStreak}/2 captured. Run Learn again to auto-apply.`
            : 'Contract updated from recent conversation.',
        );
      } else {
        setQualificationNote('Contract updated from recent conversation. Review and click Save to persist.');
      }
    } finally {
      setLearningContract(false);
    }
  };

  const handleAnalyzePropose = async () => {
    setAnalyzingContract(true);
    try {
      const snapshot = await qualifyAndMaintain(false);
      await onAnalyzePropose(definition.key, snapshot);
    } finally {
      setAnalyzingContract(false);
    }
  };

  return (
    <div className="rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.02)] p-3.5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-aegis-text">{profile.title}</div>
          <div className="text-[10px] text-aegis-text-dim font-mono mt-0.5">{definition.openclawAgentId}</div>
        </div>
        <div className="text-[9px] uppercase tracking-[1px] text-aegis-text-dim">L{definition.depth}</div>
      </div>

      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-aegis-text-dim">Role</span>
        <input
          value={draft.role}
          onChange={(e) => setDraft((s) => ({ ...s, role: e.target.value }))}
          className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.03)] px-2.5 py-1.5 text-[12px] text-aegis-text"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-aegis-text-dim">Responsibilities</span>
        <textarea
          rows={3}
          value={draft.responsibilities}
          onChange={(e) => setDraft((s) => ({ ...s, responsibilities: e.target.value }))}
          className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.03)] px-2.5 py-1.5 text-[12px] text-aegis-text resize-y"
        />
      </label>

      <label className="block space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-aegis-text-dim">LLM Model (OpenRouter)</span>
          <a
            href="https://openrouter.ai/models"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-aegis-primary hover:text-aegis-primary/80"
          >
            Browse
            <ExternalLink size={10} />
          </a>
        </div>
        <div className="rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.03)] p-2 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-2">
            <input
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              placeholder="Filter models..."
              className="w-full rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] px-2 py-1.5 text-[11px] text-aegis-text"
            />
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              className="w-full rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] px-2 py-1.5 text-[11px] text-aegis-text"
            >
              <option value="all">All providers</option>
              {providerOptions.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </div>
          <select
            value={draft.model}
            onChange={(e) => setDraft((s) => ({ ...s, model: e.target.value }))}
            className="w-full rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] px-2 py-1.5 text-[11px] text-aegis-text"
          >
            <option value="">Use current agent model</option>
            {draft.model && !modelOptions.some((item) => item.id === draft.model) && (
              <option value={draft.model}>{draft.model} (current)</option>
            )}
            {filteredModels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          {modelsLoading && (
            <div className="text-[10px] text-aegis-text-dim flex items-center gap-1.5">
              <Loader2 size={10} className="animate-spin" />
              Loading model catalog from OpenRouter...
            </div>
          )}
          {!modelsLoading && !!modelsError && (
            <div className="text-[10px] text-aegis-warning">{modelsError}</div>
          )}
          {!modelsLoading && !modelsError && (
            <div className="text-[10px] text-aegis-text-dim">
              {filteredModels.length}/{modelOptions.length} models shown
              {providerFilter !== 'all' ? ` for provider "${providerFilter}"` : ''}.
            </div>
          )}
        </div>
      </label>

      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-aegis-text-dim">Skills from ClawHub</span>
        <div className="rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.03)] p-2 space-y-2">
          <div className="flex flex-wrap gap-1.5 min-h-[26px]">
            {draft.skills.length === 0 && (
              <span className="text-[11px] text-aegis-text-dim">No skill selected yet.</span>
            )}
            {draft.skills.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center gap-1 rounded-md border border-aegis-primary/20 bg-aegis-primary/10 px-2 py-0.5 text-[10px] text-aegis-primary"
              >
                {skill}
                <button
                  onClick={() => removeSkill(skill)}
                  className="text-aegis-primary/80 hover:text-aegis-primary"
                  aria-label={`Remove ${skill}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>

          <div className="flex gap-1.5">
            <input
              value={skillQuery}
              onChange={(e) => setSkillQuery(e.target.value)}
              placeholder="Search ClawHub skills..."
              className="flex-1 rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] px-2 py-1.5 text-[11px] text-aegis-text"
            />
            <button
              onClick={suggestSkills}
              disabled={suggestingSkills}
              className="px-2 py-1.5 rounded-md border border-aegis-accent/25 bg-aegis-accent/10 text-aegis-accent text-[10px] font-semibold disabled:opacity-50"
            >
              {suggestingSkills ? 'Suggesting...' : 'Suggest'}
            </button>
          </div>

          {searchingSkills && (
            <div className="text-[11px] text-aegis-text-dim flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" />
              Searching ClawHub...
            </div>
          )}

          {!!skillSearchError && !searchingSkills && (
            <div className="text-[10px] text-aegis-text-dim">{skillSearchError}</div>
          )}

          {!searchingSkills && skillResults.length > 0 && (
            <div className="max-h-[170px] overflow-y-auto space-y-1.5 scrollbar-thin">
              {skillResults.map((skill) => (
                <button
                  key={skill.slug}
                  onClick={() => addSkill(skill.slug)}
                  className="w-full text-left rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] hover:bg-[rgb(var(--aegis-overlay)/0.05)] px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-aegis-text truncate">{skill.name}</span>
                    <span className="text-[9px] text-aegis-text-dim shrink-0">{skill.stars}★ · {skill.installs}</span>
                  </div>
                  <div className="text-[10px] text-aegis-text-dim font-mono mt-0.5 truncate">{skill.slug}</div>
                  {skill.summary && (
                    <div className="text-[10px] text-aegis-text-dim mt-0.5 truncate">{skill.summary}</div>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="pt-1 border-t border-[rgb(var(--aegis-overlay)/0.08)] space-y-1.5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => void qualifyAndMaintain(true)}
                disabled={qualifyingSkills}
                className="px-2 py-1.5 rounded-md border border-aegis-success/25 bg-aegis-success/10 text-aegis-success text-[10px] font-semibold disabled:opacity-50"
              >
                {qualifyingSkills ? 'Qualifying...' : 'Requalify & Auto-update'}
              </button>
              <button
                onClick={() => setAutoMaintain((v) => !v)}
                className={clsx(
                  'px-2 py-1.5 rounded-md border text-[10px] font-semibold',
                  autoMaintain
                    ? 'border-aegis-primary/25 bg-aegis-primary/10 text-aegis-primary'
                    : 'border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-dim',
                )}
              >
                {autoMaintain ? 'Auto maintain: ON' : 'Auto maintain: OFF'}
              </button>
            </div>
            {qualificationNote && (
              <div className="text-[10px] text-aegis-text-dim">{qualificationNote}</div>
            )}
            {lastQualifiedAt && (
              <div className="text-[9px] text-aegis-text-dim">Last check: {timeAgo(lastQualifiedAt)}</div>
            )}
            {draft.skills.length > 0 && (
              <div className="space-y-1">
                {draft.skills.map((slug) => {
                  const quality = qualityBySlug[slug];
                  if (!quality) return null;
                  return (
                    <div key={`qual-${slug}`} className="text-[9px] text-aegis-text-dim flex items-center gap-1.5">
                      <StatusDot status={quality.qualified ? 'active' : 'error'} size={6} glow={quality.qualified} />
                      <span className="font-mono truncate">{slug}</span>
                      <span>· {quality.reason}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </label>

      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-aegis-text-dim">Expected Outputs</span>
        <textarea
          rows={3}
          value={draft.outputs}
          onChange={(e) => setDraft((s) => ({ ...s, outputs: e.target.value }))}
          className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.03)] px-2.5 py-1.5 text-[12px] text-aegis-text resize-y"
        />
      </label>

      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setAutoApplyEnabled((v) => !v);
              setConfirmStreak(0);
              setLastProposalFingerprint('');
            }}
            className={clsx(
              'px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors',
              autoApplyEnabled
                ? 'text-aegis-success border-aegis-success/25 bg-aegis-success/10'
                : 'text-aegis-text-dim border-[rgb(var(--aegis-overlay)/0.1)]',
            )}
          >
            {autoApplyEnabled ? `Auto-apply Learned (2x): ON${confirmStreak ? ` ${confirmStreak}/2` : ''}` : 'Auto-apply Learned (2x): OFF'}
          </button>
          <ActionHint text="Only affects Learn From Conversation. If 2 consecutive learned proposals match, it auto-saves that learned contract." />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void handleLearnFromConversation()}
            disabled={learningContract || applyingLearned}
            className={clsx(
              'px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors',
              learningContract || applyingLearned
                ? 'text-aegis-text-dim border-[rgb(var(--aegis-overlay)/0.1)]'
                : 'text-aegis-accent border-aegis-accent/25 bg-aegis-accent/10'
            )}
          >
            {learningContract ? 'Learning...' : applyingLearned ? 'Auto-applying...' : 'Learn From Conversation'}
          </button>
          <ActionHint text="Uses recent dialog to refine this role contract. Returns an updated draft in this form. Save applies it." />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void handleAnalyzePropose()}
            disabled={analyzingContract || learningContract || applyingLearned}
            className={clsx(
              'px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors',
              analyzingContract
                ? 'text-aegis-text-dim border-[rgb(var(--aegis-overlay)/0.1)]'
                : 'text-aegis-success border-aegis-success/25 bg-aegis-success/10'
            )}
          >
            {analyzingContract ? 'Analyzing...' : 'Analyze + Propose'}
          </button>
          <ActionHint text="Generates a formal proposal and sends it to Evolution Review. Approval there is always manual." />
        </div>

        <button
          onClick={() => void handleSave()}
          disabled={!dirty || qualifyingSkills || applyingLearned}
          className={clsx(
            'px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors',
            dirty
              ? 'text-aegis-primary border-aegis-primary/25 bg-aegis-primary/10'
              : 'text-aegis-text-dim border-[rgb(var(--aegis-overlay)/0.1)]'
          )}
        >
          {qualifyingSkills ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={() => onReset(definition.key)}
          className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-dim"
        >
          Reset
        </button>
      </div>
      <div className="text-[10px] text-aegis-text-dim mt-1">
        Auto-apply Learned (2x) does not cover Analyze + Propose. Analyze flow always requires approval in Evolution Review.
      </div>
    </div>
  );
}

function isProfileCustomized(definition: TeamMemberDefinition, profile: TeamAgentProfile): boolean {
  if (profile.role !== definition.role) return true;
  if (profile.responsibilities.join('|') !== definition.responsibilities.join('|')) return true;
  if ((profile.model || '').trim()) return true;
  if (profile.skills.join('|') !== definition.skillSet.join('|')) return true;
  if (profile.outputs.join('|') !== definition.outputs.join('|')) return true;
  return false;
}

function TeamContractsModal({
  open,
  onClose,
  definitions,
  profiles,
  modelOptions,
  modelsLoading,
  modelsError,
  selectedKey,
  onSelectKey,
  onLearnFromConversation,
  onAnalyzePropose,
  onSave,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  definitions: TeamMemberDefinition[];
  profiles: Record<string, TeamAgentProfile>;
  modelOptions: ModelOption[];
  modelsLoading: boolean;
  modelsError: string;
  selectedKey: string;
  onSelectKey: (key: string) => void;
  onLearnFromConversation: (key: string, currentDraft: RoleDraft) => Promise<RoleDraft | null>;
  onAnalyzePropose: (key: string, currentDraft: RoleDraft) => Promise<void>;
  onSave: (key: string, draft: RoleDraft) => Promise<SaveProfileResult> | SaveProfileResult;
  onReset: (key: string) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const activeDefinition = definitions.find((item) => item.key === selectedKey) || definitions[0];
  if (!activeDefinition) return null;

  const activeProfile = profiles[activeDefinition.key] || {
    key: activeDefinition.key,
    title: activeDefinition.title,
    role: activeDefinition.role,
    responsibilities: [...activeDefinition.responsibilities],
    model: '',
    skills: [...activeDefinition.skillSet],
    outputs: [...activeDefinition.outputs],
  };

  return (
    <div
      className="fixed inset-0 z-[120] bg-transparent backdrop-blur-[2px] p-3 md:p-5"
      onClick={onClose}
    >
      <div
        className="mx-auto h-full max-h-[860px] w-full max-w-[1260px] rounded-2xl border border-aegis-primary/20 bg-[var(--aegis-bg)] shadow-[0_0_0_1px_rgb(var(--aegis-primary)/0.12),0_0_36px_rgb(var(--aegis-primary)/0.16),0_20px_60px_rgb(var(--aegis-overlay)/0.25)] overflow-hidden flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-5 border-b border-[rgb(var(--aegis-overlay)/0.08)] flex items-start justify-between gap-3">
          <div>
            <div className="text-[18px] font-bold text-aegis-text flex items-center gap-2">
              <Settings2 size={16} />
              Team Contracts Settings
            </div>
            <p className="text-[12px] text-aegis-text-dim mt-1">
              Select an agent role on the left, then maintain role, responsibilities, skills, and expected outputs on the right.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-dim hover:text-aegis-text flex items-center justify-center"
            aria-label="Close contracts settings"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[320px_1fr]">
          <div className="border-r border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.02)] overflow-y-auto p-3 space-y-2">
            {definitions.map((definition) => {
              const profile = profiles[definition.key] || {
                key: definition.key,
                title: definition.title,
                role: definition.role,
                responsibilities: [...definition.responsibilities],
                model: '',
                skills: [...definition.skillSet],
                outputs: [...definition.outputs],
              };
              const customized = isProfileCustomized(definition, profile);
              const active = selectedKey === definition.key;
              return (
                <button
                  key={definition.key}
                  onClick={() => onSelectKey(definition.key)}
                  className={clsx(
                    'w-full text-left rounded-xl border p-3 transition-colors',
                    active
                      ? 'border-aegis-primary/25 bg-aegis-primary/10'
                      : 'border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] hover:bg-[rgb(var(--aegis-overlay)/0.05)]',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[12px] font-semibold text-aegis-text">{profile.title}</div>
                      <div className="text-[10px] text-aegis-text-dim mt-0.5">L{definition.depth} · {profile.role}</div>
                      {!!(profile.model || '').trim() && (
                        <div className="text-[10px] text-aegis-primary mt-0.5 truncate">
                          model: {profile.model}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {customized && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-md border border-aegis-accent/25 bg-aegis-accent/10 text-aegis-accent">
                          Edited
                        </span>
                      )}
                      {active && <StatusDot status="active" size={7} glow beacon />}
                    </div>
                  </div>
                  <div className="text-[10px] text-aegis-text-dim font-mono mt-1.5 truncate">{definition.openclawAgentId}</div>
                </button>
              );
            })}
          </div>

          <div className="overflow-y-auto p-4 md:p-5">
            <RoleEditorCard
              definition={activeDefinition}
              profile={activeProfile}
              modelOptions={modelOptions}
              modelsLoading={modelsLoading}
              modelsError={modelsError}
              onLearnFromConversation={onLearnFromConversation}
              onAnalyzePropose={onAnalyzePropose}
              onSave={onSave}
              onReset={onReset}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function TeamMonitorPage() {
  const { t } = useTranslation();
  const connected = useChatStore((s) => s.connected);
  const agents = useGatewayDataStore((s) => s.agents);
  const sessions = useGatewayDataStore((s) => s.sessions);
  const cronJobs = useGatewayDataStore((s) => s.cronJobs);
  const runningSubAgents = useGatewayDataStore((s) => s.runningSubAgents);

  const {
    hasHydrated,
    leadAgentId,
    profiles,
    proposals,
    conversationStates,
    setLeadAgentId,
    syncFromDefinitions,
    updateProfile,
    resetProfile,
    upsertProposal,
    setProposalStatus,
    removeProposal,
    markConversationPending,
    markConversationProgress,
    markConversationInterrupted,
    clearConversationState,
  } = useTeamStudioStore();

  const [messages, setMessages] = useState<TeamChatMessage[]>([]);
  const [historyRows, setHistoryRows] = useState<any[]>([]);
  const [lastHistoryLoadedAt, setLastHistoryLoadedAt] = useState(0);
  const [input, setInput] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [applyingPolicy, setApplyingPolicy] = useState(false);
  const [contractsOpen, setContractsOpen] = useState(false);
  const [selectedContractKey, setSelectedContractKey] = useState('ceo');
  const [notice, setNotice] = useState<{ type: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [leadAllowedAgentIds, setLeadAllowedAgentIds] = useState<string[]>([]);
  const [autoRetryMeta, setAutoRetryMeta] = useState<Record<string, AutoRetryMetaEntry>>({});
  const [showDelegationHistory, setShowDelegationHistory] = useState(false);
  const [showLayoutDebug, setShowLayoutDebug] = useState(false);
  const [layoutDebugCopied, setLayoutDebugCopied] = useState(false);
  const [dialogShellForcedHeight, setDialogShellForcedHeight] = useState(() => {
    if (typeof window === 'undefined') return 640;
    return Math.max(320, Math.floor(window.innerHeight - 260));
  });
  const [layoutDebug, setLayoutDebug] = useState({
    shellHeight: 0,
    headerHeight: 0,
    middleHeight: 0,
    composerHeight: 0,
    chatClientHeight: 0,
    chatScrollHeight: 0,
    hasOverflow: false,
    viewportHeight: 0,
  });

  const primedSessionsRef = useRef<Set<string>>(new Set());
  const dialogCardWrapRef = useRef<HTMLDivElement>(null);
  const dialogShellRef = useRef<HTMLDivElement>(null);
  const dialogHeaderRef = useRef<HTMLDivElement>(null);
  const dialogComposerRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const stickyScrollRef = useRef(true);
  const forceScrollRef = useRef(true);
  const historyFetchInFlightRef = useRef(false);
  const autoRetryTimersRef = useRef<Map<string, number>>(new Map());
  const latestDelegationByIntentRef = useRef<Map<string, DelegationRun>>(new Map());
  const lastLayoutLogRef = useRef(0);
  const lastLayoutSnapshotRef = useRef('');
  const layoutCopyResetTimerRef = useRef<number | null>(null);

  const teamDefs = useMemo(() => getTeamDefinitions(), []);
  const teamInteractions = useMemo(() => getTeamInteractions(), []);
  const resolvedMembers = useMemo(() => resolveTeamMembers(agents), [agents]);

  useEffect(() => {
    if (!hasHydrated) return;
    syncFromDefinitions(teamDefs);
  }, [hasHydrated, syncFromDefinitions, teamDefs]);

  const resolvedAgentByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of resolvedMembers) {
      map.set(item.definition.key, item.agent?.id || item.definition.openclawAgentId);
    }
    return map;
  }, [resolvedMembers]);

  const leadChoices = useMemo(() => {
    return teamDefs
      .filter((def) => def.key !== 'controller')
      .map((def) => {
        const resolved = resolvedMembers.find((item) => item.definition.key === def.key);
        return {
          key: def.key,
          title: def.title,
          agentId: resolved?.agent?.id || def.openclawAgentId,
          present: !!resolved?.agent,
        };
      });
  }, [teamDefs, resolvedMembers]);

  useEffect(() => {
    if (!leadChoices.length) return;
    const exists = leadChoices.some((item) => item.agentId === leadAgentId);
    if (!exists) {
      setLeadAgentId(leadChoices[0].agentId);
    }
  }, [leadChoices, leadAgentId, setLeadAgentId]);

  useEffect(() => {
    if (!teamDefs.some((item) => item.key === selectedContractKey)) {
      setSelectedContractKey(teamDefs[0]?.key || 'ceo');
    }
  }, [teamDefs, selectedContractKey]);

  const loadModelCatalog = useCallback(async () => {
    setLoadingModels(true);
    setModelsError('');
    try {
      const openRouterResponse = await fetch('https://openrouter.ai/api/v1/models');
      if (!openRouterResponse.ok) throw new Error(`OpenRouter models HTTP ${openRouterResponse.status}`);
      const openRouterPayload = await openRouterResponse.json();
      const parsed = parseOpenRouterModels(openRouterPayload);
      if (parsed.length > 0) {
        setModelOptions(parsed);
        return;
      }
      throw new Error('OpenRouter returned no models');
    } catch (error: any) {
      const fallbackError = error?.message || String(error);
      try {
        const gatewayModels = await gateway.getAvailableModels();
        const parsedFallback = parseGatewayModels(gatewayModels);
        setModelOptions(parsedFallback);
        setModelsError(
          parsedFallback.length > 0
            ? `OpenRouter unavailable (${fallbackError}). Using Gateway model list fallback.`
            : `Model catalog unavailable: ${fallbackError}`,
        );
      } catch {
        setModelOptions([]);
        setModelsError(`Model catalog unavailable: ${fallbackError}`);
      }
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    void loadModelCatalog();
  }, [loadModelCatalog]);

  const activeLead = useMemo(() => {
    return leadChoices.find((item) => item.agentId === leadAgentId) || leadChoices[0] || null;
  }, [leadChoices, leadAgentId]);

  const activeLeadDef = useMemo(() => {
    if (!activeLead) return teamDefs.find((def) => def.key === 'ceo') || teamDefs[0];
    return teamDefs.find((def) => def.key === activeLead.key) || teamDefs[0];
  }, [activeLead, teamDefs]);

  useEffect(() => {
    let canceled = false;
    const loadLeadPolicy = async () => {
      if (!connected || !activeLead?.agentId) {
        if (!canceled) setLeadAllowedAgentIds([]);
        return;
      }
      try {
        const snapshot = await gateway.call('config.get', {});
        const list = Array.isArray(snapshot?.config?.agents?.list) ? snapshot.config.agents.list : [];
        const entry = list.find((item: any) => item && typeof item === 'object' && item.id === activeLead.agentId);
        const allow = Array.isArray(entry?.subagents?.allowAgents)
          ? entry.subagents.allowAgents.map((item: any) => String(item || '').trim()).filter(Boolean)
          : [];
        if (!canceled) setLeadAllowedAgentIds(allow);
      } catch {
        if (!canceled) setLeadAllowedAgentIds([]);
      }
    };
    void loadLeadPolicy();
    return () => {
      canceled = true;
    };
  }, [connected, activeLead?.agentId]);

  const sessionKey = useMemo(() => buildSessionKey(activeLead?.agentId || leadAgentId || 'main'), [activeLead, leadAgentId]);

  const historyFresh = useMemo(() => {
    if (!lastHistoryLoadedAt) return false;
    return Date.now() - lastHistoryLoadedAt <= 15_000;
  }, [lastHistoryLoadedAt, messages.length]);

  const leadAllowedSummary = useMemo(() => {
    if (leadAllowedAgentIds.length === 0) return '';
    const names = leadAllowedAgentIds.map((agentId) => {
      const def = teamDefs.find((item) => item.openclawAgentId === agentId);
      return def?.title || agentId;
    });
    return names.join(', ');
  }, [leadAllowedAgentIds, teamDefs]);

  const teamAgentIds = useMemo(() => {
    const ids = new Set<string>();
    resolvedMembers.forEach((item) => {
      ids.add(item.agent?.id || item.definition.openclawAgentId);
    });
    return ids;
  }, [resolvedMembers]);

  const teamSessions = useMemo(() => {
    return sessions.filter((session: any) => {
      const sessionAgentId = getSessionAgentId(session);
      return teamAgentIds.has(sessionAgentId);
    });
  }, [sessions, teamAgentIds]);

  const activeTeamSession = useMemo(() => {
    return teamSessions.find((session: any) => session?.key === sessionKey) || null;
  }, [teamSessions, sessionKey]);

  const sessionRunning = useMemo(() => {
    if (!activeTeamSession) return false;
    if (typeof activeTeamSession?.running === 'boolean') return activeTeamSession.running;
    const lastActiveMs = toEpochMs(activeTeamSession?.lastActive || activeTeamSession?.updatedAt);
    if (lastActiveMs && Date.now() - lastActiveMs <= 90_000) return true;
    return false;
  }, [activeTeamSession]);

  const conversationState = useMemo(() => conversationStates[sessionKey] || null, [conversationStates, sessionKey]);

  const delegationRuns = useMemo(
    () => deriveDelegationRuns(historyRows, teamDefs, historyFresh),
    [historyRows, teamDefs, historyFresh],
  );

  const recoveredDelegationKeys = useMemo(() => {
    const latestCompletedByAgent = new Map<string, number>();
    const completedRuns: Array<{ completedAt: number; spawnedAt: number; task: string; label: string }> = [];
    delegationRuns.forEach((run) => {
      if (run.status !== 'completed') return;
      const agentId = compactText(run.agentId);
      if (!agentId) return;
      const completedTs = toEpochMs(run.completedAt || run.spawnedAt);
      const spawnedTs = toEpochMs(run.spawnedAt);
      if (!completedTs) return;
      const prev = latestCompletedByAgent.get(agentId) || 0;
      if (completedTs > prev) latestCompletedByAgent.set(agentId, completedTs);
      completedRuns.push({
        completedAt: completedTs,
        spawnedAt: spawnedTs,
        task: run.task || '',
        label: run.label || '',
      });
    });

    const keys = new Set<string>();
    delegationRuns.forEach((run) => {
      if (!['failed', 'timed_out', 'blocked'].includes(run.status)) return;
      const agentId = compactText(run.agentId);
      if (!agentId) return;
      const completedAt = latestCompletedByAgent.get(agentId) || 0;
      const runStartedAt = toEpochMs(run.spawnedAt);
      if (completedAt > 0 && runStartedAt > 0 && completedAt > runStartedAt) {
        keys.add(run.key);
        return;
      }

      // For BLOCKED cases, a later relay completion by another agent should recover it
      // if it clearly matches the same task intent.
      if (run.status === 'blocked' && runStartedAt > 0) {
        const matchedRelay = completedRuns.some((done) => {
          if (done.completedAt <= runStartedAt) return false;
          const similarity = taskSimilarity(run.task || '', done.task || '');
          const relayHint = /relay|intern/i.test(done.label || '');
          return similarity >= 0.45 || (relayHint && similarity >= 0.3);
        });
        if (matchedRelay) {
          keys.add(run.key);
        }
      }
    });
    return keys;
  }, [delegationRuns]);

  const activeDelegationRuns = useMemo(() => {
    return delegationRuns.filter((run) => !recoveredDelegationKeys.has(run.key));
  }, [delegationRuns, recoveredDelegationKeys]);

  const latestDelegationByIntent = useMemo(() => {
    const map = new Map<string, DelegationRun>();
    activeDelegationRuns.forEach((run) => {
      const key = run.intentKey || run.key;
      if (!map.has(key)) {
        map.set(key, run);
      }
    });
    return map;
  }, [activeDelegationRuns]);

  const latestDelegationRuns = useMemo(() => {
    return Array.from(latestDelegationByIntent.values())
      .sort((a, b) => toEpochMs(b.spawnedAt) - toEpochMs(a.spawnedAt));
  }, [latestDelegationByIntent]);

  const delegationRunsForDisplay = useMemo(() => {
    return showDelegationHistory ? activeDelegationRuns : latestDelegationRuns;
  }, [showDelegationHistory, activeDelegationRuns, latestDelegationRuns]);

  const delegationCounts = useMemo(() => {
    const counts = { running: 0, completed: 0, failed: 0, timed_out: 0, blocked: 0 };
    latestDelegationRuns.forEach((run) => {
      counts[run.status] += 1;
    });
    return counts;
  }, [latestDelegationRuns]);

  const failedDelegations = useMemo(
    () => latestDelegationRuns.filter((run) => ['failed', 'timed_out', 'blocked'].includes(run.status)),
    [latestDelegationRuns],
  );

  const recoveredDelegationCount = recoveredDelegationKeys.size;

  const activeSessions = useMemo(() => teamSessions.filter((session: any) => !!session?.running), [teamSessions]);

  const teamRunningSubAgents = useMemo(() => {
    return runningSubAgents.filter((sub) => teamAgentIds.has(sub.agentId));
  }, [runningSubAgents, teamAgentIds]);

  const activeRuntimeCount = useMemo(() => {
    return activeSessions.length + teamRunningSubAgents.length;
  }, [activeSessions.length, teamRunningSubAgents.length]);

  const teamCronJobs = useMemo(() => {
    return cronJobs.filter((job: any) => teamAgentIds.has(inferCronAgentId(job)));
  }, [cronJobs, teamAgentIds]);

  const layoutDebugText = useMemo(() => {
    const lines = [
      `sessionKey=${sessionKey}`,
      `leadAgentId=${activeLead?.agentId || leadAgentId || '-'}`,
      `forcedShellHeight=${dialogShellForcedHeight}`,
      `viewportHeight=${layoutDebug.viewportHeight}`,
      `shellHeight=${layoutDebug.shellHeight}`,
      `headerHeight=${layoutDebug.headerHeight}`,
      `middleHeight=${layoutDebug.middleHeight}`,
      `composerHeight=${layoutDebug.composerHeight}`,
      `chatClientHeight=${layoutDebug.chatClientHeight}`,
      `chatScrollHeight=${layoutDebug.chatScrollHeight}`,
      `hasOverflow=${layoutDebug.hasOverflow ? 'yes' : 'no'}`,
    ];
    return lines.join('\n');
  }, [sessionKey, activeLead?.agentId, leadAgentId, layoutDebug, dialogShellForcedHeight]);

  const sortedProposals = useMemo(() => {
    return [...proposals].sort((a, b) => toEpochMs(b.createdAt) - toEpochMs(a.createdAt));
  }, [proposals]);

  const pendingProposals = useMemo(() => sortedProposals.filter((item) => item.status === 'pending'), [sortedProposals]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const node = chatScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
  }, []);

  const handleHistoryScroll = useCallback(() => {
    const node = chatScrollRef.current;
    if (!node) return;
    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    stickyScrollRef.current = distanceToBottom <= 56;
  }, []);

  useEffect(() => {
    stickyScrollRef.current = true;
    forceScrollRef.current = true;
  }, [sessionKey]);

  useEffect(() => {
    latestDelegationByIntentRef.current = latestDelegationByIntent;
  }, [latestDelegationByIntent]);

  useEffect(() => {
    setHistoryRows([]);
    setLastHistoryLoadedAt(0);
    setAutoRetryMeta({});
    autoRetryTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    autoRetryTimersRef.current.clear();
  }, [sessionKey]);

  useEffect(() => {
    if (!messages.length) return;
    if (!stickyScrollRef.current && !forceScrollRef.current) return;
    const behavior: ScrollBehavior = forceScrollRef.current ? 'auto' : 'smooth';
    const frame = requestAnimationFrame(() => scrollToBottom(behavior));
    forceScrollRef.current = false;
    return () => cancelAnimationFrame(frame);
  }, [messages, scrollToBottom]);

  const updateLayoutDebug = useCallback(() => {
    const shellNode = dialogShellRef.current;
    const headerNode = dialogHeaderRef.current;
    const composerNode = dialogComposerRef.current;
    const chatNode = chatScrollRef.current;
    if (!shellNode || !headerNode || !composerNode || !chatNode) return;

    const shellHeight = Math.round(shellNode.getBoundingClientRect().height);
    const headerHeight = Math.round(headerNode.getBoundingClientRect().height);
    const composerHeight = Math.round(composerNode.getBoundingClientRect().height);
    const middleHeight = Math.max(0, shellHeight - headerHeight - composerHeight);
    const chatClientHeight = Math.round(chatNode.clientHeight);
    const chatScrollHeight = Math.round(chatNode.scrollHeight);
    const hasOverflow = chatScrollHeight > chatClientHeight + 1;
    const viewportHeight = Math.round(window.innerHeight);
    const snapshot = `${shellHeight}|${headerHeight}|${middleHeight}|${composerHeight}|${chatClientHeight}|${chatScrollHeight}|${hasOverflow ? 1 : 0}|${viewportHeight}`;

    const now = Date.now();
    if (snapshot !== lastLayoutSnapshotRef.current && now - lastLayoutLogRef.current > 500) {
      lastLayoutSnapshotRef.current = snapshot;
      lastLayoutLogRef.current = now;
      console.info('[TeamDialogDebug]', {
        viewportHeight,
        shellHeight,
        headerHeight,
        middleHeight,
        composerHeight,
        chatClientHeight,
        chatScrollHeight,
        hasOverflow,
      });
      if (middleHeight <= 0 || chatClientHeight <= 0) {
        console.warn('[TeamDialogDebug] Scroll area collapsed', {
          middleHeight,
          chatClientHeight,
        });
      }
    }

    setLayoutDebug((prev) => {
      if (
        prev.shellHeight === shellHeight &&
        prev.headerHeight === headerHeight &&
        prev.middleHeight === middleHeight &&
        prev.composerHeight === composerHeight &&
        prev.chatClientHeight === chatClientHeight &&
        prev.chatScrollHeight === chatScrollHeight &&
        prev.hasOverflow === hasOverflow &&
        prev.viewportHeight === viewportHeight
      ) {
        return prev;
      }
      return {
        shellHeight,
        headerHeight,
        middleHeight,
        composerHeight,
        chatClientHeight,
        chatScrollHeight,
        hasOverflow,
        viewportHeight,
      };
    });
  }, []);

  const updateDialogForcedHeight = useCallback(() => {
    const wrap = dialogCardWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    // Keep breathing space so rounded borders/shadows are not clipped.
    const top = Number.isFinite(rect.top) ? rect.top : 220;
    const available = Math.floor(window.innerHeight - top - 24);
    const next = Number.isFinite(available) ? Math.max(320, available) : Math.max(320, Math.floor(window.innerHeight - 260));
    setDialogShellForcedHeight((prev) => (Math.abs(prev - next) <= 1 ? prev : next));
  }, []);

  useEffect(() => {
    updateLayoutDebug();
  }, [updateLayoutDebug, messages.length, input.length, loadingHistory, sending, sessionKey, dialogShellForcedHeight]);

  useEffect(() => {
    const shellNode = dialogShellRef.current;
    const headerNode = dialogHeaderRef.current;
    const composerNode = dialogComposerRef.current;
    const chatNode = chatScrollRef.current;
    const nodes = [shellNode, headerNode, composerNode, chatNode].filter(Boolean) as Element[];
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => updateLayoutDebug());
      nodes.forEach((node) => observer?.observe(node));
    }
    const intervalId = window.setInterval(updateLayoutDebug, 1000);
    window.addEventListener('resize', updateLayoutDebug);
    return () => {
      if (observer) observer.disconnect();
      window.clearInterval(intervalId);
      window.removeEventListener('resize', updateLayoutDebug);
    };
  }, [updateLayoutDebug, sessionKey]);

  useEffect(() => {
    updateDialogForcedHeight();
  }, [updateDialogForcedHeight, notice, contractsOpen]);

  useEffect(() => {
    const wrap = dialogCardWrapRef.current;
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && wrap) {
      observer = new ResizeObserver(() => updateDialogForcedHeight());
      observer.observe(wrap);
    }
    const intervalId = window.setInterval(updateDialogForcedHeight, 1000);
    window.addEventListener('resize', updateDialogForcedHeight);
    return () => {
      if (observer) observer.disconnect();
      window.clearInterval(intervalId);
      window.removeEventListener('resize', updateDialogForcedHeight);
    };
  }, [updateDialogForcedHeight]);

  useEffect(() => {
    return () => {
      if (layoutCopyResetTimerRef.current) {
        window.clearTimeout(layoutCopyResetTimerRef.current);
      }
      autoRetryTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      autoRetryTimersRef.current.clear();
    };
  }, []);

  const handleCopyLayoutDebug = useCallback(async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(layoutDebugText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = layoutDebugText;
        ta.setAttribute('readonly', 'true');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setLayoutDebugCopied(true);
      if (layoutCopyResetTimerRef.current) {
        window.clearTimeout(layoutCopyResetTimerRef.current);
      }
      layoutCopyResetTimerRef.current = window.setTimeout(() => {
        setLayoutDebugCopied(false);
      }, 1800);
    } catch (err: any) {
      setNotice({ type: 'error', text: `Copy debug failed: ${err?.message || String(err)}` });
    }
  }, [layoutDebugText]);

  const loadHistory = useCallback(
    async (showSpinner = true, silenceError = false): Promise<TeamChatMessage[]> => {
      if (!connected) return [];
      if (showSpinner) setLoadingHistory(true);
      try {
        const res = await gateway.getHistory(sessionKey, 120);
        const rows = Array.isArray(res?.messages) ? res.messages : [];
        const parsed = parseHistory(rows);
        setHistoryRows(rows);
        setLastHistoryLoadedAt(Date.now());
        if (parsed.some((msg) => msg.role === 'user' || msg.role === 'assistant')) {
          primedSessionsRef.current.add(sessionKey);
        }
        setMessages((prev) => (sameHistory(prev, parsed) ? prev : parsed));
        return parsed;
      } catch (err: any) {
        const text = err?.message || String(err);
        if (!silenceError) {
          setNotice({ type: 'error', text });
        }
        return [];
      } finally {
        if (showSpinner) setLoadingHistory(false);
      }
    },
    [connected, sessionKey],
  );

  useEffect(() => {
    if (!connected) return;
    loadHistory(true);
  }, [connected, sessionKey, loadHistory]);

  useEffect(() => {
    if (!connected) return;
    const shouldPoll = sending || !!conversationState?.pending || delegationCounts.running > 0;
    if (!shouldPoll) return;

    const tick = async () => {
      if (historyFetchInFlightRef.current) return;
      historyFetchInFlightRef.current = true;
      try {
        await loadHistory(false, true);
      } finally {
        historyFetchInFlightRef.current = false;
      }
    };

    void tick();
    const timerId = window.setInterval(() => {
      void tick();
    }, 3500);
    return () => {
      window.clearInterval(timerId);
    };
  }, [connected, sending, conversationState?.pending, delegationCounts.running, loadHistory]);

  useEffect(() => {
    if (!conversationState) return;
    const sentAtMs = toEpochMs(conversationState.lastSentAt);
    if (!sentAtMs) return;

    const latestAssistant = [...messages]
      .reverse()
      .find((item) => item.role === 'assistant' && toEpochMs(item.timestamp) >= sentAtMs - 1200);

    const latestAssistantTs = toEpochMs(latestAssistant?.timestamp);
    const storedAssistantTs = toEpochMs(conversationState.lastAssistantAt);
    if (
      latestAssistant &&
      (
        conversationState.pending ||
        conversationState.interrupted ||
        latestAssistantTs > storedAssistantTs + 500
      )
    ) {
      markConversationProgress({
        sessionKey,
        assistantAt: latestAssistant.timestamp,
        assistantSnippet: clipText(latestAssistant.content, 280),
      });
      return;
    }

    if (!conversationState.pending) return;

    const ageMs = Date.now() - sentAtMs;
    if (!sessionRunning && ageMs > 35_000) {
      markConversationInterrupted({
        sessionKey,
        reason: 'No assistant reply detected and session is no longer running.',
      });
      return;
    }
    if (ageMs > 180_000) {
      markConversationInterrupted({
        sessionKey,
        reason: 'No assistant reply detected for 3 minutes.',
      });
    }
  }, [
    conversationState,
    messages,
    sessionKey,
    sessionRunning,
    markConversationProgress,
    markConversationInterrupted,
  ]);

  const handleRefresh = async () => {
    if (!connected || refreshing) return;
    setRefreshing(true);
    setNotice(null);
    try {
      await refreshAll();
      await loadHistory(false);
      setNotice({ type: 'ok', text: 'Team data refreshed.' });
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || String(err) });
    } finally {
      setRefreshing(false);
    }
  };

  const handleProvisionAgents = async () => {
    if (!connected || provisioning) return;
    setProvisioning(true);
    setNotice(null);

    let workspaceHint = agents.find((a) => typeof a.workspace === 'string' && a.workspace.trim())?.workspace?.trim();
    if (!workspaceHint) {
      try {
        const direct = await gateway.call('config.get', { path: 'agents.defaults.workspace' });
        const directValue = typeof direct === 'string'
          ? direct
          : typeof direct?.value === 'string'
            ? direct.value
            : typeof direct?.result === 'string'
              ? direct.result
              : '';
        if (directValue.trim()) workspaceHint = directValue.trim();
      } catch {
        // Continue to full snapshot check below.
      }
    }
    if (!workspaceHint) {
      try {
        const full = await gateway.call('config.get', {});
        const nested = full?.config?.agents?.defaults?.workspace;
        if (typeof nested === 'string' && nested.trim()) workspaceHint = nested.trim();
      } catch {
        // Continue; createAgent will surface a clear error if workspace remains empty.
      }
    }
    let created = 0;
    let skipped = 0;
    const failures: string[] = [];

    try {
      for (const { definition, agent } of resolvedMembers) {
        if (!isProvisionable(definition)) continue;
        if (agent) {
          skipped += 1;
          continue;
        }
        try {
          await gateway.createAgent({
            agentId: definition.openclawAgentId,
            name: definition.title,
            workspace: workspaceHint,
          });
          created += 1;
        } catch (err: any) {
          const msg = String(err?.message || err || 'create failed');
          if (msg.toLowerCase().includes('exists')) skipped += 1;
          else failures.push(`${definition.title}: ${msg}`);
        }
      }

      await refreshGroup('agents');

      if (failures.length > 0) {
        setNotice({ type: 'error', text: `Provision completed with issues. ${failures[0]}` });
      } else {
        setNotice({ type: 'ok', text: `Provision complete. Created ${created}, skipped ${skipped}.` });
      }
    } finally {
      setProvisioning(false);
    }
  };

  const handleApplyCoworkPolicy = async () => {
    if (!connected || applyingPolicy) return;
    setApplyingPolicy(true);
    setNotice(null);

    const delegationMap = new Map<string, Set<string>>();
    for (const edge of teamInteractions) {
      if (!['delegates', 'supports', 'reviews'].includes(edge.mode)) continue;
      const fromId = resolvedAgentByKey.get(edge.from);
      const toId = resolvedAgentByKey.get(edge.to);
      if (!fromId || !toId || fromId === toId || fromId === 'main') continue;
      const existing = delegationMap.get(fromId) || new Set<string>();
      existing.add(toId);
      delegationMap.set(fromId, existing);
    }

    let updated = 0;
    const failures: string[] = [];

    try {
      // Gateway 2026.2.x removed subagents from agents.update schema.
      // Cowork delegation must be written via config.agents.list[*].subagents.allowAgents.
      const snapshot = await gateway.call('config.get', {});
      const baseHash = typeof snapshot?.hash === 'string' ? snapshot.hash : undefined;
      const baseConfig = snapshot?.config;
      if (!baseConfig || typeof baseConfig !== 'object') {
        throw new Error('config.get returned no config payload');
      }

      const nextConfig = JSON.parse(JSON.stringify(baseConfig));
      const agentList = Array.isArray(nextConfig?.agents?.list) ? nextConfig.agents.list : null;
      if (!agentList) throw new Error('config.get missing config.agents.list');

      const byId = new Map<string, any>();
      for (const entry of agentList) {
        if (!entry || typeof entry !== 'object') continue;
        const id = typeof entry.id === 'string' ? entry.id.trim() : '';
        if (!id) continue;
        byId.set(id, entry);
      }

      for (const [agentId, allow] of delegationMap.entries()) {
        const entry = byId.get(agentId);
        if (!entry) {
          failures.push(`${agentId}: agent missing from config.agents.list`);
          continue;
        }

        const allowAgents = Array.from(allow.values()).map((v) => v.trim()).filter(Boolean);
        entry.subagents = {
          ...(entry.subagents && typeof entry.subagents === 'object' ? entry.subagents : {}),
          allowAgents,
        };
        updated += 1;
      }

      if (updated > 0) {
        const params: Record<string, any> = { raw: JSON.stringify(nextConfig, null, 2) };
        if (baseHash) params.baseHash = baseHash;
        await gateway.call('config.set', params);
      }

      await refreshGroup('agents');

      if (failures.length > 0) {
        setNotice({ type: 'error', text: `Cowork policy partially applied. ${failures[0]}` });
      } else {
        setNotice({ type: 'ok', text: `Cowork policy applied to ${updated} agents.` });
      }
    } finally {
      setApplyingPolicy(false);
    }
  };

  const dispatchLeadRequest = async ({
    rawPrompt,
    visiblePrompt,
    trackingRequest,
  }: {
    rawPrompt: string;
    visiblePrompt?: string;
    trackingRequest?: string;
  }) => {
    const trimmedRaw = rawPrompt.trim();
    const trimmedVisible = (visiblePrompt || rawPrompt).trim();
    if (!connected || sending || !trimmedRaw || !activeLeadDef) return;

    const sentAt = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: 'user',
        content: trimmedVisible,
        timestamp: sentAt,
      },
    ]);
    stickyScrollRef.current = true;
    forceScrollRef.current = true;
    setSending(true);
    setNotice(null);
    markConversationPending({
      sessionKey,
      leadAgentId: activeLead?.agentId || activeLeadDef.openclawAgentId,
      userRequest: trackingRequest || trimmedVisible,
      sentAt,
    });

    const charter = buildTeamCharter(
      activeLeadDef,
      profiles,
      teamDefs,
      teamInteractions,
      resolvedAgentByKey,
      leadAllowedAgentIds,
    );
    const firstMessage = !primedSessionsRef.current.has(sessionKey);
    const outgoing = firstMessage
      ? `${charter}\n\n[USER_REQUEST]\n${trimmedRaw}\n[/USER_REQUEST]`
      : trimmedRaw;

    try {
      await gateway.sendMessage(outgoing, undefined, sessionKey);
      primedSessionsRef.current.add(sessionKey);

      let gotAssistant = false;
      let latestHistory: TeamChatMessage[] = [];
      const sentAtMs = toEpochMs(sentAt);
      for (let i = 0; i < 16; i += 1) {
        await sleep(1500);
        latestHistory = await loadHistory(false);
        gotAssistant = latestHistory.some(
          (msg) => msg.role === 'assistant' && toEpochMs(msg.timestamp) >= sentAtMs - 1200,
        );
        if (gotAssistant) break;
      }

      if (gotAssistant) {
        const latestAssistant = [...latestHistory]
          .reverse()
          .find((item) => item.role === 'assistant' && toEpochMs(item.timestamp) >= sentAtMs - 1200);
        markConversationProgress({
          sessionKey,
          assistantAt: latestAssistant?.timestamp,
          assistantSnippet: latestAssistant ? clipText(latestAssistant.content, 280) : undefined,
        });
      } else {
        setNotice({
          type: 'info',
          text: 'Request sent. Waiting for assistant output. If this run is interrupted, Resume will appear automatically.',
        });
      }
    } catch (err: any) {
      const reason = err?.message || String(err);
      setNotice({ type: 'error', text: reason });
      markConversationInterrupted({ sessionKey, reason });
      await loadHistory(false);
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput('');
    await dispatchLeadRequest({ rawPrompt: trimmed, trackingRequest: trimmed });
  };

  const handleResume = async () => {
    if (!conversationState || !conversationState.interrupted) return;
    const lastRequest = compactText(conversationState.lastUserRequest || '');
    if (!lastRequest) return;

    const resumeEnvelope = buildResumePrompt(
      lastRequest,
      conversationState.interruptionReason,
      conversationState.lastAssistantSnippet,
    );
    const resumePrompt = `${resumeEnvelope}\n\n${lastRequest}`;
    await dispatchLeadRequest({
      rawPrompt: resumePrompt,
      visiblePrompt: `Resume: ${clipText(lastRequest, 140)}`,
      trackingRequest: lastRequest,
    });
  };

  const handleDismissResume = () => {
    clearConversationState(sessionKey);
  };

  const handleRetryOneDelegation = async (
    run: DelegationRun,
    options?: { auto?: boolean },
  ): Promise<boolean> => {
    if (!run.agentId || !run.task) {
      if (!options?.auto) {
        setNotice({ type: 'error', text: 'Cannot retry this delegation: missing agentId or task payload.' });
      }
      return false;
    }
    const prompt = [
      '[TEAM_STUDIO_DELEGATION_RETRY]',
      options?.auto
        ? 'Auto-retry this timed-out delegation exactly once after cooldown.'
        : 'Retry this timed-out delegation only.',
      `agentId: ${run.agentId}`,
      `task: ${run.task}`,
      'Use sessions_spawn in mode=run and preserve the same task intent.',
      'After spawn, wait for completion callback and summarize outcome.',
      '[/TEAM_STUDIO_DELEGATION_RETRY]',
    ].join('\n');
    if (!options?.auto) {
      setNotice({ type: 'info', text: `Retrying timed-out delegation for ${run.agentTitle}...` });
    }
    await dispatchLeadRequest({
      rawPrompt: prompt,
      visiblePrompt: options?.auto ? `Auto-retry timed-out: ${run.agentTitle}` : `Retry timed-out: ${run.agentTitle}`,
      trackingRequest: `${options?.auto ? 'Auto-retry' : 'Retry'} timed-out delegation for ${run.agentId}`,
    });
    return true;
  };

  const handleRetryFailedDelegations = async () => {
    if (failedDelegations.length === 0) return;
    const rows = failedDelegations
      .map(
        (run, idx) =>
          `${idx + 1}. status=${run.status} | agentId=${run.agentId || 'unknown'} | task=${run.task || 'missing task'} | issue=${run.errorText || '-'}`,
      )
      .join('\n');
    const prompt = [
      '[TEAM_STUDIO_DELEGATION_RETRY]',
      `Recover failed delegations listed below (${failedDelegations.length} items).`,
      'Rules:',
      '- Process only these items.',
      '- For timed_out/failed: retry with same agentId and same task intent using sessions_spawn mode=run.',
      '- For blocked: do not spawn blocked agent directly; reroute via COO (team-coo-operations) or another allowed delegate.',
      '- Report each new childSessionKey and runId.',
      '- Wait for completion callbacks and then provide final summary.',
      `Failed delegations:\n${rows}`,
      '[/TEAM_STUDIO_DELEGATION_RETRY]',
    ].join('\n');
    await dispatchLeadRequest({
      rawPrompt: prompt,
      visiblePrompt: `Recover failed delegations (${failedDelegations.length})`,
      trackingRequest: `Recover ${failedDelegations.length} failed delegations`,
    });
  };

  const handleRerouteBlockedDelegation = async (run: DelegationRun) => {
    if (run.status !== 'blocked') return;
    const blockedAgentId = compactText(run.agentId);
    const blockedTask = compactText(run.task);
    if (!blockedAgentId || !blockedTask) {
      setNotice({ type: 'error', text: 'Cannot reroute blocked delegation: missing agentId or task.' });
      return;
    }

    const cooDef = teamDefs.find((def) => def.key === 'coo');
    const cooAgentId = cooDef ? (resolvedAgentByKey.get(cooDef.key) || cooDef.openclawAgentId) : '';
    const canUseCoo = !!cooAgentId && leadAllowedAgentIds.includes(cooAgentId);
    const fallbackAllowed = leadAllowedAgentIds[0] || '';
    const relayAgentId = canUseCoo ? cooAgentId : fallbackAllowed;
    if (!relayAgentId) {
      setNotice({ type: 'error', text: 'No allowed relay agent available for reroute.' });
      return;
    }

    const prompt = [
      '[TEAM_STUDIO_DELEGATION_REROUTE]',
      `Previous delegation was blocked by sessions_spawn policy for direct agentId=${blockedAgentId}.`,
      `Use allowed relay agentId=${relayAgentId} to execute the same intent.`,
      'Rules:',
      '- Keep the original task intent and output format.',
      '- Use sessions_spawn mode=run for relay agent.',
      `- Instruct relay agent to delegate internally to ${blockedAgentId} if policy allows at relay level; otherwise complete directly.`,
      `Original task: ${blockedTask}`,
      'Return: relay runId, childSessionKey, and final completion summary.',
      '[/TEAM_STUDIO_DELEGATION_REROUTE]',
    ].join('\n');

    setNotice({ type: 'info', text: `Rerouting blocked delegation via ${relayAgentId}...` });
    await dispatchLeadRequest({
      rawPrompt: prompt,
      visiblePrompt: `Reroute blocked delegation: ${run.agentTitle}`,
      trackingRequest: `Reroute blocked delegation for ${blockedAgentId} via ${relayAgentId}`,
    });
  };

  useEffect(() => {
    if (!connected) return;

    // Drop timers for intents that are no longer timed out.
    autoRetryTimersRef.current.forEach((timerId, intentKey) => {
      const latest = latestDelegationByIntent.get(intentKey);
      if (!latest || latest.status !== 'timed_out') {
        window.clearTimeout(timerId);
        autoRetryTimersRef.current.delete(intentKey);
      }
    });

    // Reset retry state once an intent leaves timed-out state, so future timeout
    // cycles can still get one automatic retry.
    setAutoRetryMeta((prev) => {
      let changed = false;
      const next: Record<string, AutoRetryMetaEntry> = {};
      Object.entries(prev).forEach(([intentKey, meta]) => {
        const latest = latestDelegationByIntent.get(intentKey);
        if (latest && latest.status === 'timed_out') {
          next[intentKey] = meta;
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    latestDelegationByIntent.forEach((run, intentKey) => {
      if (run.status !== 'timed_out') return;

      const meta = autoRetryMeta[intentKey] || { attempts: 0, finalTimeout: false };
      if (meta.attempts >= 1) {
        const runStartedAt = toEpochMs(run.spawnedAt);
        const retryAt = Number(meta.lastRetryAt || 0);
        // Ignore the original timed-out run right after scheduling auto-retry.
        if (retryAt > 0 && (!runStartedAt || runStartedAt <= retryAt + 1000)) {
          return;
        }
        if (!meta.finalTimeout) {
          setAutoRetryMeta((prev) => ({
            ...prev,
            [intentKey]: {
              attempts: prev[intentKey]?.attempts || 1,
              lastRetryAt: prev[intentKey]?.lastRetryAt,
              finalTimeout: true,
            },
          }));
        }
        return;
      }

      if (autoRetryTimersRef.current.has(intentKey)) return;

      const timerId = window.setTimeout(async () => {
        autoRetryTimersRef.current.delete(intentKey);
        const latestNow = latestDelegationByIntentRef.current.get(intentKey);
        if (!latestNow || latestNow.status !== 'timed_out') return;

        if (sending) {
          // UI is busy; try once more shortly.
          if (!autoRetryTimersRef.current.has(intentKey)) {
            const delayed = window.setTimeout(async () => {
              autoRetryTimersRef.current.delete(intentKey);
              const latestAgain = latestDelegationByIntentRef.current.get(intentKey);
              if (!latestAgain || latestAgain.status !== 'timed_out') return;
              if (sending) return;
              const started = await handleRetryOneDelegation(latestAgain, { auto: true });
              if (started) {
                setAutoRetryMeta((prev) => ({
                  ...prev,
                  [intentKey]: {
                    attempts: 1,
                    lastRetryAt: Date.now(),
                    finalTimeout: false,
                  },
                }));
              }
            }, 3000);
            autoRetryTimersRef.current.set(intentKey, delayed);
          }
          return;
        }

        const started = await handleRetryOneDelegation(latestNow, { auto: true });
        if (started) {
          setAutoRetryMeta((prev) => ({
            ...prev,
            [intentKey]: {
              attempts: 1,
              lastRetryAt: Date.now(),
              finalTimeout: false,
            },
          }));
          setNotice({
            type: 'info',
            text: `Auto-retry triggered for timed-out delegation: ${latestNow.agentTitle}`,
          });
        }
      }, AUTO_RETRY_COOLDOWN_MS);

      autoRetryTimersRef.current.set(intentKey, timerId);
    });
  }, [connected, latestDelegationByIntent, autoRetryMeta, sending, handleRetryOneDelegation]);

  const handleLearnProfileFromConversation = async (key: string, currentDraft: RoleDraft): Promise<RoleDraft | null> => {
    if (!connected) {
      setNotice({ type: 'error', text: 'Gateway is disconnected. Connect first to learn from conversation.' });
      return null;
    }

    const definition = teamDefs.find((item) => item.key === key);
    if (!definition) {
      setNotice({ type: 'error', text: `Unknown team role: ${key}` });
      return null;
    }

    const transcriptMessages = messages
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .slice(-18);
    if (transcriptMessages.length === 0) {
      setNotice({ type: 'info', text: 'No conversation found yet. Send messages first, then retry.' });
      return null;
    }

    const agentId = resolvedAgentByKey.get(key) || definition.openclawAgentId || 'main';
    const refineSessionKey = `agent:${agentId}:team-contract-refiner`;
    const sentAt = Date.now();
    const runId = `team-contract-refine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const transcript = transcriptMessages
      .map((item) => `[${String(item.role || '').toUpperCase()}] ${item.content}`)
      .join('\n');

    const prompt = [
      'Refine this agent contract from the conversation evidence.',
      'Do not ask clarifying questions. Infer and produce a decisive contract update.',
      'Return STRICT JSON ONLY (no markdown, no prose).',
      'JSON schema:',
      '{"role":"string","responsibilities":["string"],"skills":["string"],"outputs":["string"],"model":"optional openrouter/...","rationale":"string"}',
      'Rules:',
      '- responsibilities: 3 to 7 concrete action statements.',
      '- skills: 3 to 8 concrete skill slugs, no duplicates.',
      '- outputs: 3 to 6 concrete deliverables.',
      '- keep model unchanged unless a model change is clearly needed.',
      `Agent id: ${agentId}`,
      `Current contract JSON: ${JSON.stringify({
        role: currentDraft.role,
        responsibilities: splitLines(currentDraft.responsibilities),
        model: currentDraft.model,
        skills: currentDraft.skills,
        outputs: splitLines(currentDraft.outputs),
      })}`,
      `Conversation transcript:\n${transcript}`,
    ].join('\n');

    try {
      setNotice({ type: 'info', text: `Learning contract update from ${agentId}...` });
      await gateway.call('chat.send', {
        sessionKey: refineSessionKey,
        idempotencyKey: runId,
        message: prompt,
      });

      for (let i = 0; i < 20; i += 1) {
        await sleep(1200);
        const history = await gateway.call('chat.history', { sessionKey: refineSessionKey, limit: 50 });
        const rows = Array.isArray(history?.messages) ? history.messages : [];
        const latest = [...rows]
          .reverse()
          .find((item: any) => item?.role === 'assistant' && toEpochMs(item?.timestamp) >= sentAt - 1000);
        if (!latest) continue;

        const assistantError = typeof latest?.errorMessage === 'string' ? latest.errorMessage.trim() : '';
        if (assistantError) throw new Error(assistantError);

        const text = extractText(latest?.content).trim();
        if (!text) continue;

        const payload = parseJsonObject(text);
        if (!payload) continue;

        const refined = buildDraftFromPayload(payload, currentDraft);
        setNotice({ type: 'ok', text: `Contract proposal generated by ${agentId}. Review and click Save to apply.` });
        return refined;
      }

      throw new Error('No structured JSON proposal returned yet. Try again after more conversation context.');
    } catch (err: any) {
      setNotice({ type: 'error', text: `Contract learning failed: ${err?.message || String(err)}` });
      return null;
    }
  };

  const runLocalAnalyzePropose = async (
    key: string,
    definition: TeamMemberDefinition,
    agentId: string,
    currentDraft: RoleDraft,
    transcriptMessages: TeamChatMessage[],
  ): Promise<{ analysis: TeamEvolutionAnalysis; proposedDraft: RoleDraft; rationale: string }> => {
    const refineSessionKey = `agent:${agentId}:team-evolve-proposer`;
    const sentAt = Date.now();
    const runId = `team-evolve-propose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const transcript = transcriptMessages
      .map((item) => `[${String(item.role || '').toUpperCase()}] ${item.content}`)
      .join('\n');

    const prompt = [
      'Analyze this team agent contract from conversation evidence and propose an upgrade.',
      'Do not ask questions. Decide from available context and produce one concrete proposal.',
      'Return STRICT JSON ONLY (no markdown, no prose).',
      'JSON schema:',
      '{"analysis":{"summary":"string","strengths":["string"],"gaps":["string"],"risks":["string"],"recommendations":["string"]},"proposal":{"role":"string","responsibilities":["string"],"skills":["string"],"outputs":["string"],"model":"optional openrouter/..."},"rationale":"string"}',
      'Rules:',
      '- strengths/gaps/risks/recommendations: 2-6 concise bullets each.',
      '- responsibilities: 3-8 action statements.',
      '- skills: 3-10 concrete skill slugs.',
      '- outputs: 3-8 tangible deliverables.',
      '- model: keep current unless clearly justified.',
      `Agent key: ${key}`,
      `Agent id: ${agentId}`,
      `Agent title: ${definition.title}`,
      `Current contract JSON: ${JSON.stringify(toProposalDraft(currentDraft))}`,
      `Conversation transcript:\n${transcript}`,
    ].join('\n');

    await gateway.call('chat.send', {
      sessionKey: refineSessionKey,
      idempotencyKey: runId,
      message: prompt,
    });

    for (let i = 0; i < 20; i += 1) {
      await sleep(1200);
      const history = await gateway.call('chat.history', { sessionKey: refineSessionKey, limit: 60 });
      const rows = Array.isArray(history?.messages) ? history.messages : [];
      const latest = [...rows]
        .reverse()
        .find((item: any) => item?.role === 'assistant' && toEpochMs(item?.timestamp) >= sentAt - 1000);
      if (!latest) continue;

      const assistantError = typeof latest?.errorMessage === 'string' ? latest.errorMessage.trim() : '';
      if (assistantError) throw new Error(assistantError);

      const text = extractText(latest?.content).trim();
      if (!text) continue;
      const payload = parseJsonObject(text);
      if (!payload) continue;

      const analysis = normalizeAnalysis(payload.analysis || payload);
      const proposalPayload = payload.proposal && typeof payload.proposal === 'object' ? payload.proposal : payload;
      const proposedDraft = buildDraftFromPayload(proposalPayload, currentDraft);
      const rationale = compactText(String(payload.rationale || analysis.summary || 'Contract evolution proposed from recent conversation evidence.'));
      return { analysis, proposedDraft, rationale };
    }

    throw new Error('No structured proposal was returned yet. Try again after adding more dialog context.');
  };

  const handleAnalyzeAndPropose = async (key: string, currentDraft: RoleDraft): Promise<void> => {
    if (!connected) {
      setNotice({ type: 'error', text: 'Gateway is disconnected. Connect first to run team evolution analysis.' });
      return;
    }

    const definition = teamDefs.find((item) => item.key === key);
    if (!definition) {
      setNotice({ type: 'error', text: `Unknown team role: ${key}` });
      return;
    }

    const transcriptMessages = messages
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .slice(-24);
    if (transcriptMessages.length === 0) {
      setNotice({ type: 'info', text: 'No conversation found yet. Send messages first, then run Analyze + Propose.' });
      return;
    }

    const profile = profiles[key] || {
      key,
      title: definition.title,
      role: definition.role,
      responsibilities: [...definition.responsibilities],
      skills: [...definition.skillSet],
      outputs: [...definition.outputs],
      model: '',
    };
    const agentId = resolvedAgentByKey.get(key) || definition.openclawAgentId || 'main';
    const roster = teamDefs
      .filter((item) => item.key !== 'controller')
      .map((item) => {
        const p = profiles[item.key];
        return {
          key: item.key,
          agentId: resolvedAgentByKey.get(item.key) || item.openclawAgentId,
          title: p?.title || item.title,
          role: p?.role || item.role,
          responsibilities: p?.responsibilities || item.responsibilities,
          skills: p?.skills || item.skillSet,
          outputs: p?.outputs || item.outputs,
          model: p?.model || '',
        };
      });

    const payloadBase = {
      target: {
        key,
        agentId,
        title: profile.title,
        contract: toProposalDraft(currentDraft),
      },
      transcript: transcriptMessages.map((item) => ({
        role: item.role,
        content: item.content,
        timestamp: item.timestamp,
      })),
      roster,
      interactions: teamInteractions,
    };

    try {
      setNotice({ type: 'info', text: `Running team evolution analyze + propose for ${profile.title}...` });

      let analysis: TeamEvolutionAnalysis | null = null;
      let proposedDraft: RoleDraft | null = null;
      let rationale = '';
      let source: 'gateway' | 'local' = 'gateway';

      try {
        const analysisPayload = await gateway.teamEvolveAnalyze(payloadBase);
        analysis = normalizeAnalysis(analysisPayload?.analysis || analysisPayload);

        const proposePayload = await gateway.teamEvolvePropose({
          ...payloadBase,
          analysis,
        });
        const proposalBody = proposePayload?.proposal && typeof proposePayload.proposal === 'object'
          ? proposePayload.proposal
          : proposePayload;
        proposedDraft = buildDraftFromPayload(proposalBody, currentDraft);
        rationale = compactText(
          String(
            proposePayload?.rationale ||
            analysisPayload?.summary ||
            analysis?.summary ||
            'Gateway team.evolve proposal generated.'
          )
        );
      } catch (methodErr: any) {
        source = 'local';
        const local = await runLocalAnalyzePropose(key, definition, agentId, currentDraft, transcriptMessages);
        analysis = local.analysis;
        proposedDraft = local.proposedDraft;
        rationale = local.rationale || String(methodErr?.message || '');
      }

      if (!analysis || !proposedDraft) {
        throw new Error('No proposal generated.');
      }

      const proposal: TeamEvolutionProposal = {
        id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        key,
        agentId,
        agentTitle: profile.title,
        createdAt: new Date().toISOString(),
        source,
        status: 'pending',
        rationale,
        analysis,
        current: toProposalDraft(currentDraft),
        proposed: toProposalDraft(proposedDraft),
      };
      upsertProposal(proposal);
      setNotice({
        type: 'ok',
        text: `Proposal generated for ${profile.title}. Review it in Evolution Review and approve/reject.`,
      });
    } catch (err: any) {
      setNotice({ type: 'error', text: `Analyze + propose failed: ${err?.message || String(err)}` });
    }
  };

  const handleApproveProposal = async (proposal: TeamEvolutionProposal) => {
    const roleDraft = fromProposalDraft(proposal.proposed);
    const result = await handleSaveProfile(proposal.key, roleDraft);
    if (!result.ok) {
      setProposalStatus(proposal.id, 'pending', `Apply failed: ${result.error || result.message}`);
      setNotice({ type: 'error', text: `Approval failed for ${proposal.agentTitle}: ${result.error || result.message}` });
      return;
    }
    const reviewNote = result.configApplied
      ? 'Applied to profile and gateway config.'
      : result.message;
    setProposalStatus(proposal.id, 'approved', reviewNote);
    setNotice({ type: 'ok', text: `Proposal approved: ${proposal.agentTitle}` });
  };

  const handleRejectProposal = (proposal: TeamEvolutionProposal) => {
    setProposalStatus(proposal.id, 'rejected', 'Rejected from Evolution Review panel.');
    setNotice({ type: 'info', text: `Proposal rejected: ${proposal.agentTitle}` });
  };

  const handleSaveProfile = async (key: string, draft: RoleDraft): Promise<SaveProfileResult> => {
    const targetModel = normalizeOpenRouterModelRef(draft.model.trim());
    updateProfile(key, {
      role: draft.role.trim() || profiles[key]?.role || '',
      responsibilities: splitLines(draft.responsibilities),
      model: targetModel,
      skills: draft.skills,
      outputs: splitLines(draft.outputs),
    });

    const resolvedAgentId = resolvedAgentByKey.get(key);
    if (!resolvedAgentId) {
      const msg = 'Team role updated. Provision agent first to apply model selection.';
      setNotice({ type: 'info', text: msg });
      return { ok: true, configApplied: false, message: msg };
    }

    try {
      const snapshot = await gateway.call('config.get', {});
      const baseHash = typeof snapshot?.hash === 'string' ? snapshot.hash : undefined;
      const baseConfig = snapshot?.config;
      if (!baseConfig || typeof baseConfig !== 'object') {
        throw new Error('config.get returned no config payload');
      }

      const nextConfig = JSON.parse(JSON.stringify(baseConfig));
      const agentList = Array.isArray(nextConfig?.agents?.list) ? nextConfig.agents.list : null;
      if (!agentList) throw new Error('config.get missing config.agents.list');

      const entry = agentList.find((item: any) => item && typeof item === 'object' && item.id === resolvedAgentId);
      if (!entry) throw new Error(`agent not found in config.agents.list: ${resolvedAgentId}`);
      let message = '';
      if (!targetModel) {
        // Clear explicit override so agent inherits model selection from default/global config.
        delete entry.model;
        message = 'Team role updated. Reverted to inherited/default model.';
      } else {
        entry.model = targetModel;
        message = `Team role updated. Explicit model applied: ${targetModel}`;
      }

      const params: Record<string, any> = { raw: JSON.stringify(nextConfig, null, 2) };
      if (baseHash) params.baseHash = baseHash;
      await gateway.call('config.set', params);
      await refreshGroup('agents');
      setNotice({ type: 'ok', text: message });
      return { ok: true, configApplied: true, message };
    } catch (err: any) {
      const errorText = err?.message || String(err);
      setNotice({
        type: 'error',
        text: `Role updated, but model update failed for ${resolvedAgentId}: ${errorText}`,
      });
      return {
        ok: false,
        configApplied: false,
        message: 'Role updated locally, but gateway config update failed.',
        error: errorText,
      };
    }
  };

  const handleResetProfile = (key: string) => {
    resetProfile(key);
    setNotice({ type: 'info', text: 'Role reset to default.' });
  };

  return (
    <PageTransition className="p-6 max-w-[1380px] mx-auto h-full min-h-0 overflow-hidden flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-[28px] font-extrabold text-aegis-text tracking-tight">{t('teamMonitor.title', 'Team Studio')}</h1>
          <p className="text-[13px] text-aegis-text-dim mt-1">
            {t(
              'teamMonitor.subtitle',
              'Dialog-first human-agent collaboration with role contracts, cowork delegation, and live team runtime visibility.',
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={handleRefresh}
            disabled={!connected || refreshing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold transition-colors border border-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-muted hover:text-aegis-text"
            style={{ background: 'rgb(var(--aegis-overlay) / 0.03)' }}
          >
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Refresh
          </button>
          <button
            onClick={handleProvisionAgents}
            disabled={!connected || provisioning}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-colors border border-aegis-primary/25 text-aegis-primary"
            style={{ background: themeAlpha('primary', 0.08) }}
          >
            {provisioning ? <Loader2 size={13} className="animate-spin" /> : <Users2 size={13} />}
            Provision Agents
          </button>
          <button
            onClick={handleApplyCoworkPolicy}
            disabled={!connected || applyingPolicy}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-colors border border-aegis-success/25 text-aegis-success"
            style={{ background: 'rgb(var(--aegis-success) / 0.10)' }}
          >
            {applyingPolicy ? <Loader2 size={13} className="animate-spin" /> : <Network size={13} />}
            Apply Cowork Policy
          </button>
          <button
            onClick={() => {
              setSelectedContractKey(activeLead?.key || 'ceo');
              setContractsOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-colors border border-aegis-accent/25 text-aegis-accent"
            style={{ background: 'rgb(var(--aegis-accent) / 0.10)' }}
          >
            <Settings2 size={13} />
            Contracts Settings
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={clsx(
            'text-[12px] px-3 py-2 rounded-lg border',
            notice.type === 'ok' && 'text-aegis-success border-aegis-success/20 bg-aegis-success/10',
            notice.type === 'error' && 'text-aegis-danger border-aegis-danger/20 bg-aegis-danger/10',
            notice.type === 'info' && 'text-aegis-text-muted border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.03)]',
          )}
        >
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 shrink-0">
        {[
          { icon: Users2, label: 'Team roles', value: teamDefs.length, color: 'primary' as const },
          { icon: ShieldCheck, label: 'Provisioned', value: resolvedMembers.filter((m) => !!m.agent || m.definition.fixed).length, color: 'success' as const },
          { icon: Activity, label: 'Active runtime', value: activeRuntimeCount, color: 'accent' as const },
          { icon: Bot, label: 'Running sub-agents', value: teamRunningSubAgents.length, color: 'warning' as const },
        ].map((item, idx) => (
          <GlassCard key={item.label} delay={idx * 0.03} hover noPad>
            <div className="px-3.5 py-2.5">
              <div className="flex w-full items-center">
                <div
                  className="w-8 h-8 shrink-0 rounded-lg border flex items-center justify-center ml-5 mr-[10px]"
                  style={{
                    background: themeAlpha(item.color, 0.1),
                    borderColor: themeAlpha(item.color, 0.2),
                    color: themeHex(item.color),
                  }}
                >
                  <item.icon size={14} />
                </div>
                <div className="min-w-0 flex-1 ml-0 mr-[12px] text-[14px] font-semibold leading-tight text-aegis-text truncate">{item.label}</div>
                <div className="text-[24px] leading-none font-extrabold tabular-nums text-aegis-text ml-[8px] mr-5">{item.value}</div>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 flex-1 h-0 min-h-0 overflow-hidden xl:items-stretch">
        <div
          ref={dialogCardWrapRef}
          className="xl:col-span-3 xl:self-stretch h-full min-h-0 py-[2px]"
          style={{ height: `${Math.max(320, dialogShellForcedHeight)}px`, maxHeight: `${Math.max(320, dialogShellForcedHeight)}px` }}
        >
          <GlassCard className="h-full min-h-0 overflow-hidden" noPad>
          <div
            ref={dialogShellRef}
            className="h-full min-h-0 max-h-full grid grid-rows-[auto_minmax(0,1fr)_auto]"
          >
            <div ref={dialogHeaderRef} className="p-5 pb-3 border-b border-[rgb(var(--aegis-overlay)/0.06)] space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[15px] font-bold text-aegis-text flex items-center gap-2">
                  <MessageCircle size={14} />
                  Team Dialog Workspace
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowLayoutDebug((prev) => !prev)}
                    className={clsx(
                      'px-2 py-1 rounded-md text-[10px] font-semibold border',
                      showLayoutDebug
                        ? 'text-aegis-warning border-aegis-warning/30 bg-aegis-warning/10'
                        : 'text-aegis-text-dim border-[rgb(var(--aegis-overlay)/0.12)]'
                    )}
                  >
                    {showLayoutDebug ? 'Debug ON' : 'Debug OFF'}
                  </button>
                  <StatusPill active={activeRuntimeCount > 0} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wide text-aegis-text-dim">Lead Agent</span>
                  <select
                    value={activeLead?.agentId || leadAgentId}
                    onChange={(e) => {
                      setLeadAgentId(e.target.value);
                      setNotice(null);
                    }}
                    className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.03)] px-2.5 py-2 text-[12px] text-aegis-text"
                  >
                    {leadChoices.map((choice) => (
                      <option key={`${choice.key}-${choice.agentId}`} value={choice.agentId}>
                        {choice.title}{choice.present ? '' : ' (create first)'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wide text-aegis-text-dim">Session</span>
                  <input
                    value={sessionKey}
                    readOnly
                    className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.03)] px-2.5 py-2 text-[11px] font-mono text-aegis-text"
                  />
                </label>
              </div>
              <div className="text-[10px] text-aegis-text-dim">
                Delegation policy:
                {' '}
                {leadAllowedSummary || 'No explicit allow-list found for this lead agent.'}
              </div>
            </div>

            <div className="px-4 pt-4 min-h-0 overflow-hidden">
              {showLayoutDebug && (layoutDebug.middleHeight <= 0 || layoutDebug.chatClientHeight <= 0) && (
                <div className="mb-2 rounded-lg border border-aegis-danger/30 bg-aegis-danger/10 px-2.5 py-2 text-[11px] text-aegis-danger">
                  Debug: scroll region collapsed (mid={layoutDebug.middleHeight}px, chat={layoutDebug.chatClientHeight}px).
                </div>
              )}
              {conversationState?.interrupted && (
                <div className="mb-2 rounded-lg border border-aegis-warning/30 bg-aegis-warning/10 px-3 py-2">
                  <div className="text-[11px] font-semibold text-aegis-warning">Conversation interrupted</div>
                  <div className="text-[10px] text-aegis-text-dim mt-0.5">
                    {conversationState.interruptionReason || 'The previous run did not complete.'}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleResume}
                      disabled={sending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-aegis-warning/30 bg-aegis-warning/15 px-2.5 py-1 text-[10px] font-semibold text-aegis-warning disabled:opacity-50"
                    >
                      <RotateCcw size={11} />
                      Resume
                    </button>
                    <button
                      type="button"
                      onClick={handleDismissResume}
                      className="rounded-md border border-[rgb(var(--aegis-overlay)/0.15)] px-2 py-1 text-[10px] text-aegis-text-dim hover:text-aegis-text"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
              {conversationState?.pending && !conversationState.interrupted && (
                <div className="mb-2 rounded-lg border border-aegis-primary/25 bg-aegis-primary/10 px-2.5 py-1.5 text-[10px] text-aegis-primary">
                  Request in progress{sessionRunning ? ' (session running)' : ''}. Sent {timeAgo(conversationState.lastSentAt)}.
                </div>
              )}
              <div
                ref={chatScrollRef}
                onScroll={handleHistoryScroll}
                className="team-dialog-scroll h-full max-h-full min-h-0 overflow-y-scroll rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.02)] p-3 space-y-2 overscroll-contain"
                style={{ scrollbarGutter: 'stable both-edges' }}
              >
                {loadingHistory && messages.length === 0 && (
                  <div className="text-[12px] text-aegis-text-dim flex items-center gap-2">
                    <Loader2 size={13} className="animate-spin" /> Loading dialog history...
                  </div>
                )}

                {!loadingHistory && messages.length === 0 && (
                  <div className="text-[12px] text-aegis-text-dim text-center py-8">
                    No conversation yet. Send a request to start cowork orchestration.
                  </div>
                )}

                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className={clsx(
                      'max-w-[92%] rounded-xl px-3 py-2 border',
                      message.role === 'user' &&
                        'ml-auto bg-aegis-primary/10 border-aegis-primary/20 text-aegis-text',
                      message.role === 'assistant' &&
                        'mr-auto bg-[rgb(var(--aegis-overlay)/0.03)] border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text',
                      message.role === 'system' &&
                        'mx-auto bg-aegis-warning/10 border-aegis-warning/20 text-aegis-warning text-center',
                    )}
                  >
                    <div className="text-[12px] whitespace-pre-wrap leading-relaxed">{message.content}</div>
                    <div className="text-[10px] text-aegis-text-dim mt-1">{timeAgo(message.timestamp)}</div>
                  </motion.div>
                ))}
              </div>
            </div>

            <div ref={dialogComposerRef} className="p-4 pt-3 flex gap-2 shrink-0">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={3}
                placeholder="Describe objective, constraints, and expected output. The lead agent will delegate to specialists."
                className="flex-1 rounded-xl border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.03)] px-3 py-2 text-[13px] text-aegis-text resize-y"
              />
              <button
                onClick={handleSend}
                disabled={!connected || sending || !input.trim()}
                className={clsx(
                  'self-end h-fit px-3.5 py-2 rounded-xl text-[12px] font-semibold border flex items-center gap-1.5',
                  'text-aegis-primary border-aegis-primary/25 bg-aegis-primary/10',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Send
              </button>
            </div>
          </div>

          {showLayoutDebug && (
            <div
              className="absolute end-3 bottom-3 z-20 w-[320px] rounded-lg border border-aegis-warning/30 bg-black/75 px-2.5 py-2 text-[10px] font-mono text-aegis-warning shadow-lg backdrop-blur-sm pointer-events-auto"
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-aegis-warning/90">Layout debug</span>
                <button
                  type="button"
                  onClick={handleCopyLayoutDebug}
                  className="inline-flex items-center gap-1 rounded border border-aegis-warning/40 bg-aegis-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-aegis-warning hover:bg-aegis-warning/15"
                >
                  {layoutDebugCopied ? <Check size={10} /> : <Copy size={10} />}
                  {layoutDebugCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <textarea
                value={layoutDebugText}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                className="h-[122px] w-full resize-none rounded border border-aegis-warning/25 bg-black/40 px-2 py-1.5 text-[10px] leading-4 text-aegis-warning/95 outline-none"
              />
            </div>
          )}
        </GlassCard>
        </div>

        <div className="xl:col-span-2 space-y-4 h-full min-h-0 overflow-y-auto pr-1 scrollbar-thin">
          <GlassCard noPad>
            <div className="p-5 pb-3 border-b border-[rgb(var(--aegis-overlay)/0.06)]">
              <div className="text-[15px] font-bold text-aegis-text">Cowork Runtime</div>
              <p className="text-[12px] text-aegis-text-dim mt-1">
                Live sessions and cron assignments tied to your team agents.
              </p>
            </div>
            <div className="p-4 space-y-2 max-h-[280px] overflow-y-auto scrollbar-thin">
              {teamSessions.length === 0 && (
                <div className="text-[11px] text-aegis-text-dim py-5 text-center">No team sessions yet.</div>
              )}
              {teamSessions.map((session: any) => {
                const sid = getSessionAgentId(session);
                const matched = leadChoices.find((choice) => normalize(choice.agentId) === normalize(sid));
                return (
                  <div key={session.key} className="rounded-lg border border-[rgb(var(--aegis-overlay)/0.08)] p-2.5 bg-[rgb(var(--aegis-overlay)/0.02)]">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-semibold text-aegis-text truncate">
                        {matched?.title || sid || session.key}
                      </div>
                      <StatusDot status={session?.running ? 'active' : 'idle'} size={6} glow={!!session?.running} />
                    </div>
                    <div className="text-[10px] text-aegis-text-dim font-mono mt-1 truncate">{session.key}</div>
                    <div className="text-[10px] text-aegis-text-dim mt-1">last active: {timeAgo(session?.lastActive || session?.updatedAt)}</div>
                  </div>
                );
              })}
            </div>
          </GlassCard>

          <GlassCard noPad>
            <div className="p-5 pb-3 border-b border-[rgb(var(--aegis-overlay)/0.06)] flex items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-bold text-aegis-text">Delegation Tracker</div>
                <p className="text-[12px] text-aegis-text-dim mt-1">
                  sessions_spawn runs and callback status for this Team Dialog session.
                </p>
              </div>
              <div className="text-[10px] text-aegis-text-dim text-end leading-4">
                <div>Run {delegationCounts.running}</div>
                <div>Done {delegationCounts.completed}</div>
                <div>Fail {delegationCounts.failed + delegationCounts.timed_out + delegationCounts.blocked}</div>
                {recoveredDelegationCount > 0 && <div>Recovered {recoveredDelegationCount}</div>}
                <div>{historyFresh ? 'Live' : 'Stale'}</div>
              </div>
            </div>
            <div className="px-4 pt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleRetryFailedDelegations}
                disabled={!connected || sending || failedDelegations.length === 0}
                className={clsx(
                  'rounded-md border px-2.5 py-1 text-[10px] font-semibold',
                  failedDelegations.length > 0
                    ? 'border-aegis-warning/30 bg-aegis-warning/10 text-aegis-warning'
                    : 'border-[rgb(var(--aegis-overlay)/0.12)] text-aegis-text-dim',
                )}
              >
                Retry Failed ({failedDelegations.length})
              </button>
              <button
                type="button"
                onClick={() => setShowDelegationHistory((prev) => !prev)}
                className="rounded-md border border-[rgb(var(--aegis-overlay)/0.12)] px-2.5 py-1 text-[10px] font-semibold text-aegis-text-dim"
              >
                {showDelegationHistory ? 'Hide History' : 'Show History'}
              </button>
            </div>
            <div className="p-4 space-y-2 max-h-[320px] overflow-y-auto scrollbar-thin">
              {delegationRunsForDisplay.length === 0 && (
                <div className="text-[11px] text-aegis-text-dim py-4 text-center">
                  {recoveredDelegationCount > 0
                    ? 'No active failures. Previous failed runs were superseded by later completions.'
                    : 'No delegation activity yet in this session.'}
                </div>
              )}
              {delegationRunsForDisplay.map((run) => {
                const intentKey = run.intentKey || run.key;
                const latestForIntent = latestDelegationByIntent.get(intentKey);
                const isLatestForIntent = latestForIntent?.key === run.key;
                const isFinalTimeout = run.status === 'timed_out' && isLatestForIntent && !!autoRetryMeta[intentKey]?.finalTimeout;
                const statusMeta = isFinalTimeout
                  ? { label: 'FINAL TIMEOUT', className: 'text-aegis-danger border-aegis-danger/25 bg-aegis-danger/10' }
                  : delegationStatusMeta(run.status);
                const startedAt = toEpochMs(run.spawnedAt);
                const completedAt = toEpochMs(run.completedAt);
                const durationSec = run.runtimeSeconds || (
                  startedAt && completedAt && completedAt > startedAt
                    ? Math.round((completedAt - startedAt) / 1000)
                    : 0
                );
                return (
                  <div
                    key={run.key}
                    className="rounded-lg border border-[rgb(var(--aegis-overlay)/0.08)] p-2.5 bg-[rgb(var(--aegis-overlay)/0.02)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-aegis-text truncate">
                          {run.agentTitle}
                        </div>
                        <div className="text-[10px] text-aegis-text-dim font-mono truncate mt-0.5">
                          {run.runId || 'run id unavailable'}
                        </div>
                      </div>
                      <span className={clsx('text-[9px] px-1.5 py-0.5 rounded-md border', statusMeta.className)}>
                        {statusMeta.label}
                      </span>
                    </div>

                    {!!run.task && (
                      <div className="text-[10px] text-aegis-text-dim mt-1.5 line-clamp-2">
                        task: {run.task}
                      </div>
                    )}
                    {!!run.childSessionKey && (
                      <div className="text-[10px] text-aegis-text-dim font-mono mt-1 truncate">
                        {run.childSessionKey}
                      </div>
                    )}

                    <div className="text-[10px] text-aegis-text-dim mt-1">
                      started {timeAgo(run.spawnedAt)}
                      {durationSec > 0 ? ` · runtime ${durationSec}s` : ''}
                    </div>

                    {!!run.resultSnippet && (
                      <div className="text-[10px] text-aegis-success mt-1 line-clamp-2">
                        result: {run.resultSnippet}
                      </div>
                    )}
                    {!!run.errorText && (
                      <div className="text-[10px] text-aegis-danger mt-1 line-clamp-2">
                        issue: {run.errorText}
                      </div>
                    )}
                    {isFinalTimeout && (
                      <div className="text-[10px] text-aegis-danger mt-1">
                        auto-retry exhausted (1 attempt). Manual retry required.
                      </div>
                    )}
                    {run.status === 'timed_out' && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => void handleRetryOneDelegation(run)}
                          disabled={!connected || sending}
                          className="rounded-md border border-aegis-warning/30 bg-aegis-warning/10 px-2 py-1 text-[10px] font-semibold text-aegis-warning disabled:opacity-50"
                        >
                          Retry This
                        </button>
                      </div>
                    )}
                    {run.status === 'blocked' && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => void handleRerouteBlockedDelegation(run)}
                          disabled={!connected || sending}
                          className="rounded-md border border-aegis-primary/30 bg-aegis-primary/10 px-2 py-1 text-[10px] font-semibold text-aegis-primary disabled:opacity-50"
                        >
                          Reroute
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </GlassCard>

          <GlassCard noPad>
            <div className="p-5 pb-3 border-b border-[rgb(var(--aegis-overlay)/0.06)]">
              <div className="text-[15px] font-bold text-aegis-text">Interaction Matrix</div>
              <p className="text-[12px] text-aegis-text-dim mt-1">Delegation and review edges used by cowork policy.</p>
            </div>
            <div className="p-4 space-y-2 max-h-[280px] overflow-y-auto scrollbar-thin">
              {teamInteractions.map((edge) => {
                const from = teamDefs.find((d) => d.key === edge.from)?.title || edge.from;
                const to = teamDefs.find((d) => d.key === edge.to)?.title || edge.to;
                return (
                  <div key={`${edge.from}-${edge.to}-${edge.mode}`} className="rounded-lg border border-[rgb(var(--aegis-overlay)/0.08)] p-2.5 bg-[rgb(var(--aegis-overlay)/0.02)]">
                    <div className="text-[11px] font-semibold text-aegis-text">{from} → {to}</div>
                    <div className="text-[10px] text-aegis-text-dim mt-1">{edge.mode} · {edge.purpose}</div>
                  </div>
                );
              })}
            </div>
            <div className="p-4 border-t border-[rgb(var(--aegis-overlay)/0.06)] text-[11px] text-aegis-text-dim">
              <div className="font-semibold text-aegis-text mb-1">Cowork protocol (from analyzed patterns)</div>
              <div>Use role specialization + shared state + structured handoff logs for every delegation step.</div>
              <div className="mt-1">Suggested state path: <span className="font-mono">/Users/huangdon/Documents/OntoSynth/openclaw/TEAM_STATE.yaml</span></div>
              <div className="mt-1">Team cron jobs mapped: {teamCronJobs.length}</div>
            </div>
          </GlassCard>

          <GlassCard noPad>
            <div className="p-5 pb-3 border-b border-[rgb(var(--aegis-overlay)/0.06)] flex items-center justify-between gap-3">
              <div>
                <div className="text-[15px] font-bold text-aegis-text">Evolution Review</div>
                <p className="text-[12px] text-aegis-text-dim mt-1">
                  Analyze/propose outputs from Team Contracts. Approve to apply updates.
                </p>
              </div>
              <div className="text-[11px] text-aegis-text-dim">
                Pending: <span className="font-semibold text-aegis-text">{pendingProposals.length}</span>
              </div>
            </div>
            <div className="p-4 space-y-2 max-h-[360px] overflow-y-auto scrollbar-thin">
              {sortedProposals.length === 0 && (
                <div className="text-[11px] text-aegis-text-dim py-4 text-center">
                  No proposals yet. Open Contracts Settings and click <strong>Analyze + Propose</strong>.
                </div>
              )}
              {sortedProposals.map((proposal) => {
                const diffRows = summarizeDiff(proposal.current, proposal.proposed);
                return (
                  <div
                    key={proposal.id}
                    className="rounded-lg border border-[rgb(var(--aegis-overlay)/0.08)] p-2.5 bg-[rgb(var(--aegis-overlay)/0.02)] space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-semibold text-aegis-text">{proposal.agentTitle}</div>
                        <div className="text-[10px] text-aegis-text-dim">
                          {proposal.source === 'gateway' ? 'Gateway' : 'Local fallback'} · {timeAgo(proposal.createdAt)}
                        </div>
                      </div>
                      <span
                        className={clsx(
                          'text-[9px] px-1.5 py-0.5 rounded-md border',
                          proposal.status === 'pending' && 'text-aegis-warning border-aegis-warning/25 bg-aegis-warning/10',
                          proposal.status === 'approved' && 'text-aegis-success border-aegis-success/25 bg-aegis-success/10',
                          proposal.status === 'rejected' && 'text-aegis-danger border-aegis-danger/25 bg-aegis-danger/10',
                        )}
                      >
                        {proposal.status.toUpperCase()}
                      </span>
                    </div>

                    <div className="text-[10px] text-aegis-text-dim">{extractProposalSummary(proposal)}</div>
                    <div className="text-[10px] text-aegis-text-dim space-y-0.5">
                      {diffRows.slice(0, 3).map((line) => (
                        <div key={`${proposal.id}-${line}`} className="truncate">• {line}</div>
                      ))}
                    </div>

                    {!!proposal.rationale && (
                      <div className="text-[10px] text-aegis-text-dim">Rationale: {proposal.rationale}</div>
                    )}

                    {proposal.status === 'pending' ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => void handleApproveProposal(proposal)}
                          className="px-2 py-1 rounded-md border border-aegis-success/25 bg-aegis-success/10 text-aegis-success text-[10px] font-semibold"
                        >
                          Approve & Apply
                        </button>
                        <button
                          onClick={() => handleRejectProposal(proposal)}
                          className="px-2 py-1 rounded-md border border-aegis-danger/25 bg-aegis-danger/10 text-aegis-danger text-[10px] font-semibold"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => removeProposal(proposal.id)}
                          className="px-2 py-1 rounded-md border border-[rgb(var(--aegis-overlay)/0.12)] text-aegis-text-dim text-[10px] font-semibold"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </GlassCard>
        </div>
      </div>

      {!connected && (
        <div className="text-[12px] text-aegis-warning bg-aegis-warning/10 border border-aegis-warning/20 rounded-xl px-3 py-2 shrink-0">
          Gateway is disconnected. Connect to enable team dialog and cowork controls.
        </div>
      )}

      <TeamContractsModal
        open={contractsOpen}
        onClose={() => setContractsOpen(false)}
        definitions={teamDefs}
        profiles={profiles}
        modelOptions={modelOptions}
        modelsLoading={loadingModels}
        modelsError={modelsError}
        selectedKey={selectedContractKey}
        onSelectKey={setSelectedContractKey}
        onLearnFromConversation={handleLearnProfileFromConversation}
        onAnalyzePropose={handleAnalyzeAndPropose}
        onSave={handleSaveProfile}
        onReset={handleResetProfile}
      />
    </PageTransition>
  );
}
