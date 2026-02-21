// ═══════════════════════════════════════════════════════════
// ClarifyCard — Floating quick-reply card for clarifying questions
//
// Appears above MessageInput when AEGIS asks a question with
// numbered/bulleted options. User can click an option to auto-fill
// the input, or type a custom answer.
//
// Inspired by Claude Code's AskUserQuestion tool.
// ═══════════════════════════════════════════════════════════

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, X, Send, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getDirection } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ClarifyQuestion } from '@/utils/clarifyDetector';
import clsx from 'clsx';

interface ClarifyCardProps {
  question: ClarifyQuestion;
  onSelect: (text: string) => void;  // Fill input with selected option
  onSend: (text: string) => void;    // Send immediately
  onDismiss: () => void;             // Close the card
}

export function ClarifyCard({ question, onSelect, onSend, onDismiss }: ClarifyCardProps) {
  const { t } = useTranslation();
  const { language } = useSettingsStore();
  const dir = getDirection(language);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [customText, setCustomText] = useState('');
  const [mode, setMode] = useState<'options' | 'custom'>('options');

  const handleOptionClick = useCallback((option: { index: number; label: string }) => {
    setSelectedIndex(option.index);
    setCustomText('');
    setMode('options');
  }, []);

  const handleSubmit = useCallback(() => {
    if (mode === 'custom' && customText.trim()) {
      onSend(customText.trim());
    } else if (selectedIndex !== null) {
      const selected = question.options.find((o) => o.index === selectedIndex);
      if (selected) {
        onSend(selected.label);
      }
    }
  }, [mode, customText, selectedIndex, question, onSend]);

  const hasSelection = selectedIndex !== null || (mode === 'custom' && customText.trim());

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
        dir={dir}
        className="mx-4 mb-3"
      >
        <div
          className={clsx(
            'rounded-2xl border overflow-hidden',
            'bg-[rgb(var(--aegis-surface)/0.95)] backdrop-blur-xl',
            'border-aegis-accent/20',
            'shadow-[0_8px_32px_rgb(var(--aegis-accent)/0.08)]'
          )}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[rgb(var(--aegis-overlay)/0.06)]">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-aegis-accent/10 flex items-center justify-center">
                <HelpCircle size={13} className="text-aegis-accent" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-widest text-aegis-accent/70">
                {t('chat.clarify.title', 'Needs Your Input')}
              </span>
            </div>
            <button
              onClick={onDismiss}
              className="p-1 rounded-lg hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
            >
              <X size={13} className="text-aegis-text-dim hover:text-aegis-text-muted" />
            </button>
          </div>

          {/* ── Question ── */}
          <div className="px-4 pt-3 pb-2">
            <p className="text-[13px] text-aegis-text-secondary leading-relaxed">
              {question.question}
            </p>
          </div>

          {/* ── Options ── */}
          <div className="px-4 pb-2 space-y-1.5">
            {question.options.map((opt) => (
              <button
                key={opt.index}
                onClick={() => handleOptionClick(opt)}
                className={clsx(
                  'w-full text-start px-3.5 py-2.5 rounded-xl border transition-all duration-200',
                  'flex items-center gap-3 group',
                  selectedIndex === opt.index
                    ? 'bg-aegis-accent/10 border-aegis-accent/30 shadow-[0_0_12px_rgb(var(--aegis-accent)/0.06)]'
                    : 'bg-[rgb(var(--aegis-overlay)/0.02)] border-[rgb(var(--aegis-overlay)/0.06)] hover:bg-[rgb(var(--aegis-overlay)/0.05)] hover:border-[rgb(var(--aegis-overlay)/0.12)]'
                )}
              >
                {/* Radio indicator */}
                <div
                  className={clsx(
                    'w-4 h-4 rounded-full border-2 shrink-0 transition-all duration-200 flex items-center justify-center',
                    selectedIndex === opt.index
                      ? 'border-aegis-accent bg-aegis-accent'
                      : 'border-[rgb(var(--aegis-overlay)/0.15)] group-hover:border-[rgb(var(--aegis-overlay)/0.25)]'
                  )}
                >
                  {selectedIndex === opt.index && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="w-1.5 h-1.5 rounded-full bg-white"
                    />
                  )}
                </div>

                {/* Option text */}
                <span
                  className={clsx(
                    'text-[12px] leading-relaxed transition-colors flex-1',
                    selectedIndex === opt.index
                      ? 'text-aegis-accent font-medium'
                      : 'text-aegis-text-muted group-hover:text-aegis-text-secondary'
                  )}
                >
                  {opt.label}
                </span>

                {/* Arrow on hover */}
                <ChevronRight
                  size={12}
                  className={clsx(
                    'shrink-0 transition-all duration-200',
                    selectedIndex === opt.index
                      ? 'text-aegis-accent opacity-100'
                      : 'text-aegis-text-dim opacity-0 group-hover:opacity-50'
                  )}
                />
              </button>
            ))}
          </div>

          {/* ── Custom answer + Submit ── */}
          <div className="px-4 pb-3 pt-1 flex items-center gap-2">
            <input
              type="text"
              value={customText}
              onChange={(e) => {
                setCustomText(e.target.value);
                setSelectedIndex(null);
                setMode('custom');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hasSelection) handleSubmit();
              }}
              placeholder={t('chat.clarify.customPlaceholder', 'Or type your own answer...')}
              className={clsx(
                'flex-1 px-3 py-2 rounded-xl text-[12px] transition-all',
                'bg-[rgb(var(--aegis-overlay)/0.04)] border',
                'text-aegis-text-secondary placeholder:text-aegis-text-dim/50',
                'focus:outline-none focus:bg-[rgb(var(--aegis-overlay)/0.06)]',
                mode === 'custom' && customText
                  ? 'border-aegis-accent/30 focus:border-aegis-accent/50'
                  : 'border-[rgb(var(--aegis-overlay)/0.08)] focus:border-[rgb(var(--aegis-overlay)/0.15)]'
              )}
            />
            <button
              onClick={handleSubmit}
              disabled={!hasSelection}
              className={clsx(
                'px-4 py-2 rounded-xl text-[11px] font-semibold transition-all duration-200',
                'flex items-center gap-1.5 shrink-0',
                hasSelection
                  ? 'bg-aegis-accent text-white shadow-[0_2px_8px_rgb(var(--aegis-accent)/0.25)] hover:shadow-[0_4px_16px_rgb(var(--aegis-accent)/0.35)] active:scale-[0.97]'
                  : 'bg-[rgb(var(--aegis-overlay)/0.04)] text-aegis-text-dim cursor-not-allowed'
              )}
            >
              <Send size={11} />
              {t('chat.clarify.submit', 'Send')}
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
