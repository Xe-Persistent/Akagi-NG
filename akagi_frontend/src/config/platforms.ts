/**
 * 平台常量和配置
 */

export const PLATFORMS = {
  MAJSOUL: 'majsoul',
  TENHOU: 'tenhou',
  RIICHI_CITY: 'riichi_city',
  AMATSUKI: 'amatsuki',
  AUTO: 'auto',
} as const;

export type Platform = (typeof PLATFORMS)[keyof typeof PLATFORMS];

/**
 * 各平台的默认配置
 */
export const PLATFORM_DEFAULTS: Record<
  string,
  {
    url: string;
    name: string;
  }
> = {
  [PLATFORMS.MAJSOUL]: {
    url: 'https://game.maj-soul.com/1/',
    name: 'Majsoul',
  },
  [PLATFORMS.TENHOU]: {
    url: 'https://tenhou.net/3/',
    name: 'Tenhou',
  },
  [PLATFORMS.RIICHI_CITY]: {
    url: 'https://riichi.city/',
    name: 'Riichi City',
  },
  [PLATFORMS.AMATSUKI]: {
    url: 'https://amatsuki-mj.jp/',
    name: 'Amatsuki',
  },
};
