export const MAJSOUL_SERVERS = {
  CN: 'cn',
  JP: 'jp',
  EN: 'en',
} as const;

export type MajsoulServer = (typeof MAJSOUL_SERVERS)[keyof typeof MAJSOUL_SERVERS];

const MAJSOUL_GAME_URLS: Record<MajsoulServer, string> = {
  cn: 'https://game.maj-soul.com/1/',
  jp: 'https://game.mahjongsoul.com/',
  en: 'https://mahjongsoul.yo-star.com/',
};

export function getGameUrl(server: MajsoulServer): string {
  return MAJSOUL_GAME_URLS[server];
}
