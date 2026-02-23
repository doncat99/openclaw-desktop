// ═══════════════════════════════════════════════════════════
// NotificationCenter — Slide-down notification history panel
// ═══════════════════════════════════════════════════════════

import { motion, AnimatePresence } from 'framer-motion';
import { Bell, MessageCircle, CheckCircle, AlertTriangle, Wifi, Trash2, X } from 'lucide-react';
import { useNotificationStore, NotificationType } from '@/stores/notificationStore';
import { useTranslation } from 'react-i18next';
import { timeAgo } from '@/utils/format';
import clsx from 'clsx';

const typeConfig: Record<NotificationType, { icon: any; color: string }> = {
  message: { icon: MessageCircle, color: 'text-aegis-accent' },
  task_complete: { icon: CheckCircle, color: 'text-aegis-success' },
  budget_warning: { icon: AlertTriangle, color: 'text-aegis-warning' },
  connection: { icon: Wifi, color: 'text-aegis-primary' },
};

export function NotificationCenter() {
  const { t } = useTranslation();
  const { notifications, panelOpen, setPanelOpen, markAllRead, clearAll } = useNotificationStore();

  if (!panelOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[90]"
        onClick={() => { markAllRead(); setPanelOpen(false); }}
      >
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-11 left-16 w-[300px] max-h-[420px] rounded-2xl bg-aegis-bg/95 backdrop-blur-xl border border-aegis-border/30 shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-aegis-border/20">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-aegis-primary" />
              <span className="text-[13px] font-semibold text-aegis-text">{t('notificationCenter.title')}</span>
            </div>
            <div className="flex items-center gap-1">
              {notifications.length > 0 && (
                <button onClick={clearAll} className="p-1 rounded-lg hover:bg-[rgb(var(--aegis-overlay)/0.05)] text-aegis-text-dim" title={t('notificationCenter.clearAll')}>
                  <Trash2 size={13} />
                </button>
              )}
              <button onClick={() => { markAllRead(); setPanelOpen(false); }} className="p-1 rounded-lg hover:bg-[rgb(var(--aegis-overlay)/0.05)] text-aegis-text-dim">
                <X size={13} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {notifications.length === 0 ? (
              <div className="text-center py-12 text-[12px] text-aegis-text-dim/50">
                <Bell size={28} className="mx-auto mb-2 opacity-20" />
                {t('notificationCenter.empty')}
              </div>
            ) : (
              notifications.map((n) => {
                const cfg = typeConfig[n.type] || typeConfig.message;
                const Icon = cfg.icon;
                return (
                  <div key={n.id} className={clsx(
                    'flex items-start gap-3 px-4 py-3 border-b border-aegis-border/10 transition-colors',
                    !n.read && 'bg-aegis-primary/[0.03]'
                  )}>
                    <Icon size={14} className={clsx(cfg.color, 'mt-0.5 shrink-0')} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-aegis-text truncate">{n.title}</div>
                      {n.body && <div className="text-[11px] text-aegis-text-dim truncate mt-0.5">{n.body}</div>}
                    </div>
                    <span className="text-[9px] text-aegis-text-dim/40 shrink-0 mt-0.5">{timeAgo(n.timestamp)}</span>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
