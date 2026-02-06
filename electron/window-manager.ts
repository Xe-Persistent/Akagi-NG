import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import path from 'path';

import type { BackendManager } from './backend-manager';
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
} from './constants';
import { GameHandler } from './game-handler';

export class WindowManager {
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

  public getGameWindow(): BrowserWindow | null {
    return this.gameWindow;
  }

  public async createDashboardWindow(): Promise<void> {
    if (this.dashboardWindow) {
      this.dashboardWindow.focus();
      return;
    }

    this.dashboardWindow = new BrowserWindow({
      width: DASHBOARD_WINDOW_WIDTH,
      height: DASHBOARD_WINDOW_HEIGHT,
      minWidth: DASHBOARD_WINDOW_MIN_WIDTH,
      minHeight: DASHBOARD_WINDOW_MIN_HEIGHT,
      frame: false,
      titleBarStyle: 'hiddenInset',
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#ffffff',
      show: false, // Don't show until styles are ready
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    this.dashboardWindow.once('ready-to-show', () => {
      this.dashboardWindow?.show();
    });

    const devUrl = DEV_SERVER_URL; // Vite dev server
    // In production we would load a file

    const isDev = !app.isPackaged;

    if (isDev) {
      await this.dashboardWindow.loadURL(devUrl).catch((err) => {
        console.error(`[WindowManager] Failed to load dev URL: ${err.message}`);
      });
      this.dashboardWindow.webContents.openDevTools();
    } else {
      const indexPath = path.join(__dirname, '../renderer/index.html');
      await this.dashboardWindow.loadFile(indexPath).catch((err) => {
        console.error(`[WindowManager] Failed to load index file: ${err.message}`);
      });
    }

    this.dashboardWindow.on('closed', () => {
      this.dashboardWindow = null;
      // If dashboard closes, we quit the app (main anchor)
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    this.dashboardWindow.on('maximize', () => {
      if (!this.dashboardWindow?.isDestroyed() && this.dashboardWindow?.webContents) {
        this.dashboardWindow.webContents.send('window-state-changed', true);
      }
    });

    this.dashboardWindow.on('unmaximize', () => {
      if (!this.dashboardWindow?.isDestroyed() && this.dashboardWindow?.webContents) {
        this.dashboardWindow.webContents.send('window-state-changed', false);
      }
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
            this.hudWindow?.setOpacity(1);
          }, 100);
        }
        this.hudWindow.focus();
      }
    } else {
      if (this.hudWindow?.isVisible()) {
        this.hudWindow.hide();
        if (!this.dashboardWindow?.isDestroyed() && this.dashboardWindow?.webContents) {
          this.dashboardWindow.webContents.send('hud-visibility-changed', false);
        }
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
      alwaysOnTop: true,
      hasShadow: false,
      resizable: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Wait for ready-to-show but DO NOT show immediately
    // Just mark it as ready internally if needed, or rely on show() later
    this.hudWindow.once('ready-to-show', () => {
      // Do nothing, wait for toggle command
    });

    const isDev = !app.isPackaged;
    const loadPromise = isDev
      ? this.hudWindow.loadURL(DEV_HUD_URL)
      : this.hudWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: '/hud' });

    await loadPromise.catch((err) => console.error('[WindowManager] Failed to load HUD:', err));

    // Prevent closing, just hide
    this.hudWindow.on('close', (e) => {
      // If the app is quitting, allow close. Otherwise, just hide.
      if (!this.isQuitting) {
        e.preventDefault();
        this.hudWindow?.hide();
        if (!this.dashboardWindow?.isDestroyed() && this.dashboardWindow?.webContents) {
          this.dashboardWindow.webContents.send('hud-visibility-changed', false);
        }
      }
    });

    this.hudWindow.on('closed', () => {
      this.hudWindow = null;
    });
  }

  public async createGameWindow(options: {
    url?: string;
    useMitm?: boolean;
    platform?: string;
  }): Promise<void> {
    const { url, useMitm } = options;

    if (this.gameWindow) {
      if (!this.gameWindow.isDestroyed()) {
        this.gameWindow.focus();
      } else {
        this.gameWindow = null; // Clean up zombie reference
      }
      return;
    }

    this.gameWindow = new BrowserWindow({
      width: GAME_WINDOW_WIDTH,
      height: GAME_WINDOW_HEIGHT,
      maximizable: true,
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#ffffff',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
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
    const targetUrl = url;
    if (!targetUrl) {
      console.warn('[WindowManager] No URL provided for Game Window!');
      return;
    }

    // Sanitize User Agent to remove Electron fingerprint
    const defaultUA = this.gameWindow.webContents.session.getUserAgent();
    // Remove "akagi-ng-desktop/1.0.0" and "Electron/x.y.z"
    const cleanUA = defaultUA
      .replace(/akagi-ng-desktop\/\S+\s/g, '')
      .replace(/Electron\/\S+\s/g, '');

    this.gameWindow.webContents.setUserAgent(cleanUA);

    // Set up proxy if using MITM
    if (useMitm) {
      const mitm = this.backendManager.getMitmConfig();
      const proxyRules = `http://${mitm.host}:${mitm.port}`;
      console.log(`[WindowManager] Setting game window proxy to: ${proxyRules}`);
      await this.gameWindow.webContents.session.setProxy({
        proxyRules: proxyRules,
        proxyBypassRules: '127.0.0.1,localhost',
      });
    } else {
      // If NOT using MITM, attach GameHandler (Debugger API) for local interception
      // MUST attach before loading URL to capture early WebSocket traffic and avoid crash
      try {
        if (
          this.gameWindow &&
          !this.gameWindow.isDestroyed() &&
          this.gameWindow.webContents &&
          !this.gameWindow.webContents.isDestroyed()
        ) {
          const backend = this.backendManager.getBackendConfig();
          const apiBase = `http://${backend.host}:${backend.port}`;
          this.gameHandler = new GameHandler(this.gameWindow.webContents, apiBase);
          this.gameHandler.attach(); // Do not await, let it happen in parallel with loadURL
        }
      } catch (e) {
        console.error('Failed to attach GameHandler:', e);
      }
    }

    try {
      await this.gameWindow.loadURL(targetUrl);
    } catch (err) {
      const error = err as { code?: string; errno?: number; message?: string };
      // ERR_ABORTED can happen during redirects or if the navigation is cancelled by the page logic
      // but it doesn't always mean the load failed.
      if (error.code === 'ERR_ABORTED' || error.errno === -3) {
        console.warn(
          `[WindowManager] Navigation aborted for ${targetUrl}, attempting to proceed...`,
        );
      } else {
        console.error(
          `[WindowManager] Failed to load game URL: ${error.message ?? 'Unknown Error'}`,
        );
        // Clean up failed window immediately
        if (this.gameWindow && !this.gameWindow.isDestroyed()) {
          this.gameWindow.close();
        }
        this.gameWindow = null;
        throw err;
      }
    }

    if (this.gameWindow && !this.gameWindow.isDestroyed()) {
      this.gameWindow.on('closed', () => {
        if (this.gameHandler) {
          this.gameHandler.detach();
          this.gameHandler = null;
        }
        this.gameWindow = null;
      });
    }
  }
}
