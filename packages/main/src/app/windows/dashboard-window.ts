import { app, BrowserWindow, nativeTheme } from 'electron';

import { createLogger } from '../../logging/index.js';
import { forwardRendererConsole } from '../../services/renderer-console.js';
import {
  DASHBOARD_WINDOW_HEIGHT,
  DASHBOARD_WINDOW_MIN_HEIGHT,
  DASHBOARD_WINDOW_MIN_WIDTH,
  DASHBOARD_WINDOW_WIDTH,
  DEV_SERVER_URL,
} from '../../shared/constants.js';
import { getPreloadPath, getRendererPath } from '../../shared/paths.js';
import { isSafeWindow, safeSend } from '../../shared/utils.js';

const logger = createLogger('DashboardWindow');

/** The main application window; closing it hides it unless the app is quitting. */
export class DashboardWindow {
  private window: BrowserWindow | null = null;

  constructor(private readonly shouldHideOnClose: () => boolean) {}

  public get(): BrowserWindow | null {
    return isSafeWindow(this.window) ? this.window : null;
  }

  /** Creates the window on first use, then shows and focuses it. */
  public async show(): Promise<void> {
    const existing = this.get();
    if (existing) {
      existing.show();
      existing.focus();
      return;
    }

    const window = new BrowserWindow({
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
    this.window = window;

    window.once('ready-to-show', () => window.show());
    forwardRendererConsole(window, 'Dashboard');
    this.registerWindowEvents(window);

    await this.load(window);
  }

  /** Shows the window when it is hidden, hides it when it is visible. */
  public toggle() {
    const window = this.get();
    if (!window) {
      void this.show();
      return;
    }

    if (window.isMinimized()) {
      window.restore();
      window.show();
    } else if (window.isVisible()) {
      window.hide();
    } else {
      window.show();
    }
    window.focus();
  }

  private registerWindowEvents(window: BrowserWindow) {
    window.on('close', (event) => {
      if (!this.shouldHideOnClose()) return;

      event.preventDefault();
      window.hide();
    });

    window.on('closed', () => {
      this.window = null;
    });

    window.on('maximize', () => safeSend(window, 'window-state-changed', true));
    window.on('unmaximize', () => safeSend(window, 'window-state-changed', false));
  }

  private async load(window: BrowserWindow) {
    if (!app.isPackaged) {
      await window.loadURL(DEV_SERVER_URL).catch((err: Error) => {
        logger.error(`Failed to load Dashboard in dev mode: ${err.message}`);
      });
      if (isSafeWindow(window)) {
        window.webContents.openDevTools();
      }
      return;
    }

    await window.loadFile(getRendererPath('index.html')).catch((err: Error) => {
      logger.error(`Failed to load Dashboard: ${err.message}`);
    });
  }
}
