import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enUS from './locales/en-US.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import jaJP from './locales/ja-JP.json';

i18n.use(initReactI18next).init({
  resources: {
    'en-US': { translation: enUS },
    'zh-CN': { translation: zhCN },
    'zh-TW': { translation: zhTW },
    'ja-JP': { translation: jaJP },
  },
  lng: 'zh-CN', // Default initial language, will be updated by settings
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false, // React already safes from xss
  },
});

export default i18n;
