import type { Mockttp } from 'mockttp';
import * as mockttp from 'mockttp';

import { createLogger } from '../../logging/index.js';
import { bridgeManager } from '../../protocol/bridge-manager.js';
import { errorMessage } from '../../shared/errors.js';
import { getCertificatesDir } from '../../shared/paths.js';
import {
  isMajsoulUrl,
  MAJSOUL_CLIENT_HOSTS,
  MAJSOUL_DOMAINS,
} from '../../shared/schema/platforms.js';
import type { EngineService } from '../engine/engine-service.js';
import { getSettingsManager } from '../settings-manager.js';
import { ensureCertificates } from './certificates.js';
import { ConnectionTracker } from './connection-tracker.js';
import { ingestCapturedFrame } from './frame-ingest.js';
import { isTelemetryBeacon, SLS_TLS_HOST } from './telemetry.js';

const logger = createLogger('MITMProxy');

/**
 * Only Majsoul hosts and the Aliyun SLS analytics host are decrypted. Everything
 * else the client sends through this proxy is tunnelled untouched, so a
 * misconfigured system proxy cannot make Akagi-NG a general-purpose TLS
 * interception point.
 *
 * SLS is decrypted only so its beacons can be dropped. The built-in window
 * already cancels them in its own session; this leg covers an external browser
 * or game client routed through the proxy, which has no Electron session.
 *
 * The English client's origin is matched by exact host, never by the whole
 * `yo-star.com` publisher domain: that domain also serves unrelated Yostar
 * games, which must stay tunnelled.
 */
export const INTERCEPTED_TLS_HOSTS: { hostname: string }[] = [
  ...MAJSOUL_DOMAINS.map((domain) => ({ hostname: `*.${domain}` })),
  ...MAJSOUL_CLIENT_HOSTS.map((hostname) => ({ hostname })),
  { hostname: SLS_TLS_HOST },
];

/**
 * Options shared by both passthrough legs (websocket and request).
 *
 * `mirrorTlsFingerprint` is deliberately absent. It asks mockttp to replay the
 * client's ClientHello upstream through the optional native `tls-impersonate`
 * module, and that module aborts the whole Electron process on the first
 * upstream TLS connection — the game client's login — with no JS error and
 * nothing in the log. Node's default fingerprint is the safer trade.
 */
export function buildPassthroughOptions(upstream: string | undefined) {
  const proxyUrl = upstream?.trim();
  return proxyUrl ? { proxyConfig: { proxyUrl, noProxy: ['127.0.0.1', 'localhost'] } } : {};
}

/**
 * Request-leg options: the shared connection setup plus the telemetry drop.
 *
 * A beacon is answered locally with the same empty `200` the real endpoint
 * returns, so it never reaches Aliyun (or the user's upstream proxy). Keeping
 * this in the catch-all rule's `beforeRequest` matters: mockttp treats a rule
 * without a completion check as single-use unless it is the last matching one,
 * so a second rule could not be relied on to fire.
 */
export function buildRequestOptions(upstream: string | undefined) {
  return {
    ...buildPassthroughOptions(upstream),
    beforeRequest: (req: mockttp.CompletedRequest) => {
      if (!isTelemetryBeacon(req.url)) return;
      // The query string is the payload; only the endpoint belongs in a log.
      const { hostname, pathname } = new URL(req.url);
      logger.debug(`Blocked game telemetry beacon to ${hostname}${pathname}`);
      return { response: { statusCode: 200 } };
    },
  };
}

/**
 * The lifecycle calls the proxy reports. Kept structural so a test can pass a
 * recorder instead of a real `ConnectionTracker`.
 */
export interface SocketTracker {
  onConnectionOpened(id: string): void;
  onConnectionClosed(id: string): void;
}

/**
 * Wires the proxy's socket lifecycle to a connection tracker.
 *
 * `websocket-close` fires **only for a clean shutdown**; mockttp reports an
 * unclean one (close code 1006 — the game window killed, the page reloaded, the
 * network dropped) as `abort` instead. A player closing the game window is
 * exactly that case, so listening to `websocket-close` alone left the connection
 * state stuck at `connected` and no `disconnected`/`left_game` notice ever
 * reached the UI.
 *
 * Both events carry the same id as `websocket-request`, and each socket is
 * removed from `streams` on the way out, so the pair cannot report twice.
 */
export async function trackGameSockets(
  server: Mockttp,
  streams: Set<string>,
  tracker: SocketTracker,
): Promise<void> {
  await server.on('websocket-request', (req) => {
    if (!isMajsoulUrl(req.url)) return;

    logger.debug(`[MITM] WebSocket connection requested: ${req.url}`);
    bridgeManager.getBridgeForUrl(req.url);
    streams.add(req.id);
    tracker.onConnectionOpened(req.id);
  });

  const close = (id: string, how: 'closed' | 'aborted') => {
    if (!streams.delete(id)) return;
    logger.debug(`[MITM] WebSocket connection ${how} (${id})`);
    tracker.onConnectionClosed(id);
  };

  await server.on('websocket-close', (event) => close(event.streamId, 'closed'));
  await server.on('abort', (req) => close(req.id, 'aborted'));
}

export class MitmProxyManager {
  private server: Mockttp | null = null;
  private isRunning = false;
  /** Set while a start attempt is in flight, so concurrent callers share it. */
  private startTask: Promise<void> | null = null;
  /** Majsoul websockets only; messages of other proxied sockets must not reach the bridge. */
  private readonly majsoulStreams = new Set<string>();
  private readonly connectionTracker: ConnectionTracker;

  constructor(private engine: EngineService) {
    this.connectionTracker = new ConnectionTracker(engine);
  }

  /**
   * Two overlapping attempts would bind the port twice: the loser fails, clears
   * `this.server`, and leaves the winner running with no handle to stop it.
   */
  public start(): Promise<void> {
    this.startTask ??= this.startOnce().finally(() => {
      this.startTask = null;
    });
    return this.startTask;
  }

  private async startOnce() {
    if (this.isRunning) {
      logger.warn('MITM Proxy is already running.');
      return;
    }

    const settings = getSettingsManager().getSettings();
    if (!settings.mitm.enabled) {
      logger.info('MITM Proxy is disabled in settings. Skipping startup.');
      return;
    }

    try {
      const { keyPath, pemPath } = await ensureCertificates(getCertificatesDir());

      const server = mockttp.getLocal({
        https: {
          keyPath,
          certPath: pemPath,
          tlsInterceptOnly: INTERCEPTED_TLS_HOSTS,
        },
      });
      this.server = server;

      // Game traffic can be chained through a proxy the user already runs.
      const connectionOptions = buildPassthroughOptions(settings.mitm.upstream);
      const requestOptions = buildRequestOptions(settings.mitm.upstream);
      const upstream = settings.mitm.upstream.trim();
      if (upstream) {
        logger.info(`Forwarding traffic through upstream proxy: ${upstream}`);
      }

      // Rules must be installed before the proxy accepts traffic.
      await server.forAnyWebSocket().thenPassThrough(connectionOptions);

      await trackGameSockets(server, this.majsoulStreams, this.connectionTracker);

      // Both directions of a Majsoul socket are parsed; nothing else is touched.
      await server.on('websocket-message-received', (msg) => void this.handleMessage(msg));
      await server.on('websocket-message-sent', (msg) => void this.handleMessage(msg));

      await server.forAnyRequest().thenPassThrough(requestOptions);

      await server.start(settings.mitm.port);
      this.isRunning = true;
      logger.info(`MITM Proxy started on port ${settings.mitm.port}`);
    } catch (error) {
      logger.error('Failed to start MITM Proxy:', errorMessage(error));
      await this.discardServer();
    }
  }

  private async handleMessage(msg: mockttp.WebSocketMessage) {
    if (!this.majsoulStreams.has(msg.streamId)) return;

    const bridge = bridgeManager.getCurrentBridge();
    if (!bridge) return;

    const dataBuffer =
      typeof msg.content === 'string' ? Buffer.from(msg.content, 'utf8') : Buffer.from(msg.content);
    await ingestCapturedFrame(this.engine, bridge, dataBuffer, 'MITM');
  }

  /** Drops a server that failed to start, so a later attempt starts from scratch. */
  private async discardServer() {
    const server = this.server;
    this.server = null;
    this.isRunning = false;
    this.majsoulStreams.clear();
    if (!server) return;

    try {
      await server.stop();
    } catch {
      // A server that never started has nothing to stop.
    }
  }

  public async stop() {
    // A start still in flight must settle before there is a server to stop.
    await this.startTask?.catch(() => undefined);
    if (!this.isRunning || !this.server) return;
    logger.info('Stopping MITM Proxy...');
    this.connectionTracker.forceDisconnect();
    try {
      await this.server.stop();
      this.server = null;
      this.isRunning = false;
      logger.info('MITM Proxy stopped.');
    } catch (error) {
      logger.error('Failed to stop MITM Proxy:', errorMessage(error));
    } finally {
      this.majsoulStreams.clear();
    }
  }
}
