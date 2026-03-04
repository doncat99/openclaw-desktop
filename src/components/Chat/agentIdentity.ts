import type { Session } from '@/stores/chatStore';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function extractAgentId(sessionKey: string): string {
  const match = sessionKey.match(/^agent:([^:]+):/i);
  return match?.[1]?.trim() || '';
}

function tagFromLabel(label: string): string {
  const upper = label.toUpperCase();
  if (upper.includes('CEO')) return 'CEO';
  if (upper.includes('CTO')) return 'CTO';
  if (upper.includes('CFO')) return 'CFO';
  if (upper.includes('COO')) return 'COO';
  if (upper.includes('CMO')) return 'CMO';
  if (upper.includes('HEAD OF HR') || upper === 'HR') return 'HR';
  if (upper.includes('LEGAL')) return 'LEG';
  if (upper.includes('INTERN')) return 'INT';
  if (upper.includes('ORCHESTRATOR')) return 'ORC';
  if (upper.includes('NEURA') || upper.includes('MAIN')) return 'NEU';

  const words = label
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);
  if (words.length === 0) return 'AI';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map((w) => w[0].toUpperCase()).join('');
}

function tagFromText(text: string): string {
  const t = normalize(text);
  if (!t) return '';

  if (/team-ceo|agent:team-ceo|\bceo\b/.test(t)) return 'CEO';
  if (/team-cto|agent:team-cto|\bcto\b/.test(t)) return 'CTO';
  if (/team-cfo|agent:team-cfo|\bcfo\b/.test(t)) return 'CFO';
  if (/team-coo|agent:team-coo|\bcoo\b/.test(t)) return 'COO';
  if (/team-cmo|agent:team-cmo|\bcmo\b/.test(t)) return 'CMO';
  if (/team-hr|agent:team-hr|head of hr|\bhr\b/.test(t)) return 'HR';
  if (/team-legal|agent:team-legal|\blegal\b/.test(t)) return 'LEG';
  if (/team-intern|agent:team-intern|\bintern\b/.test(t)) return 'INT';
  return '';
}

export function getAgentTagForSession(sessionKey: string, sessions: Session[], contentHint = ''): string {
  const cleanKey = (sessionKey || '').trim();
  const agentId = extractAgentId(cleanKey);
  const id = normalize(agentId || cleanKey);

  if (id === 'main') {
    const fromContent = tagFromText(contentHint);
    if (fromContent) return fromContent;
    return 'NEU';
  }
  if (id.includes('team-ceo')) return 'CEO';
  if (id.includes('team-cto')) return 'CTO';
  if (id.includes('team-cfo')) return 'CFO';
  if (id.includes('team-coo')) return 'COO';
  if (id.includes('team-cmo')) return 'CMO';
  if (id.includes('team-hr')) return 'HR';
  if (id.includes('team-legal')) return 'LEG';
  if (id.includes('team-intern')) return 'INT';
  if (id.includes('orchestrator')) return 'ORC';

  const session = sessions.find((s) => s.key === cleanKey);
  if (session?.label) {
    const fromLabel = tagFromLabel(session.label);
    if (fromLabel) return fromLabel;
  }
  const fromContent = tagFromText(contentHint);
  if (fromContent) return fromContent;
  return 'NEU';
}
