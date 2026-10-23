import { describe, expect, it } from 'vitest';

import { INTERCEPTED_TLS_HOSTS } from '../../src/services/capture/mitm-proxy.js';
import {
  getGameUrl,
  isMajsoulUrl,
  MAJSOUL_CLIENT_HOSTS,
  MAJSOUL_DOMAINS,
  MAJSOUL_SERVERS,
} from '../../src/shared/schema/platforms.js';

describe('majsoul hosts', () => {
  it('serves every server from a recognised host', () => {
    for (const server of Object.values(MAJSOUL_SERVERS)) {
      expect(isMajsoulUrl(getGameUrl(server))).toBe(true);
    }
  });

  it.each(MAJSOUL_DOMAINS)('accepts the apex %s and its subdomains', (domain) => {
    expect(isMajsoulUrl(`https://${domain}/`)).toBe(true);
    expect(isMajsoulUrl(`wss://gateway.${domain}/1/`)).toBe(true);
  });

  it.each([
    'wss://mjusgs.mahjongsoul.com:4501',
    'wss://mjjpgs.mahjongsoul.com:4501',
    'wss://engs.mahjongsoul.com:443/gateway',
    'wss://gateway-cdn.maj-soul.com/gateway',
    'wss://route-6.maj-soul.com/gateway',
    'wss://gateway-v2.majsoul.com:4501',
  ])('recognises the gateway %s', (url) => {
    expect(isMajsoulUrl(url)).toBe(true);
  });

  it.each(MAJSOUL_CLIENT_HOSTS)('accepts the English client origin %s', (host) => {
    expect(isMajsoulUrl(`https://${host}/`)).toBe(true);
  });

  it.each([
    'https://notmajsoul.com/',
    'https://majsoul.com.example.net/',
    'https://example.com/?host=game.maj-soul.com',
    'wss://gateway.majsoul.example/game',
    'ftp://game.maj-soul.com/1/',
    'file:///game.maj-soul.com/1/',
    'game.maj-soul.com/1/',
    '',
  ])('rejects %s', (url) => {
    expect(isMajsoulUrl(url)).toBe(false);
  });

  // The publisher domain also serves unrelated Yostar games. Only the game's
  // own client hosts may match, so the rest keeps being tunnelled.
  it.each([
    'https://www.yo-star.com/',
    'https://azurlane.yo-star.com/',
    'https://arknights.yo-star.com/',
    'https://en.azurlane.yo-star.com/',
  ])('leaves the unrelated publisher host %s alone', (url) => {
    expect(isMajsoulUrl(url)).toBe(false);
  });
});

describe('intercepted TLS hosts', () => {
  const hostnames = INTERCEPTED_TLS_HOSTS.map(({ hostname }) => hostname);

  it('decrypts the game domains and the client origin', () => {
    for (const domain of MAJSOUL_DOMAINS) expect(hostnames).toContain(`*.${domain}`);
    for (const host of MAJSOUL_CLIENT_HOSTS) expect(hostnames).toContain(host);
  });

  it('decrypts the analytics endpoint so external clients get their beacons dropped', () => {
    expect(hostnames).toContain('*.log.aliyuncs.com');
  });

  it('never decrypts the whole publisher domain', () => {
    expect(hostnames).not.toContain('*.yo-star.com');
  });
});
