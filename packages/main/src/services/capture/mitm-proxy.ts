import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Mockttp } from 'mockttp';
import * as mockttp from 'mockttp';

import { createLogger } from '../../logging/index.js';
import { bridgeManager } from '../../protocol/bridge-manager.js';
import { errorMessage } from '../../shared/errors.js';
import { getAssetPath } from '../../shared/paths.js';
import type { EngineService } from '../engine/engine-service.js';
import { getSettingsManager } from '../settings-manager.js';
import { ConnectionTracker } from './connection-tracker.js';
import { ingestCapturedFrame } from './frame-ingest.js';

const logger = createLogger('MITMProxy');

export class MitmProxyManager {
  private server: Mockttp | null = null;
  private isRunning = false;
  /** Majsoul websockets only; messages of other proxied sockets must not reach the bridge. */
  private readonly majsoulStreams = new Set<string>();
  private readonly connectionTracker: ConnectionTracker;

  constructor(private engine: EngineService) {
    this.connectionTracker = new ConnectionTracker(engine);
  }

  /**
   * Initializes the CA certificates.
   */
  private async getCerts(): Promise<{ keyPath: string; certPath: string }> {
    const certsDir = getAssetPath('config', 'certs');
    if (!existsSync(certsDir)) {
      mkdirSync(certsDir, { recursive: true });
    }

    const keyPath = join(certsDir, 'ca.key');
    const certPath = join(certsDir, 'ca.pem');

    if (!existsSync(keyPath) || !existsSync(certPath)) {
      logger.info('Generating new CA certificates for MITM proxy...');
      const { key, cert } = await mockttp.generateCACertificate({
        subject: { commonName: 'Akagi-NG Proxy CA' },
      });
      await writeFile(keyPath, key);
      await writeFile(certPath, cert);
      logger.info(`CA certificates generated at ${certsDir}`);
    } else {
      logger.info(`Using existing CA certificates at ${certsDir}`);
    }

    return { keyPath, certPath };
  }

  public async start() {
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
      const { keyPath, certPath } = await this.getCerts();

      const server = mockttp.getLocal({
        https: {
          keyPath,
          certPath,
        },
        cors: true,
      });
      this.server = server;

      // Optionally chain game traffic through a user-configured upstream proxy
      const upstream = settings.mitm.upstream?.trim();
      const passThroughOptions = upstream
        ? { proxyConfig: { proxyUrl: upstream, noProxy: ['127.0.0.1', 'localhost'] } }
        : undefined;
      if (upstream) {
        logger.info(`Forwarding traffic through upstream proxy: ${upstream}`);
      }

      // Rules must be installed before the proxy accepts traffic.
      await server.forAnyWebSocket().thenPassThrough(passThroughOptions);

      await server.on('websocket-request', (req) => {
        if (!bridgeManager.isMajsoulUrl(req.url)) return;

        logger.verbose(`[MITM] WebSocket connection requested: ${req.url}`);
        bridgeManager.getBridgeForUrl(req.url);
        this.majsoulStreams.add(req.id);
        this.connectionTracker.onConnectionOpened(req.id);
      });

      await server.on('websocket-close', (close) => {
        if (!this.majsoulStreams.delete(close.streamId)) return;

        logger.verbose(`[MITM] WebSocket connection closed (${close.streamId})`);
        this.connectionTracker.onConnectionClosed(close.streamId);
      });

      // client -> server (outbound) and server -> client (inbound)
      await server.on('websocket-message-received', (msg) => this.handleMessage(msg));
      await server.on('websocket-message-sent', (msg) => this.handleMessage(msg));

      // Pass through other HTTP requests without interception
      await server.forAnyRequest().thenPassThrough(passThroughOptions);

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
