import { createLogger } from '../../logging/index.js';
import { bridgeManager } from '../../protocol/bridge-manager.js';
import type { BackendManager } from '../backend-manager.js';

const logger = createLogger('ConnectionTracker');

/**
 * Tracks the lifecycle of game websockets for a single capture path (CDP or MITM)
 * and emits `client_connected` / `game_disconnected` / `return_lobby` on the
 * first open and the last close, mirroring the legacy electron_client behaviour.
 */
export class ConnectionTracker {
  private readonly activeConnections = new Set<string>();

  constructor(private readonly backendManager: BackendManager) {}

  public onConnectionOpened(id: string) {
    if (this.activeConnections.has(id)) return;

    const isFirstConnection = this.activeConnections.size === 0;
    this.activeConnections.add(id);

    if (isFirstConnection) {
      logger.info(`Game client connected (${id})`);
      this.backendManager.notifyClientConnected();
    }
  }

  public onConnectionClosed(id: string) {
    if (!this.activeConnections.delete(id)) return;
    if (this.activeConnections.size > 0) return;

    const gameEnded = bridgeManager.getCurrentBridge()?.gameEnded ?? false;
    logger.info(`All game connections closed (game ended: ${gameEnded})`);
    this.backendManager.notifyGameDisconnected(gameEnded);
  }

  /**
   * Called when the capture is torn down without close events (window closed,
   * debugger detached, ...), so the UI does not stay in the connected state.
   */
  public forceDisconnect() {
    if (this.activeConnections.size === 0) return;

    this.activeConnections.clear();
    const gameEnded = bridgeManager.getCurrentBridge()?.gameEnded ?? false;
    this.backendManager.notifyGameDisconnected(gameEnded);
  }
}
