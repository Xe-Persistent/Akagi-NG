import { createLogger } from '../../logging/index.js';

const logger = createLogger('Telemetry');

/**
 * Aliyun SLS web tracking: the game client reports on itself through beacons on
 * `<project>.<region>.log.aliyuncs.com`, and every host under that service
 * domain serves nothing else. A beacon's CORS preflight already carries the
 * whole query-string payload, so the domain is dropped outright rather than
 * matched by path.
 *
 * Blocking inside the browser covers both capture paths: the CDP path talks to
 * the game directly and never involves the proxy.
 */
const TELEMETRY_URLS = ['*://*.log.aliyuncs.com/*'];

/**
 * Drops the game's telemetry for everything this session loads. The page sees
 * `net::ERR_BLOCKED_BY_CLIENT`, the same failure an ad blocker produces.
 */
export function blockTelemetry(target: Electron.Session): void {
  target.webRequest.onBeforeRequest({ urls: TELEMETRY_URLS }, (details, callback) => {
    // The query string is the payload; the host is all a log line needs.
    logger.verbose(`Blocked game telemetry to ${new URL(details.url).host}`);
    callback({ cancel: true });
  });
}
