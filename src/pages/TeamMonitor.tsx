import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  Activity,
  Bot,
  Loader2,
  MessageCircle,
  Network,
  RefreshCw,
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
import { TeamAgentProfile, useTeamStudioStore } from '@/stores/teamStudioStore';
import { themeAlpha, themeHex } from '@/utils/theme-colors';

interface TeamChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

interface RoleDraft {
  role: string;
  responsibilities: string;
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

const CLAWHUB_API = 'https://clawhub.ai/api/v1';
const hubSkillSearchCache = new Map<string, HubSkillCandidate[]>();
const hubSkillDetailCache = new Map<string, HubSkillDetail>();

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

function buildDraft(profile: TeamAgentProfile): RoleDraft {
  return {
    role: profile.role,
    responsibilities: profile.responsibilities.join('\n'),
    skills: [...profile.skills],
    outputs: profile.outputs.join('\n'),
  };
}

function buildTeamCharter(
  lead: TeamMemberDefinition,
  profiles: Record<string, TeamAgentProfile>,
  definitions: TeamMemberDefinition[],
  interactions: TeamInteractionDefinition[],
  resolvedAgentByKey: Map<string, string>,
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

  return [
    '[TEAM_STUDIO_CHARTER]',
    `You are ${profiles[lead.key]?.title || lead.title}, the lead for this team session.`,
    'Operate in dialog-first cowork mode:',
    '1) Keep role specialization strict; do not collapse all work into one agent.',
    '2) Delegate with sessions_spawn / sessions_send when specialist execution is needed.',
    '3) Maintain shared state in TEAM_STATE.yaml style (owner, status, blockers, artifacts).',
    '4) Return concise handoff logs after every delegation step.',
    '5) Ask for human approval before irreversible operations.',
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

function StatusPill({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-aegis-text-dim">
      <StatusDot status={active ? 'active' : 'idle'} size={7} glow={active} beacon={active} />
      {active ? 'Active' : 'Idle'}
    </div>
  );
}

function RoleEditorCard({
  definition,
  profile,
  onSave,
  onReset,
}: {
  definition: TeamMemberDefinition;
  profile: TeamAgentProfile;
  onSave: (key: string, draft: RoleDraft) => void;
  onReset: (key: string) => void;
}) {
  const [draft, setDraft] = useState<RoleDraft>(buildDraft(profile));
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
    setSkillResults([]);
    setSkillQuery('');
    setSkillSearchError('');
    setQualificationNote('');
    setLastQualifiedAt('');
    setQualityBySlug({});
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
    !arraysEqual(draft.skills, profile.skills) ||
    splitLines(draft.outputs).join('|') !== profile.outputs.join('|');

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
    onSave(definition.key, finalDraft);
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

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => void handleSave()}
          disabled={!dirty || qualifyingSkills}
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
    </div>
  );
}

function isProfileCustomized(definition: TeamMemberDefinition, profile: TeamAgentProfile): boolean {
  if (profile.role !== definition.role) return true;
  if (profile.responsibilities.join('|') !== definition.responsibilities.join('|')) return true;
  if (profile.skills.join('|') !== definition.skillSet.join('|')) return true;
  if (profile.outputs.join('|') !== definition.outputs.join('|')) return true;
  return false;
}

function TeamContractsModal({
  open,
  onClose,
  definitions,
  profiles,
  selectedKey,
  onSelectKey,
  onSave,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  definitions: TeamMemberDefinition[];
  profiles: Record<string, TeamAgentProfile>;
  selectedKey: string;
  onSelectKey: (key: string) => void;
  onSave: (key: string, draft: RoleDraft) => void;
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

  const { leadAgentId, profiles, setLeadAgentId, syncFromDefinitions, updateProfile, resetProfile } = useTeamStudioStore();

  const [messages, setMessages] = useState<TeamChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [applyingPolicy, setApplyingPolicy] = useState(false);
  const [contractsOpen, setContractsOpen] = useState(false);
  const [selectedContractKey, setSelectedContractKey] = useState('ceo');
  const [notice, setNotice] = useState<{ type: 'ok' | 'error' | 'info'; text: string } | null>(null);

  const primedSessionsRef = useRef<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  const teamDefs = useMemo(() => getTeamDefinitions(), []);
  const teamInteractions = useMemo(() => getTeamInteractions(), []);
  const resolvedMembers = useMemo(() => resolveTeamMembers(agents), [agents]);

  useEffect(() => {
    syncFromDefinitions(teamDefs);
  }, [syncFromDefinitions, teamDefs]);

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

  const activeLead = useMemo(() => {
    return leadChoices.find((item) => item.agentId === leadAgentId) || leadChoices[0] || null;
  }, [leadChoices, leadAgentId]);

  const activeLeadDef = useMemo(() => {
    if (!activeLead) return teamDefs.find((def) => def.key === 'ceo') || teamDefs[0];
    return teamDefs.find((def) => def.key === activeLead.key) || teamDefs[0];
  }, [activeLead, teamDefs]);

  const sessionKey = useMemo(() => buildSessionKey(activeLead?.agentId || leadAgentId || 'main'), [activeLead, leadAgentId]);

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

  const activeSessions = useMemo(() => teamSessions.filter((session: any) => !!session?.running), [teamSessions]);

  const teamRunningSubAgents = useMemo(() => {
    return runningSubAgents.filter((sub) => teamAgentIds.has(sub.agentId));
  }, [runningSubAgents, teamAgentIds]);

  const teamCronJobs = useMemo(() => {
    return cronJobs.filter((job: any) => teamAgentIds.has(inferCronAgentId(job)));
  }, [cronJobs, teamAgentIds]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const loadHistory = useCallback(
    async (showSpinner = true): Promise<TeamChatMessage[]> => {
      if (!connected) return [];
      if (showSpinner) setLoadingHistory(true);
      try {
        const res = await gateway.getHistory(sessionKey, 120);
        const parsed = parseHistory(Array.isArray(res?.messages) ? res.messages : []);
        setMessages(parsed);
        return parsed;
      } catch (err: any) {
        const text = err?.message || String(err);
        setNotice({ type: 'error', text });
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

    const workspaceHint = agents.find((a) => typeof a.workspace === 'string' && a.workspace.trim())?.workspace;
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
            id: definition.openclawAgentId,
            name: definition.title,
            workspace: workspaceHint || undefined,
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
      for (const [agentId, allow] of delegationMap.entries()) {
        try {
          await gateway.call('agents.update', {
            agentId,
            subagents: { allowAgents: Array.from(allow.values()) },
          });
          updated += 1;
        } catch (err: any) {
          failures.push(`${agentId}: ${err?.message || String(err)}`);
        }
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

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!connected || sending || !trimmed || !activeLeadDef) return;

    const sentAt = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: 'user',
        content: trimmed,
        timestamp: sentAt,
      },
    ]);
    setInput('');
    setSending(true);
    setNotice(null);

    const charter = buildTeamCharter(activeLeadDef, profiles, teamDefs, teamInteractions, resolvedAgentByKey);
    const firstMessage = !primedSessionsRef.current.has(sessionKey);
    const outgoing = firstMessage
      ? `${charter}\n\n[USER_REQUEST]\n${trimmed}\n[/USER_REQUEST]`
      : trimmed;

    try {
      await gateway.sendMessage(outgoing, undefined, sessionKey);
      primedSessionsRef.current.add(sessionKey);

      let gotAssistant = false;
      for (let i = 0; i < 16; i += 1) {
        await sleep(1500);
        const latest = await loadHistory(false);
        gotAssistant = latest.some((msg) => msg.role === 'assistant' && toEpochMs(msg.timestamp) >= toEpochMs(sentAt));
        if (gotAssistant) break;
      }

      if (!gotAssistant) {
        setNotice({ type: 'info', text: 'Request sent. Agent is still running; press Refresh to sync latest output.' });
      }
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || String(err) });
      await loadHistory(false);
    } finally {
      setSending(false);
    }
  };

  const handleSaveProfile = (key: string, draft: RoleDraft) => {
    updateProfile(key, {
      role: draft.role.trim() || profiles[key]?.role || '',
      responsibilities: splitLines(draft.responsibilities),
      skills: draft.skills,
      outputs: splitLines(draft.outputs),
    });
    setNotice({ type: 'ok', text: 'Team role updated.' });
  };

  const handleResetProfile = (key: string) => {
    resetProfile(key);
    setNotice({ type: 'info', text: 'Role reset to default.' });
  };

  return (
    <PageTransition className="p-6 space-y-6 max-w-[1380px] mx-auto overflow-y-auto">
      <div className="flex items-start justify-between gap-4">
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Users2, label: 'Team roles', value: teamDefs.length, color: 'primary' as const },
          { icon: ShieldCheck, label: 'Provisioned', value: resolvedMembers.filter((m) => !!m.agent || m.definition.fixed).length, color: 'success' as const },
          { icon: Activity, label: 'Active sessions', value: activeSessions.length, color: 'accent' as const },
          { icon: Bot, label: 'Running sub-agents', value: teamRunningSubAgents.length, color: 'warning' as const },
        ].map((item, idx) => (
          <GlassCard key={item.label} delay={idx * 0.03} hover>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl border flex items-center justify-center"
                style={{
                  background: themeAlpha(item.color, 0.1),
                  borderColor: themeAlpha(item.color, 0.2),
                  color: themeHex(item.color),
                }}
              >
                <item.icon size={16} />
              </div>
              <div>
                <div className="text-[20px] font-bold text-aegis-text">{item.value}</div>
                <div className="text-[11px] text-aegis-text-dim">{item.label}</div>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <GlassCard className="xl:col-span-3" noPad>
          <div className="p-5 pb-3 border-b border-[rgb(var(--aegis-overlay)/0.06)] space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[15px] font-bold text-aegis-text flex items-center gap-2">
                <MessageCircle size={14} />
                Team Dialog Workspace
              </div>
              <StatusPill active={activeSessions.length > 0} />
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
          </div>

          <div className="p-4">
            <div className="h-[420px] overflow-y-auto rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.02)] p-3 space-y-2 scrollbar-thin">
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
              <div ref={bottomRef} />
            </div>

            <div className="mt-3 flex gap-2">
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
                  'h-fit px-3.5 py-2 rounded-xl text-[12px] font-semibold border flex items-center gap-1.5',
                  'text-aegis-primary border-aegis-primary/25 bg-aegis-primary/10',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Send
              </button>
            </div>
          </div>
        </GlassCard>

        <div className="xl:col-span-2 space-y-4">
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
        </div>
      </div>

      {!connected && (
        <div className="text-[12px] text-aegis-warning bg-aegis-warning/10 border border-aegis-warning/20 rounded-xl px-3 py-2">
          Gateway is disconnected. Connect to enable team dialog and cowork controls.
        </div>
      )}

      <TeamContractsModal
        open={contractsOpen}
        onClose={() => setContractsOpen(false)}
        definitions={teamDefs}
        profiles={profiles}
        selectedKey={selectedContractKey}
        onSelectKey={setSelectedContractKey}
        onSave={handleSaveProfile}
        onReset={handleResetProfile}
      />
    </PageTransition>
  );
}
