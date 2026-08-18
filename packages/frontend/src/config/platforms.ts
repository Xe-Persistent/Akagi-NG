/**
 * 平台常量和配置
 */

export const MAJSOUL_SERVERS = {
  CN: 'cn',
  JP: 'jp',
  EN: 'en',
} as const;

export type MajsoulServer = (typeof MAJSOUL_SERVERS)[keyof typeof MAJSOUL_SERVERS];
