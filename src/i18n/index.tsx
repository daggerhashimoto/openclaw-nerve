import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { translations, SUPPORTED_LOCALES, localeLabels, type Locale } from './translations';

const LOCALE_STORAGE_KEY = 'nerve:locale';

function resolveInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';

  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY) as Locale | null;
    if (saved && SUPPORTED_LOCALES.includes(saved)) return saved;
  } catch {
    // ignore
  }

  const browserLocale = navigator.language.split('-')[0].toLowerCase() as Locale;
  if (SUPPORTED_LOCALES.includes(browserLocale)) return browserLocale;
  return 'en';
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, fallback?: string) => string;
  supportedLocales: readonly Locale[];
  localeLabels: Record<Locale, string>;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(resolveInitialLocale);

  useEffect(() => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore storage errors
    }
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale: (nextLocale: Locale) => {
      if (!SUPPORTED_LOCALES.includes(nextLocale)) return;
      setLocaleState(nextLocale);
    },
    t: (key: string, fallback?: string) => {
      const localized = translations[locale]?.[key] ?? translations.en[key];
      return localized ?? fallback ?? key;
    },
    supportedLocales: SUPPORTED_LOCALES,
    localeLabels,
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useLocale must be used within LocaleProvider');
  }
  return ctx;
}
