import { useRef, useEffect, useState, useCallback } from 'react';
import { ArrowDown, Loader2, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore, type ChatMessage } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { gateway } from '@/services/gateway';
import { MessageBubble } from './MessageBubble';
import { ToolCallBubble } from './ToolCallBubble';
import { ThinkingBubble } from './ThinkingBubble';
import { MessageInput } from './MessageInput';
import { TypingIndicator } from './TypingIndicator';
import { InlineButtonBar, extractInlineButtons } from './InlineButtonBar';
import { QuickReplyBar } from './QuickReplyBar';
import clsx from 'clsx';

// ═══════════════════════════════════════════════════════════
// Compact Divider — shimmer animated line
// ═══════════════════════════════════════════════════════════

function CompactDivider({ timestamp }: { timestamp?: string }) {
  const time = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div className="flex items-center gap-0 py-5 px-4 group">
      {/* Left line with shimmer */}
      <div className="flex-1 h-px relative overflow-visible">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
        <div
          className="absolute top-[-1px] h-[3px] w-[60%] bg-gradient-to-r from-transparent via-amber-400/50 to-transparent rounded-full"
          style={{ animation: 'compact-shimmer 4s ease-in-out infinite' }}
        />
      </div>
      {/* Badge */}
      <div className="flex items-center gap-1.5 px-3.5 py-1 bg-amber-500/[0.06] border border-amber-500/[0.12] rounded-full shrink-0 mx-1 transition-colors group-hover:bg-amber-500/[0.1] group-hover:border-amber-500/[0.2]">
        <Zap size={10} className="text-amber-500/50" />
        <span className="text-[9px] font-bold uppercase tracking-[1.5px] text-amber-500/50 group-hover:text-amber-500/70 transition-colors">
          Context Compacted
        </span>
        {time && <span className="text-[9px] text-amber-500/25 font-mono">· {time}</span>}
      </div>
      {/* Right line with shimmer */}
      <div className="flex-1 h-px relative overflow-visible">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
        <div
          className="absolute top-[-1px] h-[3px] w-[60%] bg-gradient-to-r from-transparent via-amber-400/50 to-transparent rounded-full"
          style={{ animation: 'compact-shimmer 4s ease-in-out infinite 2s', right: 0 }}
        />
      </div>
      <style>{`
        @keyframes compact-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(260%); }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Chat View — premium chat area
// ═══════════════════════════════════════════════════════════

export function ChatView() {
  const { t } = useTranslation();
  const { messages, isTyping, connected, connecting, connectionError, isLoadingHistory, setMessages, setIsLoadingHistory, activeSessionKey, cacheMessagesForSession, getCachedMessages, addMessage, setHistoryLoader, quickReplies, setQuickReplies, thinkingText, thinkingRunId } = useChatStore();
  const toolIntentEnabled = useSettingsStore((s) => s.toolIntentEnabled);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  // prevCompactionsRef removed — compaction detection moved to gateway.ts (direct agent event)

  // ── Clarify Card state (auto-detection disabled — triggered too many false positives) ──
  // ClarifyCard is kept for future use with official inline buttons from Gateway
  // const [clarifyQuestion, setClarifyQuestion] = useState<ClarifyQuestion | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  }, []);

  useEffect(() => { if (autoScroll) scrollToBottom(); }, [messages, isTyping, autoScroll, scrollToBottom]);

  // Real-time compaction detection moved to gateway.ts — direct agent event interception
  // (no longer relies on polling tokenUsage.compactions counter)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom = distanceFromBottom < 100;
    setAutoScroll(isNearBottom);
    setShowScrollDown(!isNearBottom && messages.length > 3);
  }, [messages.length]);

  const extractText = (val: any): string => {
    if (typeof val === 'string') return val;
    if (val == null) return '';
    if (Array.isArray(val)) {
      return val.map((b: any) => {
        if (typeof b === 'string') return b;
        if (b?.type === 'text' && typeof b.text === 'string') return b.text;
        if (typeof b?.text === 'string') return b.text;
        return '';
      }).join('');
    }
    if (typeof val === 'object') {
      if (typeof val.text === 'string') return val.text;
      if (typeof val.content === 'string') return val.content;
      if (Array.isArray(val.content)) return extractText(val.content);
      return JSON.stringify(val);
    }
    return String(val);
  };

  const NOISE_PATTERNS = [
    /^Read HEARTBEAT\.md/i, /^HEARTBEAT_OK/, /^NO_REPLY$/,
    /^احفظ جميع المعلومات المهمة/, /^⚠️ Session nearing compaction/,
    /^\[System\]/i, /^System:\s*\[/, /^PS [A-Z]:\\.*>/,
    /^node scripts\/build/, /^npx electron/, /^Ctrl\+[A-Z]/,
    // Desktop-injected metadata blocks
    /^Conversation info \(untrusted metadata\)/i,
    /^\[AEGIS_DESKTOP_CONTEXT\]/i,
    /^\[AEGIS:RASHID\]/i,
  ];

  const isNoise = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return true;
    return NOISE_PATTERNS.some((p) => p.test(trimmed));
  };

  // Strip injected metadata from user messages for clean display
  const stripUserMeta = (text: string): string => {
    let clean = text;
    // Remove [AEGIS_DESKTOP_CONTEXT]...[/AEGIS_DESKTOP_CONTEXT] block
    clean = clean.replace(/\[AEGIS_DESKTOP_CONTEXT\][\s\S]*?\[\/AEGIS_DESKTOP_CONTEXT\]\s*/i, '');
    // Remove Conversation info JSON block
    clean = clean.replace(/Conversation info \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\s*/i, '');
    // Remove System notification blocks (exec completed, compaction audit, etc.)
    // Greedy match until the next recognized user block (timestamp, Conversation info, Desktop context) or end
    clean = clean.replace(/System:\s*\[[\s\S]*?(?=\n\nConversation info|\n\n\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)|\n\n\[AEGIS_DESKTOP|\s*$)/g, '');
    // Remove inline [Sat 2026-...] timestamp prefixes
    clean = clean.replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+UTC\]\s*/i, '');
    return clean.trim();
  };

  const loadHistory = useCallback(async () => {
    // Check cache first
    const cached = getCachedMessages(activeSessionKey);
    if (cached && cached.length > 0) {
      setMessages(cached);
      return;
    }

    setIsLoadingHistory(true);
    try {
      const result = await gateway.getHistory(activeSessionKey, 200);
      const rawMessages = Array.isArray(result?.messages) ? result.messages : [];
      const filtered = rawMessages
        .map((msg: any) => {
          const role = typeof msg.role === 'string' ? msg.role : 'unknown';
          const content = extractText(msg.content);
          if (!content) return null;
          if (role === 'system') {
            if (/compact/i.test(content)) {
              return { id: msg.id || `compaction-${Math.random().toString(36).slice(2)}`, role: 'compaction' as any, content: '', timestamp: msg.timestamp || msg.createdAt || new Date().toISOString() };
            }
            return null;
          }
          // ── Tool call messages → ToolCallBubble (only if enabled in settings) ──
          if (!toolIntentEnabled && (
            role === 'toolResult' || role === 'tool' ||
            (role === 'assistant' && Array.isArray(msg.content) &&
              msg.content.every((b: any) => b.type === 'toolCall' || b.type === 'tool_use'))
          )) return null;

          if (role === 'assistant' && Array.isArray(msg.content)) {
            const toolBlocks = msg.content.filter((b: any) =>
              b.type === 'toolCall' || b.type === 'tool_use'
            );
            if (toolBlocks.length > 0) {
              // Map each tool block as a separate tool message
              return toolBlocks.map((block: any, idx: number) => {
                const toolName = block.name || block.toolName || 'unknown';
                const toolInput = block.input ?? block.params ?? {};
                return {
                  id: `${msg.id || 'tool'}-call-${idx}`,
                  role: 'tool' as const,
                  content: '',
                  toolName,
                  toolInput,
                  toolStatus: 'done' as const,
                  timestamp: msg.timestamp || msg.createdAt || new Date().toISOString(),
                };
              });
            }
          }

          // Tool result messages — find matching call and attach output
          if (role === 'toolResult' || role === 'tool') {
            const toolName = msg.toolName || msg.name || 'unknown';
            const output = typeof msg.content === 'string'
              ? msg.content
              : extractText(msg.content);
            return {
              id: msg.id || `tool-result-${Math.random().toString(36).slice(2)}`,
              role: 'tool' as const,
              content: '',
              toolName,
              toolOutput: output?.slice(0, 2000) || '',
              toolStatus: 'done' as const,
              timestamp: msg.timestamp || msg.createdAt || new Date().toISOString(),
            };
          }

          if (role !== 'user' && role !== 'assistant') return null;
          if (Array.isArray(msg.content)) {
            const hasOnlyTools = msg.content.every((b: any) =>
              b.type === 'toolCall' || b.type === 'toolResult' || b.type === 'tool_use' || b.type === 'tool_result'
            );
            if (hasOnlyTools) return null;
          }
          if (msg.toolCallId || msg.tool_call_id) return null;
          if (role === 'assistant' && isNoise(content)) return null;

          // Clean user messages — strip injected Desktop context & metadata
          const displayContent = role === 'user' ? stripUserMeta(content) : content;
          if (!displayContent) return null;

          return {
            id: msg.id || msg.messageId || `hist-${Math.random().toString(36).slice(2)}`,
            role: role as 'user' | 'assistant',
            content: displayContent,
            timestamp: msg.timestamp || msg.createdAt || new Date().toISOString(),
            mediaUrl: msg.mediaUrl || undefined,
          };
        })
        .flat()
        .filter(Boolean) as any[];
      setMessages(filtered);
      cacheMessagesForSession(activeSessionKey, filtered);
    } catch (err) {
      console.error('[ChatView] History load failed:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [setMessages, setIsLoadingHistory, activeSessionKey, getCachedMessages, cacheMessagesForSession]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    if (isRefreshing || isLoadingHistory) return;
    setIsRefreshing(true);
    try { await loadHistory(); }
    finally { setTimeout(() => setIsRefreshing(false), 500); }
  }, [isRefreshing, isLoadingHistory, loadHistory]);

  // Auto-load history on connect
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (connected && !hasLoadedRef.current && messages.length === 0) {
      hasLoadedRef.current = true;
      loadHistory();
    }
  }, [connected, messages.length, loadHistory]);

  // Register loadHistory in store so MessageInput can trigger it before first send
  useEffect(() => {
    setHistoryLoader(loadHistory);
    return () => setHistoryLoader(null);
  }, [loadHistory, setHistoryLoader]);

  useEffect(() => {
    const handler = () => handleRefresh();
    window.addEventListener('aegis:refresh', handler);
    return () => window.removeEventListener('aegis:refresh', handler);
  }, [handleRefresh]);

  const handleResend = useCallback((content: string) => { gateway.sendMessage(content, undefined, activeSessionKey); }, [activeSessionKey]);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-aegis-bg">
      {/* Connection Banner */}
      {!connected && (
        <div className={clsx(
          'shrink-0 px-4 py-2 text-center text-[12px] border-b',
          connecting ? 'bg-aegis-warning-surface text-aegis-warning border-aegis-warning/10' : 'bg-aegis-danger-surface text-aegis-danger border-aegis-danger/10'
        )}>
          {connecting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-1.5 h-1.5 bg-aegis-warning rounded-full animate-pulse-soft" />
              {t('connection.connectingBanner')}
            </span>
          ) : (
            <span>
              {t('connection.disconnectedBanner')}
              {connectionError && <span className="opacity-60"> — {connectionError}</span>}
              <button onClick={() => {
                window.aegis?.config.get().then((c: any) => {
                  gateway.connect(c.gatewayUrl || 'ws://127.0.0.1:18789', c.gatewayToken || '');
                });
              }} className="mx-2 underline hover:no-underline">
                {t('connection.reconnect')}
              </button>
            </span>
          )}
        </div>
      )}

      {/* Messages Area */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden py-3 scroll-smooth">
        {isLoadingHistory ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <Loader2 size={28} className="text-aegis-primary animate-spin mb-4" />
            <p className="text-aegis-text-muted text-[13px]">{t('chat.loadingHistory')}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex-1" />
        ) : (
          <div className="space-y-0.5">
            {messages.map((msg) => {
              if (msg.role === 'compaction') {
                return <CompactDivider key={msg.id} timestamp={msg.timestamp} />;
              }
              // Tool messages — check for inline buttons first, then normal tool display
              if ((msg.role as string) === 'tool') {
                // Always show inline buttons from `message` tool, regardless of toolIntentEnabled
                const inlineButtons = extractInlineButtons(msg.toolName || '', msg.toolInput);
                if (inlineButtons) {
                  return (
                    <InlineButtonBar
                      key={msg.id}
                      buttons={inlineButtons}
                      onCallback={async (callbackData) => {
                        const text = callbackData;
                        const userMsg: ChatMessage = {
                          id: `user-${Date.now()}`,
                          role: 'user',
                          content: text,
                          timestamp: new Date().toISOString(),
                        };
                        addMessage(userMsg);
                        const { setIsTyping } = useChatStore.getState();
                        setIsTyping(true);
                        try {
                          await gateway.sendMessage(text, undefined, activeSessionKey);
                        } catch (err) {
                          console.error('[InlineButtons] Send error:', err);
                        }
                      }}
                    />
                  );
                }

                // Normal tool calls — only show when Tool Intent View is enabled
                if (!toolIntentEnabled) return null;
                return (
                  <ToolCallBubble
                    key={msg.id}
                    tool={{
                      toolName: msg.toolName || 'unknown',
                      input: msg.toolInput,
                      output: msg.toolOutput,
                      status: msg.toolStatus || 'done',
                      durationMs: msg.toolDurationMs,
                    }}
                  />
                );
              }
              return (
                <div key={msg.id}>
                  {/* Finalized thinking — show collapsed bubble above the assistant message */}
                  {msg.role === 'assistant' && msg.thinkingContent && (
                    <ThinkingBubble content={msg.thinkingContent} />
                  )}
                  <MessageBubble message={msg} onResend={msg.role === 'user' ? handleResend : undefined} />
                </div>
              );
            })}
          </div>
        )}
        {/* Live thinking stream — show above typing indicator when reasoning is active */}
        {thinkingText && thinkingRunId && (
          <ThinkingBubble content={thinkingText} isStreaming />
        )}
        {isTyping && <TypingIndicator />}
        <div ref={bottomRef} className="h-1" />
      </div>

      {/* Scroll to bottom */}
      {showScrollDown && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
          <button onClick={() => { setAutoScroll(true); scrollToBottom(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass shadow-float text-[11px] text-aegis-text-muted hover:text-aegis-text transition-colors">
            <ArrowDown size={13} />
            <span>{t('chat.newMessages')}</span>
          </button>
        </div>
      )}

      {/* Quick Reply buttons — from [[button:...]] markers in AI response */}
      {quickReplies.length > 0 && !isTyping && (
        <QuickReplyBar
          buttons={quickReplies}
          onSend={async (text) => {
            // Clear buttons immediately
            setQuickReplies([]);

            // Add user message to chat
            const userMsg: ChatMessage = {
              id: `user-${Date.now()}`,
              role: 'user',
              content: text,
              timestamp: new Date().toISOString(),
            };
            addMessage(userMsg);

            // Send via gateway
            const { setIsTyping } = useChatStore.getState();
            setIsTyping(true);
            try {
              await gateway.sendMessage(text, undefined, activeSessionKey);
            } catch (err) {
              console.error('[QuickReplyBar] Send error:', err);
            }
          }}
          onDismiss={() => setQuickReplies([])}
        />
      )}

      <MessageInput />
    </div>
  );
}
