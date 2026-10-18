import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enUS from './locales/en-US.json';
import jaJP from './locales/ja-JP.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';

i18n.use(initReactI18next).init({
  resources: {
    'en-US': { translation: enUS },
    'zh-CN': { translation: zhCN },
    'zh-TW': { translation: zhTW },
    'ja-JP': { translation: jaJP },
  },
  // Replaced by the stored locale as soon as the settings arrive.
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: {
    // React already escapes what it renders.
    escapeValue: false,
  },
});

document.documentElement.lang = i18n.language;
i18n.on('languageChanged', (lng) => (document.documentElement.lang = lng));

export default i18n;
