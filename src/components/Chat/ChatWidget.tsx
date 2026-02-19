// ═══════════════════════════════════════════════════════════
// ChatWidget — Floating chat bubble (Intercom-style)
// Hidden on /chat page (full chat there)
// ═══════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, X, Send, Maximize2, Loader2 } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { gateway } from '@/services/gateway';
import { getDirection } from '@/i18n';
import clsx from 'clsx';

export function ChatWidget() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { connected } = useChatStore();
  const { language } = useSettingsStore();
  const dir = getDirection(language);
  const isRTL = dir === 'rtl';

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: string; content: string; id: string }>>([]);
  const [unread, setUnread] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hide on /chat page — but AFTER all hooks (React rules)
  const isHidden = location.pathname === '/chat';

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);
  useEffect(() => { if (open) { setUnread(0); inputRef.current?.focus(); } }, [open]);

  // Listen for quick action events from Dashboard
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.message) {
        setOpen(true);
        if (detail.autoSend) {
          const msg = { role: 'user', content: detail.message, id: Date.now().toString() };
          setMessages(prev => [...prev, msg]);
          sendToGateway(detail.message);
        } else {
          setInput(detail.message);
        }
      }
    };
    window.addEventListener('aegis:quick-action', handler);
    return () => window.removeEventListener('aegis:quick-action', handler);
  }, []);

  const sendToGateway = async (text: string) => {
    setSending(true);
    try {
      await gateway.sendMessage(text);
      const assistantMsg = { role: 'assistant', content: '...', id: `a-${Date.now()}` };
      setMessages(prev => [...prev, assistantMsg]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: t('chat.sendError'),
        id: `err-${Date.now()}`
      }]);
    } finally {
      setSending(false);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || sending || !connected) return;
    const msg = { role: 'user', content: text, id: Date.now().toString() };
    setMessages(prev => [...prev, msg]);
    setInput('');
    sendToGateway(text);
  };

  // Don't render if on chat page
  if (isHidden) return null;

  return (
    <>
      {/* Floating bubble */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setOpen(true)}
            className={clsx(
              'fixed bottom-5 z-50 w-[48px] h-[48px] rounded-2xl',
              'bg-gradient-to-br from-aegis-primary to-aegis-accent',
              'flex items-center justify-center',
              'fab-glow',
              'hover:shadow-[0_12px_40px_rgb(var(--aegis-primary)/0.4)]',
              'transition-all duration-300',
              isRTL ? 'left-5' : 'right-5'
            )}
          >
            <MessageCircle size={20} className="text-white" />
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-aegis-danger text-white text-[10px] font-bold flex items-center justify-center">
                {unread}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={clsx(
              'fixed bottom-5 z-50 w-[380px] h-[500px] rounded-2xl overflow-hidden',
              'flex flex-col',
              isRTL ? 'left-5' : 'right-5'
            )}
            style={{
              background: 'var(--aegis-bg-frosted)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgb(var(--aegis-overlay) / 0.08)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            }}
          >
            {/* Header — dark with visible controls */}
            <div
              className="shrink-0 px-4 py-3 flex items-center justify-between"
              style={{ borderBottom: '1px solid rgb(var(--aegis-overlay) / 0.06)', background: 'rgb(var(--aegis-overlay) / 0.03)' }}
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-aegis-primary/15">
                  <MessageCircle size={14} className="text-aegis-primary" />
                </div>
                <span className="text-[13px] font-semibold text-aegis-text">{t('chat.quickChat')}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setOpen(false); navigate('/chat'); }}
                  className="p-1.5 rounded-lg hover:bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-muted hover:text-aegis-text-secondary transition-colors"
                  title={t('chat.openFullChat')}
                >
                  <Maximize2 size={14} />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-muted hover:text-aegis-text-secondary transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-hidden">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                  <MessageCircle size={32} className="text-aegis-text-dim" />
                  <span className="text-[12px] text-aegis-text-dim">{t('chat.widgetPlaceholder')}</span>
                </div>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={clsx(
                    'max-w-[85%] px-3 py-2 rounded-xl text-[13px]',
                    msg.role === 'user'
                      ? 'ms-auto bg-aegis-primary/[0.12] text-aegis-text'
                      : 'bg-[rgb(var(--aegis-overlay)/0.04)] text-aegis-text-muted'
                  )}
                >
                  {msg.content}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input — dark themed */}
            <div
              className="shrink-0 px-3 py-3"
              style={{ borderTop: '1px solid rgb(var(--aegis-overlay) / 0.06)' }}
            >
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  placeholder={t('chat.typeMessage')}
                  className="flex-1 rounded-xl px-3 py-2 text-[13px] text-aegis-text placeholder:text-aegis-text-dim focus:outline-none"
                  style={{
                    background: 'rgb(var(--aegis-overlay) / 0.04)',
                    border: '1px solid rgb(var(--aegis-overlay) / 0.08)',
                  }}
                  dir="auto"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sending || !connected}
                  className="p-2 rounded-xl transition-all disabled:opacity-30"
                  style={input.trim() && connected
                    ? { background: 'rgb(var(--aegis-primary))', color: 'var(--aegis-bg-solid)' }
                    : { background: 'rgb(var(--aegis-overlay) / 0.04)', color: 'rgb(var(--aegis-overlay) / 0.2)' }
                  }
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
