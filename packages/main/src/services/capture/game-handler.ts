import type { WebContents } from 'electron';

import { createLogger } from '../../logging/index.js';
import { bridgeManager } from '../../protocol/bridge-manager.js';
import type { AkagiEvent } from '../../shared/schema/mjai.js';
import type { EngineService } from '../engine/engine-service.js';
import { ConnectionTracker } from './connection-tracker.js';

const logger = createLogger('GameHandler');

export interface WebSocketCreatedEvent {
  requestId: string;
  url: string;
}
export interface WebSocketClosedEvent {
  requestId: string;
}
export interface WebSocketFrameReceivedEvent {
  requestId: string;
  response?: {
    payloadData?: string;
    opcode?: number;
  };
}
export interface WebSocketFrameSentEvent {
  requestId: string;
  response?: {
    payloadData?: string;
    opcode?: number;
  };
}

export class GameHandler {
  private attached = false;
  private readonly connectionTracker: ConnectionTracker;

  constructor(
    private webContents: WebContents,
    private engine: EngineService,
  ) {
    this.connectionTracker = new ConnectionTracker(engine);
  }

  public async attach() {
    if (this.attached || this.webContents.isDestroyed()) return;

    try {
      // 1. Listen for process issues
      this.webContents.on('render-process-gone', (_event, details) => {
        logger.error(`Renderer process gone: ${details.reason} (${details.exitCode})`);
        this.attached = false;
        this.connectionTracker.forceDisconnect();
      });

      this.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) {
          logger.info(`Main frame navigating to: ${url}`);
        }
      });

      // 2. Auto re-attach when page reloads or navigates
      this.webContents.on('did-finish-load', async () => {
        if (!this.attached && !this.webContents.isDestroyed()) {
          setTimeout(() => this.tryAttach(), 500);
        }
      });

      // 3. Initial attachment
      await this.tryAttach();
    } catch (err) {
      logger.error('Failed to initialize GameHandler:', err);
    }
  }

  private async tryAttach() {
    if (this.attached || this.webContents.isDestroyed()) return;

    try {
      if (this.webContents.debugger.isAttached()) {
        this.attached = true;
        return;
      }

      this.webContents.debugger.attach('1.3');
      this.attached = true;

      this.webContents.debugger.removeAllListeners('detach');
      this.webContents.debugger.removeAllListeners('message');

      this.webContents.debugger.on('detach', (_event, reason) => {
        logger.warn('Web debugger detached:', reason);
        this.attached = false;
      });

      this.webContents.debugger.on('message', this.handleDebuggerMessage.bind(this));

      // Wrap command in try-catch to avoid crashing if target closes mid-flight
      try {
        await this.webContents.debugger.sendCommand('Network.enable');
      } catch (cmdErr) {
        logger.warn('Failed to enable network inspection for game window:', cmdErr);
      }
    } catch (e) {
      const error = e as Error;
      logger.error('Failed to attach web debugger to game window:', error.message);
      this.attached = false;
    }
  }

  public detach() {
    this.connectionTracker.forceDisconnect();
    if (this.attached) {
      this.attached = false;
      if (!this.webContents.isDestroyed()) {
        try {
          this.webContents.debugger.detach();
        } catch {
          // Ignore detach errors if target is already closed
        }
      }
    }
  }

  private readonly cdpHandlers: ReadonlyMap<string, (params: never) => void> = new Map([
    [
      'Network.webSocketCreated',
      (params: WebSocketCreatedEvent) => {
        // Only Majsoul sockets are tracked; other page sockets are ignored.
        if (!bridgeManager.getBridgeForUrl(params.url)) return;
        this.connectionTracker.onConnectionOpened(params.requestId);
      },
    ],
    [
      'Network.webSocketClosed',
      (params: WebSocketClosedEvent) => {
        this.connectionTracker.onConnectionClosed(params.requestId);
      },
    ],
    [
      'Network.webSocketFrameReceived',
      (params: WebSocketFrameReceivedEvent) => {
        this.handleWebSocketFrame(params);
      },
    ],
    [
      'Network.webSocketFrameSent',
      (params: WebSocketFrameSentEvent) => {
        this.handleWebSocketFrame(params);
      },
    ],
  ] as Array<[string, (params: never) => void]>);

  private async handleDebuggerMessage(_event: unknown, method: string, params: unknown) {
    this.cdpHandlers.get(method)?.(params as never);
  }

  private handleWebSocketFrame(params: WebSocketFrameReceivedEvent | WebSocketFrameSentEvent) {
    const { response } = params;

    if (!response || !response.payloadData) {
      return;
    }

    const bridge = bridgeManager.getCurrentBridge();
    if (!bridge) return;

    try {
      const buffer = Buffer.from(response.payloadData, response.opcode === 1 ? 'utf8' : 'base64');
      const parsedEvents: AkagiEvent[] = bridge.parse(buffer);
      if (parsedEvents.length === 0) return;

      this.engine.ingest(parsedEvents).catch((err: unknown) => {
        logger.error('Failed to ingest parsed events:', err);
      });
    } catch (err) {
      logger.error('Error parsing via TS bridge', err);
    }
  }
}
