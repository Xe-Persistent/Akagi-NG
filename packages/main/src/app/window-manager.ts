import { app, BrowserWindow, Menu, nativeImage, nativeTheme, screen, Tray } from 'electron';

import { createLogger } from '../logging/index.js';
import type { BackendManager } from '../services/backend-manager.js';
import { GameHandler } from '../services/capture/game-handler.js';
import { forwardRendererConsole } from '../services/renderer-console.js';
import {
  DASHBOARD_WINDOW_HEIGHT,
  DASHBOARD_WINDOW_MIN_HEIGHT,
  DASHBOARD_WINDOW_MIN_WIDTH,
  DASHBOARD_WINDOW_WIDTH,
  DEV_HUD_URL,
  DEV_SERVER_URL,
  GAME_WINDOW_HEIGHT,
  GAME_WINDOW_WIDTH,
  HUD_MAX_HEIGHT,
  HUD_MAX_WIDTH,
  HUD_MIN_HEIGHT,
  HUD_MIN_WIDTH,
  HUD_WINDOW_HEIGHT,
  HUD_WINDOW_WIDTH,
} from '../shared/constants.js';
import { getPreloadPath, getRendererPath } from '../shared/paths.js';
import { getAssetPath } from '../shared/paths.js';
import { isSafeWindow, safeSend } from '../shared/utils.js';

const logger = createLogger('WindowManager');

export class WindowManager {
  private tray: Tray | null = null;
  private dashboardWindow: BrowserWindow | null = null;
  private gameWindow: BrowserWindow | null = null;
  private hudWindow: BrowserWindow | null = null;
  private gameHandler: GameHandler | null = null;
  private lastHudPosition: { x: number; y: number } | null = null;
  private isQuitting: boolean = false;

  constructor(private backendManager: BackendManager) {}

  public setQuitting(quitting: boolean) {
    this.isQuitting = quitting;
  }

  public getMainWindow(): BrowserWindow | null {
    return this.dashboardWindow;
  }

  public setupTray(onCheckForUpdates?: () => void): void {
    if (this.tray) return;

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    const iconFile = isWin ? 'torii.ico' : isMac ? 'toriiTemplate.png' : 'torii.png';
    const iconPath = getAssetPath('assets', iconFile);
    const icon = nativeImage.createFromPath(iconPath);

    if (isMac) {
      icon.setTemplateImage(true);
    }
    this.tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Akagi-NG',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Show Dashboard',
        click: () => {
          this.createDashboardWindow();
        },
      },
      {
        label: 'Check for Updates',
        click: () => {
          if (onCheckForUpdates) {
            onCheckForUpdates();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Akagi-NG',
        click: () => {
          this.createDashboardWindow();
          const win = this.getMainWindow();
          if (win) {
            win.show();
            win.focus();
            safeSend(win, 'request-app-quit');
          }
        },
      },
    ]);

    this.tray.setToolTip('Akagi-NG');
    this.tray.setContextMenu(contextMenu);

    this.tray.on('click', () => {
      const window = this.getMainWindow();
      if (window) {
        if (window.isMinimized()) {
          window.restore();
          window.show();
        } else if (window.isVisible()) {
          window.hide();
        } else {
          window.show();
        }
        window.focus();
      } else {
        this.createDashboardWindow();
      }
    });
  }

  public getGameWindow(): BrowserWindow | null {
    return this.gameWindow;
  }

  public async createDashboardWindow(): Promise<void> {
    if (this.dashboardWindow) {
      this.dashboardWindow.show();
      this.dashboardWindow.focus();
      return;
    }

    this.dashboardWindow = new BrowserWindow({
      width: DASHBOARD_WINDOW_WIDTH,
      height: DASHBOARD_WINDOW_HEIGHT,
      minWidth: DASHBOARD_WINDOW_MIN_WIDTH,
      minHeight: DASHBOARD_WINDOW_MIN_HEIGHT,
      frame: false,
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#ffffff',
      show: false,
      webPreferences: {
        preload: getPreloadPath(),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    this.dashboardWindow.once('ready-to-show', () => {
      this.dashboardWindow?.show();
    });

    forwardRendererConsole(this.dashboardWindow, 'Dashboard');

    const isDev = !app.isPackaged;

    if (isDev) {
      await this.dashboardWindow.loadURL(DEV_SERVER_URL).catch((err) => {
        logger.error(`Failed to load Dashboard in dev mode: ${err.message}`);
      });
      if (isSafeWindow(this.dashboardWindow)) {
        this.dashboardWindow.webContents.openDevTools();
      }
    } else {
      const indexPath = getRendererPath('index.html');
      await this.dashboardWindow.loadFile(indexPath).catch((err) => {
        logger.error(`Failed to load Dashboard: ${err.message}`);
      });
    }

    this.dashboardWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.dashboardWindow?.hide();
      }
    });

    this.dashboardWindow.on('closed', () => {
      this.dashboardWindow = null;
    });

    this.dashboardWindow.on('maximize', () => {
      safeSend(this.dashboardWindow, 'window-state-changed', true);
    });

    this.dashboardWindow.on('unmaximize', () => {
      safeSend(this.dashboardWindow, 'window-state-changed', false);
    });

    // Preload HUD window so it is ready instantly
    this.createHudWindow();
  }

  public async toggleHudWindow(show: boolean): Promise<void> {
    if (!this.hudWindow) {
      await this.createHudWindow();
    }

    if (show) {
      if (this.hudWindow) {
        if (!this.hudWindow.isVisible()) {
          // Mask initial layout shift
          this.hudWindow.setOpacity(0);
          this.hudWindow.show();
          // Short delay to allow renderer to stabilize
          setTimeout(() => {
            if (isSafeWindow(this.hudWindow)) {
              this.hudWindow.setOpacity(1);
            }
          }, 50);
        }
        this.hudWindow.focus();
      }
    } else {
      if (this.hudWindow?.isVisible()) {
        this.hudWindow.hide();
        safeSend(this.dashboardWindow, 'hud-visibility-changed', false);
      }
    }
  }

  private async createHudWindow(): Promise<void> {
    if (this.hudWindow) return; // Already exists

    const { width } = screen.getPrimaryDisplay().workAreaSize;

    // Use saved position or default
    const x = this.lastHudPosition?.x ?? width - (HUD_WINDOW_WIDTH + 20);
    const y = this.lastHudPosition?.y ?? 100;

    this.hudWindow = new BrowserWindow({
      x,
      y,
      width: HUD_WINDOW_WIDTH,
      height: HUD_WINDOW_HEIGHT,
      minWidth: HUD_MIN_WIDTH,
      minHeight: HUD_MIN_HEIGHT,
      maxWidth: HUD_MAX_WIDTH,
      maxHeight: HUD_MAX_HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      show: false, // Keep hidden initially
      hasShadow: false,
      resizable: true,
      webPreferences: {
        preload: getPreloadPath(),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Enforce high-level always-on-top (works over fullscreen apps/games on most OS)
    this.hudWindow.setAlwaysOnTop(true, 'screen-saver');

    // Ensure visibility across virtual desktops (Mac/Win)
    this.hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Enforce 16:9 aspect ratio natively
    this.hudWindow.setAspectRatio(16 / 9);

    forwardRendererConsole(this.hudWindow, 'HUD');

    // Save position whenever user moves it
    this.hudWindow.on('moved', () => {
      if (isSafeWindow(this.hudWindow)) {
        const [x, y] = this.hudWindow.getPosition();
        this.lastHudPosition = { x, y };
      }
    });

    const isDev = !app.isPackaged;
    const loadPromise = isDev
      ? this.hudWindow.loadURL(DEV_HUD_URL)
      : this.hudWindow.loadFile(getRendererPath('index.html'), { hash: '/hud' });

    await loadPromise.catch((err) => logger.error('Failed to load HUD:', err));

    this.hudWindow.on('close', (e) => {
      // If the app is quitting, allow close. Otherwise, just hide.
      if (!this.isQuitting) {
        e.preventDefault();
        this.hudWindow?.hide();
        safeSend(this.dashboardWindow, 'hud-visibility-changed', false);
      }
    });

    this.hudWindow.on('closed', () => {
      this.hudWindow = null;
    });
  }

  public async createGameWindow(options: { url?: string; useMitm?: boolean }): Promise<void> {
    const { url, useMitm } = options;

    if (isSafeWindow(this.gameWindow)) {
      this.gameWindow.focus();
      return;
    }
    this.gameWindow = null; // Clean up zombie reference and proceed with creation

    if (!url) {
      logger.warn('No URL provided for Game Window!');
      return;
    }

    this.gameWindow = new BrowserWindow({
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

    this.gameWindow.webContents.setWindowOpenHandler(() => {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#ffffff',
        },
      };
    });

    // Handle F11 for fullscreen toggle
    this.gameWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') {
        const isFullScreen = this.gameWindow?.isFullScreen();
        this.gameWindow?.setFullScreen(!isFullScreen);
        event.preventDefault();
      }
    });

    // Frontend should always provide a valid URL.
    // Sanitize User Agent to remove Electron fingerprint
    const defaultUA = this.gameWindow.webContents.session.getUserAgent();
    // Remove "akagi-ng-desktop/1.0.0" and "Electron/x.y.z"
    const cleanUA = defaultUA
      .replace(/akagi-ng-desktop\/\S+\s/g, '')
      .replace(/Electron\/\S+\s/g, '');

    this.gameWindow.webContents.setUserAgent(cleanUA);

    // Set up proxy if using MITM
    if (useMitm) {
      const mitm = await this.backendManager.getMitmConfig();
      const proxyRules = `http://${mitm.host}:${mitm.port}`;
      logger.info(`Routing game traffic through MITM proxy: ${proxyRules}`);
      await this.gameWindow.webContents.session.setProxy({
        proxyRules,
        proxyBypassRules: '127.0.0.1,localhost',
      });
    } else {
      // If NOT using MITM, attach GameHandler (Debugger API) for local interception
      // MUST attach before loading URL to capture early WebSocket traffic and avoid crash
      try {
        if (isSafeWindow(this.gameWindow) && !this.gameWindow.webContents.isDestroyed()) {
          this.gameHandler = new GameHandler(this.gameWindow.webContents, this.backendManager);
          this.gameHandler.attach(); // Do not await, let it happen in parallel with loadURL
        }
      } catch (e) {
        logger.error('Failed to attach GameHandler:', e);
      }
    }

    if (isSafeWindow(this.gameWindow)) {
      this.gameWindow.on('closed', () => {
        if (this.gameHandler) {
          this.gameHandler.detach();
          this.gameHandler = null;
        }
        this.gameWindow = null;
      });
    }

    try {
      await this.gameWindow.loadURL(url);
    } catch (err) {
      const error = err as { code?: string; errno?: number; message?: string };
      // ERR_ABORTED can happen during redirects or if the navigation is cancelled by the page logic
      // but it doesn't always mean the load failed.
      if (error.code === 'ERR_ABORTED' || error.errno === -3) {
        logger.warn(`Navigation aborted for ${url}, attempting to proceed...`);
      } else {
        logger.error(`Failed to load game URL: ${error.message ?? 'Unknown Error'}`);
        // Clean up failed window immediately
        if (isSafeWindow(this.gameWindow)) {
          this.gameWindow.close();
        }
        this.gameWindow = null;
        throw err;
      }
    }
  }
}
