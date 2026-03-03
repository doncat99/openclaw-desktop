// ═══════════════════════════════════════════════════════════
// OfflineOverlay — Shown on pages that require Gateway connection
// Transparent overlay with centered status — no blocking, no errors
// ═══════════════════════════════════════════════════════════

import { useTranslation } from 'react-i18next';
import { WifiOff } from 'lucide-react';

export function OfflineOverlay() {
  const { t } = useTranslation();

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-[320px]">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-5
          bg-[rgb(var(--aegis-overlay)/0.04)] border border-[rgb(var(--aegis-overlay)/0.08)]
          flex items-center justify-center">
          <WifiOff size={28} className="text-aegis-text-dim" />
        </div>
        <h2 className="text-[16px] font-bold text-aegis-text mb-2">
          {t('offline.title')}
        </h2>
        <p className="text-[12.5px] text-aegis-text-muted leading-relaxed mb-4">
          {t('offline.description')}
        </p>
        <div className="flex items-center justify-center gap-2 text-[11px] text-aegis-text-dim">
          <span className="w-1.5 h-1.5 rounded-full bg-aegis-warning/60 animate-pulse" />
          {t('offline.retrying')}
        </div>
      </div>
    </div>
  );
}
