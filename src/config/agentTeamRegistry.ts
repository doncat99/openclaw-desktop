import type { AgentInfo } from '@/stores/gatewayDataStore';

export type TeamDepth = 0 | 1 | 2 | 3;
export type TeamRuntimeStatus = 'missing' | 'ready' | 'active' | 'idle';

export interface TeamMemberDefinition {
  key: string;
  openclawAgentId: string;
  title: string;
  role: string;
  depth: TeamDepth;
  reportsTo?: string;
  fixed?: boolean;
  aliases: string[];
  responsibilities: string[];
  skillSet: string[];
  outputs: string[];
}

export interface TeamInteractionDefinition {
  from: string;
  to: string;
  mode: 'delegates' | 'reviews' | 'approves' | 'supports' | 'reports';
  purpose: string;
}

export interface ResolvedTeamMember {
  definition: TeamMemberDefinition;
  agent: AgentInfo | null;
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const TEAM_DEFS: TeamMemberDefinition[] = [
  {
    key: 'controller',
    openclawAgentId: 'main',
    title: 'OpenClaw Controller Agent',
    role: 'Platform Controller',
    depth: 0,
    fixed: true,
    aliases: ['main', 'openclaw-controller', 'controller'],
    responsibilities: [
      'Global safety, escalation, and final execution gate',
      'Route work to CEO and team agents based on intent',
      'Enforce policy and execution constraints',
    ],
    skillSet: ['Routing', 'Policy governance', 'Execution arbitration', 'Escalation handling'],
    outputs: ['Approved execution plan', 'Escalation decision', 'Final release approval'],
  },
  {
    key: 'ceo',
    openclawAgentId: 'team-ceo-strategy',
    title: 'CEO Orchestrator',
    role: 'Strategic Lead',
    depth: 1,
    reportsTo: 'controller',
    aliases: ['ceo', 'strategy-lead', 'team-ceo'],
    responsibilities: [
      'Turn objectives into cross-team plans',
      'Prioritize initiatives and sequencing',
      'Assign work across CTO/CFO/COO/CMO/HR/Legal',
    ],
    skillSet: ['Strategic planning', 'Prioritization', 'Program decomposition', 'Decision scoring'],
    outputs: ['Team execution brief', 'Delegation checklist', 'Daily strategic summary'],
  },
  {
    key: 'cto',
    openclawAgentId: 'team-cto-engineering',
    title: 'CTO Engineering',
    role: 'Technology Lead',
    depth: 2,
    reportsTo: 'ceo',
    aliases: ['cto', 'engineering-lead', 'team-cto'],
    responsibilities: [
      'Architecture decisions and technical delivery',
      'Code quality, reliability, and release readiness',
      'Defect triage and remediation',
    ],
    skillSet: ['System design', 'Coding', 'Testing', 'Debugging', 'Integration'],
    outputs: ['Technical implementation pack', 'Risk register', 'Release readiness report'],
  },
  {
    key: 'cfo',
    openclawAgentId: 'team-cfo-finance',
    title: 'CFO Finance',
    role: 'Cost & Risk Lead',
    depth: 2,
    reportsTo: 'ceo',
    aliases: ['cfo', 'finance-lead', 'team-cfo'],
    responsibilities: [
      'Budget guardrails and cost forecasting',
      'Track utilization and ROI by workflow',
      'Approve high-cost execution paths',
    ],
    skillSet: ['Cost analytics', 'Forecasting', 'Budget control', 'Risk assessment'],
    outputs: ['Cost envelope', 'Spend variance report', 'Approval/reject decision'],
  },
  {
    key: 'coo',
    openclawAgentId: 'team-coo-operations',
    title: 'COO Operations',
    role: 'Execution Lead',
    depth: 2,
    reportsTo: 'ceo',
    aliases: ['coo', 'operations-lead', 'team-coo'],
    responsibilities: [
      'Operational runbooks and task orchestration',
      'SLA tracking and queue throughput',
      'Drive queue -> in-progress -> done flow',
    ],
    skillSet: ['Workflow orchestration', 'Runbook execution', 'SLA management', 'Incident response'],
    outputs: ['Execution runbook', 'Throughput dashboard summary', 'Blocker escalation list'],
  },
  {
    key: 'cmo',
    openclawAgentId: 'team-cmo-marketing',
    title: 'CMO Marketing',
    role: 'Content & Campaign Lead',
    depth: 2,
    reportsTo: 'ceo',
    aliases: ['cmo', 'marketing-lead', 'team-cmo'],
    responsibilities: [
      'Campaign planning and narrative development',
      'Asset briefs and content outputs',
      'Coordinate publish-ready messaging',
    ],
    skillSet: ['Content strategy', 'Campaign planning', 'Creative briefs', 'Audience targeting'],
    outputs: ['Campaign brief', 'Content draft package', 'Launch checklist'],
  },
  {
    key: 'hr',
    openclawAgentId: 'team-hr-people',
    title: 'Head of HR',
    role: 'People & Communication Lead',
    depth: 2,
    reportsTo: 'ceo',
    aliases: ['hr', 'head-of-hr', 'team-hr'],
    responsibilities: [
      'Internal communication quality and consistency',
      'Policy wording and team communication tone',
      'Human-centered review of outputs',
    ],
    skillSet: ['Communication QA', 'Policy drafting', 'Tone alignment', 'Internal messaging'],
    outputs: ['Communication quality review', 'Tone/style corrections', 'People-impact notes'],
  },
  {
    key: 'legal',
    openclawAgentId: 'team-legal-compliance',
    title: 'Head of Legal',
    role: 'Compliance Gate',
    depth: 3,
    reportsTo: 'ceo',
    aliases: ['legal', 'head-of-legal', 'team-legal'],
    responsibilities: [
      'Compliance and legal risk review',
      'Privacy and policy checks before release',
      'Approve/block external-facing artifacts',
    ],
    skillSet: ['Compliance review', 'Privacy governance', 'Policy validation', 'Approval workflows'],
    outputs: ['Compliance verdict', 'Required legal edits', 'Release gate decision'],
  },
  {
    key: 'intern',
    openclawAgentId: 'team-intern-research',
    title: 'Intern Research',
    role: 'Support Specialist',
    depth: 3,
    reportsTo: 'coo',
    aliases: ['intern', 'research-intern', 'team-intern'],
    responsibilities: [
      'Research gathering and note consolidation',
      'Draft-first outputs for review',
      'Support COO/CMO/CTO with prep work',
    ],
    skillSet: ['Web research', 'Summarization', 'Drafting', 'Task triage'],
    outputs: ['Research notes', 'First-pass draft', 'Evidence links bundle'],
  },
];

const TEAM_INTERACTIONS: TeamInteractionDefinition[] = [
  { from: 'controller', to: 'ceo', mode: 'delegates', purpose: 'Top-level objective routing and escalation' },
  { from: 'ceo', to: 'cto', mode: 'delegates', purpose: 'Technical execution streams' },
  { from: 'ceo', to: 'cfo', mode: 'delegates', purpose: 'Budget and cost validation' },
  { from: 'ceo', to: 'coo', mode: 'delegates', purpose: 'Operational orchestration' },
  { from: 'ceo', to: 'cmo', mode: 'delegates', purpose: 'Campaign/content execution' },
  { from: 'ceo', to: 'hr', mode: 'delegates', purpose: 'People and communication review' },
  { from: 'ceo', to: 'legal', mode: 'delegates', purpose: 'Compliance approval path' },
  { from: 'coo', to: 'intern', mode: 'supports', purpose: 'Research and prep workload offload' },
  { from: 'cmo', to: 'legal', mode: 'reviews', purpose: 'External message compliance review' },
  { from: 'cto', to: 'legal', mode: 'reviews', purpose: 'Technical policy and privacy alignment' },
  { from: 'cfo', to: 'ceo', mode: 'reports', purpose: 'Cost-risk report and approvals' },
  { from: 'legal', to: 'controller', mode: 'approves', purpose: 'Final compliance gate for releases' },
];

export function getTeamDefinitions(): TeamMemberDefinition[] {
  return TEAM_DEFS;
}

export function getTeamInteractions(): TeamInteractionDefinition[] {
  return TEAM_INTERACTIONS;
}

function isTeamMatch(def: TeamMemberDefinition, value: string): boolean {
  if (!value) return false;
  const norm = normalize(value);
  if (!norm) return false;
  if (normalize(def.openclawAgentId) === norm) return true;
  return def.aliases.some((a) => normalize(a) === norm);
}

export function findTeamDefinitionByAgent(agentIdOrName?: string | null): TeamMemberDefinition | null {
  const source = (agentIdOrName || '').trim();
  if (!source) return null;
  for (const def of TEAM_DEFS) {
    if (isTeamMatch(def, source)) return def;
  }
  return null;
}

export function resolveTeamMembers(agents: AgentInfo[]): ResolvedTeamMember[] {
  return TEAM_DEFS.map((def) => {
    const agent = agents.find((item) => {
      const id = typeof item?.id === 'string' ? item.id : '';
      const name = typeof item?.name === 'string' ? item.name : '';
      return isTeamMatch(def, id) || isTeamMatch(def, name);
    }) || null;
    return { definition: def, agent };
  });
}

export function isProvisionable(def: TeamMemberDefinition): boolean {
  return !def.fixed;
}
