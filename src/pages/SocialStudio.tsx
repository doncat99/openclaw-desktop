import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CalendarClock, RefreshCw, Send, Settings, Settings2, Sparkles, X } from 'lucide-react';
import clsx from 'clsx';
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';

type Platform =
  | 'linkedin'
  | 'x'
  | 'youtube'
  | 'tiktok'
  | 'threads'
  | 'instagram'
  | 'facebook'
  | 'bluesky';

interface SocialHealth {
  status: string;
  service?: string;
  version?: string;
  backendUrl?: string;
  ready?: boolean;
  accountPersistence?: {
    mode?: 'json' | 'postgres';
  };
  oauth?: {
    linkedinConfigured?: boolean;
    xConfigured?: boolean;
  };
  generation?: {
    defaultContentModel?: string;
    defaultImageModel?: string;
    workspaceContentModel?: string | null;
    workspaceImageModel?: string | null;
    effectiveContentModel?: string;
    effectiveImageModel?: string;
  };
}

interface SocialAccount {
  socialAccountId: string;
  workspaceId?: string;
  platform: Platform;
  handle: string;
  status: 'connected' | 'reauth_required' | 'disabled';
  isDefault?: boolean;
  tags?: string[];
  lastSyncAt?: string;
}

interface SocialPost {
  postId: string;
  platform: Platform;
  socialAccountId: string;
  status: string;
  text: string;
  mediaUrls?: string[];
  scheduledAt?: string;
  publishedAt?: string;
  createdAt: string;
  externalUrl?: string;
}

interface SocialConnectSession {
  sessionId: string;
  platform: Platform;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  socialAccountId?: string;
  error?: string;
}

interface WorkspaceOauthApp {
  workspaceId: string;
  platform: 'linkedin' | 'x';
  clientId: string;
  hasClientSecret: boolean;
  scopes: string[];
  updatedAt?: string;
}

interface WorkspaceGenerationSettings {
  workspaceId: string;
  contentModel?: string;
  imageModel?: string;
  updatedAt?: string;
}

interface GeneratedAsset {
  assetId: string;
  status?: 'ready' | 'pending' | 'failed';
  url?: string;
  prompt?: string;
  source?: string;
  type?: string;
}

interface SocialGenerateCandidate {
  platform: Platform;
  text: string;
  outputType?: 'publishable_post' | 'brief';
  qualityFlags?: string[];
  assets?: GeneratedAsset[];
}

type DraftPreset = {
  id: string;
  label: string;
  brief: string;
  topic: string;
  angle: string;
  audience: string;
  tone: string;
  cta: string;
};

type PlaybookSectorId =
  | 'content_creation'
  | 'account_operations'
  | 'engagement_operations'
  | 'data_analytics'
  | 'commerce_conversion'
  | 'platform_rules'
  | 'tool_ecosystem'
  | 'growth_marketing';

type PlaybookField = {
  key: string;
  label: string;
  placeholder: string;
  defaultValue: string;
};

type PlaybookDefinition = {
  id: string;
  sector: PlaybookSectorId;
  name: string;
  summary: string;
  objective: string;
  kpi: string;
  relatedSkills: string[];
  defaults: {
    topic: string;
    angle: string;
    tone: string;
    audience: string;
    cta: string;
    platforms: Platform[];
  };
  fields: PlaybookField[];
  briefTemplate: string;
  contextTemplate?: string;
};

type PlaybookRunEventType = 'apply' | 'generate' | 'poster' | 'queue' | 'publish';
type PlaybookRunStatus = 'success' | 'failed';

type PlaybookRunRecord = {
  runId: string;
  workspaceId: string;
  playbookId: string;
  eventType: PlaybookRunEventType;
  status: PlaybookRunStatus;
  message: string;
  occurredAt: string;
  outputType?: 'publishable_post' | 'brief' | 'unknown';
  mediaCount?: number;
};

type PlaybookKpiSnapshot = {
  applies: number;
  generateAttempts: number;
  generateSuccess: number;
  generateBriefCount: number;
  posterSuccess: number;
  queueSuccess: number;
  publishSuccess: number;
  lastRunAt?: string;
};

type GenerationOverrides = {
  brief: string;
  topic: string;
  angle: string;
  tone: string;
  audience: string;
  cta: string;
  contextNoteInput: string;
  contextSourcesInput: string;
  contentModel: string;
  imageModel: string;
  selectedPlatforms: Platform[];
  publishPlatform: Platform;
  workspaceId: string;
};

const SUPPORTED_PLATFORMS: Platform[] = [
  'linkedin',
  'x',
  'youtube',
  'tiktok',
  'threads',
  'instagram',
  'facebook',
  'bluesky',
];

const DRAFT_PRESETS: DraftPreset[] = [
  {
    id: 'launch-ai-product',
    label: 'AI launch checklist',
    brief: 'Write a LinkedIn and X post about launching an AI product with a small team in 30 days. Focus on a practical 7-step checklist, include common mistakes, and end with a strong discussion question.',
    topic: 'How a small team can launch an AI product in 30 days',
    angle: '7-step launch checklist + 3 common mistakes',
    audience: 'B2B SaaS founders and product managers',
    tone: 'confident, practical, concise',
    cta: 'Which step do you think most teams skip too early?',
  },
  {
    id: 'pmf-experiment',
    label: 'PMF experiments',
    brief: 'Create a post on finding product-market fit for an AI workflow tool. Emphasize experiments that reduce false-positive demand signals and keep the post tactical.',
    topic: 'Finding product-market fit for an AI workflow tool',
    angle: 'experiments that reduce false-positive demand signals',
    audience: 'early-stage startup operators',
    tone: 'direct and evidence-driven',
    cta: 'What experiment would you run first to validate demand?',
  },
  {
    id: 'content-system',
    label: 'Content system',
    brief: 'Draft a post about building a weekly AI-assisted social content system. Cover a repeatable workflow from idea to publish and include one concrete operating cadence.',
    topic: 'Building a weekly social content system with AI assistance',
    angle: 'repeatable operating cadence from idea to publish',
    audience: 'growth and marketing leads',
    tone: 'actionable and structured',
    cta: 'What part of this workflow would you automate first?',
  },
];

const PLAYBOOK_RUNS_STORAGE_KEY = 'social.playbookRuns.v1';
const PLAYBOOK_RUNS_MAX_PER_WORKSPACE = 300;

const PLAYBOOK_SECTORS: Array<{ id: PlaybookSectorId; label: string; summary: string }> = [
  { id: 'content_creation', label: '01 Content Creation', summary: 'Draft, title, cover, hashtags, poster' },
  { id: 'account_operations', label: '02 Account Operations', summary: 'Positioning, persona, calendar consistency' },
  { id: 'engagement_operations', label: '03 Engagement Ops', summary: 'From source: 03-互动运营' },
  { id: 'data_analytics', label: '04 Data Analytics', summary: 'From source: 03-数据分析' },
  { id: 'commerce_conversion', label: '05 Commerce Conversion', summary: 'Seeding, funnel, trust, conversion rate' },
  { id: 'platform_rules', label: '06 Platform Rules', summary: 'Risk checks, policy-safe phrasing, guardrails' },
  { id: 'tool_ecosystem', label: '07 Tool Ecosystem', summary: 'Workflow SOPs for editing and analytics stack' },
  { id: 'growth_marketing', label: '08 Marketing & Growth', summary: 'Combined source: 07-营销推广 + 08-增长策略' },
];

const PLAYBOOK_DEFINITIONS: PlaybookDefinition[] = [
  {
    id: 'content-production-sprint',
    sector: 'content_creation',
    name: 'Content Production Sprint',
    summary: 'Generate a ready-to-publish post with poster direction.',
    objective: 'Create a publishable post with clear value and CTA.',
    kpi: 'Draft acceptance >= 90%, save rate >= 5%',
    relatedSkills: ['content-planning', 'copywriting-skills', 'cover-design', 'hashtag-optimization'],
    defaults: {
      topic: 'Building a repeatable social content system with AI support',
      angle: 'playbook from idea to publishable output',
      tone: 'confident, practical, concise',
      audience: 'growth and marketing leads',
      cta: 'What part of this workflow would you automate first?',
      platforms: ['linkedin', 'x'],
    },
    fields: [
      { key: 'goal', label: 'Goal', placeholder: 'e.g. Announce new launch process', defaultValue: 'Ship a high-value practical post' },
      { key: 'core_offer', label: 'Core value', placeholder: 'e.g. 5-step checklist', defaultValue: 'A concrete 5-step operating checklist' },
      { key: 'audience_detail', label: 'Audience detail', placeholder: 'e.g. SaaS founders under 20-person teams', defaultValue: 'small product and growth teams' },
      { key: 'constraint', label: 'Constraint', placeholder: 'e.g. avoid hype, no buzzwords', defaultValue: 'clear language, no fluff, specific actions only' },
    ],
    briefTemplate: 'Create a publishable social post. Goal: {goal}. Audience: {audience_detail}. Core value: {core_offer}. Constraint: {constraint}. Structure: practical insight opener, then 3-5 action bullets, then a strong comment-driving CTA.',
    contextTemplate: 'Also produce title options, hashtag set, and one poster image prompt that matches the post angle.',
  },
  {
    id: 'account-positioning-workshop',
    sector: 'account_operations',
    name: 'Account Positioning Workshop',
    summary: 'Lock positioning + persona + content cadence for one workspace.',
    objective: 'Produce positioning statement and 4-week content plan.',
    kpi: 'Positioning clarity score >= 8/10',
    relatedSkills: ['account-positioning', 'persona-building', 'content-calendar', 'content-consistency'],
    defaults: {
      topic: 'How to define account positioning and content cadence',
      angle: 'framework + weekly operating cadence',
      tone: 'professional and clear',
      audience: 'startup founders',
      cta: 'What positioning trade-off would you make differently?',
      platforms: ['linkedin'],
    },
    fields: [
      { key: 'niche', label: 'Niche', placeholder: 'e.g. AI workflow automation for SMB', defaultValue: 'AI workflow automation for SMB operations' },
      { key: 'persona', label: 'Persona', placeholder: 'e.g. practical operator', defaultValue: 'operator-first, execution-focused builder' },
      { key: 'differentiation', label: 'Differentiation', placeholder: 'e.g. from experiments to ops system', defaultValue: 'turn experiments into repeatable operating systems' },
      { key: 'cadence', label: 'Cadence', placeholder: 'e.g. 3 posts/week', defaultValue: '3 posts per week with one monthly deep-dive' },
    ],
    briefTemplate: 'Draft a strategic memo for account operations: niche {niche}, persona {persona}, differentiation {differentiation}, cadence {cadence}. Include a 4-week content plan and measurable checkpoints.',
    contextTemplate: 'Output should include profile bio draft, content pillar table, and a publishing cadence checklist.',
  },
  {
    id: 'engagement-reply-engine',
    sector: 'engagement_operations',
    name: 'Engagement Reply Engine',
    summary: 'Create a structured comment and DM response playbook.',
    objective: 'Increase meaningful comments and return interactions.',
    kpi: 'Meaningful reply rate >= 25%',
    relatedSkills: ['comment-strategy', 'community-management', 'follower-retention', 'social-listening'],
    defaults: {
      topic: 'Building an engagement loop that compounds community trust',
      angle: 'do this / avoid this comparison',
      tone: 'friendly and educational',
      audience: 'creator-economy professionals',
      cta: 'What reply style gets the best discussions for your audience?',
      platforms: ['linkedin', 'x'],
    },
    fields: [
      { key: 'conversation_goal', label: 'Conversation goal', placeholder: 'e.g. move comments from praise to discussion', defaultValue: 'turn short comments into deeper discussion' },
      { key: 'community_type', label: 'Community type', placeholder: 'e.g. founders / creators / buyers', defaultValue: 'operators and growth-minded professionals' },
      { key: 'tone_guardrail', label: 'Tone guardrail', placeholder: 'e.g. polite but direct', defaultValue: 'respectful, direct, and specific' },
      { key: 'response_sla', label: 'Reply SLA', placeholder: 'e.g. within 2 hours', defaultValue: 'reply to priority comments within 2 hours' },
    ],
    briefTemplate: 'Build an engagement operations playbook. Goal: {conversation_goal}. Community: {community_type}. Tone guardrail: {tone_guardrail}. SLA: {response_sla}. Include comment templates, escalation rules, and retention triggers.',
    contextTemplate: 'Include examples for positive feedback, objections, misinformation, and conversion-oriented questions.',
  },
  {
    id: 'weekly-analytics-review',
    sector: 'data_analytics',
    name: 'Weekly Analytics Review',
    summary: 'Generate a weekly insight report and action backlog.',
    objective: 'Turn content metrics into next-week decisions.',
    kpi: 'Week-over-week engagement uplift >= 15%',
    relatedSkills: ['data-analytics', 'content-performance-analysis', 'timing-analysis', 'topic-analysis'],
    defaults: {
      topic: 'How to run weekly social analytics review',
      angle: 'data-backed and precise',
      tone: 'calm and analytical',
      audience: 'operations leaders',
      cta: 'Which metric would you prioritize first next week?',
      platforms: ['linkedin'],
    },
    fields: [
      { key: 'time_window', label: 'Time window', placeholder: 'e.g. last 7 days', defaultValue: 'last 7 days' },
      { key: 'north_star_metric', label: 'North-star metric', placeholder: 'e.g. save rate', defaultValue: 'save rate' },
      { key: 'top_pattern', label: 'Top pattern observed', placeholder: 'e.g. tactical checklists outperform opinions', defaultValue: 'practical checklist posts outperform opinion-only posts' },
      { key: 'underperforming_area', label: 'Underperforming area', placeholder: 'e.g. low retention on long posts', defaultValue: 'low completion on long-form posts' },
    ],
    briefTemplate: 'Create a weekly analytics report for {time_window}. North-star metric: {north_star_metric}. Top pattern: {top_pattern}. Underperforming area: {underperforming_area}. Output: diagnosis, hypotheses, and next 5 experiments.',
    contextTemplate: 'Provide action priorities for topic, format, posting time, and CTA style.',
  },
  {
    id: 'commerce-conversion-funnel',
    sector: 'commerce_conversion',
    name: 'Commerce Conversion Funnel',
    summary: 'Design a conversion-focused content + offer sequence.',
    objective: 'Improve funnel conversion without increasing traffic.',
    kpi: 'Conversion rate uplift >= 20%',
    relatedSkills: ['product-selection', 'seeding-content-creation', 'sales-funnel', 'conversion-optimization'],
    defaults: {
      topic: 'How to increase social commerce conversion through trust and funnel design',
      angle: 'risk map + mitigation actions',
      tone: 'authoritative and strategic',
      audience: 'SMB business owners',
      cta: 'Where do you see the biggest drop-off in your funnel?',
      platforms: ['linkedin', 'x'],
    },
    fields: [
      { key: 'offer', label: 'Offer', placeholder: 'e.g. AI toolkit package', defaultValue: 'AI workflow toolkit package' },
      { key: 'price_band', label: 'Price band', placeholder: 'e.g. $49-$99', defaultValue: '$49-$99' },
      { key: 'funnel_gap', label: 'Main funnel gap', placeholder: 'e.g. high cart abandonment', defaultValue: 'high intent but low checkout completion' },
      { key: 'trust_proof', label: 'Trust proof', placeholder: 'e.g. customer cases', defaultValue: 'customer case snippets and before/after outcomes' },
    ],
    briefTemplate: 'Draft a conversion optimization playbook for offer {offer} at {price_band}. Bottleneck: {funnel_gap}. Trust proof available: {trust_proof}. Provide seeding content angle, offer framing, and CTA sequence.',
    contextTemplate: 'Include objection handling, social proof insertion points, and urgency mechanism without overclaiming.',
  },
  {
    id: 'compliance-precheck-guard',
    sector: 'platform_rules',
    name: 'Compliance Precheck Guard',
    summary: 'Pre-publish risk scan and safe rewrite guidance.',
    objective: 'Reduce policy risk while keeping performance language.',
    kpi: 'Policy-risk incidents = 0',
    relatedSkills: ['community-guidelines', 'content-review', 'penalty-avoidance', 'violation-handling'],
    defaults: {
      topic: 'How to run policy-safe publishing checks before posting',
      angle: 'common anti-patterns and fixes',
      tone: 'neutral and informative',
      audience: 'content strategists',
      cta: 'What compliance risk appears most often in your drafts?',
      platforms: ['linkedin', 'x'],
    },
    fields: [
      { key: 'sensitive_claim', label: 'Sensitive claim', placeholder: 'e.g. performance guarantee', defaultValue: 'results and performance claims' },
      { key: 'high_risk_terms', label: 'High-risk terms', placeholder: 'comma separated', defaultValue: 'guaranteed, fastest, no risk' },
      { key: 'platform_focus', label: 'Platform focus', placeholder: 'e.g. LinkedIn + X', defaultValue: 'LinkedIn and X' },
      { key: 'safety_goal', label: 'Safety goal', placeholder: 'e.g. reduce moderation flags', defaultValue: 'avoid moderation flags while preserving persuasion' },
    ],
    briefTemplate: 'Run a pre-publish compliance review. Sensitive claim area: {sensitive_claim}. High-risk terms: {high_risk_terms}. Platform scope: {platform_focus}. Goal: {safety_goal}. Return risk checklist and safe rewrite options.',
    contextTemplate: 'Provide red/yellow/green risk labels and replacement phrasing for each risky sentence.',
  },
  {
    id: 'tool-ecosystem-sop',
    sector: 'tool_ecosystem',
    name: 'Tool Ecosystem SOP',
    summary: 'Build a practical tool-chain SOP for content operations.',
    objective: 'Reduce production time with standardized tool workflow.',
    kpi: 'Cycle time reduction >= 30%',
    relatedSkills: ['jiaying-tool', 'xingtu-tool', 'canva', 'qiangua-data'],
    defaults: {
      topic: 'How to standardize a social content tool stack',
      angle: 'template + reusable process walkthrough',
      tone: 'actionable and structured',
      audience: 'agency owners',
      cta: 'Which step in your tool chain is still the bottleneck?',
      platforms: ['linkedin'],
    },
    fields: [
      { key: 'team_size', label: 'Team size', placeholder: 'e.g. 3 creators + 1 editor', defaultValue: '3 creators and 1 operator' },
      { key: 'current_stack', label: 'Current stack', placeholder: 'e.g. Canva + CapCut + Sheets', defaultValue: 'Canva, CapCut, and spreadsheet tracking' },
      { key: 'throughput_target', label: 'Throughput target', placeholder: 'e.g. 15 posts/week', defaultValue: '15 posts per week' },
      { key: 'quality_guardrail', label: 'Quality guardrail', placeholder: 'e.g. no off-brand visuals', defaultValue: 'consistent visual style and factual accuracy' },
    ],
    briefTemplate: 'Design a tool-ecosystem SOP for a team of {team_size}. Current stack: {current_stack}. Throughput target: {throughput_target}. Quality guardrail: {quality_guardrail}. Include roles, handoff checkpoints, and QA checklist.',
    contextTemplate: 'Output should include daily workflow, weekly review, and fallback when a tool is unavailable.',
  },
  {
    id: 'marketing-growth-sprint',
    sector: 'growth_marketing',
    name: 'Marketing & Growth Sprint',
    summary: 'Plan campaigns plus growth experiments in one board.',
    objective: 'Drive incremental reach and compounding follower growth.',
    kpi: 'Follower growth >= 10% MoM, campaign ROI positive',
    relatedSkills: ['content-marketing', 'KOL-collaboration', 'viral-strategy', 'traffic-acquisition'],
    defaults: {
      topic: 'How to run a combined campaign and growth experiment sprint',
      angle: 'operating model for speed + quality',
      tone: 'executive and business-first',
      audience: 'CMOs and growth executives',
      cta: 'Which experiment would you run in week one?',
      platforms: ['linkedin', 'x'],
    },
    fields: [
      { key: 'campaign_goal', label: 'Campaign goal', placeholder: 'e.g. leads, signups, sales', defaultValue: 'qualified inbound leads' },
      { key: 'budget', label: 'Budget', placeholder: 'e.g. $5k/month', defaultValue: '$5k monthly test budget' },
      { key: 'distribution_channels', label: 'Distribution channels', placeholder: 'e.g. KOL + paid + organic', defaultValue: 'organic posts, KOL collaboration, and paid boosts' },
      { key: 'experiment_window', label: 'Experiment window', placeholder: 'e.g. 4 weeks', defaultValue: '4-week sprint' },
    ],
    briefTemplate: 'Create a campaign and growth sprint plan. Goal: {campaign_goal}. Budget: {budget}. Channels: {distribution_channels}. Window: {experiment_window}. Include experiment matrix, metrics, and decision thresholds.',
    contextTemplate: 'Return a weekly execution board with owner, KPI, and stop/scale criteria.',
  },
];

const CUSTOM_OPTION_VALUE = '__custom__';

const DEFAULT_CONTENT_MODEL_OPTIONS = [
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1-nano',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/o3',
  'openai/o3-mini',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3.5-haiku',
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'google/gemini-2.0-flash-001',
  'google/gemini-2.0-pro-exp-02-05',
  'meta-llama/llama-3.3-70b-instruct',
  'meta-llama/llama-3.1-405b-instruct',
  'qwen/qwen-2.5-72b-instruct',
  'deepseek/deepseek-chat',
  'mistralai/mistral-large',
  'mistralai/mixtral-8x22b-instruct',
  'x-ai/grok-3-beta',
];

const DEFAULT_IMAGE_MODEL_OPTIONS = [
  'google/gemini-2.5-flash-image-preview',
  'openai/gpt-image-1',
  'black-forest-labs/flux-1.1-pro',
  'black-forest-labs/flux-pro',
  'black-forest-labs/flux-dev',
  'stabilityai/stable-diffusion-3.5-large',
  'stabilityai/stable-diffusion-3.5-medium',
  'stabilityai/stable-image-core',
  'stabilityai/stable-image-ultra',
  'ideogram/ideogram-v2',
];

const TOPIC_OPTIONS = [
  'How a small team can launch an AI product in 30 days',
  'Finding product-market fit for an AI workflow tool',
  'Building a weekly AI-assisted social content system',
  'AI go-to-market strategy for B2B SaaS',
  'How to validate an AI product idea before coding',
  'Pricing AI products without killing adoption',
  'Reducing hallucination risk in customer-facing AI',
  'Designing human-in-the-loop AI operations',
  'From prototype to production for AI agents',
  'AI onboarding flows that reduce time-to-value',
  'How founders can build distribution before product perfection',
  'Writing better product narratives for AI startups',
  'Operational metrics that actually matter for AI products',
  'Building trust in AI features with transparent UX',
  'How to ship AI features weekly with a small team',
  'Choosing the first AI use case in an existing business',
  'Integrating AI into existing workflows without disruption',
  'Why most AI projects fail after pilot phase',
  'Creating an internal AI adoption playbook',
  'Cross-functional collaboration for AI delivery',
];

const ANGLE_OPTIONS = [
  '7-step launch checklist + 3 common mistakes',
  'Actionable checklist + common mistakes',
  'Myths vs reality with practical examples',
  'Framework + weekly operating cadence',
  'Do this / avoid this comparison',
  'Case-study style breakdown',
  'Before-and-after transformation narrative',
  'Decision tree for execution choices',
  'Playbook from idea to measurable outcome',
  'Root-cause analysis of failed AI launches',
  'Resource-constrained strategy for small teams',
  'High-leverage priorities for first 90 days',
  'Experiment design and validation sequence',
  'Risk map + mitigation actions',
  'Template + reusable process walkthrough',
  'Contrarian take with evidence',
  'Common anti-patterns and fixes',
  'Operating model for speed + quality',
  'Leadership alignment checklist',
  'Tactical roadmap with milestones',
];

const TONE_OPTIONS = [
  'confident, practical, concise',
  'direct and evidence-driven',
  'actionable and structured',
  'professional and clear',
  'friendly and educational',
  'authoritative and strategic',
  'bold and opinionated',
  'calm and analytical',
  'empathetic and helpful',
  'concise and punchy',
  'story-led and conversational',
  'executive and business-first',
  'technical but accessible',
  'data-backed and precise',
  'inspiring but grounded',
  'neutral and informative',
];

const AUDIENCE_OPTIONS = [
  'B2B SaaS founders and product managers',
  'early-stage startup operators',
  'growth and marketing leads',
  'startup founders',
  'product managers',
  'engineering leaders',
  'AI/ML teams',
  'operations leaders',
  'CMOs and growth executives',
  'content strategists',
  'agency owners',
  'indie hackers',
  'enterprise innovation teams',
  'SMB business owners',
  'creator-economy professionals',
  'sales and revops teams',
];

const CTA_OPTIONS = [
  'Which step do you think most teams skip too early?',
  'What experiment would you run first to validate demand?',
  'What part of this workflow would you automate first?',
  'What would you challenge in this approach?',
  'What is your strongest counterpoint?',
  'What did I miss that matters most?',
  'Would you do this differently? Why?',
  'What has worked best for your team?',
  'Where do you see the biggest risk?',
  'What is the one thing you would prioritize first?',
  'Agree or disagree? Share your reasoning.',
  'What mistake have you seen most often?',
  'Which metric would you track first?',
  'What would you test in week one?',
  'What is your playbook here?',
  'What trade-off would you make differently?',
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

function fmtWhen(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function defaultScheduleValue(): string {
  const date = new Date(Date.now() + 30 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function platformLabel(platform: Platform): string {
  if (platform === 'linkedin') return 'LinkedIn';
  if (platform === 'x') return 'X';
  return platform;
}

function parseDelimitedInput(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,\n]+/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  );
}

function playbookFieldStateKey(playbookId: string, fieldKey: string): string {
  return `${playbookId}:${fieldKey}`;
}

function renderTemplateString(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => values[key] || '');
}

function createEmptyPlaybookKpi(): PlaybookKpiSnapshot {
  return {
    applies: 0,
    generateAttempts: 0,
    generateSuccess: 0,
    generateBriefCount: 0,
    posterSuccess: 0,
    queueSuccess: 0,
    publishSuccess: 0,
  };
}

function loadPlaybookRunsByWorkspace(): Record<string, PlaybookRunRecord[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PLAYBOOK_RUNS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const record: Record<string, PlaybookRunRecord[]> = {};
    for (const [workspaceId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const rows = value
        .map((item) => asRecord(item))
        .map((item) => ({
          runId: typeof item.runId === 'string' ? item.runId : '',
          workspaceId: typeof item.workspaceId === 'string' ? item.workspaceId : workspaceId,
          playbookId: typeof item.playbookId === 'string' ? item.playbookId : '',
          eventType: (item.eventType === 'apply'
            || item.eventType === 'generate'
            || item.eventType === 'poster'
            || item.eventType === 'queue'
            || item.eventType === 'publish'
            ? item.eventType
            : 'generate') as PlaybookRunEventType,
          status: (item.status === 'success' || item.status === 'failed' ? item.status : 'success') as PlaybookRunStatus,
          message: typeof item.message === 'string' ? item.message : '',
          occurredAt: typeof item.occurredAt === 'string' ? item.occurredAt : new Date().toISOString(),
          outputType: (item.outputType === 'publishable_post' || item.outputType === 'brief' || item.outputType === 'unknown')
            ? item.outputType
            : undefined,
          mediaCount: typeof item.mediaCount === 'number' ? item.mediaCount : undefined,
        }))
        .filter((item) => item.runId && item.playbookId)
        .slice(0, PLAYBOOK_RUNS_MAX_PER_WORKSPACE);
      if (rows.length > 0) {
        record[workspaceId] = rows;
      }
    }
    return record;
  } catch {
    return {};
  }
}

function savePlaybookRunsByWorkspace(data: Record<string, PlaybookRunRecord[]>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PLAYBOOK_RUNS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore storage errors to keep UI responsive
  }
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function isOptionValue(current: string, options: readonly string[]): boolean {
  const normalized = current.trim();
  if (!normalized) return false;
  return options.includes(normalized);
}

function parseCandidate(raw: unknown): SocialGenerateCandidate | null {
  const record = asRecord(raw);
  const platform = record.platform;
  const text = typeof record.text === 'string' ? record.text : '';
  if (typeof platform !== 'string' || !text) return null;
  const assetsRaw = Array.isArray(record.assets) ? record.assets : [];
  const assets: GeneratedAsset[] = assetsRaw
    .map((item) => asRecord(item))
    .map((item) => ({
      assetId: typeof item.assetId === 'string' ? item.assetId : '',
      status: (typeof item.status === 'string' ? item.status : undefined) as GeneratedAsset['status'],
      url: typeof item.url === 'string' ? item.url : undefined,
      prompt: typeof item.prompt === 'string' ? item.prompt : undefined,
      source: typeof item.source === 'string' ? item.source : undefined,
      type: typeof item.type === 'string' ? item.type : undefined,
    }))
    .filter((item) => item.assetId);

  return {
    platform: platform as Platform,
    text,
    outputType: (record.outputType === 'publishable_post' || record.outputType === 'brief')
      ? record.outputType
      : undefined,
    qualityFlags: toStringList(record.qualityFlags),
    assets,
  };
}

function candidateReadyMediaUrls(candidate: SocialGenerateCandidate | null): string[] {
  if (!candidate || !Array.isArray(candidate.assets)) return [];
  const urls = candidate.assets
    .filter((asset) => asset.status === 'ready' && typeof asset.url === 'string' && asset.url.trim())
    .map((asset) => asset.url!.trim());
  if (urls.length > 0) return Array.from(new Set(urls));
  const fallback = candidate.assets
    .filter((asset) => typeof asset.url === 'string' && asset.url.trim())
    .map((asset) => asset.url!.trim());
  return Array.from(new Set(fallback));
}

const BRIEF_LABEL_PATTERN = /^\s*(topic|angle|audience|tone|cta|hook|hashtags?)\s*:/i;

function isBriefLikeText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labelLines = lines.filter((line) => BRIEF_LABEL_PATTERN.test(line)).length;
  const hasTemplateCue = /lead with a practical insight|comment prompt|strongest counterpoint/i.test(trimmed);
  return labelLines >= 3 || (hasTemplateCue && labelLines >= 1);
}

function deriveTopicFromBrief(brief: string): string {
  const normalized = brief.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const firstSentence = normalized.split(/[.!?]/)[0]?.trim() || normalized;
  const lowered = firstSentence.toLowerCase();
  let withoutPromptPrefix = firstSentence;
  if (/^(write|create|draft|generate|compose|make)\b/i.test(firstSentence)) {
    const aboutIndex = lowered.indexOf(' about ');
    const onIndex = lowered.indexOf(' on ');
    if (aboutIndex >= 0) {
      withoutPromptPrefix = firstSentence.slice(aboutIndex + ' about '.length);
    } else if (onIndex >= 0) {
      withoutPromptPrefix = firstSentence.slice(onIndex + ' on '.length);
    }
  }
  withoutPromptPrefix = withoutPromptPrefix
    .replace(
      /^(an?\s+|the\s+)?(linkedin|x|twitter|facebook|instagram|threads|bluesky|youtube|tiktok)?\s*(post|thread|tweet|caption)\s*(about|on)\s+/i,
      '',
    )
    .replace(/^(about|on)\s+/i, '')
    .trim();
  const withoutDirectiveTail = withoutPromptPrefix
    .split(/\b(include|focus on|make it|end with|keep it|use)\b/i)[0]
    ?.trim() || '';
  const candidate = withoutDirectiveTail || withoutPromptPrefix || firstSentence;
  return candidate.slice(0, 140).trim();
}

function resolvePrimaryTopic(brief: string, topic: string): string {
  return topic.trim() || deriveTopicFromBrief(brief) || 'AI execution strategy';
}

function buildClientFallbackPost(brief: string, topic: string, angle: string, tone: string, audience: string, cta: string): string {
  const topicText = resolvePrimaryTopic(brief, topic);
  const audienceText = audience.trim() || 'growth-minded professionals';
  const angleText = angle.trim() || 'one clear action checklist and common mistakes';
  const ctaText = cta.trim() || 'What would you challenge in this approach?';
  const tonePrefix = tone.trim() ? `${tone.trim()}. ` : '';
  return [
    `Most teams don’t fail at ${topicText} because of weak ideas; they fail because execution gets too complex too early.`,
    `For ${audienceText}, start with ${angleText}, track one leading KPI weekly, and remove any task that doesn’t improve shipping speed or quality.`,
    `${tonePrefix}${ctaText}`,
  ].join('\n\n');
}

export function SocialStudioPage() {
  const connected = useChatStore((state) => state.connected);
  const oauthPopupRef = useRef<Window | null>(null);

  const [workspaceId, setWorkspaceId] = useState(
    () => window.localStorage.getItem('social.workspaceId') || 'default',
  );
  const [health, setHealth] = useState<SocialHealth | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [oauthApps, setOauthApps] = useState<WorkspaceOauthApp[]>([]);
  const [generationSettings, setGenerationSettings] = useState<WorkspaceGenerationSettings | null>(null);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [brief, setBrief] = useState('Create a post about launching an AI product with a small team. Make it practical, include mistakes to avoid, and end with a question that drives comments.');
  const [topic, setTopic] = useState('');
  const [topicCustom, setTopicCustom] = useState(false);
  const [angle, setAngle] = useState('');
  const [angleCustom, setAngleCustom] = useState(false);
  const [tone, setTone] = useState('');
  const [toneCustom, setToneCustom] = useState(false);
  const [audience, setAudience] = useState('');
  const [audienceCustom, setAudienceCustom] = useState(false);
  const [cta, setCta] = useState('');
  const [ctaCustom, setCtaCustom] = useState(false);
  const [contextSourcesInput, setContextSourcesInput] = useState('');
  const [contextNoteInput, setContextNoteInput] = useState('');
  const [referenceFileName, setReferenceFileName] = useState('');
  const [contentModel, setContentModel] = useState('');
  const [contentModelCustom, setContentModelCustom] = useState(false);
  const [imageModel, setImageModel] = useState('');
  const [imageModelCustom, setImageModelCustom] = useState(false);
  const [availableContentModels, setAvailableContentModels] = useState<string[]>(DEFAULT_CONTENT_MODEL_OPTIONS);
  const [availableImageModels, setAvailableImageModels] = useState<string[]>(DEFAULT_IMAGE_MODEL_OPTIONS);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(['linkedin', 'x']);
  const [generatedText, setGeneratedText] = useState('');
  const [generatedOutputType, setGeneratedOutputType] = useState<'publishable_post' | 'brief' | 'unknown'>('unknown');
  const [generatedQualityFlags, setGeneratedQualityFlags] = useState<string[]>([]);
  const [generatedAssets, setGeneratedAssets] = useState<GeneratedAsset[]>([]);
  const [selectedMediaUrls, setSelectedMediaUrls] = useState<string[]>([]);
  const [generatingPoster, setGeneratingPoster] = useState(false);

  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [publishPlatform, setPublishPlatform] = useState<Platform>('linkedin');
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleValue);
  const [actionMessage, setActionMessage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [connectSessionId, setConnectSessionId] = useState('');
  const [connectPlatform, setConnectPlatform] = useState<Platform | ''>('');
  const [connectingOAuth, setConnectingOAuth] = useState(false);
  const [connectMessage, setConnectMessage] = useState('');
  const [disconnectingAccountId, setDisconnectingAccountId] = useState('');
  const [savingAccountSettings, setSavingAccountSettings] = useState(false);
  const [accountTagsInput, setAccountTagsInput] = useState('');
  const [settingsMessage, setSettingsMessage] = useState('');
  const [savingOauthPlatform, setSavingOauthPlatform] = useState<'' | 'linkedin' | 'x'>('');
  const [savingGenerationSettings, setSavingGenerationSettings] = useState(false);
  const [refreshingModelCatalog, setRefreshingModelCatalog] = useState(false);
  const [linkedInClientId, setLinkedInClientId] = useState('');
  const [linkedInClientSecret, setLinkedInClientSecret] = useState('');
  const [linkedInScopesInput, setLinkedInScopesInput] = useState('');
  const [xClientId, setXClientId] = useState('');
  const [xClientSecret, setXClientSecret] = useState('');
  const [xScopesInput, setXScopesInput] = useState('');
  const [activePlaybookSector, setActivePlaybookSector] = useState<PlaybookSectorId>('content_creation');
  const [activePlaybookId, setActivePlaybookId] = useState<string>('content-production-sprint');
  const [playbookFieldValues, setPlaybookFieldValues] = useState<Record<string, string>>({});
  const [draftPlaybookId, setDraftPlaybookId] = useState('');
  const [playbookRunsByWorkspace, setPlaybookRunsByWorkspace] = useState<Record<string, PlaybookRunRecord[]>>(
    () => loadPlaybookRunsByWorkspace(),
  );

  const applyDraftPreset = useCallback((preset: DraftPreset) => {
    setBrief(preset.brief);
    setTopic(preset.topic);
    setTopicCustom(false);
    setAngle(preset.angle);
    setAngleCustom(false);
    setAudience(preset.audience);
    setAudienceCustom(false);
    setTone(preset.tone);
    setToneCustom(false);
    setCta(preset.cta);
    setCtaCustom(false);
    setContextNoteInput('');
    setContextSourcesInput('');
    setReferenceFileName('');
    setActionMessage(`Applied preset: ${preset.label}`);
  }, []);

  const loadReferenceFile = useCallback(async (file: File) => {
    const text = (await file.text()).trim();
    const compact = text.replace(/\s+/g, ' ').slice(0, 3000);
    if (!compact) {
      setActionMessage(`Reference file "${file.name}" is empty.`);
      return;
    }
    setReferenceFileName(file.name);
    setContextNoteInput((current) => {
      const prefix = current.trim();
      const block = `[Reference file: ${file.name}]\n${compact}`;
      if (!prefix) return block;
      return `${prefix}\n\n${block}`;
    });
    setActionMessage(`Loaded reference file: ${file.name}`);
  }, []);

  const closeOauthPopup = useCallback(() => {
    const popup = oauthPopupRef.current;
    if (popup && !popup.closed) {
      try {
        popup.close();
      } catch {
        // ignore popup close errors
      }
    }
    oauthPopupRef.current = null;
  }, []);

  const resetOauthPendingState = useCallback(() => {
    setConnectSessionId('');
    setConnectPlatform('');
    setConnectingOAuth(false);
  }, []);

  const cancelOauthWaiting = useCallback(() => {
    closeOauthPopup();
    if (connectSessionId || connectingOAuth) {
      setConnectMessage('OAuth flow canceled. You can connect again.');
    }
    resetOauthPendingState();
  }, [closeOauthPopup, connectSessionId, connectingOAuth, resetOauthPendingState]);

  const applyGenerationSettingsPayload = useCallback(
    (
      rawPayload: Record<string, unknown>,
      options?: {
        preserveModelSelection?: boolean;
      },
    ) => {
      const preserveModelSelection = options?.preserveModelSelection === true;
      const generationSettingsRaw = asRecord(rawPayload.generationSettings);
      const nextGenerationSettings =
        generationSettingsRaw && typeof generationSettingsRaw.workspaceId === 'string'
          ? (generationSettingsRaw as WorkspaceGenerationSettings)
          : null;
      setGenerationSettings(nextGenerationSettings);

      const defaultsRaw = asRecord(rawPayload.defaults);
      const defaultContentModel = typeof defaultsRaw.contentModel === 'string'
        ? defaultsRaw.contentModel.trim()
        : '';
      const defaultImageModel = typeof defaultsRaw.imageModel === 'string'
        ? defaultsRaw.imageModel.trim()
        : '';
      const availableModelsRaw = asRecord(rawPayload.availableModels);
      const contentModelOptions = toStringList(availableModelsRaw.content);
      const imageModelOptions = toStringList(availableModelsRaw.image);
      const mergedContentModels = Array.from(
        new Set([
          ...DEFAULT_CONTENT_MODEL_OPTIONS,
          ...contentModelOptions,
          defaultContentModel,
          nextGenerationSettings?.contentModel || '',
        ].filter(Boolean)),
      );
      const mergedImageModels = Array.from(
        new Set([
          ...DEFAULT_IMAGE_MODEL_OPTIONS,
          ...imageModelOptions,
          defaultImageModel,
          nextGenerationSettings?.imageModel || '',
        ].filter(Boolean)),
      );
      setAvailableContentModels(mergedContentModels);
      setAvailableImageModels(mergedImageModels);

      if (!preserveModelSelection) {
        const nextContentModel = nextGenerationSettings?.contentModel || defaultContentModel || '';
        const nextImageModel = nextGenerationSettings?.imageModel || defaultImageModel || '';
        setContentModel(nextContentModel);
        setImageModel(nextImageModel);
        setContentModelCustom(Boolean(nextContentModel) && !isOptionValue(nextContentModel, mergedContentModels));
        setImageModelCustom(Boolean(nextImageModel) && !isOptionValue(nextImageModel, mergedImageModels));
      }
    },
    [],
  );

  const loadOverview = useCallback(async () => {
    if (!connected) {
      setPanelError('Gateway disconnected');
      return;
    }

    setLoading(true);
    setPanelError('');
    try {
      const [healthRaw, accountsRaw, oauthAppsRaw, generationRaw, postsRaw] = await Promise.all([
        gateway.getSocialHealth({ workspaceId }),
        gateway.listSocialAccounts({ workspaceId }),
        gateway.listSocialWorkspaceOauthApps({ workspaceId }),
        gateway.getSocialGenerationSettings({ workspaceId }),
        gateway.listSocialPosts({ limit: 12, workspaceId }),
      ]);

      const healthPayload = asRecord(healthRaw);
      if (healthPayload.status === 'error') {
        throw new Error(getErrorMessage(healthPayload.error, 'social.health failed'));
      }
      setHealth(healthPayload as SocialHealth);

      const accountsPayload = asRecord(accountsRaw);
      if (accountsPayload.status === 'error') {
        throw new Error(getErrorMessage(accountsPayload.error, 'social.accounts.list failed'));
      }
      const nextAccounts = Array.isArray(accountsPayload.accounts)
        ? (accountsPayload.accounts as SocialAccount[])
        : [];
      setAccounts(nextAccounts);

      const oauthAppsPayload = asRecord(oauthAppsRaw);
      if (oauthAppsPayload.status === 'error') {
        throw new Error(getErrorMessage(oauthAppsPayload.error, 'social.settings.oauth_apps.list failed'));
      }
      const nextOauthApps = Array.isArray(oauthAppsPayload.oauthApps)
        ? (oauthAppsPayload.oauthApps as WorkspaceOauthApp[])
        : [];
      setOauthApps(nextOauthApps);

      const generationPayload = asRecord(generationRaw);
      if (generationPayload.status === 'error') {
        throw new Error(getErrorMessage(generationPayload.error, 'social.settings.generation.list failed'));
      }
      applyGenerationSettingsPayload(generationPayload, { preserveModelSelection: false });

      const postsPayload = asRecord(postsRaw);
      if (postsPayload.status === 'error') {
        throw new Error(getErrorMessage(postsPayload.error, 'social.posts.list failed'));
      }
      const nextPosts = Array.isArray(postsPayload.posts)
        ? (postsPayload.posts as SocialPost[])
        : [];
      setPosts(nextPosts);

      if (nextAccounts.length > 0) {
        const defaultAccount = nextAccounts.find((account) => account.status === 'connected' && account.isDefault)
          || nextAccounts.find((account) => account.status === 'connected')
          || nextAccounts[0];
        setSelectedAccountId((current) => {
          if (current && nextAccounts.some((account) => account.socialAccountId === current)) {
            return current;
          }
          return defaultAccount.socialAccountId;
        });
        setPublishPlatform(defaultAccount.platform);
      } else {
        setSelectedAccountId('');
      }
    } catch (error) {
      setPanelError(getErrorMessage(error, 'Failed to load social overview from gateway'));
    } finally {
      setLoading(false);
    }
  }, [applyGenerationSettingsPayload, connected, workspaceId]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.socialAccountId === selectedAccountId) || null,
    [accounts, selectedAccountId],
  );
  const publishableAccounts = useMemo(
    () => accounts.filter((account) => account.status === 'connected'),
    [accounts],
  );
  const linkedInConfigured = Boolean(health?.oauth?.linkedinConfigured);
  const xConfigured = Boolean(health?.oauth?.xConfigured);
  const connectedAccountCount = useMemo(
    () => accounts.filter((account) => account.status === 'connected').length,
    [accounts],
  );
  const reauthAccountCount = useMemo(
    () => accounts.filter((account) => account.status === 'reauth_required').length,
    [accounts],
  );
  const disabledAccountCount = useMemo(
    () => accounts.filter((account) => account.status === 'disabled').length,
    [accounts],
  );
  const linkedInOauthApp = useMemo(
    () => oauthApps.find((item) => item.platform === 'linkedin') || null,
    [oauthApps],
  );
  const xOauthApp = useMemo(
    () => oauthApps.find((item) => item.platform === 'x') || null,
    [oauthApps],
  );

  const availablePlatforms = useMemo<Platform[]>(() => {
    if (selectedPlatforms.length > 0) return selectedPlatforms;
    return SUPPORTED_PLATFORMS;
  }, [selectedPlatforms]);

  const normalizedWorkspaceId = useMemo(
    () => workspaceId.trim() || 'default',
    [workspaceId],
  );

  const workspacePlaybookRuns = useMemo(
    () => playbookRunsByWorkspace[normalizedWorkspaceId] || [],
    [normalizedWorkspaceId, playbookRunsByWorkspace],
  );

  const appendPlaybookRun = useCallback((payload: {
    playbookId: string;
    eventType: PlaybookRunEventType;
    status: PlaybookRunStatus;
    message: string;
    outputType?: 'publishable_post' | 'brief' | 'unknown';
    mediaCount?: number;
  }) => {
    if (!payload.playbookId) return;
    setPlaybookRunsByWorkspace((current) => {
      const currentWorkspaceRuns = current[normalizedWorkspaceId] || [];
      const nextRun: PlaybookRunRecord = {
        runId: crypto.randomUUID(),
        workspaceId: normalizedWorkspaceId,
        playbookId: payload.playbookId,
        eventType: payload.eventType,
        status: payload.status,
        message: payload.message,
        occurredAt: new Date().toISOString(),
        outputType: payload.outputType,
        mediaCount: payload.mediaCount,
      };
      return {
        ...current,
        [normalizedWorkspaceId]: [nextRun, ...currentWorkspaceRuns].slice(0, PLAYBOOK_RUNS_MAX_PER_WORKSPACE),
      };
    });
  }, [normalizedWorkspaceId]);

  const clearWorkspacePlaybookRuns = useCallback(() => {
    setPlaybookRunsByWorkspace((current) => {
      if (!current[normalizedWorkspaceId]) return current;
      const next = { ...current };
      delete next[normalizedWorkspaceId];
      return next;
    });
    setActionMessage('Cleared playbook run history for current workspace.');
  }, [normalizedWorkspaceId]);

  const playbooksInActiveSector = useMemo(
    () => PLAYBOOK_DEFINITIONS.filter((item) => item.sector === activePlaybookSector),
    [activePlaybookSector],
  );

  useEffect(() => {
    if (playbooksInActiveSector.length === 0) {
      setActivePlaybookId('');
      return;
    }
    if (!playbooksInActiveSector.some((item) => item.id === activePlaybookId)) {
      setActivePlaybookId(playbooksInActiveSector[0].id);
    }
  }, [activePlaybookId, playbooksInActiveSector]);

  const activePlaybook = useMemo(
    () => PLAYBOOK_DEFINITIONS.find((item) => item.id === activePlaybookId) || null,
    [activePlaybookId],
  );

  const playbookKpiById = useMemo<Record<string, PlaybookKpiSnapshot>>(() => {
    const kpis: Record<string, PlaybookKpiSnapshot> = {};
    for (const run of workspacePlaybookRuns) {
      if (!run.playbookId) continue;
      const row = kpis[run.playbookId] || createEmptyPlaybookKpi();
      row.lastRunAt = row.lastRunAt || run.occurredAt;
      if (run.eventType === 'apply' && run.status === 'success') row.applies += 1;
      if (run.eventType === 'generate') {
        row.generateAttempts += 1;
        if (run.status === 'success') {
          row.generateSuccess += 1;
          if (run.outputType === 'brief') row.generateBriefCount += 1;
        }
      }
      if (run.eventType === 'poster' && run.status === 'success') row.posterSuccess += 1;
      if (run.eventType === 'queue' && run.status === 'success') row.queueSuccess += 1;
      if (run.eventType === 'publish' && run.status === 'success') row.publishSuccess += 1;
      kpis[run.playbookId] = row;
    }
    return kpis;
  }, [workspacePlaybookRuns]);

  const activePlaybookKpi = useMemo(
    () => (activePlaybook ? playbookKpiById[activePlaybook.id] || createEmptyPlaybookKpi() : createEmptyPlaybookKpi()),
    [activePlaybook, playbookKpiById],
  );

  const activePlaybookRunHistory = useMemo(
    () => (activePlaybook ? workspacePlaybookRuns.filter((item) => item.playbookId === activePlaybook.id).slice(0, 10) : []),
    [activePlaybook, workspacePlaybookRuns],
  );

  const activePlaybookValues = useMemo<Record<string, string>>(() => {
    if (!activePlaybook) return {};
    const values: Record<string, string> = {};
    for (const field of activePlaybook.fields) {
      const stateKey = playbookFieldStateKey(activePlaybook.id, field.key);
      const raw = playbookFieldValues[stateKey];
      values[field.key] = typeof raw === 'string' && raw.trim() ? raw.trim() : field.defaultValue;
    }
    return values;
  }, [activePlaybook, playbookFieldValues]);

  const activePlaybookBrief = useMemo(() => {
    if (!activePlaybook) return '';
    return renderTemplateString(activePlaybook.briefTemplate, activePlaybookValues).trim();
  }, [activePlaybook, activePlaybookValues]);

  const activePlaybookContext = useMemo(() => {
    if (!activePlaybook?.contextTemplate) return '';
    return renderTemplateString(activePlaybook.contextTemplate, activePlaybookValues).trim();
  }, [activePlaybook, activePlaybookValues]);

  const updatePlaybookFieldValue = useCallback((playbookId: string, fieldKey: string, value: string) => {
    const stateKey = playbookFieldStateKey(playbookId, fieldKey);
    setPlaybookFieldValues((current) => ({ ...current, [stateKey]: value }));
  }, []);

  const resetActivePlaybookInputs = useCallback(() => {
    if (!activePlaybook) return;
    setPlaybookFieldValues((current) => {
      const next = { ...current };
      for (const field of activePlaybook.fields) {
        delete next[playbookFieldStateKey(activePlaybook.id, field.key)];
      }
      return next;
    });
    setActionMessage(`Reset inputs for playbook: ${activePlaybook.name}`);
  }, [activePlaybook]);

  const buildActivePlaybookOverrides = useCallback(() => {
    if (!activePlaybook) return;
    const nextTopic = activePlaybook.defaults.topic.trim();
    const nextAngle = activePlaybook.defaults.angle.trim();
    const nextTone = activePlaybook.defaults.tone.trim();
    const nextAudience = activePlaybook.defaults.audience.trim();
    const nextCta = activePlaybook.defaults.cta.trim();
    const nextWorkspaceId = normalizedWorkspaceId;
    const nextPlatforms = activePlaybook.defaults.platforms;
    const nextPublishPlatform = nextPlatforms[0] || publishPlatform;
    const nextContextNote = activePlaybookContext || contextNoteInput;
    return {
      playbookId: activePlaybook.id,
      playbookName: activePlaybook.name,
      overrides: {
        brief: activePlaybookBrief,
        topic: nextTopic,
        angle: nextAngle,
        tone: nextTone,
        audience: nextAudience,
        cta: nextCta,
        contextNoteInput: nextContextNote,
        contextSourcesInput,
        contentModel,
        imageModel,
        selectedPlatforms: nextPlatforms,
        publishPlatform: nextPublishPlatform,
        workspaceId: nextWorkspaceId,
      } satisfies GenerationOverrides,
    };
  }, [
    activePlaybook,
    activePlaybookBrief,
    activePlaybookContext,
    contentModel,
    contextNoteInput,
    contextSourcesInput,
    imageModel,
    normalizedWorkspaceId,
    publishPlatform,
  ]);

  const applyGenerationOverridesToDraftBuilder = useCallback((
    overrides: GenerationOverrides,
    options?: {
      announce?: boolean;
      playbookId?: string;
      playbookName?: string;
    },
  ) => {
    setBrief(overrides.brief);
    setTopic(overrides.topic);
    setTopicCustom(Boolean(overrides.topic) && !isOptionValue(overrides.topic, TOPIC_OPTIONS));
    setAngle(overrides.angle);
    setAngleCustom(Boolean(overrides.angle) && !isOptionValue(overrides.angle, ANGLE_OPTIONS));
    setTone(overrides.tone);
    setToneCustom(Boolean(overrides.tone) && !isOptionValue(overrides.tone, TONE_OPTIONS));
    setAudience(overrides.audience);
    setAudienceCustom(Boolean(overrides.audience) && !isOptionValue(overrides.audience, AUDIENCE_OPTIONS));
    setCta(overrides.cta);
    setCtaCustom(Boolean(overrides.cta) && !isOptionValue(overrides.cta, CTA_OPTIONS));
    setContextNoteInput(overrides.contextNoteInput);
    setContextSourcesInput(overrides.contextSourcesInput);
    setSelectedPlatforms(overrides.selectedPlatforms);
    setPublishPlatform(overrides.publishPlatform);
    if (options?.playbookId) {
      setDraftPlaybookId(options.playbookId);
      appendPlaybookRun({
        playbookId: options.playbookId,
        eventType: 'apply',
        status: 'success',
        message: `Applied playbook: ${options.playbookName || options.playbookId}`,
      });
    }
    if (options?.announce !== false) {
      setActionMessage(`Applied playbook: ${options?.playbookName || 'Playbook'}. Review and click Generate.`);
    }
  }, [appendPlaybookRun]);

  const applyActivePlaybook = useCallback(() => {
    const applied = buildActivePlaybookOverrides();
    if (!applied) return;
    applyGenerationOverridesToDraftBuilder(applied.overrides, {
      announce: true,
      playbookId: applied.playbookId,
      playbookName: applied.playbookName,
    });
  }, [applyGenerationOverridesToDraftBuilder, buildActivePlaybookOverrides]);

  const topicSelectValue = (topicCustom || (topic.trim() && !isOptionValue(topic, TOPIC_OPTIONS)))
    ? CUSTOM_OPTION_VALUE
    : (isOptionValue(topic, TOPIC_OPTIONS) ? topic.trim() : '');
  const angleSelectValue = (angleCustom || (angle.trim() && !isOptionValue(angle, ANGLE_OPTIONS)))
    ? CUSTOM_OPTION_VALUE
    : (isOptionValue(angle, ANGLE_OPTIONS) ? angle.trim() : '');
  const toneSelectValue = (toneCustom || (tone.trim() && !isOptionValue(tone, TONE_OPTIONS)))
    ? CUSTOM_OPTION_VALUE
    : (isOptionValue(tone, TONE_OPTIONS) ? tone.trim() : '');
  const audienceSelectValue = (audienceCustom || (audience.trim() && !isOptionValue(audience, AUDIENCE_OPTIONS)))
    ? CUSTOM_OPTION_VALUE
    : (isOptionValue(audience, AUDIENCE_OPTIONS) ? audience.trim() : '');
  const ctaSelectValue = (ctaCustom || (cta.trim() && !isOptionValue(cta, CTA_OPTIONS)))
    ? CUSTOM_OPTION_VALUE
    : (isOptionValue(cta, CTA_OPTIONS) ? cta.trim() : '');
  const contentModelSelectValue = (contentModelCustom || (contentModel.trim() && !isOptionValue(contentModel, availableContentModels)))
    ? CUSTOM_OPTION_VALUE
    : (isOptionValue(contentModel, availableContentModels) ? contentModel.trim() : '');
  const imageModelSelectValue = (imageModelCustom || (imageModel.trim() && !isOptionValue(imageModel, availableImageModels)))
    ? CUSTOM_OPTION_VALUE
    : (isOptionValue(imageModel, availableImageModels) ? imageModel.trim() : '');

  const togglePlatform = useCallback((platform: Platform) => {
    setSelectedPlatforms((current) => {
      if (current.includes(platform)) {
        return current.filter((item) => item !== platform);
      }
      return [...current, platform];
    });
  }, []);

  const generateContent = useCallback(async (options?: {
    overrides?: Partial<GenerationOverrides>;
    playbookId?: string;
  }) => {
    const effectiveBrief = (options?.overrides?.brief ?? brief).trim();
    const effectiveTopic = (options?.overrides?.topic ?? topic).trim();
    const effectiveAngle = (options?.overrides?.angle ?? angle).trim();
    const effectiveTone = (options?.overrides?.tone ?? tone).trim();
    const effectiveAudience = (options?.overrides?.audience ?? audience).trim();
    const effectiveCta = (options?.overrides?.cta ?? cta).trim();
    const effectiveContextSourcesInput = options?.overrides?.contextSourcesInput ?? contextSourcesInput;
    const effectiveContextNoteInput = (options?.overrides?.contextNoteInput ?? contextNoteInput).trim();
    const effectiveContentModel = (options?.overrides?.contentModel ?? contentModel).trim();
    const effectiveImageModel = (options?.overrides?.imageModel ?? imageModel).trim();
    const effectivePlatforms = options?.overrides?.selectedPlatforms ?? selectedPlatforms;
    const effectivePublishPlatform = options?.overrides?.publishPlatform ?? publishPlatform;
    const effectiveWorkspaceId = (options?.overrides?.workspaceId ?? normalizedWorkspaceId).trim() || 'default';
    const runPlaybookId = options?.playbookId || draftPlaybookId;

    if (!connected) {
      setActionMessage('Gateway disconnected');
      return;
    }
    if (!effectiveBrief && !effectiveTopic) {
      setActionMessage('Brief or topic is required');
      return;
    }
    if (effectivePlatforms.length === 0) {
      setActionMessage('Select at least one platform');
      return;
    }

    if (runPlaybookId) {
      setDraftPlaybookId(runPlaybookId);
    }

    setGenerating(true);
    setActionMessage('');
    try {
      const contextSources = parseDelimitedInput(effectiveContextSourcesInput);
      const payload = asRecord(
        await gateway.generateSocialContent({
          workspaceId: effectiveWorkspaceId,
          brief: effectiveBrief,
          topic: effectiveTopic,
          angle: effectiveAngle,
          tone: effectiveTone,
          audience: effectiveAudience,
          cta: effectiveCta,
          contextSources,
          contextNote: effectiveContextNoteInput,
          contentModel: effectiveContentModel,
          imageModel: effectiveImageModel,
          platforms: effectivePlatforms,
        }),
      );
      if (payload.status === 'error') {
        throw new Error(getErrorMessage(payload.error, 'social.content.generate failed'));
      }

      const candidates = (Array.isArray(payload.candidates) ? payload.candidates : [])
        .map((item) => parseCandidate(item))
        .filter((item): item is SocialGenerateCandidate => Boolean(item));

      const preferred = candidates.find(
        (item) => item.platform === effectivePublishPlatform && item.outputType === 'publishable_post',
      ) || candidates.find((item) => item.outputType === 'publishable_post');
      const fallback = candidates.find((item) => item.platform === effectivePublishPlatform) || candidates[0] || null;
      const picked = preferred || fallback;

      let nextText = picked?.text?.trim() || '';
      let nextOutputType: 'publishable_post' | 'brief' | 'unknown' = picked?.outputType || 'unknown';
      const nextQualityFlags = picked?.qualityFlags || [];
      const nextAssets = picked?.assets || [];
      const nextMediaUrls = candidateReadyMediaUrls(picked);

      if (nextText && isBriefLikeText(nextText)) {
        nextText = buildClientFallbackPost(
          effectiveBrief,
          effectiveTopic,
          effectiveAngle,
          effectiveTone,
          effectiveAudience,
          effectiveCta,
        );
        nextOutputType = 'publishable_post';
      }

      setGeneratedText(nextText);
      setGeneratedOutputType(nextOutputType);
      setGeneratedQualityFlags(nextQualityFlags);
      setGeneratedAssets(nextAssets);
      setSelectedMediaUrls(nextMediaUrls);

      const warnings = toStringList(payload.warnings);
      const baseMessage = nextText ? 'Draft generated. Review and publish when ready.' : 'No draft returned.';
      const mediaMessage = nextMediaUrls.length > 0
        ? ` Poster ready (${nextMediaUrls.length} image).`
        : ' No poster image returned.';
      const warningMessage = warnings.length > 0 ? ` Warning: ${warnings[0]}` : '';
      const finalMessage = `${baseMessage}${mediaMessage}${warningMessage}`;
      setActionMessage(finalMessage);

      if (runPlaybookId) {
        appendPlaybookRun({
          playbookId: runPlaybookId,
          eventType: 'generate',
          status: 'success',
          message: finalMessage,
          outputType: nextOutputType,
          mediaCount: nextMediaUrls.length,
        });
      }

      await loadOverview();
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Failed to generate content');
      setActionMessage(errorMessage);
      if (runPlaybookId) {
        appendPlaybookRun({
          playbookId: runPlaybookId,
          eventType: 'generate',
          status: 'failed',
          message: errorMessage,
        });
      }
    } finally {
      setGenerating(false);
    }
  }, [
    angle,
    appendPlaybookRun,
    audience,
    brief,
    connected,
    contentModel,
    contextNoteInput,
    contextSourcesInput,
    cta,
    draftPlaybookId,
    imageModel,
    loadOverview,
    normalizedWorkspaceId,
    publishPlatform,
    selectedPlatforms,
    tone,
    topic,
  ]);

  const applyAndGenerateActivePlaybook = useCallback(async () => {
    const applied = buildActivePlaybookOverrides();
    if (!applied) return;
    applyGenerationOverridesToDraftBuilder(applied.overrides, {
      announce: false,
      playbookId: applied.playbookId,
      playbookName: applied.playbookName,
    });
    await generateContent({
      overrides: applied.overrides,
      playbookId: applied.playbookId,
    });
  }, [applyGenerationOverridesToDraftBuilder, buildActivePlaybookOverrides, generateContent]);

  const regeneratePoster = useCallback(async () => {
    const runPlaybookId = draftPlaybookId;
    if (!connected) {
      setActionMessage('Gateway disconnected');
      return;
    }
    if (!brief.trim() && !topic.trim()) {
      setActionMessage('Brief or topic is required before generating poster');
      return;
    }
    if (selectedPlatforms.length === 0) {
      setActionMessage('Select at least one platform');
      return;
    }

    setGeneratingPoster(true);
    setActionMessage('');
    try {
      const contextSources = parseDelimitedInput(contextSourcesInput);
      const payload = asRecord(
        await gateway.generateSocialContent({
          workspaceId: workspaceId.trim() || 'default',
          brief: brief.trim(),
          topic: topic.trim(),
          angle: angle.trim(),
          tone: tone.trim(),
          audience: audience.trim(),
          cta: cta.trim(),
          contextSources,
          contextNote: contextNoteInput.trim(),
          contentModel: contentModel.trim(),
          imageModel: imageModel.trim(),
          platforms: selectedPlatforms,
        }),
      );
      if (payload.status === 'error') {
        throw new Error(getErrorMessage(payload.error, 'social.content.generate failed'));
      }

      const candidates = (Array.isArray(payload.candidates) ? payload.candidates : [])
        .map((item) => parseCandidate(item))
        .filter((item): item is SocialGenerateCandidate => Boolean(item));
      const picked = candidates.find((item) => item.platform === publishPlatform) || candidates[0] || null;
      const mediaUrls = candidateReadyMediaUrls(picked);
      if (mediaUrls.length === 0) {
        throw new Error('No poster image returned from backend');
      }

      setGeneratedAssets(picked?.assets || []);
      setSelectedMediaUrls(mediaUrls);
      if (!generatedText.trim() && picked?.text?.trim()) {
        setGeneratedText(picked.text.trim());
        setGeneratedOutputType(picked.outputType || 'unknown');
        setGeneratedQualityFlags(picked.qualityFlags || []);
      }
      const successMessage = `Poster generated (${mediaUrls.length} image).`;
      setActionMessage(successMessage);
      if (runPlaybookId) {
        appendPlaybookRun({
          playbookId: runPlaybookId,
          eventType: 'poster',
          status: 'success',
          message: successMessage,
          mediaCount: mediaUrls.length,
        });
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Poster generation failed');
      setActionMessage(errorMessage);
      if (runPlaybookId) {
        appendPlaybookRun({
          playbookId: runPlaybookId,
          eventType: 'poster',
          status: 'failed',
          message: errorMessage,
        });
      }
    } finally {
      setGeneratingPoster(false);
    }
  }, [
    angle,
    appendPlaybookRun,
    audience,
    brief,
    connected,
    contextNoteInput,
    contextSourcesInput,
    contentModel,
    cta,
    draftPlaybookId,
    generatedText,
    imageModel,
    publishPlatform,
    selectedPlatforms,
    tone,
    topic,
    workspaceId,
  ]);

  const queuePost = useCallback(async () => {
    const runPlaybookId = draftPlaybookId;
    if (!connected) {
      setActionMessage('Gateway disconnected');
      return;
    }
    if (!selectedAccountId) {
      setActionMessage('Select a social account first');
      return;
    }
    if (!selectedAccount || selectedAccount.status !== 'connected') {
      setActionMessage('Selected account is not connected. Reconnect account first.');
      return;
    }
    if (!generatedText.trim()) {
      setActionMessage('Draft text is empty');
      return;
    }
    if (generatedOutputType === 'brief') {
      setActionMessage('Draft is marked as brief/non-publishable. Regenerate content before publishing.');
      return;
    }
    const scheduleDate = new Date(scheduledAt);
    if (Number.isNaN(scheduleDate.getTime())) {
      setActionMessage('Invalid schedule time');
      return;
    }
    const scheduleIso = scheduleDate.toISOString();

    setQueueing(true);
    setActionMessage('');
    try {
      const payload = asRecord(
        await gateway.queueSocialPost({
          idempotencyKey: `desktop-queue-${Date.now()}`,
          workspaceId: workspaceId.trim() || 'default',
          postId: crypto.randomUUID(),
          platform: publishPlatform,
          socialAccountId: selectedAccountId,
          scheduledAt: scheduleIso,
          format: 'post',
          text: generatedText.trim(),
          mediaUrls: selectedMediaUrls,
          settings: {
            outputType: generatedOutputType === 'unknown' ? 'publishable_post' : generatedOutputType,
            qualityFlags: generatedQualityFlags,
            publishable: generatedOutputType !== 'brief',
          },
        }),
      );
      if (payload.status === 'error') {
        throw new Error(getErrorMessage(payload.error, 'social.publish.queue failed'));
      }
      const successMessage = 'Post queued successfully.';
      setActionMessage(successMessage);
      if (runPlaybookId) {
        appendPlaybookRun({
          playbookId: runPlaybookId,
          eventType: 'queue',
          status: 'success',
          message: successMessage,
        });
      }
      await loadOverview();
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Queue publish failed');
      setActionMessage(errorMessage);
      if (runPlaybookId) {
        appendPlaybookRun({
          playbookId: runPlaybookId,
          eventType: 'queue',
          status: 'failed',
          message: errorMessage,
        });
      }
    } finally {
      setQueueing(false);
    }
  }, [
    appendPlaybookRun,
    connected,
    draftPlaybookId,
    generatedOutputType,
    generatedQualityFlags,
    generatedText,
    loadOverview,
    publishPlatform,
    scheduledAt,
    selectedAccount,
    selectedAccountId,
    selectedMediaUrls,
    workspaceId,
  ]);

  const publishNow = useCallback(async () => {
    const runPlaybookId = draftPlaybookId;
    if (!connected) {
      setActionMessage('Gateway disconnected');
      return;
    }
    if (!selectedAccountId) {
      setActionMessage('Select a social account first');
      return;
    }
    if (!selectedAccount || selectedAccount.status !== 'connected') {
      setActionMessage('Selected account is not connected. Reconnect account first.');
      return;
    }
    if (!generatedText.trim()) {
      setActionMessage('Draft text is empty');
      return;
    }
    if (generatedOutputType === 'brief') {
      setActionMessage('Draft is marked as brief/non-publishable. Regenerate content before publishing.');
      return;
    }

    setPublishing(true);
    setActionMessage('');
    try {
      const payload = asRecord(
        await gateway.publishSocialPostNow({
          idempotencyKey: `desktop-now-${Date.now()}`,
          workspaceId: workspaceId.trim() || 'default',
          postId: crypto.randomUUID(),
          platform: publishPlatform,
          socialAccountId: selectedAccountId,
          format: 'post',
          text: generatedText.trim(),
          mediaUrls: selectedMediaUrls,
          settings: {
            outputType: generatedOutputType === 'unknown' ? 'publishable_post' : generatedOutputType,
            qualityFlags: generatedQualityFlags,
            publishable: generatedOutputType !== 'brief',
          },
        }),
      );
      if (payload.status === 'error') {
        throw new Error(getErrorMessage(payload.error, 'social.publish.now failed'));
      }
      const successMessage = 'Post published immediately.';
      setActionMessage(successMessage);
      if (runPlaybookId) {
        appendPlaybookRun({
          playbookId: runPlaybookId,
          eventType: 'publish',
          status: 'success',
          message: successMessage,
        });
      }
      await loadOverview();
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Immediate publish failed');
      setActionMessage(errorMessage);
      if (runPlaybookId) {
        appendPlaybookRun({
          playbookId: runPlaybookId,
          eventType: 'publish',
          status: 'failed',
          message: errorMessage,
        });
      }
    } finally {
      setPublishing(false);
    }
  }, [
    appendPlaybookRun,
    connected,
    draftPlaybookId,
    generatedOutputType,
    generatedQualityFlags,
    generatedText,
    loadOverview,
    publishPlatform,
    selectedAccount,
    selectedAccountId,
    selectedMediaUrls,
    workspaceId,
  ]);

  const startPlatformConnect = useCallback(async (platform: 'linkedin' | 'x') => {
    if (!connected) {
      setConnectMessage('Gateway disconnected');
      return;
    }
    closeOauthPopup();
    setConnectingOAuth(true);
    setConnectMessage('');
    try {
      const payload = asRecord(
        await gateway.startSocialAccountConnect({
          platform,
          workspaceId: workspaceId.trim() || 'default',
        }),
      );
      if (payload.status === 'error') {
        throw new Error(getErrorMessage(payload.error, 'social.accounts.connect.start failed'));
      }
      const authUrl = typeof payload.authUrl === 'string' ? payload.authUrl : '';
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
      if (!authUrl || !sessionId) {
        throw new Error('Connect start did not return authUrl/sessionId');
      }
      setConnectSessionId(sessionId);
      setConnectPlatform(platform);
      setConnectMessage(`OAuth opened in browser for ${platformLabel(platform)}. Complete login and consent, then return here.`);
      const popup = window.open(authUrl, '_blank');
      if (!popup) {
        throw new Error('Could not open OAuth window. Allow popups and try again.');
      }
      oauthPopupRef.current = popup;
    } catch (error) {
      setConnectMessage(getErrorMessage(error, `Failed to start ${platformLabel(platform)} OAuth`));
      closeOauthPopup();
      resetOauthPendingState();
    }
  }, [closeOauthPopup, connected, resetOauthPendingState, workspaceId]);

  const disconnectAccount = useCallback(async (socialAccountId: string) => {
    if (!connected) {
      setConnectMessage('Gateway disconnected');
      return;
    }
    setDisconnectingAccountId(socialAccountId);
    setConnectMessage('');
    try {
      const payload = asRecord(
        await gateway.disconnectSocialAccount({
          socialAccountId,
          workspaceId: workspaceId.trim() || 'default',
        }),
      );
      if (payload.status === 'error') {
        throw new Error(getErrorMessage(payload.error, 'social.accounts.disconnect failed'));
      }
      setConnectMessage('Account disconnected.');
      if (selectedAccountId === socialAccountId) {
        setSelectedAccountId('');
      }
      await loadOverview();
    } catch (error) {
      setConnectMessage(getErrorMessage(error, 'Failed to disconnect account'));
    } finally {
      setDisconnectingAccountId('');
    }
  }, [connected, loadOverview, selectedAccountId, workspaceId]);

  const startAccountReauth = useCallback(async () => {
    if (!connected) {
      setSettingsMessage('Gateway disconnected');
      return;
    }
    if (!selectedAccount) {
      setSettingsMessage('Select an account first');
      return;
    }
    if (selectedAccount.platform !== 'linkedin' && selectedAccount.platform !== 'x') {
      setSettingsMessage(`Reauth is not supported for ${selectedAccount.platform}`);
      return;
    }

    closeOauthPopup();
    setConnectingOAuth(true);
    setSettingsMessage('');
    try {
      const payload = asRecord(
        await gateway.startSocialAccountReauth({
          socialAccountId: selectedAccount.socialAccountId,
          workspaceId: workspaceId.trim() || 'default',
        }),
      );
      if (payload.status === 'error') {
        throw new Error(getErrorMessage(payload.error, 'social.accounts.reauth.start failed'));
      }
      const authUrl = typeof payload.authUrl === 'string' ? payload.authUrl : '';
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
      if (!authUrl || !sessionId) {
        throw new Error('Reauth start did not return authUrl/sessionId');
      }
      setConnectSessionId(sessionId);
      setConnectPlatform(selectedAccount.platform);
      setConnectMessage(`Reauth opened for ${platformLabel(selectedAccount.platform)} account.`);
      const popup = window.open(authUrl, '_blank');
      if (!popup) {
        throw new Error('Could not open OAuth window. Allow popups and try again.');
      }
      oauthPopupRef.current = popup;
    } catch (error) {
      setSettingsMessage(getErrorMessage(error, 'Failed to start account reauth'));
      closeOauthPopup();
      resetOauthPendingState();
    }
  }, [closeOauthPopup, connected, resetOauthPendingState, selectedAccount, workspaceId]);

  const saveSelectedAccountSettings = useCallback(async () => {
    if (!connected) {
      setSettingsMessage('Gateway disconnected');
      return;
    }
    if (!selectedAccount) {
      setSettingsMessage('Select an account first');
      return;
    }

    setSavingAccountSettings(true);
    setSettingsMessage('');
    try {
      const payload = asRecord(
        await gateway.updateSocialAccountSettings({
          socialAccountId: selectedAccount.socialAccountId,
          workspaceId: workspaceId.trim() || 'default',
          tags: parseDelimitedInput(accountTagsInput),
        }),
      );
      if (payload.status === 'error') {
        throw new Error(getErrorMessage(payload.error, 'social.accounts.settings.update failed'));
      }
      setSettingsMessage('Account tags saved.');
      await loadOverview();
    } catch (error) {
      setSettingsMessage(getErrorMessage(error, 'Failed to save account settings'));
    } finally {
      setSavingAccountSettings(false);
    }
  }, [accountTagsInput, connected, loadOverview, selectedAccount, workspaceId]);

  const setSelectedAccountAsDefault = useCallback(async () => {
    if (!connected) {
      setSettingsMessage('Gateway disconnected');
      return;
    }
    if (!selectedAccount) {
      setSettingsMessage('Select an account first');
      return;
    }
    setSavingAccountSettings(true);
    setSettingsMessage('');
    try {
      const payload = asRecord(
        await gateway.updateSocialAccountSettings({
          socialAccountId: selectedAccount.socialAccountId,
          workspaceId: workspaceId.trim() || 'default',
          isDefault: true,
        }),
      );
      if (payload.status === 'error') {
        throw new Error(getErrorMessage(payload.error, 'social.accounts.settings.update failed'));
      }
      setSettingsMessage('Default account updated.');
      await loadOverview();
    } catch (error) {
      setSettingsMessage(getErrorMessage(error, 'Failed to set default account'));
    } finally {
      setSavingAccountSettings(false);
    }
  }, [connected, loadOverview, selectedAccount, workspaceId]);

  const saveWorkspaceOauthApp = useCallback(async (platform: 'linkedin' | 'x') => {
    if (!connected) {
      setSettingsMessage('Gateway disconnected');
      return;
    }

    const clientId = platform === 'linkedin' ? linkedInClientId.trim() : xClientId.trim();
    const clientSecret = platform === 'linkedin' ? linkedInClientSecret.trim() : xClientSecret.trim();
    const scopesInput = platform === 'linkedin' ? linkedInScopesInput : xScopesInput;

    if (!clientId) {
      setSettingsMessage(`${platformLabel(platform)} client ID is required`);
      return;
    }

    setSavingOauthPlatform(platform);
    setSettingsMessage('');
    try {
      const payload = asRecord(
        await gateway.upsertSocialWorkspaceOauthApp({
          workspaceId: workspaceId.trim() || 'default',
          platform,
          clientId,
          ...(clientSecret ? { clientSecret } : {}),
          scopes: parseDelimitedInput(scopesInput),
        }),
      );
      if (payload.status === 'error') {
        throw new Error(getErrorMessage(payload.error, 'social.settings.oauth_apps.upsert failed'));
      }
      if (platform === 'linkedin') {
        setLinkedInClientSecret('');
      } else {
        setXClientSecret('');
      }
      setSettingsMessage(`${platformLabel(platform)} OAuth app settings saved.`);
      await loadOverview();
    } catch (error) {
      setSettingsMessage(getErrorMessage(error, `Failed to save ${platformLabel(platform)} OAuth app`));
    } finally {
      setSavingOauthPlatform('');
    }
  }, [connected, linkedInClientId, linkedInClientSecret, linkedInScopesInput, loadOverview, workspaceId, xClientId, xClientSecret, xScopesInput]);

  const deleteWorkspaceOauthApp = useCallback(async (platform: 'linkedin' | 'x') => {
    if (!connected) {
      setSettingsMessage('Gateway disconnected');
      return;
    }

    setSavingOauthPlatform(platform);
    setSettingsMessage('');
    try {
      const payload = asRecord(
        await gateway.deleteSocialWorkspaceOauthApp({
          workspaceId: workspaceId.trim() || 'default',
          platform,
        }),
      );
      if (payload.status === 'error') {
        throw new Error(getErrorMessage(payload.error, 'social.settings.oauth_apps.delete failed'));
      }
      setSettingsMessage(`${platformLabel(platform)} OAuth app removed.`);
      await loadOverview();
    } catch (error) {
      setSettingsMessage(getErrorMessage(error, `Failed to delete ${platformLabel(platform)} OAuth app`));
    } finally {
      setSavingOauthPlatform('');
    }
  }, [connected, loadOverview, workspaceId]);

  const saveGenerationModelSettings = useCallback(async () => {
    if (!connected) {
      setSettingsMessage('Gateway disconnected');
      return;
    }

    const nextContentModel = contentModel.trim();
    const nextImageModel = imageModel.trim();
    if (!nextContentModel && !nextImageModel) {
      setSettingsMessage('Choose at least one model or click Use defaults.');
      return;
    }

    setSavingGenerationSettings(true);
    setSettingsMessage('');
    try {
      const payload = asRecord(
        await gateway.upsertSocialGenerationSettings({
          workspaceId: workspaceId.trim() || 'default',
          ...(nextContentModel ? { contentModel: nextContentModel } : {}),
          ...(nextImageModel ? { imageModel: nextImageModel } : {}),
        }),
      );
      if (payload.status === 'error') {
        throw new Error(getErrorMessage(payload.error, 'social.settings.generation.upsert failed'));
      }
      setSettingsMessage('Generation model settings saved.');
      await loadOverview();
    } catch (error) {
      setSettingsMessage(getErrorMessage(error, 'Failed to save generation model settings'));
    } finally {
      setSavingGenerationSettings(false);
    }
  }, [connected, contentModel, imageModel, loadOverview, workspaceId]);

  const clearGenerationModelSettings = useCallback(async () => {
    if (!connected) {
      setSettingsMessage('Gateway disconnected');
      return;
    }

    setSavingGenerationSettings(true);
    setSettingsMessage('');
    try {
      const payload = asRecord(
        await gateway.deleteSocialGenerationSettings({
          workspaceId: workspaceId.trim() || 'default',
        }),
      );
      if (payload.status === 'error') {
        throw new Error(getErrorMessage(payload.error, 'social.settings.generation.delete failed'));
      }
      setSettingsMessage('Generation model settings reset to defaults.');
      await loadOverview();
    } catch (error) {
      setSettingsMessage(getErrorMessage(error, 'Failed to reset generation model settings'));
    } finally {
      setSavingGenerationSettings(false);
    }
  }, [connected, loadOverview, workspaceId]);

  const refreshGenerationCatalog = useCallback(async (forceRefresh = false) => {
    if (!connected) return;
    const payload = asRecord(
      await gateway.getSocialGenerationSettings({
        workspaceId: workspaceId.trim() || 'default',
        ...(forceRefresh ? { refresh: true } : {}),
      }),
    );
    if (payload.status === 'error') {
      throw new Error(getErrorMessage(payload.error, 'social.settings.generation.list failed'));
    }
    applyGenerationSettingsPayload(payload, { preserveModelSelection: true });
  }, [applyGenerationSettingsPayload, connected, workspaceId]);

  const refreshModelCatalogNow = useCallback(async () => {
    if (!connected) {
      setSettingsMessage('Gateway disconnected');
      return;
    }
    setRefreshingModelCatalog(true);
    setSettingsMessage('');
    try {
      await refreshGenerationCatalog(true);
      setSettingsMessage('Model catalog refreshed.');
    } catch (error) {
      setSettingsMessage(getErrorMessage(error, 'Failed to refresh model catalog'));
    } finally {
      setRefreshingModelCatalog(false);
    }
  }, [connected, refreshGenerationCatalog]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => {
      void refreshGenerationCatalog(false).catch(() => {
        // keep UI stable on transient catalog refresh failures
      });
    }, 120000);
    return () => {
      clearInterval(timer);
    };
  }, [connected, refreshGenerationCatalog]);

  useEffect(() => {
    window.localStorage.setItem('social.workspaceId', workspaceId.trim() || 'default');
  }, [workspaceId]);

  useEffect(() => {
    savePlaybookRunsByWorkspace(playbookRunsByWorkspace);
  }, [playbookRunsByWorkspace]);

  useEffect(() => {
    setDraftPlaybookId('');
  }, [normalizedWorkspaceId]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [settingsOpen]);

  useEffect(() => {
    setAccountTagsInput(selectedAccount?.tags?.join(', ') || '');
  }, [selectedAccount?.socialAccountId, selectedAccount?.tags]);

  useEffect(() => {
    setLinkedInClientId(linkedInOauthApp?.clientId || '');
    setLinkedInScopesInput((linkedInOauthApp?.scopes || []).join(', '));
    setXClientId(xOauthApp?.clientId || '');
    setXScopesInput((xOauthApp?.scopes || []).join(', '));
  }, [linkedInOauthApp?.clientId, linkedInOauthApp?.scopes, xOauthApp?.clientId, xOauthApp?.scopes]);

  useEffect(() => {
    if (!connectSessionId) return;
    let active = true;
    const timer = setInterval(() => {
      void (async () => {
        if (!active) return;
        try {
          const payload = asRecord(
            await gateway.getSocialAccountConnectStatus({ sessionId: connectSessionId }),
          );
          if (payload.status === 'error') {
            throw new Error(getErrorMessage(payload.error, 'social.accounts.connect.status failed'));
          }
          const sessionPayload = asRecord(payload.session);
          const status = sessionPayload.status as SocialConnectSession['status'];
          const popupClosed = Boolean(oauthPopupRef.current && oauthPopupRef.current.closed);
          if (popupClosed) {
            oauthPopupRef.current = null;
          }
          if (status === 'completed') {
            const accountId = typeof sessionPayload.socialAccountId === 'string'
              ? sessionPayload.socialAccountId
              : '';
            const provider = connectPlatform ? platformLabel(connectPlatform) : 'Account';
            setConnectMessage(accountId
              ? `${provider} connected (${accountId}).`
              : `${provider} connected.`);
            closeOauthPopup();
            resetOauthPendingState();
            await loadOverview();
            return;
          }
          if (status === 'failed' || status === 'expired') {
            const err = typeof sessionPayload.error === 'string'
              ? sessionPayload.error
              : `OAuth session ${status}`;
            setConnectMessage(err);
            closeOauthPopup();
            resetOauthPendingState();
            return;
          }
          if (status === 'pending' && popupClosed) {
            const provider = connectPlatform ? platformLabel(connectPlatform) : 'OAuth';
            setConnectMessage(`${provider} window was closed before completion. Click Connect to try again.`);
            resetOauthPendingState();
          }
        } catch (error) {
          setConnectMessage(getErrorMessage(error, 'OAuth status polling failed'));
          closeOauthPopup();
          resetOauthPendingState();
        }
      })();
    }, 2000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [closeOauthPopup, connectPlatform, connectSessionId, loadOverview, resetOauthPendingState]);

  useEffect(() => {
    return () => {
      closeOauthPopup();
    };
  }, [closeOauthPopup]);

  useEffect(() => {
    if (!selectedAccount) return;
    if (selectedAccount.status !== 'connected') return;
    setPublishPlatform(selectedAccount.platform);
  }, [selectedAccount]);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden p-4 gap-3 bg-aegis-bg">
      <section className="shrink-0 rounded-xl border border-aegis-border bg-aegis-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[16px] font-semibold text-aegis-text">Social Studio</h1>
          <span className={clsx(
            'text-[11px] px-2 py-1 rounded-full border',
            health?.ready
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
          )}>
            {health?.ready ? 'Backend ready' : 'Backend pending'}
          </span>
          <span className="text-[11px] px-2 py-1 rounded-full border border-aegis-border text-aegis-text-dim">
            social.health / social.content.generate / social.publish.queue
          </span>
          <span className="text-[11px] px-2 py-1 rounded-full border border-aegis-border text-aegis-text-dim">
            account store: {health?.accountPersistence?.mode || 'unknown'}
          </span>
          <label className="ml-auto flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-aegis-border bg-aegis-elevated text-[11px] text-aegis-text-dim">
            Workspace
            <input
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              className="min-w-[120px] bg-transparent text-aegis-text outline-none"
              placeholder="default"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              void loadOverview();
            }}
            className="px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] inline-flex items-center gap-1.5"
          >
            <RefreshCw size={12} className={clsx(loading && 'animate-spin')} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] inline-flex items-center gap-1.5"
          >
            <Settings size={12} />
            Settings
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-aegis-text-dim">
          <span className="px-2 py-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 text-emerald-300">
            connected: {connectedAccountCount}
          </span>
          <span className="px-2 py-1 rounded-full border border-amber-500/35 bg-amber-500/10 text-amber-300">
            reauth: {reauthAccountCount}
          </span>
          <span className="px-2 py-1 rounded-full border border-aegis-border">
            disabled: {disabledAccountCount}
          </span>
        </div>
        {panelError && (
          <div className="mt-2 rounded-lg border border-aegis-danger/40 bg-aegis-danger/10 p-2 text-[12px] text-aegis-danger">
            {panelError}
          </div>
        )}
      </section>

      <section className="flex-1 min-h-0 overflow-y-auto">
        <div className="min-h-0 flex flex-col gap-3">
          <div className="rounded-xl border border-aegis-border bg-aegis-card p-3 space-y-3">
            <div className="flex items-center gap-2">
              <BookOpen size={14} className="text-aegis-primary" />
              <h2 className="text-[13px] font-semibold text-aegis-text">Playbook Center (MVP)</h2>
              <span className="text-[11px] text-aegis-text-dim">
                Adapted from xiaohongshu-skills sector model
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(240px,320px)_1fr]">
              <aside className="rounded-lg border border-aegis-border bg-aegis-elevated p-2 space-y-2 max-h-[560px] overflow-y-auto">
                <div className="px-1 text-[11px] uppercase tracking-[0.08em] text-aegis-text-dim">Sectors</div>
                <div className="space-y-1.5">
                  {PLAYBOOK_SECTORS.map((sector) => (
                    <button
                      key={sector.id}
                      type="button"
                      onClick={() => setActivePlaybookSector(sector.id)}
                      className={clsx(
                        'w-full rounded-lg border p-2 text-left transition-colors',
                        activePlaybookSector === sector.id
                          ? 'border-aegis-primary/30 bg-aegis-primary/10'
                          : 'border-aegis-border bg-aegis-card hover:bg-[rgb(var(--aegis-overlay)/0.05)]',
                      )}
                    >
                      <div className="text-[12px] font-semibold text-aegis-text">{sector.label}</div>
                      <div className="text-[11px] text-aegis-text-dim mt-0.5">{sector.summary}</div>
                    </button>
                  ))}
                </div>

                <div className="border-t border-[rgb(var(--aegis-overlay)/0.08)] pt-2 mt-2">
                  <div className="px-1 text-[11px] uppercase tracking-[0.08em] text-aegis-text-dim mb-1.5">Playbooks</div>
                  <div className="space-y-2">
                    {playbooksInActiveSector.map((playbook) => (
                      <button
                        key={playbook.id}
                        type="button"
                        onClick={() => setActivePlaybookId(playbook.id)}
                        className={clsx(
                          'w-full text-left rounded-lg border p-2 transition-colors',
                          activePlaybookId === playbook.id
                            ? 'border-aegis-primary/30 bg-aegis-primary/10'
                            : 'border-aegis-border bg-aegis-card hover:bg-[rgb(var(--aegis-overlay)/0.05)]',
                        )}
                      >
                        <div className="text-[12px] font-semibold text-aegis-text">{playbook.name}</div>
                        <div className="text-[11px] text-aegis-text-dim mt-0.5">{playbook.summary}</div>
                        <div className="text-[10px] text-aegis-text-dim mt-1">KPI target: {playbook.kpi}</div>
                        <div className="text-[10px] text-aegis-text-dim mt-0.5">
                          runs: {playbookKpiById[playbook.id]?.generateAttempts || 0}
                          {' · '}generated: {playbookKpiById[playbook.id]?.generateSuccess || 0}
                          {' · '}published: {playbookKpiById[playbook.id]?.publishSuccess || 0}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </aside>

              {activePlaybook && (
                <div className="rounded-lg border border-aegis-border bg-aegis-elevated p-3 space-y-3 min-w-0">
                  <div>
                    <div className="text-[13px] font-semibold text-aegis-text">{activePlaybook.name}</div>
                    <div className="text-[11px] text-aegis-text-dim mt-0.5">{activePlaybook.objective}</div>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2">
                    {activePlaybook.fields.map((field) => (
                      <label key={field.key} className="space-y-1 min-w-0">
                        <span className="text-[11px] text-aegis-text-dim">{field.label}</span>
                        <input
                          value={playbookFieldValues[playbookFieldStateKey(activePlaybook.id, field.key)] || ''}
                          onChange={(event) => updatePlaybookFieldValue(activePlaybook.id, field.key, event.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                          placeholder={field.placeholder}
                        />
                        <span className="block text-[10px] text-aegis-text-dim">Default: {field.defaultValue}</span>
                      </label>
                    ))}
                  </div>

                  <div className="rounded-lg border border-aegis-border bg-aegis-card p-2 space-y-1">
                    <div className="text-[11px] font-semibold text-aegis-text">Generated brief preview</div>
                    <div className="text-[11px] text-aegis-text-dim whitespace-pre-wrap break-words">
                      {activePlaybookBrief || '-'}
                    </div>
                    {activePlaybookContext && (
                      <div className="text-[11px] text-aegis-text-dim whitespace-pre-wrap break-words">
                        Context note: {activePlaybookContext}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-aegis-border bg-aegis-card p-2">
                    <div className="text-[11px] font-semibold text-aegis-text mb-1">KPI tracking (workspace)</div>
                    <div className="flex flex-wrap gap-1.5 text-[10px] text-aegis-text-dim">
                      <span className="px-2 py-1 rounded-md border border-aegis-border bg-aegis-elevated">apply: {activePlaybookKpi.applies}</span>
                      <span className="px-2 py-1 rounded-md border border-aegis-border bg-aegis-elevated">generate: {activePlaybookKpi.generateSuccess}/{activePlaybookKpi.generateAttempts}</span>
                      <span className="px-2 py-1 rounded-md border border-aegis-border bg-aegis-elevated">brief outputs: {activePlaybookKpi.generateBriefCount}</span>
                      <span className="px-2 py-1 rounded-md border border-aegis-border bg-aegis-elevated">poster: {activePlaybookKpi.posterSuccess}</span>
                      <span className="px-2 py-1 rounded-md border border-aegis-border bg-aegis-elevated">queue: {activePlaybookKpi.queueSuccess}</span>
                      <span className="px-2 py-1 rounded-md border border-aegis-border bg-aegis-elevated">publish: {activePlaybookKpi.publishSuccess}</span>
                    </div>
                    {activePlaybookKpi.lastRunAt && (
                      <div className="text-[10px] text-aegis-text-dim mt-1">last run: {fmtWhen(activePlaybookKpi.lastRunAt)}</div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={applyActivePlaybook}
                      className="px-2.5 py-1.5 text-[11px] rounded-lg bg-aegis-primary text-white hover:opacity-90"
                    >
                      Apply to Draft Builder
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void applyAndGenerateActivePlaybook();
                      }}
                      disabled={generating}
                      className="px-2.5 py-1.5 text-[11px] rounded-lg border border-aegis-primary/30 bg-aegis-primary/10 text-aegis-text hover:bg-aegis-primary/20 disabled:opacity-60"
                    >
                      {generating ? 'Generating...' : 'Apply + Generate'}
                    </button>
                    <button
                      type="button"
                      onClick={resetActivePlaybookInputs}
                      className="px-2.5 py-1.5 text-[11px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                    >
                      Reset Inputs
                    </button>
                    <button
                      type="button"
                      onClick={clearWorkspacePlaybookRuns}
                      className="px-2.5 py-1.5 text-[11px] rounded-lg border border-aegis-border text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                    >
                      Clear workspace history
                    </button>
                    <span className="text-[11px] text-aegis-text-dim">
                      Related skills: {activePlaybook.relatedSkills.join(', ')}
                    </span>
                  </div>

                  <div className="rounded-lg border border-aegis-border bg-aegis-card p-2 space-y-1">
                    <div className="text-[11px] font-semibold text-aegis-text">Run History (latest 10)</div>
                    {activePlaybookRunHistory.map((run) => (
                      <div key={run.runId} className="text-[10px] text-aegis-text-dim flex flex-wrap items-center gap-1">
                        <span className={clsx(
                          'px-1.5 py-0.5 rounded-md border',
                          run.status === 'success'
                            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                            : 'border-rose-500/35 bg-rose-500/10 text-rose-300',
                        )}>
                          {run.eventType} · {run.status}
                        </span>
                        <span>{fmtWhen(run.occurredAt)}</span>
                        {run.outputType && <span>· output {run.outputType}</span>}
                        {typeof run.mediaCount === 'number' && <span>· media {run.mediaCount}</span>}
                        <span className="break-words">· {run.message}</span>
                      </div>
                    ))}
                    {activePlaybookRunHistory.length === 0 && (
                      <div className="text-[10px] text-aegis-text-dim">No run history yet for this playbook.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {activePlaybookSector === 'content_creation' ? (
            <>
          <div className="rounded-xl border border-aegis-border bg-aegis-card p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-aegis-primary" />
              <h2 className="text-[13px] font-semibold text-aegis-text">Generate Draft</h2>
            </div>

            <div className="grid gap-2 lg:grid-cols-[minmax(0,1.35fr),minmax(0,1fr)]">
              <label className="space-y-1 min-w-0">
                <span className="text-[11px] text-aegis-text-dim">Brief (primary input)</span>
                <textarea
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                  className="w-full h-28 px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text leading-5"
                  placeholder="Describe what you want to post. Include goal, audience, key points, and desired CTA."
                />
              </label>
              <div className="space-y-2 min-w-0">
                <label className="space-y-1 block">
                  <span className="text-[11px] text-aegis-text-dim">Reference URLs / image URLs (optional)</span>
                  <textarea
                    value={contextSourcesInput}
                    onChange={(event) => setContextSourcesInput(event.target.value)}
                    className="w-full h-16 px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text leading-5"
                    placeholder={`https://example.com/article-1\nhttps://example.com/image.jpg`}
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="text-[11px] text-aegis-text-dim">Context note or file excerpt (optional)</span>
                  <textarea
                    value={contextNoteInput}
                    onChange={(event) => setContextNoteInput(event.target.value)}
                    className="w-full h-9 px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text leading-5"
                    placeholder="Any constraints, claims, or source snippets you want the model to respect."
                  />
                </label>
                <div className="flex items-center gap-2">
                  <label className="px-2 py-1 text-[11px] rounded-md border border-aegis-border text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.04)] cursor-pointer">
                    Load reference file
                    <input
                      type="file"
                      accept=".txt,.md,.json,.csv"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void loadReferenceFile(file);
                        }
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                  {referenceFileName && (
                    <span className="text-[11px] text-aegis-text-dim truncate">
                      loaded: {referenceFileName}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-aegis-border bg-aegis-elevated p-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-medium text-aegis-text">Generation Models</div>
                <div className="text-[11px] text-aegis-text-dim">
                  {generationSettings?.updatedAt
                    ? `workspace override · updated ${fmtWhen(generationSettings.updatedAt)}`
                    : 'using workspace defaults'}
                </div>
              </div>
              <div className="grid gap-2 xl:grid-cols-2">
                <label className="space-y-1 min-w-0">
                  <span className="text-[11px] text-aegis-text-dim">Content model</span>
                  <select
                    value={contentModelSelectValue}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (!next) {
                        setContentModelCustom(false);
                        setContentModel('');
                        return;
                      }
                      if (next === CUSTOM_OPTION_VALUE) {
                        setContentModelCustom(true);
                        return;
                      }
                      setContentModelCustom(false);
                      setContentModel(next);
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                  >
                    <option value="">Use default ({health?.generation?.defaultContentModel || 'configured in backend'})</option>
                    {availableContentModels.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                    <option value={CUSTOM_OPTION_VALUE}>Custom model...</option>
                  </select>
                  {contentModelSelectValue === CUSTOM_OPTION_VALUE && (
                    <input
                      value={contentModel}
                      onChange={(event) => {
                        setContentModelCustom(true);
                        setContentModel(event.target.value);
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                      placeholder="e.g. anthropic/claude-3.7-sonnet"
                    />
                  )}
                </label>
                <label className="space-y-1 min-w-0">
                  <span className="text-[11px] text-aegis-text-dim">Image model</span>
                  <select
                    value={imageModelSelectValue}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (!next) {
                        setImageModelCustom(false);
                        setImageModel('');
                        return;
                      }
                      if (next === CUSTOM_OPTION_VALUE) {
                        setImageModelCustom(true);
                        return;
                      }
                      setImageModelCustom(false);
                      setImageModel(next);
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                  >
                    <option value="">Use default ({health?.generation?.defaultImageModel || 'configured in backend'})</option>
                    {availableImageModels.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                    <option value={CUSTOM_OPTION_VALUE}>Custom model...</option>
                  </select>
                  {imageModelSelectValue === CUSTOM_OPTION_VALUE && (
                    <input
                      value={imageModel}
                      onChange={(event) => {
                        setImageModelCustom(true);
                        setImageModel(event.target.value);
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                      placeholder="e.g. black-forest-labs/flux-1.1-pro"
                    />
                  )}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void saveGenerationModelSettings();
                  }}
                  disabled={savingGenerationSettings}
                  className="px-2.5 py-1.5 text-[11px] rounded-lg bg-aegis-primary text-white hover:opacity-90 disabled:opacity-60"
                >
                  {savingGenerationSettings ? 'Saving...' : 'Save model settings'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void clearGenerationModelSettings();
                  }}
                  disabled={savingGenerationSettings}
                  className="px-2.5 py-1.5 text-[11px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
                >
                  Use defaults
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void refreshModelCatalogNow();
                  }}
                  disabled={refreshingModelCatalog}
                  className="px-2.5 py-1.5 text-[11px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
                >
                  {refreshingModelCatalog ? 'Refreshing...' : 'Refresh catalog'}
                </button>
                <span className="text-[11px] text-aegis-text-dim">
                  effective: {contentModel.trim() || health?.generation?.effectiveContentModel || '-'} · {imageModel.trim() || health?.generation?.effectiveImageModel || '-'}
                </span>
              </div>
            </div>

            <details className="rounded-lg border border-aegis-border bg-aegis-elevated p-2">
              <summary className="cursor-pointer text-[12px] font-medium text-aegis-text">
                Advanced controls (optional)
              </summary>
              <div className="mt-2 max-h-40 overflow-y-auto space-y-2">
                <div className="text-[11px] text-aegis-text-dim">
                  You can leave all fields below empty. They override the brief only when filled.
                </div>
                <div className="grid gap-2 xl:grid-cols-3">
                  <label className="space-y-1">
                    <span className="text-[11px] text-aegis-text-dim">Topic override</span>
                    <select
                      value={topicSelectValue}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (!next) {
                          setTopicCustom(false);
                          setTopic('');
                          return;
                        }
                        if (next === CUSTOM_OPTION_VALUE) {
                          setTopicCustom(true);
                          return;
                        }
                        setTopicCustom(false);
                        setTopic(next);
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                    >
                      <option value="">Use brief-derived topic</option>
                      {TOPIC_OPTIONS.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                      <option value={CUSTOM_OPTION_VALUE}>Custom topic...</option>
                    </select>
                    {topicSelectValue === CUSTOM_OPTION_VALUE && (
                      <input
                        value={topic}
                        onChange={(event) => {
                          setTopicCustom(true);
                          setTopic(event.target.value);
                        }}
                        className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                        placeholder="Custom topic"
                      />
                    )}
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-aegis-text-dim">Angle</span>
                    <select
                      value={angleSelectValue}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (!next) {
                          setAngleCustom(false);
                          setAngle('');
                          return;
                        }
                        if (next === CUSTOM_OPTION_VALUE) {
                          setAngleCustom(true);
                          return;
                        }
                        setAngleCustom(false);
                        setAngle(next);
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                    >
                      <option value="">Auto from brief</option>
                      {ANGLE_OPTIONS.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                      <option value={CUSTOM_OPTION_VALUE}>Custom angle...</option>
                    </select>
                    {angleSelectValue === CUSTOM_OPTION_VALUE && (
                      <input
                        value={angle}
                        onChange={(event) => {
                          setAngleCustom(true);
                          setAngle(event.target.value);
                        }}
                        className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                        placeholder="Custom angle"
                      />
                    )}
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-aegis-text-dim">Tone</span>
                    <select
                      value={toneSelectValue}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (!next) {
                          setToneCustom(false);
                          setTone('');
                          return;
                        }
                        if (next === CUSTOM_OPTION_VALUE) {
                          setToneCustom(true);
                          return;
                        }
                        setToneCustom(false);
                        setTone(next);
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                    >
                      <option value="">Auto from brief</option>
                      {TONE_OPTIONS.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                      <option value={CUSTOM_OPTION_VALUE}>Custom tone...</option>
                    </select>
                    {toneSelectValue === CUSTOM_OPTION_VALUE && (
                      <input
                        value={tone}
                        onChange={(event) => {
                          setToneCustom(true);
                          setTone(event.target.value);
                        }}
                        className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                        placeholder="Custom tone"
                      />
                    )}
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-aegis-text-dim">Audience</span>
                    <select
                      value={audienceSelectValue}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (!next) {
                          setAudienceCustom(false);
                          setAudience('');
                          return;
                        }
                        if (next === CUSTOM_OPTION_VALUE) {
                          setAudienceCustom(true);
                          return;
                        }
                        setAudienceCustom(false);
                        setAudience(next);
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                    >
                      <option value="">Auto from brief</option>
                      {AUDIENCE_OPTIONS.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                      <option value={CUSTOM_OPTION_VALUE}>Custom audience...</option>
                    </select>
                    {audienceSelectValue === CUSTOM_OPTION_VALUE && (
                      <input
                        value={audience}
                        onChange={(event) => {
                          setAudienceCustom(true);
                          setAudience(event.target.value);
                        }}
                        className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                        placeholder="Custom audience"
                      />
                    )}
                  </label>
                  <label className="space-y-1 xl:col-span-2">
                    <span className="text-[11px] text-aegis-text-dim">CTA</span>
                    <select
                      value={ctaSelectValue}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (!next) {
                          setCtaCustom(false);
                          setCta('');
                          return;
                        }
                        if (next === CUSTOM_OPTION_VALUE) {
                          setCtaCustom(true);
                          return;
                        }
                        setCtaCustom(false);
                        setCta(next);
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                    >
                      <option value="">Auto from brief</option>
                      {CTA_OPTIONS.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                      <option value={CUSTOM_OPTION_VALUE}>Custom CTA...</option>
                    </select>
                    {ctaSelectValue === CUSTOM_OPTION_VALUE && (
                      <input
                        value={cta}
                        onChange={(event) => {
                          setCtaCustom(true);
                          setCta(event.target.value);
                        }}
                        className="w-full px-3 py-2 rounded-lg border border-aegis-border bg-aegis-card text-[12px] text-aegis-text"
                        placeholder="Custom CTA"
                      />
                    )}
                  </label>
                </div>
              </div>
            </details>

            <div className="flex flex-wrap gap-2">
              {DRAFT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyDraftPreset(preset)}
                  className="px-2 py-1 text-[11px] rounded-md border border-aegis-border text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {SUPPORTED_PLATFORMS.map((platform) => (
                <button
                  key={platform}
                  type="button"
                  onClick={() => togglePlatform(platform)}
                  className={clsx(
                    'px-2 py-1 text-[11px] rounded-md border',
                    selectedPlatforms.includes(platform)
                      ? 'border-aegis-primary bg-aegis-primary/20 text-aegis-text'
                      : 'border-aegis-border text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.04)]',
                  )}
                >
                  {platform}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void generateContent();
                }}
                disabled={generating}
                className="px-3 py-2 text-[12px] rounded-lg bg-aegis-primary text-white hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                <Sparkles size={12} />
                {generating ? 'Generating...' : 'Generate'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void regeneratePoster();
                }}
                disabled={generatingPoster}
                className="px-3 py-2 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                <Sparkles size={12} />
                {generatingPoster ? 'Generating Poster...' : 'Generate Poster'}
              </button>
              <span className="text-[11px] text-aegis-text-dim">
                Platforms: {availablePlatforms.join(', ')}
              </span>
            </div>

            <textarea
              value={generatedText}
              onChange={(event) => setGeneratedText(event.target.value)}
              className="w-full h-36 px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text font-mono leading-5"
              placeholder="Generated social post draft appears here..."
            />

            <div className="rounded-lg border border-aegis-border bg-aegis-elevated p-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] text-aegis-text font-medium">
                  Poster Image
                </div>
                <div className="text-[11px] text-aegis-text-dim">
                  output: {generatedOutputType}
                </div>
              </div>
              {selectedMediaUrls.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {selectedMediaUrls.map((url) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setSelectedMediaUrls([url])}
                      className={clsx(
                        'rounded-lg overflow-hidden border',
                        selectedMediaUrls[0] === url ? 'border-aegis-primary' : 'border-aegis-border',
                      )}
                    >
                      <img src={url} alt="Generated poster" className="w-full h-36 object-cover" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-aegis-text-dim">
                  No poster image selected. Click Generate or Generate Poster.
                </div>
              )}
              {generatedAssets.length > 0 && (
                <div className="text-[11px] text-aegis-text-dim">
                  assets: {generatedAssets.length} · quality flags: {generatedQualityFlags.length > 0 ? generatedQualityFlags.join(', ') : 'none'}
                </div>
              )}
            </div>

            <div className="grid gap-2 lg:grid-cols-[minmax(150px,1fr),minmax(120px,auto),minmax(180px,auto),auto,auto]">
              <select
                value={selectedAccountId}
                onChange={(event) => setSelectedAccountId(event.target.value)}
                className="px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text"
              >
                {publishableAccounts.map((account) => (
                  <option key={account.socialAccountId} value={account.socialAccountId}>
                    {account.platform}: {account.handle}{account.isDefault ? ' (default)' : ''}
                  </option>
                ))}
                {publishableAccounts.length === 0 && <option value="">No connected account</option>}
              </select>

              <select
                value={publishPlatform}
                onChange={(event) => setPublishPlatform(event.target.value as Platform)}
                className="px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text"
              >
                {SUPPORTED_PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-aegis-border bg-aegis-elevated text-[12px] text-aegis-text">
                <CalendarClock size={12} />
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                  className="bg-transparent outline-none min-w-0"
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  void queuePost();
                }}
                disabled={queueing}
                className="px-3 py-2 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
              >
                {queueing ? 'Queueing...' : 'Queue'}
              </button>

              <button
                type="button"
                onClick={() => {
                  void publishNow();
                }}
                disabled={publishing}
                className="px-3 py-2 text-[12px] rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
              >
                <Send size={12} />
                {publishing ? 'Publishing...' : 'Publish now'}
              </button>
            </div>

            {actionMessage && (
              <div className="text-[12px] text-aegis-text-dim">
                {actionMessage}
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 rounded-xl border border-aegis-border bg-aegis-card p-3 overflow-auto">
            <h2 className="text-[13px] font-semibold text-aegis-text mb-2">Recent Posts</h2>
            <div className="space-y-2">
              {posts.map((post) => (
                <article key={post.postId} className="rounded-lg border border-aegis-border bg-aegis-elevated p-2 space-y-1">
                  <div className="flex items-center gap-2 text-[11px] text-aegis-text-dim">
                    <span>{post.platform}</span>
                    <span>•</span>
                    <span>{post.status}</span>
                    <span>•</span>
                    <span>{fmtWhen(post.scheduledAt || post.createdAt)}</span>
                    {Array.isArray(post.mediaUrls) && post.mediaUrls.length > 0 && (
                      <>
                        <span>•</span>
                        <span>{post.mediaUrls.length} media</span>
                      </>
                    )}
                    {post.externalUrl && (
                      <>
                        <span>•</span>
                        <a
                          href={post.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-aegis-primary hover:underline"
                        >
                          Open
                        </a>
                      </>
                    )}
                  </div>
                  <p className="text-[12px] text-aegis-text whitespace-pre-wrap break-words">{post.text}</p>
                  {Array.isArray(post.mediaUrls) && post.mediaUrls.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {post.mediaUrls.slice(0, 2).map((url) => (
                        <img key={url} src={url} alt="Post media" className="w-full h-24 rounded-md object-cover border border-aegis-border" />
                      ))}
                    </div>
                  )}
                </article>
              ))}
              {posts.length === 0 && (
                <div className="text-[12px] text-aegis-text-dim">No posts yet.</div>
              )}
            </div>
          </div>
            </>
          ) : (
            <div className="rounded-xl border border-aegis-border bg-aegis-card p-4 text-[12px] text-aegis-text-dim">
              Draft Builder is scoped to <span className="text-aegis-text font-medium">01 Content Creation</span>.
              Use playbook actions here for strategy planning, or switch sector to Content Creation for manual draft editing,
              poster generation, and publishing controls.
            </div>
          )}
        </div>
      </section>

      {settingsOpen && (
        <div
          className="fixed inset-0 z-[120] bg-transparent backdrop-blur-[2px] p-3 md:p-5"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="mx-auto h-full max-h-[860px] w-full max-w-[1260px] rounded-2xl border border-aegis-primary/20 bg-[var(--aegis-bg)] shadow-[0_0_0_1px_rgb(var(--aegis-primary)/0.12),0_0_36px_rgb(var(--aegis-primary)/0.16),0_20px_60px_rgb(var(--aegis-overlay)/0.25)] overflow-hidden flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-5 border-b border-[rgb(var(--aegis-overlay)/0.08)] flex items-start justify-between gap-3">
              <div>
                <div className="text-[18px] font-bold text-aegis-text flex items-center gap-2">
                  <Settings2 size={16} />
                  Social Studio Settings
                </div>
                <div className="text-[12px] text-aegis-text-dim mt-1">
                  Account management, OAuth configuration, and workspace-level social settings
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="w-8 h-8 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-dim hover:text-aegis-text flex items-center justify-center"
                aria-label="Close social settings"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[280px_1fr]">
              <aside className="border-r border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.02)] overflow-y-auto p-3 space-y-3">
                <div className="rounded-xl border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] p-3">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-aegis-text-dim">Workspace</div>
                  <div className="mt-1 text-[13px] font-semibold text-aegis-text break-all">{workspaceId}</div>
                  <div className="mt-2 text-[11px] text-aegis-text-dim">
                    connected: {connectedAccountCount} · reauth: {reauthAccountCount} · disabled: {disabledAccountCount}
                  </div>
                </div>

                <div className="rounded-xl border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] p-2.5 space-y-1.5">
                  <div className="px-1 text-[11px] uppercase tracking-[0.08em] text-aegis-text-dim">Sections</div>
                  <button
                    type="button"
                    onClick={() => document.getElementById('social-settings-connected')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="w-full text-left rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] px-2.5 py-2 text-[12px] text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.05)]"
                  >
                    Connected Accounts
                  </button>
                  <button
                    type="button"
                    onClick={() => document.getElementById('social-settings-account')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="w-full text-left rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] px-2.5 py-2 text-[12px] text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.05)]"
                  >
                    Account Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => document.getElementById('social-settings-oauth')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="w-full text-left rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] px-2.5 py-2 text-[12px] text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.05)]"
                  >
                    Workspace OAuth Apps
                  </button>
                </div>

                {settingsMessage && (
                  <div className="rounded-xl border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] p-2.5 text-[11px] text-aegis-text-dim">
                    {settingsMessage}
                  </div>
                )}
              </aside>

              <div className="overflow-y-auto p-4 md:p-5 space-y-3">
                <section id="social-settings-connected" className="rounded-xl border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] p-3 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="text-[13px] font-semibold text-aegis-text">Connected Accounts</h2>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void startPlatformConnect('linkedin');
                        }}
                        disabled={connectingOAuth || !linkedInConfigured}
                        className="px-2.5 py-1.5 text-[11px] rounded-lg bg-aegis-primary text-white hover:opacity-90 disabled:opacity-60"
                      >
                        {connectingOAuth && connectPlatform === 'linkedin' ? 'Waiting OAuth...' : 'Connect LinkedIn'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void startPlatformConnect('x');
                        }}
                        disabled={connectingOAuth || !xConfigured}
                        className="px-2.5 py-1.5 text-[11px] rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
                      >
                        {connectingOAuth && connectPlatform === 'x' ? 'Waiting OAuth...' : 'Connect X'}
                      </button>
                      {connectingOAuth && (
                        <button
                          type="button"
                          onClick={cancelOauthWaiting}
                          className="px-2.5 py-1.5 text-[11px] rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>

                  {(!linkedInConfigured || !xConfigured) && (
                    <div className="text-[11px] text-amber-300 space-y-1">
                      {!linkedInConfigured && (
                        <div>LinkedIn OAuth is not configured. Set env vars or add workspace OAuth app credentials below.</div>
                      )}
                      {!xConfigured && (
                        <div>X OAuth is not configured. Set env vars or add workspace OAuth app credentials below.</div>
                      )}
                    </div>
                  )}

                  {connectMessage && (
                    <div className="text-[11px] text-aegis-text-dim">
                      {connectMessage}
                    </div>
                  )}

                  <div className="space-y-2">
                    {accounts.map((account) => (
                      <div key={account.socialAccountId} className="rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] p-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[12px] text-aegis-text">
                            {account.platform} · {account.handle}{account.isDefault ? ' · default' : ''}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              void disconnectAccount(account.socialAccountId);
                            }}
                            disabled={disconnectingAccountId === account.socialAccountId}
                            className="px-2 py-1 text-[10px] rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
                          >
                            {disconnectingAccountId === account.socialAccountId ? 'Disconnecting...' : 'Disconnect'}
                          </button>
                        </div>
                        <div className="text-[11px] text-aegis-text-dim">
                          workspace {(account.workspaceId || workspaceId)} · {account.status} · last sync {fmtWhen(account.lastSyncAt)}
                        </div>
                        {Array.isArray(account.tags) && account.tags.length > 0 && (
                          <div className="text-[11px] text-aegis-text-dim">tags: {account.tags.join(', ')}</div>
                        )}
                        <div className="text-[11px] text-aegis-text-dim break-all">{account.socialAccountId}</div>
                      </div>
                    ))}
                    {accounts.length === 0 && (
                      <div className="text-[12px] text-aegis-text-dim">No account connected from backend.</div>
                    )}
                  </div>
                </section>

                <section id="social-settings-account" className="rounded-xl border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] p-3 space-y-2">
                  <h2 className="text-[13px] font-semibold text-aegis-text">Account Settings</h2>
                  {!selectedAccount && (
                    <div className="text-[12px] text-aegis-text-dim">Select an account to manage default, tags, and reauth.</div>
                  )}
                  {selectedAccount && (
                    <>
                      <div className="text-[11px] text-aegis-text-dim">
                        Active: {selectedAccount.platform} / {selectedAccount.handle}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void setSelectedAccountAsDefault();
                          }}
                          disabled={savingAccountSettings || selectedAccount.isDefault === true}
                          className="px-2.5 py-1.5 text-[11px] rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
                        >
                          {selectedAccount.isDefault ? 'Default account' : 'Set as default'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void startAccountReauth();
                          }}
                          disabled={connectingOAuth || (selectedAccount.platform !== 'linkedin' && selectedAccount.platform !== 'x')}
                          className="px-2.5 py-1.5 text-[11px] rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
                        >
                          {connectingOAuth ? 'Waiting OAuth...' : 'Quick reauth'}
                        </button>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-aegis-text-dim">Tags (comma-separated)</label>
                        <input
                          value={accountTagsInput}
                          onChange={(event) => setAccountTagsInput(event.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] text-[12px] text-aegis-text"
                          placeholder="marketing, brand-a, founder"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void saveSelectedAccountSettings();
                          }}
                          disabled={savingAccountSettings}
                          className="px-2.5 py-1.5 text-[11px] rounded-lg bg-aegis-primary text-white hover:opacity-90 disabled:opacity-60"
                        >
                          {savingAccountSettings ? 'Saving...' : 'Save tags'}
                        </button>
                      </div>
                    </>
                  )}
                </section>

                <section id="social-settings-oauth" className="rounded-xl border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] p-3 space-y-3">
                  <h2 className="text-[13px] font-semibold text-aegis-text">Workspace OAuth Apps (BYO)</h2>
                  <div className="text-[11px] text-aegis-text-dim">
                    Store per-workspace LinkedIn/X app credentials in backend settings. Secrets are never returned to UI.
                  </div>

                  <div className="rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] p-2 space-y-2">
                    <div className="text-[12px] text-aegis-text font-medium">LinkedIn</div>
                    <input
                      value={linkedInClientId}
                      onChange={(event) => setLinkedInClientId(event.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] text-[12px] text-aegis-text"
                      placeholder="LinkedIn Client ID"
                    />
                    <input
                      type="password"
                      value={linkedInClientSecret}
                      onChange={(event) => setLinkedInClientSecret(event.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] text-[12px] text-aegis-text"
                      placeholder={linkedInOauthApp?.hasClientSecret ? 'Client Secret (leave blank to keep existing)' : 'LinkedIn Client Secret'}
                    />
                    <input
                      value={linkedInScopesInput}
                      onChange={(event) => setLinkedInScopesInput(event.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] text-[12px] text-aegis-text"
                      placeholder="Scopes (comma-separated)"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void saveWorkspaceOauthApp('linkedin');
                        }}
                        disabled={savingOauthPlatform !== '' && savingOauthPlatform !== 'linkedin'}
                        className="px-2.5 py-1.5 text-[11px] rounded-lg bg-aegis-primary text-white hover:opacity-90 disabled:opacity-60"
                      >
                        {savingOauthPlatform === 'linkedin' ? 'Saving...' : 'Save LinkedIn app'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void deleteWorkspaceOauthApp('linkedin');
                        }}
                        disabled={savingOauthPlatform !== '' && savingOauthPlatform !== 'linkedin'}
                        className="px-2.5 py-1.5 text-[11px] rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="text-[11px] text-aegis-text-dim">
                      Secret stored: {linkedInOauthApp?.hasClientSecret ? 'yes' : 'no'}
                      {linkedInOauthApp?.updatedAt ? ` · updated ${fmtWhen(linkedInOauthApp.updatedAt)}` : ''}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] p-2 space-y-2">
                    <div className="text-[12px] text-aegis-text font-medium">X</div>
                    <input
                      value={xClientId}
                      onChange={(event) => setXClientId(event.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] text-[12px] text-aegis-text"
                      placeholder="X Client ID"
                    />
                    <input
                      type="password"
                      value={xClientSecret}
                      onChange={(event) => setXClientSecret(event.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] text-[12px] text-aegis-text"
                      placeholder={xOauthApp?.hasClientSecret ? 'Client Secret (optional, leave blank to keep existing)' : 'X Client Secret (optional)'}
                    />
                    <input
                      value={xScopesInput}
                      onChange={(event) => setXScopesInput(event.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.02)] text-[12px] text-aegis-text"
                      placeholder="Scopes (comma-separated)"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void saveWorkspaceOauthApp('x');
                        }}
                        disabled={savingOauthPlatform !== '' && savingOauthPlatform !== 'x'}
                        className="px-2.5 py-1.5 text-[11px] rounded-lg bg-aegis-primary text-white hover:opacity-90 disabled:opacity-60"
                      >
                        {savingOauthPlatform === 'x' ? 'Saving...' : 'Save X app'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void deleteWorkspaceOauthApp('x');
                        }}
                        disabled={savingOauthPlatform !== '' && savingOauthPlatform !== 'x'}
                        className="px-2.5 py-1.5 text-[11px] rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)] disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="text-[11px] text-aegis-text-dim">
                      Secret stored: {xOauthApp?.hasClientSecret ? 'yes' : 'no'}
                      {xOauthApp?.updatedAt ? ` · updated ${fmtWhen(xOauthApp.updatedAt)}` : ''}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
