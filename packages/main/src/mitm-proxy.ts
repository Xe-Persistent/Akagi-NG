import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Mockttp } from 'mockttp';
import * as mockttp from 'mockttp';

import type { BackendManager } from './backend-manager.js';
import { bridgeManager } from './bridge/manager.js';
import { createLogger } from './logger.js';
import type { AkagiEvent } from './schema/mjai.js';
import { settingsManager } from './settings-manager.js';
import { getAssetPath } from './utils.js';

const logger = createLogger('MITMProxy');

export class MitmProxyManager {
  private server: Mockttp | null = null;
  private isRunning: boolean = false;
  private backendManager: BackendManager;

  constructor(backendManager: BackendManager) {
    this.backendManager = backendManager;
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

      // Pass through and hook all websockets
      this.server.forAnyWebSocket().thenPassThrough();

      this.server.on('websocket-request', async (req) => {
        const isGame = this.isGameUrl(req.url);
        if (isGame) {
          logger.info(`[MITM] WebSocket connection requested: ${req.url}`);
          bridgeManager.getBridgeForUrl(req.url);
        }
      });

      this.server.on('websocket-close', async () => {
        logger.info(`[MITM] WebSocket connection closed`);
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
      this.server.forAnyRequest().thenPassThrough();

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

  private isGameUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return lower.includes('majsoul') || lower.includes('maj-soul') || lower.includes('mahjongsoul');
  }

  private async handleMessage(msg: mockttp.WebSocketMessage) {
    try {
      let dataBuffer: Buffer;
      if (typeof msg.content === 'string') {
        dataBuffer = Buffer.from(msg.content, 'utf8');
      } else {
        dataBuffer = Buffer.from(msg.content);
      }

      const bridge = bridgeManager.getCurrentBridge();
      let parsedEvents: AkagiEvent[] = [];

      if (bridge) {
        try {
          parsedEvents = bridge.parse(dataBuffer);
        } catch (err) {
          logger.error('Error parsing via TS bridge', err);
        }
      }

      if (parsedEvents.length > 0) {
        this.backendManager.ingest(parsedEvents);
      }
    } catch (err) {
      logger.error('Failed to process WebSocket message:', err);
    }
  }

  public async stop() {
    if (!this.isRunning || !this.server) return;
    logger.info('Stopping MITM Proxy...');
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
