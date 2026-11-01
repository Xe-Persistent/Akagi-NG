/**
 * The dashboard window is the whole app's front door, and the two behaviours
 * that matter are easy to get wrong silently: closing it must hide it rather
 * than end the session, and it must be created exactly once — a second `show`
 * on a live window would stack a duplicate frame on top of the first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardWindow } from '../../src/app/windows/dashboard-window.js';
import {
  DASHBOARD_WINDOW_HEIGHT,
  DASHBOARD_WINDOW_MIN_HEIGHT,
  DASHBOARD_WINDOW_MIN_WIDTH,
  DASHBOARD_WINDOW_WIDTH,
  DEV_SERVER_URL,
} from '../../src/shared/constants.js';
import {
  app,
  BrowserWindow,
  type FakeBrowserWindow,
  messagesOn,
  nativeTheme,
  resetSentMessages,
} from '../electron-stub.js';

/** The window the class created, as the fake that records what happened to it. */
function created(dashboard: DashboardWindow): FakeBrowserWindow {
  const window = dashboard.get();
  if (!window) throw new Error('the dashboard did not create a window');
  return window as unknown as FakeBrowserWindow;
}

function dashboardWindow(hideOnClose = true): DashboardWindow {
  return new DashboardWindow(() => hideOnClose);
}

describe('the dashboard window', () => {
  beforeEach(() => {
    BrowserWindow.resetInstances();
    resetSentMessages();
  });

  afterEach(() => {
    app.isPackaged = true;
    nativeTheme.shouldUseDarkColors = false;
    vi.restoreAllMocks();
  });

  it('has no window until it is shown', () => {
    expect(dashboardWindow().get()).toBeNull();
  });

  it('creates one window and focuses it again on the next show', async () => {
    const dashboard = dashboardWindow();

    await dashboard.show();
    const window = created(dashboard);
    await dashboard.show();

    expect(BrowserWindow.getAllWindows()).toHaveLength(1);
    expect(window.callsTo('focus')).toHaveLength(1);
    expect(window.callsTo('show')).toHaveLength(1);
  });

  it('creates a frameless window at the documented size', async () => {
    const dashboard = dashboardWindow();

    await dashboard.show();
    const window = created(dashboard);

    expect(window.options).toMatchObject({
      width: DASHBOARD_WINDOW_WIDTH,
      height: DASHBOARD_WINDOW_HEIGHT,
      minWidth: DASHBOARD_WINDOW_MIN_WIDTH,
      minHeight: DASHBOARD_WINDOW_MIN_HEIGHT,
      frame: false,
      show: false,
      backgroundColor: '#ffffff',
    });
    expect(window.options.webPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
    });
  });

  it('follows the system theme for the background', async () => {
    nativeTheme.shouldUseDarkColors = true;
    const dashboard = dashboardWindow();

    await dashboard.show();

    expect(created(dashboard).options.backgroundColor).toBe('#18181b');
  });

  it('waits for the first paint before showing itself', async () => {
    const dashboard = dashboardWindow();
    await dashboard.show();
    const window = created(dashboard);

    expect(window.isVisible()).toBe(false);
    window.emit('ready-to-show');
    expect(window.isVisible()).toBe(true);
  });

  it('loads the built renderer when packaged', async () => {
    const dashboard = dashboardWindow();
    await dashboard.show();

    const [load] = created(dashboard).callsTo('loadFile');
    expect(String(load?.[0])).toMatch(/renderer[\\/]index\.html$/);
    expect(created(dashboard).webContents.devToolsOpened).toBe(0);
  });

  it('loads the dev server and opens devtools outside a packaged build', async () => {
    app.isPackaged = false;
    const dashboard = dashboardWindow();

    await dashboard.show();

    expect(created(dashboard).callsTo('loadURL')).toEqual([[DEV_SERVER_URL]]);
    expect(created(dashboard).webContents.devToolsOpened).toBe(1);
  });

  it('survives a renderer that fails to load', async () => {
    const original = BrowserWindow.prototype.loadFile;
    BrowserWindow.prototype.loadFile = async () => {
      throw new Error('ERR_FILE_NOT_FOUND');
    };

    try {
      const dashboard = dashboardWindow();
      // The failure is logged, not thrown: a bad build must not stop the app
      // from opening a window at all.
      await expect(dashboard.show()).resolves.toBeUndefined();
      expect(dashboard.get()).not.toBeNull();
    } finally {
      BrowserWindow.prototype.loadFile = original;
    }
  });

  it('hides instead of closing while the app is not quitting', async () => {
    const dashboard = dashboardWindow(true);
    await dashboard.show();
    const window = created(dashboard);
    window.show();

    window.close();

    expect(window.isDestroyed()).toBe(false);
    expect(window.isVisible()).toBe(false);
  });

  it('really closes when the app is quitting', async () => {
    const dashboard = dashboardWindow(false);
    await dashboard.show();
    const window = created(dashboard);

    window.close();

    expect(window.isDestroyed()).toBe(true);
    expect(dashboard.get()).toBeNull();
  });

  it('forgets the window once it is closed', async () => {
    const dashboard = dashboardWindow(false);
    await dashboard.show();
    const window = created(dashboard);

    window.destroy();

    expect(dashboard.get()).toBeNull();
  });

  describe('toggling', () => {
    it('creates the window when there is none', async () => {
      const dashboard = dashboardWindow();

      dashboard.toggle();
      await vi.waitFor(() => expect(dashboard.get()).not.toBeNull());
    });

    it('hides a visible window', async () => {
      const dashboard = dashboardWindow();
      await dashboard.show();
      const window = created(dashboard);
      window.show();

      dashboard.toggle();

      expect(window.isVisible()).toBe(false);
      expect(window.callsTo('focus')).toHaveLength(1);
    });

    it('shows a hidden window', async () => {
      const dashboard = dashboardWindow();
      await dashboard.show();
      const window = created(dashboard);

      dashboard.toggle();

      expect(window.isVisible()).toBe(true);
    });

    it('restores a minimized window instead of leaving it in the taskbar', async () => {
      const dashboard = dashboardWindow();
      await dashboard.show();
      const window = created(dashboard);
      window.minimize();

      dashboard.toggle();

      expect(window.isMinimized()).toBe(false);
      expect(window.isVisible()).toBe(true);
    });
  });

  it('mirrors maximize changes to the renderer', async () => {
    const dashboard = dashboardWindow();
    await dashboard.show();
    const window = created(dashboard);

    window.emit('maximize');
    window.emit('unmaximize');

    expect(messagesOn('window-state-changed')).toEqual([true, false]);
  });
});
