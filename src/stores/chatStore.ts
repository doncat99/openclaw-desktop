import { create } from 'zustand';

// ═══════════════════════════════════════════════════════════
// Chat Store — Message, Session, Tabs & Usage State
// ═══════════════════════════════════════════════════════════

const MAIN_SESSION = 'agent:main:main';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  mediaUrl?: string;
  mediaType?: string;
  attachments?: Array<{
    mimeType: string;
    content: string;
    fileName: string;
  }>;
  // Tool call metadata (role === 'tool')
  toolName?: string;
  toolInput?: Record<string, any>;
  toolOutput?: string;
  toolStatus?: 'running' | 'done' | 'error';
  toolDurationMs?: number;
  // Thinking/reasoning content (saved after streaming completes)
  thinkingContent?: string;
}

export interface Session {
  key: string;
  label: string;
  lastMessage?: string;
  lastTimestamp?: string;
  unread?: number;
  kind?: string;
}

export interface TokenUsage {
  contextTokens: number;
  maxTokens: number;
  percentage: number;
  compactions: number;
}

interface ChatState {
  // Messages (active session)
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  updateStreamingMessage: (id: string, content: string, extra?: { mediaUrl?: string; mediaType?: string }) => void;
  finalizeStreamingMessage: (id: string, content: string, extra?: { mediaUrl?: string; mediaType?: string }) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  clearMessages: () => void;

  // Per-session message cache
  messagesPerSession: Record<string, ChatMessage[]>;
  cacheMessagesForSession: (key: string, msgs: ChatMessage[]) => void;
  getCachedMessages: (key: string) => ChatMessage[] | undefined;

  // Sessions
  sessions: Session[];
  activeSessionKey: string;
  setSessions: (sessions: Session[]) => void;
  setActiveSession: (key: string) => void;

  // Tabs
  openTabs: string[];
  openTab: (key: string) => void;
  closeTab: (key: string) => void;
  reorderTabs: (keys: string[]) => void;

  // Token Usage
  tokenUsage: TokenUsage | null;
  setTokenUsage: (usage: TokenUsage | null) => void;

  // Current model (live from gateway)
  currentModel: string | null;
  setCurrentModel: (model: string | null) => void;

  // Manual model override — set when user picks manually, prevents polling from overwriting
  manualModelOverride: string | null;
  setManualModelOverride: (model: string | null) => void;

  // Current thinking level (live from gateway session)
  currentThinking: string | null;
  setCurrentThinking: (level: string | null) => void;

  // Available models (fetched from gateway models.list)
  availableModels: Array<{ id: string; label: string; alias?: string }>;
  setAvailableModels: (models: Array<{ id: string; label: string; alias?: string }>) => void;

  // Drafts (per-session)
  drafts: Record<string, string>;
  setDraft: (key: string, text: string) => void;
  getDraft: (key: string) => string;

  // UI State
  isTyping: boolean;
  setIsTyping: (typing: boolean) => void;
  isSending: boolean;
  setIsSending: (sending: boolean) => void;
  isLoadingHistory: boolean;
  setIsLoadingHistory: (loading: boolean) => void;
  // Called by MessageInput before first send — loads history if not yet loaded
  historyLoader: (() => Promise<void>) | null;
  setHistoryLoader: (fn: (() => Promise<void>) | null) => void;

  // Quick Replies (from [[button:...]] markers)
  quickReplies: Array<{ text: string; value: string }>;
  setQuickReplies: (buttons: Array<{ text: string; value: string }>) => void;

  // Thinking stream (live reasoning display)
  thinkingText: string;
  thinkingRunId: string | null;
  setThinkingStream: (runId: string, text: string) => void;
  clearThinking: () => void;

  // Connection
  connected: boolean;
  connecting: boolean;
  connectionError: string | null;
  setConnectionStatus: (status: { connected: boolean; connecting: boolean; error?: string }) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  // ── Messages (active session) ──
  messages: [],

  addMessage: (msg) => {
    set((state) => {
      if (state.messages.some((m) => m.id === msg.id)) return state;
      const updated = [...state.messages, msg];
      return {
        messages: updated,
        messagesPerSession: {
          ...state.messagesPerSession,
          [state.activeSessionKey]: updated,
        },
      };
    });
  },

  updateStreamingMessage: (id, content, extra) => {
    set((state) => {
      const existingIdx = state.messages.findIndex((m) => m.id === id);
      let updated: ChatMessage[];
      if (existingIdx >= 0) {
        updated = [...state.messages];
        updated[existingIdx] = {
          ...updated[existingIdx],
          content,
          isStreaming: true,
          ...(extra?.mediaUrl ? { mediaUrl: extra.mediaUrl, mediaType: extra.mediaType } : {}),
        };
      } else {
        updated = [
          ...state.messages,
          {
            id,
            role: 'assistant' as const,
            content,
            timestamp: new Date().toISOString(),
            isStreaming: true,
            ...(extra?.mediaUrl ? { mediaUrl: extra.mediaUrl, mediaType: extra.mediaType } : {}),
          },
        ];
      }
      return {
        messages: updated,
        messagesPerSession: {
          ...state.messagesPerSession,
          [state.activeSessionKey]: updated,
        },
      };
    });
  },

  finalizeStreamingMessage: (id, content, extra) => {
    set((state) => {
      const existingIdx = state.messages.findIndex((m) => m.id === id);
      if (existingIdx >= 0) {
        const updated = [...state.messages];

        // Attach thinking content if available (from stream:"thinking" events
        // OR from separate Reasoning: messages intercepted in gateway.ts)
        const thinkingContent = state.thinkingText || undefined;

        updated[existingIdx] = {
          ...updated[existingIdx],
          content: content || updated[existingIdx].content,
          isStreaming: false,
          ...(extra?.mediaUrl ? { mediaUrl: extra.mediaUrl, mediaType: extra.mediaType } : {}),
          ...(thinkingContent ? { thinkingContent } : {}),
        };

        // OS notification handled in App.tsx onStreamEnd callback (single source)

        return {
          messages: updated,
          isTyping: false,
          // Clear thinking state after attaching to message
          thinkingText: '',
          thinkingRunId: null,
          messagesPerSession: {
            ...state.messagesPerSession,
            [state.activeSessionKey]: updated,
          },
        };
      }
      return { isTyping: false };
    });
  },

  setMessages: (msgs) => set((state) => ({
    messages: msgs,
    messagesPerSession: {
      ...state.messagesPerSession,
      [state.activeSessionKey]: msgs,
    },
  })),

  clearMessages: () => set((state) => ({
    messages: [],
    messagesPerSession: {
      ...state.messagesPerSession,
      [state.activeSessionKey]: [],
    },
  })),

  // ── Per-session cache ──
  messagesPerSession: {},

  cacheMessagesForSession: (key, msgs) => set((state) => ({
    messagesPerSession: { ...state.messagesPerSession, [key]: msgs },
  })),

  getCachedMessages: (key) => get().messagesPerSession[key],

  // ── Sessions ──
  sessions: [{ key: MAIN_SESSION, label: 'Main Session' }],
  activeSessionKey: MAIN_SESSION,

  setSessions: (sessions) => set({ sessions }),

  setActiveSession: (key) => {
    const state = get();
    // Cache current messages before switching
    const cached = state.messagesPerSession[key];
    set({
      activeSessionKey: key,
      messages: cached || [],
      isTyping: false,
    });
  },

  // ── Tabs ──
  openTabs: [MAIN_SESSION],

  openTab: (key) => set((state) => {
    if (state.openTabs.includes(key)) {
      // Already open — just activate
      const cached = state.messagesPerSession[key];
      return { activeSessionKey: key, messages: cached || [], isTyping: false };
    }
    return {
      openTabs: [...state.openTabs, key],
      activeSessionKey: key,
      messages: state.messagesPerSession[key] || [],
      isTyping: false,
    };
  }),

  closeTab: (key) => set((state) => {
    // Can't close main session
    if (key === MAIN_SESSION) return state;
    const newTabs = state.openTabs.filter((t) => t !== key);
    if (newTabs.length === 0) newTabs.push(MAIN_SESSION);
    // If closing active tab, switch to last tab or main
    const newActive = state.activeSessionKey === key
      ? newTabs[newTabs.length - 1]
      : state.activeSessionKey;
    return {
      openTabs: newTabs,
      activeSessionKey: newActive,
      messages: state.messagesPerSession[newActive] || [],
      isTyping: false,
    };
  }),

  reorderTabs: (keys) => set({ openTabs: keys }),

  // ── Token Usage ──
  tokenUsage: null,
  setTokenUsage: (usage) => set({ tokenUsage: usage }),
  currentModel: null,
  setCurrentModel: (model) => set({ currentModel: model }),
  manualModelOverride: null,
  setManualModelOverride: (model) => set({ manualModelOverride: model, currentModel: model }),
  currentThinking: null,
  setCurrentThinking: (level) => set({ currentThinking: level }),

  // ── Available Models ──
  availableModels: [],
  setAvailableModels: (models) => set({ availableModels: models }),

  // ── UI State ──
  isTyping: false,
  setIsTyping: (typing) => set({ isTyping: typing }),
  isSending: false,
  setIsSending: (sending) => set({ isSending: sending }),
  isLoadingHistory: false,
  setIsLoadingHistory: (loading) => set({ isLoadingHistory: loading }),
  historyLoader: null,
  setHistoryLoader: (fn) => set({ historyLoader: fn }),

  // ── Drafts ──
  drafts: {},
  setDraft: (key, text) => set((state) => ({ drafts: { ...state.drafts, [key]: text } })),
  getDraft: (key) => get().drafts[key] || '',

  // ── Quick Replies ──
  quickReplies: [],
  setQuickReplies: (buttons) => set({ quickReplies: buttons }),

  // ── Thinking Stream ──
  thinkingText: '',
  thinkingRunId: null,
  setThinkingStream: (runId, text) => set({ thinkingRunId: runId, thinkingText: text }),
  clearThinking: () => set({ thinkingText: '', thinkingRunId: null }),

  // ── Connection ──
  connected: false,
  connecting: false,
  connectionError: null,

  setConnectionStatus: (status) =>
    set({
      connected: status.connected,
      connecting: status.connecting,
      connectionError: status.error || null,
    }),
}));
