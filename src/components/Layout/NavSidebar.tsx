// ═══════════════════════════════════════════════════════════
// NavSidebar — Compact icon-only sidebar (64px)
// Matches conceptual design: icons + active bar + user avatar
// ═══════════════════════════════════════════════════════════

import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, MessageCircle, Kanban, DollarSign,
  Clock, Bot, Settings, Brain, Activity, User, Puzzle,
  Terminal,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { getDirection } from '@/i18n';
import clsx from 'clsx';

interface NavItem {
  to: string;
  icon: any;
  labelKey: string;
  badge?: string;
}

const navItems: NavItem[] = [
  { to: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { to: '/chat', icon: MessageCircle, labelKey: 'nav.chat' },
  { to: '/workshop', icon: Kanban, labelKey: 'nav.workshop' },
  { to: '/cron', icon: Clock, labelKey: 'nav.cron' },
  { to: '/agents', icon: Bot, labelKey: 'nav.agents' },
  { to: '/costs', icon: DollarSign, labelKey: 'nav.costs' },
  { to: '/skills', icon: Puzzle, labelKey: 'nav.skills' },
  { to: '/terminal', icon: Terminal, labelKey: 'nav.terminal' },
  { to: '/memory', icon: Brain, labelKey: 'nav.memory', badge: '🧪' },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings' },
];

export function NavSidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const { language } = useSettingsStore();
  const dir = getDirection(language);
  const isRTL = dir === 'rtl';

  const borderClass = isRTL ? 'border-l' : 'border-r';

  return (
    <div
      className={clsx(
        'w-[64px] shrink-0 flex flex-col items-center',
        'chrome-bg', borderClass, 'border-aegis-border',
        'py-3 relative'
      )}
    >
      {/* Navigation Icons */}
      <nav className="flex-1 flex flex-col items-center gap-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.to ||
            (item.to !== '/' && location.pathname.startsWith(item.to));

          return (
            <NavLink
              key={item.to}
              to={item.to}
              aria-current={isActive ? 'page' : undefined}
              className={clsx(
                'relative w-[44px] h-[44px] rounded-xl',
                'flex items-center justify-center',
                'transition-all duration-300 group',
                isActive
                  ? 'nav-icon-active-glow text-aegis-primary'
                  : 'text-aegis-text-muted hover:text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.04)]'
              )}
            >
              {/* Active indicator bar — animated slide */}
              {isActive && (
                <motion.div
                  layoutId="nav-active-bar"
                  className={clsx(
                    'absolute top-1/2 -translate-y-1/2',
                    'w-[3px] h-[20px] rounded-full',
                    'bg-aegis-primary',
                    'shadow-[0_0_12px_rgba(78,201,176,0.4)]',
                    isRTL ? '-right-[12px]' : '-left-[12px]'
                  )}
                  transition={{
                    type: 'spring',
                    stiffness: 400,
                    damping: 30,
                  }}
                />
              )}

              <div className="relative">
                <item.icon size={18} className={clsx(isActive && 'icon-halo-teal')} />
                {item.badge && (
                  <span className="absolute -top-1.5 -right-2 text-[8px]">{item.badge}</span>
                )}
              </div>

              {/* Tooltip on hover */}
              <div className={clsx(
                'absolute top-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-lg',
                'bg-aegis-elevated-solid border border-aegis-border shadow-lg',
                'text-aegis-text text-[11px] font-medium whitespace-nowrap',
                'opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50',
                isRTL ? 'right-full mr-3' : 'left-full ml-3'
              )}>
                {t(item.labelKey)}
              </div>
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom: User Avatar */}
      <div className="mt-auto pt-3">
        <div className={clsx(
          'w-[36px] h-[36px] rounded-xl',
          'bg-gradient-to-br from-aegis-primary/20 to-[rgba(213,0,249,0.15)]',
          'border border-[rgb(var(--aegis-overlay)/0.08)]',
          'flex items-center justify-center',
          'text-aegis-primary'
        )}>
          <User size={16} />
        </div>
      </div>
    </div>
  );
}
