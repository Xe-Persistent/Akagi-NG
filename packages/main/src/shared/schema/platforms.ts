export const MAJSOUL_SERVERS = {
  CN: 'cn',
  JP: 'jp',
  EN: 'en',
} as const;

export type MajsoulServer = (typeof MAJSOUL_SERVERS)[keyof typeof MAJSOUL_SERVERS];

const MAJSOUL_GAME_URLS: Record<MajsoulServer, string> = {
  cn: 'https://game.maj-soul.com/1/',
  jp: 'https://game.mahjongsoul.com/',
  en: 'https://mahjongsoul.game.yo-star.com/',
};

/**
 * Host suffixes that carry game traffic: the web client, the asset API and
 * every gateway (`route-N.maj-soul.com`, `gateway-cdn.maj-soul.com`,
 * `mjjpgs`/`mjusgs`/`engs.mahjongsoul.com`, `gateway-v2.majsoul.com`, ...).
 *
 * `yo-star.com` is deliberately absent. It belongs to the publisher, not the
 * game: the English client is *served* from `mahjongsoul.game.yo-star.com`,
 * but its websocket goes to `mahjongsoul.com`. Treating the whole publisher
 * domain as game traffic would also decrypt unrelated Yostar properties
 * (`www.yo-star.com`, `azurlane.yo-star.com`, `arknights.yo-star.com`).
 */
export const MAJSOUL_DOMAINS = ['maj-soul.com', 'majsoul.com', 'mahjongsoul.com'] as const;

/**
 * Exact hosts serving the English web client. Kept separate from the suffix
 * list so only these two Yostar hosts match, and so a client that opens its
 * websocket on its own origin is still recognised.
 */
export const MAJSOUL_CLIENT_HOSTS = [
  'mahjongsoul.game.yo-star.com',
  'mahjongsoul.yo-star.com',
] as const;

/** Schemes a game URL can be reached with. */
const MAJSOUL_URL_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

export function getGameUrl(server: MajsoulServer): string {
  return MAJSOUL_GAME_URLS[server];
}

/**
 * Whether a URL points at a Majsoul host. The parsed hostname is compared
 * exactly, so a marker in the path, query or a lookalike domain
 * (`notmajsoul.example`) does not count. Scheme is http(s) or ws(s).
 */
export function isMajsoulUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (!MAJSOUL_URL_PROTOCOLS.has(parsed.protocol)) return false;

  const host = parsed.hostname.toLowerCase();
  const matches = (suffix: string) => host === suffix || host.endsWith(`.${suffix}`);

  return MAJSOUL_CLIENT_HOSTS.some(matches) || MAJSOUL_DOMAINS.some(matches);
}
