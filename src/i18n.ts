import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar.json';
import en from './locales/en.json';
import zh from './locales/zh.json';
import { getStorageItem, setStorageItem, storageKey } from '@/utils/storage';

// ═══════════════════════════════════════════════════════════
// i18n — Internationalization
// ═══════════════════════════════════════════════════════════

type SupportedLang = 'ar' | 'en' | 'zh';
type LanguageSelection = SupportedLang | 'auto';

function detectSystemLanguage(): SupportedLang {
  const candidates = [
    (typeof navigator !== 'undefined' ? navigator.language : '') || '',
    ...((typeof navigator !== 'undefined' ? navigator.languages : []) || []),
  ];
  for (const raw of candidates) {
    const lang = String(raw || '').trim().toLowerCase();
    if (!lang) continue;
    if (lang.startsWith('ar')) return 'ar';
    if (lang.startsWith('zh')) return 'zh';
    if (lang.startsWith('en')) return 'en';
  }
  return 'en';
}

function normalizeSupportedLang(lang: string | null | undefined): SupportedLang | null {
  const clean = String(lang || '').trim().toLowerCase();
  if (!clean) return null;
  if (clean === 'ar' || clean.startsWith('ar-')) return 'ar';
  if (clean === 'zh' || clean.startsWith('zh-')) return 'zh';
  if (clean === 'en' || clean.startsWith('en-')) return 'en';
  return null;
}

function resolveLanguage(selection: string | null | undefined): SupportedLang {
  const clean = String(selection || '').trim().toLowerCase();
  if (clean === 'auto') return detectSystemLanguage();
  return normalizeSupportedLang(clean) || 'en';
}

// Detect language priority:
//   1. New install/upgrade: installer language wins (user chose it in setup wizard)
//   2. Normal run: localStorage wins (user may have changed it in Settings)
//   3. First run (dev/no installer): system language
//   4. Fallback: 'en'
const getInitialLang = (): string => {
  const languageStorageKey = storageKey('language');
  const installedVersionStorageKey = storageKey('installed-version');
  const stored = getStorageItem(languageStorageKey);
  const installerLang = (window as any).aegis?.installerLanguage as string | null;
  const currentVersion = (window as any).__APP_VERSION__ || '';
  const lastVersion = getStorageItem(installedVersionStorageKey);

  // New install or upgrade: installer language takes priority
  // (The NSIS wizard asks the user every time — respect that choice)
  const installerSelection: LanguageSelection =
    installerLang === 'auto' ? 'auto' : (normalizeSupportedLang(installerLang) || 'en');
  if (installerLang && lastVersion !== currentVersion) {
    setStorageItem(languageStorageKey, installerSelection);
    setStorageItem(installedVersionStorageKey, currentVersion);
    return resolveLanguage(installerSelection);
  }

  // Normal run: use saved preference
  if (stored === 'auto' || normalizeSupportedLang(stored)) {
    // Sync version marker if missing
    if (!lastVersion && currentVersion) setStorageItem(installedVersionStorageKey, currentVersion);
    return resolveLanguage(stored);
  }

  // Default: auto-detect from system locale.
  setStorageItem(languageStorageKey, 'auto');
  if (currentVersion) setStorageItem(installedVersionStorageKey, currentVersion);
  return resolveLanguage('auto');
};

const savedLang = getInitialLang();

i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: savedLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Helper: get direction for current language
export const getDirection = (lang?: string): 'rtl' | 'ltr' => {
  const resolved = resolveLanguage(lang || i18n.resolvedLanguage || i18n.language);
  return resolved === 'ar' ? 'rtl' : 'ltr';
};

// Helper: change language and persist
export const changeLanguage = (lang: string) => {
  const selection: LanguageSelection =
    String(lang || '').trim().toLowerCase() === 'auto'
      ? 'auto'
      : (normalizeSupportedLang(lang) || 'en');
  const resolved = resolveLanguage(selection);
  i18n.changeLanguage(resolved);
  setStorageItem(storageKey('language'), selection);
  document.documentElement.dir = getDirection(resolved);
  document.documentElement.lang = resolved;
};

// Set initial direction
document.documentElement.dir = getDirection(savedLang);
document.documentElement.lang = savedLang;

export default i18n;
