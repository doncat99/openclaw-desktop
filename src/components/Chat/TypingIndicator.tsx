import clsx from 'clsx';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { getDirection } from '@/i18n';
import { getAgentTagForSession } from './agentIdentity';

// ═══════════════════════════════════════════════════════════
// Typing Indicator — smooth animated dots
// ═══════════════════════════════════════════════════════════

export function TypingIndicator() {
  const { language } = useSettingsStore();
  const activeSessionKey = useChatStore((s) => s.activeSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const dir = getDirection(language);
  const assistantTag = getAgentTagForSession(activeSessionKey, sessions);

  return (
    <div className="flex items-start gap-3 px-5 py-2 animate-fade-in" dir={dir}>
      {/* Avatar */}
      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-primary to-aegis-accent flex items-center justify-center shrink-0 mt-0.5 shadow-glow-sm">
        <span className="text-[9px] font-bold tracking-[0.2px] text-aegis-text">{assistantTag}</span>
      </div>

      {/* Dots container */}
      <div className="bg-aegis-bot-bubble rounded-2xl rounded-tr-md px-5 py-3 border border-aegis-bot-border shadow-inner-glow">
        <div className="flex items-center gap-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-[6px] h-[6px] bg-aegis-primary rounded-full animate-typing-dot"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
