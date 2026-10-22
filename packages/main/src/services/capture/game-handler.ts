import type { WebContents } from 'electron';

import { createLogger } from '../../logging/index.js';
import { bridgeManager } from '../../protocol/bridge-manager.js';
import type { EngineService } from '../engine/engine-service.js';
import { ConnectionTracker } from './connection-tracker.js';
import { ingestCapturedFrame } from './frame-ingest.js';

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
  /** A detached handler never re-attaches: the window may have switched to MITM. */
  private disposed = false;
  /** Majsoul websockets only; frames of other page sockets must not reach the bridge. */
  private readonly majsoulRequests = new Set<string>();
  private readonly connectionTracker: ConnectionTracker;

  /**
   * A reload drops the debugger session, so the new page needs re-attaching.
   * Kept in a field so `detach()` can unregister it.
   */
  private readonly onDidFinishLoad = () => {
    if (this.disposed || this.attached || this.webContents.isDestroyed()) return;
    setTimeout(() => void this.tryAttach(), 500);
  };

  constructor(
    private webContents: WebContents,
    private engine: EngineService,
  ) {
    this.connectionTracker = new ConnectionTracker(engine);
  }

  public attach(): void {
    if (this.disposed || this.attached || this.webContents.isDestroyed()) return;

    try {
      this.webContents.on('render-process-gone', (_event, details) => {
        logger.error(`Renderer process gone: ${details.reason} (${details.exitCode})`);
        this.attached = false;
        this.majsoulRequests.clear();
        this.connectionTracker.forceDisconnect();
      });

      this.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) {
          logger.info(`Main frame navigating to: ${url}`);
        }
      });

      this.webContents.on('did-finish-load', this.onDidFinishLoad);

      this.tryAttach();
    } catch (err) {
      logger.error('Failed to initialize GameHandler:', err);
    }
  }

  private tryAttach(): void {
    if (this.disposed || this.attached || this.webContents.isDestroyed()) return;

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
        this.majsoulRequests.clear();
        this.connectionTracker.forceDisconnect();
      });

      this.webContents.debugger.on('message', this.handleDebuggerMessage.bind(this));

      // `Network.enable` only answers once the target has a page, and the caller
      // attaches before navigating: awaiting it here would block the navigation
      // that makes it resolve, leaving the window blank forever.
      void this.webContents.debugger.sendCommand('Network.enable').catch((cmdErr) => {
        logger.warn('Failed to enable network inspection for game window:', cmdErr);
      });
    } catch (e) {
      const error = e as Error;
      logger.error('Failed to attach web debugger to game window:', error.message);
      this.attached = false;
    }
  }

  public detach() {
    this.disposed = true;
    this.majsoulRequests.clear();
    this.connectionTracker.forceDisconnect();
    if (!this.webContents.isDestroyed()) {
      this.webContents.removeListener('did-finish-load', this.onDidFinishLoad);
    }
    if (this.attached) {
      this.attached = false;
      if (!this.webContents.isDestroyed()) {
        try {
          this.webContents.debugger.detach();
        } catch {
          // Already gone: nothing to detach.
        }
      }
    }
  }

  private readonly cdpHandlers: ReadonlyMap<string, (params: unknown) => void> = new Map([
    [
      'Network.webSocketCreated',
      (params) => {
        const { requestId, url } = params as WebSocketCreatedEvent;
        // Only Majsoul sockets are tracked; other page sockets are ignored.
        if (!bridgeManager.getBridgeForUrl(url)) return;

        this.majsoulRequests.add(requestId);
        this.connectionTracker.onConnectionOpened(requestId);
      },
    ],
    [
      'Network.webSocketClosed',
      (params) => {
        const { requestId } = params as WebSocketClosedEvent;
        if (!this.majsoulRequests.delete(requestId)) return;
        this.connectionTracker.onConnectionClosed(requestId);
      },
    ],
    [
      'Network.webSocketFrameReceived',
      (params) => this.handleWebSocketFrame(params as WebSocketFrameReceivedEvent),
    ],
    [
      'Network.webSocketFrameSent',
      (params) => this.handleWebSocketFrame(params as WebSocketFrameSentEvent),
    ],
  ]);

  private handleDebuggerMessage(_event: unknown, method: string, params: unknown) {
    this.cdpHandlers.get(method)?.(params);
  }

  private handleWebSocketFrame(params: WebSocketFrameReceivedEvent | WebSocketFrameSentEvent) {
    if (!this.majsoulRequests.has(params.requestId)) return;

    const { response } = params;
    if (!response?.payloadData) return;

    const bridge = bridgeManager.getCurrentBridge();
    if (!bridge) return;

    const buffer = Buffer.from(response.payloadData, response.opcode === 1 ? 'utf8' : 'base64');
    void ingestCapturedFrame(this.engine, bridge, buffer, 'CDP');
  }
}
