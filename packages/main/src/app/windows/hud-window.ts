import { app, BrowserWindow, screen } from 'electron';

import { createLogger } from '../../logging/index.js';
import { forwardRendererConsole } from '../../services/renderer-console.js';
import {
  DEV_HUD_URL,
  HUD_MAX_HEIGHT,
  HUD_MAX_WIDTH,
  HUD_MIN_HEIGHT,
  HUD_MIN_WIDTH,
  HUD_WINDOW_HEIGHT,
  HUD_WINDOW_WIDTH,
} from '../../shared/constants.js';
import { getPreloadPath, getRendererPath } from '../../shared/paths.js';
import { isSafeWindow } from '../../shared/utils.js';

const logger = createLogger('HudWindow');

/** The always-on-top overlay window that shows the recommendations. */
export class HudWindow {
  private window: BrowserWindow | null = null;
  private lastPosition: { x: number; y: number } | null = null;

  constructor(
    private readonly shouldHideOnClose: () => boolean,
    /** Lets the dashboard keep its toggle button in sync. */
    private readonly onVisibilityChanged: (visible: boolean) => void,
  ) {}

  public get(): BrowserWindow | null {
    return isSafeWindow(this.window) ? this.window : null;
  }

  /** Creates the overlay if needed; the window is created hidden and preloaded. */
  public async ensure(): Promise<void> {
    if (this.get()) return;

    const { width } = screen.getPrimaryDisplay().workAreaSize;
    const window = new BrowserWindow({
      x: this.lastPosition?.x ?? width - (HUD_WINDOW_WIDTH + 20),
      y: this.lastPosition?.y ?? 100,
      width: HUD_WINDOW_WIDTH,
      height: HUD_WINDOW_HEIGHT,
      minWidth: HUD_MIN_WIDTH,
      minHeight: HUD_MIN_HEIGHT,
      maxWidth: HUD_MAX_WIDTH,
      maxHeight: HUD_MAX_HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      show: false,
      hasShadow: false,
      resizable: true,
      webPreferences: {
        preload: getPreloadPath(),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    this.window = window;

    // Stay above fullscreen games and on every virtual desktop.
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setAspectRatio(16 / 9);

    forwardRendererConsole(window, 'HUD');
    this.registerWindowEvents(window);

    const load = app.isPackaged
      ? window.loadFile(getRendererPath('index.html'), { hash: '/hud' })
      : window.loadURL(DEV_HUD_URL);
    await load.catch((err: Error) => logger.error('Failed to load HUD:', err));
  }

  public async setVisible(visible: boolean): Promise<void> {
    await this.ensure();

    const window = this.get();
    if (!window) return;

    if (!visible) {
      if (window.isVisible()) {
        window.hide();
        this.onVisibilityChanged(false);
      }
      return;
    }

    if (!window.isVisible()) {
      // Hide the initial layout shift behind a short fade.
      window.setOpacity(0);
      window.show();
      setTimeout(() => {
        if (isSafeWindow(window)) {
          window.setOpacity(1);
        }
      }, 50);
    }
    window.focus();
    this.onVisibilityChanged(true);
  }

  private registerWindowEvents(window: BrowserWindow) {
    window.on('moved', () => {
      if (isSafeWindow(window)) {
        const [x = 0, y = 0] = window.getPosition();
        this.lastPosition = { x, y };
      }
    });

    window.on('close', (event) => {
      if (!this.shouldHideOnClose()) return;

      event.preventDefault();
      window.hide();
      this.onVisibilityChanged(false);
    });

    window.on('closed', () => {
      this.window = null;
    });
  }
}
