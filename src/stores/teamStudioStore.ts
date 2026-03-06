import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getTeamDefinitions, TeamMemberDefinition } from '@/config/agentTeamRegistry';
import { migrateStorageKey, storageKey } from '@/utils/storage';

export interface TeamAgentProfile {
  key: string;
  title: string;
  role: string;
  responsibilities: string[];
  model?: string;
  skills: string[];
  outputs: string[];
}

export interface TeamEvolutionAnalysis {
  summary?: string;
  strengths: string[];
  gaps: string[];
  risks: string[];
  recommendations: string[];
}

export interface TeamEvolutionProposalDraft {
  role: string;
  responsibilities: string[];
  model?: string;
  skills: string[];
  outputs: string[];
}

export type TeamEvolutionProposalStatus = 'pending' | 'approved' | 'rejected';

export interface TeamEvolutionProposal {
  id: string;
  key: string;
  agentId: string;
  agentTitle: string;
  createdAt: string;
  source: 'gateway' | 'local';
  status: TeamEvolutionProposalStatus;
  rationale: string;
  analysis: TeamEvolutionAnalysis;
  current: TeamEvolutionProposalDraft;
  proposed: TeamEvolutionProposalDraft;
  reviewNote?: string;
  approvedAt?: string;
  rejectedAt?: string;
}

export interface TeamDialogResumeState {
  sessionKey: string;
  leadAgentId: string;
  pending: boolean;
  interrupted: boolean;
  lastUserRequest: string;
  lastSentAt: string;
  lastAssistantAt?: string;
  lastAssistantSnippet?: string;
  interruptionReason?: string;
  attempts: number;
}

interface TeamStudioState {
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  leadAgentId: string;
  profiles: Record<string, TeamAgentProfile>;
  proposals: TeamEvolutionProposal[];
  conversationStates: Record<string, TeamDialogResumeState>;
  setLeadAgentId: (agentId: string) => void;
  syncFromDefinitions: (definitions?: TeamMemberDefinition[]) => void;
  updateProfile: (
    key: string,
    patch: Partial<Pick<TeamAgentProfile, 'role' | 'responsibilities' | 'model' | 'skills' | 'outputs'>>
  ) => void;
  resetProfile: (key: string) => void;
  upsertProposal: (proposal: TeamEvolutionProposal) => void;
  setProposalStatus: (
    proposalId: string,
    status: TeamEvolutionProposalStatus,
    reviewNote?: string,
  ) => void;
  removeProposal: (proposalId: string) => void;
  markConversationPending: (params: {
    sessionKey: string;
    leadAgentId: string;
    userRequest: string;
    sentAt?: string;
  }) => void;
  markConversationProgress: (params: {
    sessionKey: string;
    assistantAt?: string;
    assistantSnippet?: string;
  }) => void;
  markConversationInterrupted: (params: {
    sessionKey: string;
    reason: string;
    assistantAt?: string;
    assistantSnippet?: string;
  }) => void;
  clearConversationState: (sessionKey: string) => void;
}

function toProfile(def: TeamMemberDefinition): TeamAgentProfile {
  return {
    key: def.key,
    title: def.title,
    role: def.role,
    responsibilities: [...def.responsibilities],
    model: '',
    skills: [...def.skillSet],
    outputs: [...def.outputs],
  };
}

function defaultLeadAgentId(): string {
  const defs = getTeamDefinitions();
  return defs.find((d) => d.key === 'ceo')?.openclawAgentId || 'main';
}

function defaultProfiles(definitions: TeamMemberDefinition[]): Record<string, TeamAgentProfile> {
  return Object.fromEntries(definitions.map((def) => [def.key, toProfile(def)]));
}

const TEAM_STUDIO_KEY = storageKey('team-studio');
migrateStorageKey(TEAM_STUDIO_KEY, 'aegis-team-studio');

export const useTeamStudioStore = create<TeamStudioState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      leadAgentId: defaultLeadAgentId(),
      profiles: defaultProfiles(getTeamDefinitions()),
      proposals: [],
      conversationStates: {},

      setLeadAgentId: (agentId) => set({ leadAgentId: agentId }),

      syncFromDefinitions: (definitions = getTeamDefinitions()) =>
        set((state) => {
          const merged: Record<string, TeamAgentProfile> = { ...state.profiles };
          for (const def of definitions) {
            const existing = merged[def.key];
            if (!existing) {
              merged[def.key] = toProfile(def);
              continue;
            }
            merged[def.key] = {
              ...existing,
              key: def.key,
              title: def.title,
              role: existing.role || def.role,
              responsibilities: existing.responsibilities?.length ? existing.responsibilities : [...def.responsibilities],
              model: typeof existing.model === 'string' ? existing.model : '',
              skills: existing.skills?.length ? existing.skills : [...def.skillSet],
              outputs: existing.outputs?.length ? existing.outputs : [...def.outputs],
            };
          }
          return { profiles: merged };
        }),

      updateProfile: (key, patch) =>
        set((state) => {
          const current = state.profiles[key];
          if (!current) return state;
          return {
            profiles: {
              ...state.profiles,
              [key]: {
                ...current,
                ...patch,
                responsibilities: patch.responsibilities ? [...patch.responsibilities] : current.responsibilities,
                skills: patch.skills ? [...patch.skills] : current.skills,
                outputs: patch.outputs ? [...patch.outputs] : current.outputs,
              },
            },
          };
        }),

      resetProfile: (key) =>
        set((state) => {
          const def = getTeamDefinitions().find((d) => d.key === key);
          if (!def) return state;
          return {
            profiles: {
              ...state.profiles,
              [key]: toProfile(def),
            },
          };
        }),

      upsertProposal: (proposal) =>
        set((state) => {
          const next = state.proposals.filter((item) => item.id !== proposal.id);
          next.unshift(proposal);
          return { proposals: next.slice(0, 80) };
        }),

      setProposalStatus: (proposalId, status, reviewNote) =>
        set((state) => ({
          proposals: state.proposals.map((item) => {
            if (item.id !== proposalId) return item;
            const now = new Date().toISOString();
            return {
              ...item,
              status,
              reviewNote: reviewNote || item.reviewNote,
              approvedAt: status === 'approved' ? now : item.approvedAt,
              rejectedAt: status === 'rejected' ? now : item.rejectedAt,
            };
          }),
        })),

      removeProposal: (proposalId) =>
        set((state) => ({
          proposals: state.proposals.filter((item) => item.id !== proposalId),
        })),

      markConversationPending: ({ sessionKey, leadAgentId, userRequest, sentAt }) =>
        set((state) => {
          const current = state.conversationStates[sessionKey];
          const nextAttempts = (current?.attempts || 0) + 1;
          return {
            conversationStates: {
              ...state.conversationStates,
              [sessionKey]: {
                sessionKey,
                leadAgentId,
                pending: true,
                interrupted: false,
                lastUserRequest: userRequest,
                lastSentAt: sentAt || new Date().toISOString(),
                lastAssistantAt: current?.lastAssistantAt,
                lastAssistantSnippet: current?.lastAssistantSnippet,
                interruptionReason: '',
                attempts: nextAttempts,
              },
            },
          };
        }),

      markConversationProgress: ({ sessionKey, assistantAt, assistantSnippet }) =>
        set((state) => {
          const current = state.conversationStates[sessionKey];
          if (!current) return state;
          return {
            conversationStates: {
              ...state.conversationStates,
              [sessionKey]: {
                ...current,
                pending: false,
                interrupted: false,
                lastAssistantAt: assistantAt || current.lastAssistantAt,
                lastAssistantSnippet: assistantSnippet || current.lastAssistantSnippet,
                interruptionReason: '',
              },
            },
          };
        }),

      markConversationInterrupted: ({ sessionKey, reason, assistantAt, assistantSnippet }) =>
        set((state) => {
          const current = state.conversationStates[sessionKey];
          if (!current) return state;
          return {
            conversationStates: {
              ...state.conversationStates,
              [sessionKey]: {
                ...current,
                pending: false,
                interrupted: true,
                interruptionReason: reason,
                lastAssistantAt: assistantAt || current.lastAssistantAt,
                lastAssistantSnippet: assistantSnippet || current.lastAssistantSnippet,
              },
            },
          };
        }),

      clearConversationState: (sessionKey) =>
        set((state) => {
          if (!state.conversationStates[sessionKey]) return state;
          const next = { ...state.conversationStates };
          delete next[sessionKey];
          return { conversationStates: next };
        }),
    }),
    {
      name: TEAM_STUDIO_KEY,
      onRehydrateStorage: () => (state, error) => {
        state?.setHasHydrated(!error);
      },
    },
  ),
);
