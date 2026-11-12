import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Language, translations } from './i18n';

type TranslationParams = Record<string, string | number>;

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  /**
   * Translate a key. Optional `params` are interpolated into `{{name}}` placeholders:
   *   t("members.inviteSent", { email })  →  "邀请已发送至 dad@family.com"
   */
  t: (key: keyof typeof translations.zh, params?: TranslationParams) => string;
  /**
   * Pick between two already-localised values coming from data (e.g. API rows that
   * carry `title` and `titleEn`). Prefer `t()` for static UI copy.
   */
  l: <T,>(zh: T, en: T) => T;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('zh');
  const [isLoading, setIsLoading] = useState(true);

  // Load saved language preference on mount
  useEffect(() => {
    const loadLanguage = async () => {
      try {
        const savedLanguage = await AsyncStorage.getItem('language');
        if (savedLanguage === 'en' || savedLanguage === 'zh') {
          setLanguageState(savedLanguage);
        }
      } catch (error) {
        console.error('Failed to load language preference:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadLanguage();
  }, []);

  const setLanguage = async (lang: Language) => {
    try {
      setLanguageState(lang);
      await AsyncStorage.setItem('language', lang);
    } catch (error) {
      console.error('Failed to save language preference:', error);
    }
  };

  const t = (key: keyof typeof translations.zh, params?: TranslationParams): string => {
    const raw = translations[language][key] || translations.zh[key] || key;
    if (!params) return raw;
    return raw.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      params[name] === undefined ? `{{${name}}}` : String(params[name]),
    );
  };

  const l = <T,>(zh: T, en: T): T => (language === 'zh' ? zh : en);

  if (isLoading) {
    return null;
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, l }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}
