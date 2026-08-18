/**
 * 支持的语言/地区配置
 */
export const SUPPORTED_LOCALES = [
  { value: 'zh-CN', label: '中文(简体)' },
  { value: 'zh-TW', label: '中文(繁體)' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'en-US', label: 'English' },
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]['value'];
