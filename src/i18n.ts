import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar.json';
import en from './locales/en.json';

// ═══════════════════════════════════════════════════════════
// i18n — Internationalization (Arabic + English)
// ═══════════════════════════════════════════════════════════

// Detect language: localStorage > system language > default 'en'
const getInitialLang = (): string => {
  const stored = localStorage.getItem('aegis-language');
  if (stored === 'ar' || stored === 'en') return stored;

  // Auto-detect from system/browser language
  const sysLang = navigator.language || navigator.languages?.[0] || '';
  if (sysLang.startsWith('ar')) return 'ar';
  return 'en';
};

const savedLang = getInitialLang();

i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: savedLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Helper: get direction for current language
export const getDirection = (lang?: string): 'rtl' | 'ltr' => {
  return (lang || i18n.language) === 'ar' ? 'rtl' : 'ltr';
};

// Helper: change language and persist
export const changeLanguage = (lang: string) => {
  i18n.changeLanguage(lang);
  localStorage.setItem('aegis-language', lang);
  document.documentElement.dir = getDirection(lang);
  document.documentElement.lang = lang;
};

// Set initial direction
document.documentElement.dir = getDirection(savedLang);
document.documentElement.lang = savedLang;

export default i18n;
