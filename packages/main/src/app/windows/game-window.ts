import { BrowserWindow, nativeTheme } from 'electron';

import { createLogger } from '../../logging/index.js';
import { GameHandler } from '../../services/capture/game-handler.js';
import {
  GAME_PARTITION,
  hardenGameSession,
  routeDirect,
  routeThroughMitmProxy,
} from '../../services/capture/game-session.js';
import type { EngineService } from '../../services/engine/engine-service.js';
import { GAME_WINDOW_HEIGHT, GAME_WINDOW_WIDTH } from '../../shared/constants.js';
import { isSafeWindow } from '../../shared/utils.js';
import {
  classifyLoadFailure,
  type GameLaunchResult,
  type GameWindowOptions,
} from './game-launch.js';

const logger = createLogger('GameWindow');

/** Hosts the game client and wires whichever capture path is configured. */
export class GameWindow {
  private window: BrowserWindow | null = null;
  private gameHandler: GameHandler | null = null;

  constructor(private readonly engine: EngineService) {}

  public get(): BrowserWindow | null {
    return isSafeWindow(this.window) ? this.window : null;
  }

  public async open({ url, useMitm }: GameWindowOptions): Promise<GameLaunchResult> {
    const existing = this.get();
    if (existing) {
      existing.focus();
      return { ok: true };
    }
    this.window = null; // Drop a zombie reference before creating a new window

    if (!url) {
      logger.warn('No URL provided for the game window.');
      return { ok: false, reason: 'url' };
    }

    const window = new BrowserWindow({
      width: GAME_WINDOW_WIDTH,
      height: GAME_WINDOW_HEIGHT,
      useContentSize: true,
      maximizable: true,
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#ffffff',
      webPreferences: {
        partition: GAME_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    this.window = window;

    /**
     * Closing the window cancels the navigation in flight, which Electron
     * reports as a load failure. The user closing a window they just opened is
     * not an error, so the load below needs to know it is being torn down.
     */
    let closing = false;

    window.on('close', () => {
      closing = true;
      this.gameHandler?.detach();
      this.gameHandler = null;
    });

    window.on('closed', () => {
      this.window = null;
    });

    this.registerWindowEvents(window);
    hardenGameSession(window);
    await this.syncProxy(useMitm ?? false);

    try {
      await window.loadURL(url);
      return { ok: true };
    } catch (err) {
      const error = err as { code?: string; errno?: number; message?: string };
      const failure = classifyLoadFailure(error, { closing, destroyed: window.isDestroyed() });

      if (!failure) {
        logger.info(
          `Navigation to ${url} ended early: the window was closed or the page moved on.`,
        );
        return { ok: true };
      }

      if (failure === 'proxy') {
        logger.error(`The game window could not reach the MITM proxy: ${error.message}`);
      } else {
        logger.error(`Failed to load game URL: ${error.message ?? 'Unknown Error'}`);
      }

      if (isSafeWindow(this.window)) {
        this.window.close();
      }
      this.window = null;
      return { ok: false, reason: failure };
    }
  }

  /**
   * Applies the proxy the current mode needs: MITM points the window at our
   * loopback proxy, CDP clears one left behind by an earlier MITM run. The
   * capture path follows, so CDP and MITM never observe the same socket.
   * Called on open and again whenever the proxy settings change.
   */
  public async syncProxy(useMitm: boolean): Promise<void> {
    const window = this.get();
    if (!window) return;

    logger.info(`Applying game proxy settings (mitm: ${useMitm})`);
    if (useMitm) {
      this.gameHandler?.detach();
      this.gameHandler = null;
      await routeThroughMitmProxy(window);
      return;
    }

    await routeDirect(window);
    if (!this.gameHandler) {
      this.attachGameHandler(window);
    }
  }

  private registerWindowEvents(window: BrowserWindow) {
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (!/^https?:/i.test(url)) return { action: 'deny' };

      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#ffffff',
        },
      };
    });

    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') {
        window.setFullScreen(!window.isFullScreen());
        event.preventDefault();
      }
    });
  }

  /**
   * The debugger API must be attached before the page loads, otherwise the first
   * websocket frames are missed.
   */
  private attachGameHandler(window: BrowserWindow) {
    try {
      if (window.webContents.isDestroyed()) return;

      this.gameHandler = new GameHandler(window.webContents, this.engine);
      this.gameHandler.attach();
    } catch (err) {
      logger.error('Failed to attach GameHandler:', err);
    }
  }
}
