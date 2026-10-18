export const MAJSOUL_SERVERS = {
  CN: 'cn',
  JP: 'jp',
  EN: 'en',
} as const;

export type MajsoulServer = (typeof MAJSOUL_SERVERS)[keyof typeof MAJSOUL_SERVERS];
