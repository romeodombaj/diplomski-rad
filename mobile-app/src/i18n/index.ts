import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en/translation.json';
import hr from './hr/translation.json';

const getStoredLanguage = (): string => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return localStorage.getItem('language') ?? 'en';
  }
  return 'en';
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      hr: { translation: hr },
    },
    lng: getStoredLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18n;
