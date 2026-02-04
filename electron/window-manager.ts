import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import path from 'path';

import { GameHandler } from './game-handler';

export class WindowManager {
  private dashboardWindow: BrowserWindow | null = null;
  private gameWindow: BrowserWindow | null = null;
  private hudWindow: BrowserWindow | null = null;
  private gameHandler: GameHandler | null = null;
  private lastHudPosition: { x: number; y: number } | null = null;
  private isQuitting: boolean = false;

  constructor() {}

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
      width: 1280,
      height: 800,
      minWidth: 1280,
      minHeight: 800,
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

    const devUrl = 'http://localhost:5173'; // Vite dev server
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
    const x = this.lastHudPosition?.x ?? width - 660;
    const y = this.lastHudPosition?.y ?? 100;

    this.hudWindow = new BrowserWindow({
      x,
      y,
      width: 640,
      height: 360,
      minWidth: 320,
      minHeight: 180,
      maxWidth: 1280,
      maxHeight: 720,
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
      ? this.hudWindow.loadURL('http://localhost:5173/#/hud')
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
    const { url, useMitm, platform } = options;

    if (this.gameWindow) {
      if (!this.gameWindow.isDestroyed()) {
        this.gameWindow.focus();
      } else {
        this.gameWindow = null; // Clean up zombie reference
      }
      return;
    }

    this.gameWindow = new BrowserWindow({
      width: 1280,
      height: 720,
      minWidth: 1280,
      minHeight: 720,
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

    let targetUrl = url;
    if (!targetUrl) {
      if (platform === 'tenhou') {
        targetUrl = 'https://tenhou.net/3/';
      } else {
        // Default to Majsoul for backward compatibility or auto
        targetUrl = 'https://game.maj-soul.com/1/';
      }
    }

    // Sanitize User Agent to remove Electron fingerprint
    // This dynamically uses the Chrome version bundled with Electron, so it auto-updates!
    const defaultUA = this.gameWindow.webContents.session.getUserAgent();
    // Remove "akagi-ng-desktop/1.0.0" and "Electron/x.y.z"
    const cleanUA = defaultUA
      .replace(/akagi-ng-desktop\/\S+\s/g, '')
      .replace(/Electron\/\S+\s/g, '');

    this.gameWindow.webContents.setUserAgent(cleanUA);

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

    // If NOT using MITM, attach GameHandler (Debugger API) for local interception
    if (!useMitm) {
      try {
        if (
          this.gameWindow &&
          !this.gameWindow.isDestroyed() &&
          this.gameWindow.webContents &&
          !this.gameWindow.webContents.isDestroyed()
        ) {
          this.gameHandler = new GameHandler(this.gameWindow.webContents);
          await this.gameHandler.attach();
        }
      } catch (e) {
        console.error('Failed to attach GameHandler:', e);
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
