import { createLogger } from '../../logging/index.js';

const logger = createLogger('Telemetry');

/**
 * Aliyun SLS web tracking: the game client reports on itself through beacons on
 * `<project>.<region>.log.aliyuncs.com`, and every host under that service
 * domain serves nothing else. A beacon's CORS preflight already carries the
 * whole query-string payload, so the domain is dropped outright rather than
 * matched by path.
 */
export const SLS_HOST = 'log.aliyuncs.com';

/** The SLS service domain as a Chromium match pattern. */
export const SLS_URL_PATTERN = `*://*.${SLS_HOST}/*`;

/** The host pattern mockttp needs to decrypt SLS requests in proxy mode. */
export const SLS_TLS_HOST = `*.${SLS_HOST}`;

/**
 * The web-tracking endpoint: `GET|POST /logstores/<store>/track...`. Matching
 * the path as well as the host keeps the rule from dropping an unrelated
 * `/logstores/.../track` on a host we do not own.
 */
const TELEMETRY_BEACON = /\/logstores\/[^/?]+\/track(?:_ua\.gif)?(?:[?#]|$)/;

function isSlsHost(hostname: string): boolean {
  return hostname === SLS_HOST || hostname.endsWith(`.${SLS_HOST}`);
}

/** Whether a proxied URL is an Aliyun SLS web-tracking beacon. */
export function isTelemetryBeacon(url: string): boolean {
  try {
    const parsed = new URL(url);
    return isSlsHost(parsed.hostname) && TELEMETRY_BEACON.test(parsed.pathname + parsed.search);
  } catch {
    return false;
  }
}

/** Sessions already wired, so reopening the game window cannot add a listener. */
const blockedSessions = new WeakSet<Electron.Session>();

/**
 * Drops the game's telemetry for everything this session loads. Covers both
 * capture backends of the built-in window (CDP talks to the game directly;
 * MITM points the window at our proxy), but not an external client, which has
 * no Electron session — the proxy's `isTelemetryBeacon` rule covers that one.
 *
 * The page sees `net::ERR_BLOCKED_BY_CLIENT`, the same failure an ad blocker
 * produces.
 */
export function blockTelemetry(target: Electron.Session): void {
  if (blockedSessions.has(target)) return;
  blockedSessions.add(target);

  target.webRequest.onBeforeRequest({ urls: [SLS_URL_PATTERN] }, (details, callback) => {
    // The query string is the payload; the host is all a log line needs.
    logger.debug(`Blocked game telemetry to ${new URL(details.url).host}`);
    callback({ cancel: true });
  });
}
