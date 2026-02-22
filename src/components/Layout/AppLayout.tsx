// ═══════════════════════════════════════════════════════════
// AppLayout — Main layout with TitleBar + NavSidebar + Content
// + Ambient background glow (from conceptual design)
// ═══════════════════════════════════════════════════════════

import { Outlet, useLocation } from 'react-router-dom';
import { TitleBar } from '@/components/TitleBar';
import { NavSidebar } from '@/components/Layout/NavSidebar';
import { ChatWidget } from '@/components/Chat/ChatWidget';
import { CommandPalette } from '@/components/CommandPalette';
import { NotificationCenter } from '@/components/NotificationCenter';
import { OfflineOverlay } from '@/components/OfflineOverlay';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { getDirection } from '@/i18n';

/** Pages that work without Gateway connection */
const OFFLINE_PAGES = ['/settings', '/terminal'];

export function AppLayout() {
  const { language } = useSettingsStore();
  const dir = getDirection(language);
  const location = useLocation();
  const { connected } = useChatStore();

  // Register global keyboard shortcuts
  useKeyboardShortcuts();

  // Show offline overlay on pages that need Gateway, when not connected
  const isOfflinePage = OFFLINE_PAGES.some(p => location.pathname === p || location.pathname.startsWith(p + '/'));
  const showOffline = !connected && !isOfflinePage;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-aegis-bg relative">
      {/* ── Ambient Background Glow (from conceptual JSX) ── */}
      <div className="ambient-glow-teal" />
      <div className="ambient-glow-purple" />

      <TitleBar />
      <div className="flex flex-1 min-h-0 relative z-[1]" dir={dir}>
        <NavSidebar />
        <main className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <ErrorBoundary>
              {showOffline ? <OfflineOverlay /> : <Outlet />}
            </ErrorBoundary>
          </div>
        </main>
      </div>
      {/* Floating Chat Widget — available on all pages */}
      <ChatWidget />
      {/* Notification Center panel */}
      <NotificationCenter />
      {/* Command Palette overlay */}
      <CommandPalette />
    </div>
  );
}
