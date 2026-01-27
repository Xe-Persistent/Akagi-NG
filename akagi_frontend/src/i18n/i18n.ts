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
  lng: 'zh-CN', // 默认初始语言，将由设置更新
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false, // React 已经防止了 XSS
  },
});

export default i18n;
