import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Mockttp } from 'mockttp';
import * as mockttp from 'mockttp';

import { createLogger } from '../../logging/index.js';
import { bridgeManager } from '../../protocol/bridge-manager.js';
import { getAssetPath } from '../../shared/paths.js';
import type { AkagiEvent } from '../../shared/schema/mjai.js';
import type { BackendManager } from '../backend-manager.js';
import { settingsManager } from '../settings-manager.js';
import { ConnectionTracker } from './connection-tracker.js';

const logger = createLogger('MITMProxy');

export class MitmProxyManager {
  private server: Mockttp | null = null;
  private isRunning: boolean = false;
  private readonly connectionTracker: ConnectionTracker;

  constructor(private backendManager: BackendManager) {
    this.connectionTracker = new ConnectionTracker(backendManager);
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

    const settings = settingsManager.getSettings();
    if (!settings.mitm.enabled) {
      logger.info('MITM Proxy is disabled in settings. Skipping startup.');
      return;
    }

    try {
      const { keyPath, certPath } = await this.getCerts();

      this.server = mockttp.getLocal({
        https: {
          keyPath,
          certPath,
        },
        cors: true,
      });

      // Optionally chain game traffic through a user-configured upstream proxy
      const upstream = settings.mitm.upstream?.trim();
      const passThroughOptions = upstream
        ? { proxyConfig: { proxyUrl: upstream, noProxy: ['127.0.0.1', 'localhost'] } }
        : undefined;
      if (upstream) {
        logger.info(`Forwarding traffic through upstream proxy: ${upstream}`);
      }

      // Pass through and hook all websockets
      this.server.forAnyWebSocket().thenPassThrough(passThroughOptions);

      this.server.on('websocket-request', async (req) => {
        if (!bridgeManager.isMajsoulUrl(req.url)) return;

        logger.info(`[MITM] WebSocket connection requested: ${req.url}`);
        bridgeManager.getBridgeForUrl(req.url);
        this.connectionTracker.onConnectionOpened(req.id);
      });

      this.server.on('websocket-close', async (close) => {
        logger.info(`[MITM] WebSocket connection closed (${close.streamId})`);
        this.connectionTracker.onConnectionClosed(close.streamId);
      });

      this.server.on('websocket-message-received', async (msg) => {
        // This is client -> server (outbound)
        await this.handleMessage(msg);
      });

      this.server.on('websocket-message-sent', async (msg) => {
        // This is server -> client (inbound)
        await this.handleMessage(msg);
      });

      // Pass through other HTTP requests without interception
      this.server.forAnyRequest().thenPassThrough(passThroughOptions);

      await this.server.start(settings.mitm.port);
      this.isRunning = true;
      logger.info(`MITM Proxy started on port ${settings.mitm.port}`);
    } catch (error) {
      logger.error(
        'Failed to start MITM Proxy:',
        error instanceof Error ? error.message : String(error),
      );
      this.isRunning = false;
    }
  }

  private async handleMessage(msg: mockttp.WebSocketMessage) {
    try {
      const bridge = bridgeManager.getCurrentBridge();
      if (!bridge) return;

      const dataBuffer =
        typeof msg.content === 'string'
          ? Buffer.from(msg.content, 'utf8')
          : Buffer.from(msg.content);

      const parsedEvents: AkagiEvent[] = bridge.parse(dataBuffer);
      if (parsedEvents.length > 0) {
        await this.backendManager.ingest(parsedEvents);
      }
    } catch (err) {
      logger.error('Failed to process WebSocket message:', err);
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
      logger.error(
        'Failed to stop MITM Proxy:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
