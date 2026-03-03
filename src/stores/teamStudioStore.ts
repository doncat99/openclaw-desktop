import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getTeamDefinitions, TeamMemberDefinition } from '@/config/agentTeamRegistry';
import { migrateStorageKey, storageKey } from '@/utils/storage';

export interface TeamAgentProfile {
  key: string;
  title: string;
  role: string;
  responsibilities: string[];
  skills: string[];
  outputs: string[];
}

interface TeamStudioState {
  leadAgentId: string;
  profiles: Record<string, TeamAgentProfile>;
  setLeadAgentId: (agentId: string) => void;
  syncFromDefinitions: (definitions?: TeamMemberDefinition[]) => void;
  updateProfile: (
    key: string,
    patch: Partial<Pick<TeamAgentProfile, 'role' | 'responsibilities' | 'skills' | 'outputs'>>
  ) => void;
  resetProfile: (key: string) => void;
}

function toProfile(def: TeamMemberDefinition): TeamAgentProfile {
  return {
    key: def.key,
    title: def.title,
    role: def.role,
    responsibilities: [...def.responsibilities],
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
      leadAgentId: defaultLeadAgentId(),
      profiles: defaultProfiles(getTeamDefinitions()),

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
    }),
    {
      name: TEAM_STUDIO_KEY,
    },
  ),
);

