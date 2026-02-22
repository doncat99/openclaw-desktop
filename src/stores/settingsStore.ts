import { create } from 'zustand';

// ═══════════════════════════════════════════════════════════
// Settings Store
// ═══════════════════════════════════════════════════════════

interface SettingsState {
  theme: 'dark' | 'light' | 'system';
  fontSize: number;
  sidebarOpen: boolean;
  sidebarWidth: number;
  settingsOpen: boolean;
  language: 'ar' | 'en';
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  dndMode: boolean;
  budgetLimit: number;
  commandPaletteOpen: boolean;
  memoryExplorerEnabled: boolean;
  memoryMode: 'api' | 'local';
  memoryApiUrl: string;
  memoryLocalPath: string;
  context1mEnabled: boolean;
  toolIntentEnabled: boolean;
  gatewayUrl: string;
  gatewayToken: string;

  setTheme: (theme: 'dark' | 'light' | 'system') => void;
  setFontSize: (size: number) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setSettingsOpen: (open: boolean) => void;
  setLanguage: (lang: 'ar' | 'en') => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setDndMode: (dnd: boolean) => void;
  setBudgetLimit: (n: number) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setMemoryExplorerEnabled: (enabled: boolean) => void;
  setMemoryMode: (mode: 'api' | 'local') => void;
  setMemoryApiUrl: (url: string) => void;
  setMemoryLocalPath: (path: string) => void;
  setContext1mEnabled: (enabled: boolean) => void;
  setToolIntentEnabled: (enabled: boolean) => void;
  setGatewayUrl: (url: string) => void;
  setGatewayToken: (token: string) => void;
}

// Auto-detect language on first run: check saved → system language → fallback to English
const detectLang = (): 'ar' | 'en' => {
  const saved = localStorage.getItem('aegis-language');
  if (saved === 'ar' || saved === 'en') return saved;
  // First run — detect from system/browser language
  const sysLang = navigator.language || navigator.languages?.[0] || '';
  return sysLang.startsWith('ar') ? 'ar' : 'en';
};
const savedLang = detectLang();

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: (localStorage.getItem('aegis-theme') || 'dark') as 'dark' | 'light' | 'system',
  fontSize: 14,
  sidebarOpen: true,
  sidebarWidth: 280,
  settingsOpen: false,
  language: savedLang,
  notificationsEnabled: localStorage.getItem('aegis-notifications') !== 'false',
  soundEnabled: localStorage.getItem('aegis-sound') !== 'false',
  dndMode: false,
  budgetLimit: parseFloat(localStorage.getItem('aegis-budget-limit') || '0') || 0,
  commandPaletteOpen: false,
  memoryExplorerEnabled: localStorage.getItem('aegis-memory-explorer') === 'true',
  memoryMode: (localStorage.getItem('aegis-memory-mode') || 'local') as 'api' | 'local',
  memoryApiUrl: localStorage.getItem('aegis-memory-api-url') || 'http://localhost:3040',
  memoryLocalPath: localStorage.getItem('aegis-memory-local-path') || '',
  context1mEnabled: localStorage.getItem('aegis-context1m') === 'true',
  toolIntentEnabled: localStorage.getItem('aegis-tool-intent') === 'true',
  gatewayUrl: localStorage.getItem('aegis-gateway-url') || '',
  gatewayToken: localStorage.getItem('aegis-gateway-token') || '',

  setTheme: (theme) => { localStorage.setItem('aegis-theme', theme); set({ theme }); },
  setFontSize: (size) => set({ fontSize: size }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setLanguage: (lang) => set({ language: lang }),
  setNotificationsEnabled: (enabled) => { localStorage.setItem('aegis-notifications', String(enabled)); set({ notificationsEnabled: enabled }); },
  setSoundEnabled: (enabled) => { localStorage.setItem('aegis-sound', String(enabled)); set({ soundEnabled: enabled }); },
  setDndMode: (dnd) => set({ dndMode: dnd }),
  setBudgetLimit: (n) => { localStorage.setItem('aegis-budget-limit', String(n)); set({ budgetLimit: n }); },
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setMemoryExplorerEnabled: (enabled) => { localStorage.setItem('aegis-memory-explorer', String(enabled)); set({ memoryExplorerEnabled: enabled }); },
  setMemoryMode: (mode) => { localStorage.setItem('aegis-memory-mode', mode); set({ memoryMode: mode }); },
  setMemoryApiUrl: (url) => { localStorage.setItem('aegis-memory-api-url', url); set({ memoryApiUrl: url }); },
  setMemoryLocalPath: (path) => { localStorage.setItem('aegis-memory-local-path', path); set({ memoryLocalPath: path }); },
  setContext1mEnabled: (enabled) => { localStorage.setItem('aegis-context1m', String(enabled)); set({ context1mEnabled: enabled }); },
  setToolIntentEnabled: (enabled) => { localStorage.setItem('aegis-tool-intent', String(enabled)); set({ toolIntentEnabled: enabled }); },
  setGatewayUrl: (url) => { localStorage.setItem('aegis-gateway-url', url); set({ gatewayUrl: url }); },
  setGatewayToken: (token) => { localStorage.setItem('aegis-gateway-token', token); set({ gatewayToken: token }); },
}));
