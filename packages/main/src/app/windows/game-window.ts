import { BrowserWindow, nativeTheme } from 'electron';

import { createLogger } from '../../logging/index.js';
import { GameHandler } from '../../services/capture/game-handler.js';
import type { EngineService } from '../../services/engine/engine-service.js';
import { getMitmPort } from '../../services/settings-manager.js';
import { GAME_WINDOW_HEIGHT, GAME_WINDOW_WIDTH } from '../../shared/constants.js';
import { isSafeWindow } from '../../shared/utils.js';

const logger = createLogger('GameWindow');

/**
 * The game runs in its own persistent session, so its proxy and permission
 * rules cannot leak into the dashboard or the HUD, and its login survives a
 * restart.
 */
const GAME_PARTITION = 'persist:game';

/**
 * Capabilities the game page may request. Everything else — camera,
 * microphone, geolocation, notifications, clipboard reads, external protocol
 * launches, HID/USB/serial — is refused: this window shows remote content and
 * has no business reaching them.
 */
const ALLOWED_PERMISSIONS = new Set<string>([
  'fullscreen',
  'pointerLock',
  'clipboard-sanitized-write',
]);

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
        partition: GAME_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    this.window = window;

    this.registerWindowEvents(window);
    this.hardenSession(window);
    await this.syncProxy(useMitm ?? false);

    window.on('close', () => {
      this.gameHandler?.detach();
      this.gameHandler = null;
    });

    window.on('closed', () => {
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
      await this.useMitmProxy(window);
      return;
    }

    await this.useDirectConnection(window);
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

  /** Remote content gets no capability we do not explicitly need. */
  private hardenSession(window: BrowserWindow) {
    const gameSession = window.webContents.session;

    gameSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    });
    gameSession.setPermissionCheckHandler((_contents, permission) =>
      ALLOWED_PERMISSIONS.has(permission),
    );
  }

  private async useMitmProxy(window: BrowserWindow) {
    // The proxy is always addressed over loopback, whatever the machine's
    // network interfaces look like.
    const proxyRules = `http://127.0.0.1:${getMitmPort()}`;
    logger.info(`Routing game traffic through MITM proxy: ${proxyRules}`);

    await window.webContents.session.setProxy({
      proxyRules,
      proxyBypassRules: '127.0.0.1,localhost',
    });
  }

  /** Clears a proxy left behind by an earlier MITM run. */
  private async useDirectConnection(window: BrowserWindow) {
    await window.webContents.session.setProxy({ mode: 'direct' });
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
