import { BrowserWindow, nativeTheme } from 'electron';

import { createLogger } from '../../logging/index.js';
import { GameHandler } from '../../services/capture/game-handler.js';
import type { EngineService } from '../../services/engine/engine-service.js';
import { getMitmConfig } from '../../services/settings-manager.js';
import { GAME_WINDOW_HEIGHT, GAME_WINDOW_WIDTH } from '../../shared/constants.js';
import { isSafeWindow } from '../../shared/utils.js';

const logger = createLogger('GameWindow');

/**
 * Removes the Electron tokens from a Chromium user agent, leaving the shape a
 * plain Chrome would send. The app-name token is not present in Electron 44's
 * default agent but older builds and packaged variants can add it.
 */
export function anonymizeUserAgent(userAgent: string): string {
  return userAgent.replace(/akagi-ng-desktop\/\S+\s/g, '').replace(/Electron\/\S+\s/g, '');
}

export interface GameWindowOptions {
  url?: string;
  /** Route the page through our MITM proxy instead of the debugger API. */
  useMitm?: boolean;
}

/** Hosts the game client and wires whichever capture path is configured. */
export class GameWindow {
  private window: BrowserWindow | null = null;
  private gameHandler: GameHandler | null = null;

  constructor(private readonly engine: EngineService) {}

  public get(): BrowserWindow | null {
    return isSafeWindow(this.window) ? this.window : null;
  }

  public async open({ url, useMitm }: GameWindowOptions): Promise<void> {
    const existing = this.get();
    if (existing) {
      existing.focus();
      return;
    }
    this.window = null; // Drop a zombie reference before creating a new window

    if (!url) {
      logger.warn('No URL provided for Game Window!');
      return;
    }

    const window = new BrowserWindow({
      width: GAME_WINDOW_WIDTH,
      height: GAME_WINDOW_HEIGHT,
      useContentSize: true,
      maximizable: true,
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#ffffff',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    this.window = window;

    this.registerWindowEvents(window);
    this.registerUserAgent(window);

    if (useMitm) {
      await this.useMitmProxy(window);
    } else {
      this.attachGameHandler(window);
    }

    window.on('closed', () => {
      this.gameHandler?.detach();
      this.gameHandler = null;
      this.window = null;
    });

    try {
      await window.loadURL(url);
    } catch (err) {
      const error = err as { code?: string; errno?: number; message?: string };
      // ERR_ABORTED happens during redirects and when the page cancels the
      // navigation, which does not mean the load failed.
      if (error.code === 'ERR_ABORTED' || error.errno === -3) {
        logger.warn(`Navigation aborted for ${url}, attempting to proceed...`);
        return;
      }

      logger.error(`Failed to load game URL: ${error.message ?? 'Unknown Error'}`);
      if (isSafeWindow(this.window)) {
        this.window.close();
      }
      this.window = null;
      throw err;
    }
  }

  private registerWindowEvents(window: BrowserWindow) {
    window.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#ffffff',
      },
    }));

    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') {
        window.setFullScreen(!window.isFullScreen());
        event.preventDefault();
      }
    });
  }

  /** Removes the Electron fingerprint from the user agent the page sees. */
  private registerUserAgent(window: BrowserWindow) {
    window.webContents.setUserAgent(anonymizeUserAgent(window.webContents.session.getUserAgent()));
  }

  private async useMitmProxy(window: BrowserWindow) {
    const mitm = getMitmConfig();
    const proxyRules = `http://${mitm.host}:${mitm.port}`;
    logger.info(`Routing game traffic through MITM proxy: ${proxyRules}`);

    await window.webContents.session.setProxy({
      proxyRules,
      proxyBypassRules: '127.0.0.1,localhost',
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
      void this.gameHandler.attach();
    } catch (err) {
      logger.error('Failed to attach GameHandler:', err);
    }
  }
}
