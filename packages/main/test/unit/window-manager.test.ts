/**
 * The coordinator: three windows and a tray that all outlive each other. The
 * behaviours worth holding down are the ones a caller cannot see from the
 * outside — that a tray is built once, that the tray's quit goes through the
 * dashboard's confirmation, and that the HUD tells the dashboard what it did.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WindowManager } from '../../src/app/window-manager.js';
import type { EngineService } from '../../src/services/engine/engine-service.js';
import { BrowserWindow, Menu, messagesOn, resetSentMessages, Tray } from '../electron-stub.js';

function engine(): EngineService {
  return {} as EngineService;
}

describe('the window manager', () => {
  let windowManager: WindowManager;

  beforeEach(() => {
    BrowserWindow.resetInstances();
    Tray.resetInstances();
    Menu.reset();
    resetSentMessages();
    vi.useFakeTimers();
    windowManager = new WindowManager(engine());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('owns no window until one is asked for', () => {
    expect(windowManager.getMainWindow()).toBeNull();
    expect(windowManager.getHudWindow()).toBeNull();
    expect(windowManager.getGameWindow()).toBeNull();
  });

  it('opens the dashboard and preloads the HUD behind it', async () => {
    await windowManager.createDashboardWindow();

    expect(windowManager.getMainWindow()).not.toBeNull();
    expect(windowManager.getHudWindow()).not.toBeNull();
    // The overlay is created hidden, so showing it later is instant.
    expect((windowManager.getHudWindow() as unknown as BrowserWindow).isVisible()).toBe(false);
  });

  it('shows and hides the HUD on request', async () => {
    await windowManager.createDashboardWindow();

    await windowManager.toggleHudWindow(true);
    expect((windowManager.getHudWindow() as unknown as BrowserWindow).isVisible()).toBe(true);

    await windowManager.toggleHudWindow(false);
    expect((windowManager.getHudWindow() as unknown as BrowserWindow).isVisible()).toBe(false);
  });

  it('tells the dashboard when the HUD appears or disappears', async () => {
    await windowManager.createDashboardWindow();

    await windowManager.toggleHudWindow(true);
    expect(messagesOn('hud-visibility-changed')).toEqual([true]);

    await windowManager.toggleHudWindow(false);
    expect(messagesOn('hud-visibility-changed')).toEqual([true, false]);
  });

  it('passes a game launch through and reports what happened', async () => {
    await expect(windowManager.createGameWindow({ url: 'https://game.test/1/' })).resolves.toEqual({
      ok: true,
    });
    expect(windowManager.getGameWindow()).not.toBeNull();
  });

  it('re-points the open game window when the proxy settings change', async () => {
    await windowManager.createGameWindow({ url: 'https://game.test/1/' });
    const game = windowManager.getGameWindow() as unknown as {
      readonly webContents: { debugger: { detachCalls: number } };
    };

    await windowManager.syncGameWindowProxy(true);
    expect(game.webContents.debugger.detachCalls).toBe(1);

    await windowManager.syncGameWindowProxy(false);
    expect(game.webContents.debugger.detachCalls).toBe(1);
  });

  describe('the tray', () => {
    const quitItem = () => Menu.built.at(-1)?.find((item) => item.label === 'Quit Akagi-NG');

    it('is built exactly once', () => {
      windowManager.setupTray(vi.fn());
      windowManager.setupTray(vi.fn());

      expect(Tray.instances).toHaveLength(1);
    });

    it('asks the dashboard to confirm a quit instead of exiting itself', async () => {
      await windowManager.createDashboardWindow();
      resetSentMessages();
      windowManager.setupTray(vi.fn());

      quitItem()?.click?.();

      // The dialog lives in the renderer, so the dashboard has to be visible
      // before the request is meaningful.
      await vi.waitFor(() => expect(messagesOn('request-app-quit')).toEqual([undefined]));
    });

    it('forwards the update check the menu asks for', () => {
      const check = vi.fn();
      windowManager.setupTray(check);

      Menu.built
        .at(-1)
        ?.find((item) => item.label === 'Check for Updates')
        ?.click?.();

      expect(check).toHaveBeenCalledTimes(1);
    });

    it('toggles the dashboard when the icon is clicked', async () => {
      await windowManager.createDashboardWindow();
      windowManager.setupTray(vi.fn());
      const dashboard = windowManager.getMainWindow() as unknown as BrowserWindow;
      dashboard.show();

      Tray.instances[0]?.emit('click');

      expect(dashboard.isVisible()).toBe(false);
      expect(windowManager.getMainWindow()).not.toBeNull();
    });

    it('brings the dashboard back through the menu', async () => {
      await windowManager.createDashboardWindow();
      windowManager.setupTray(vi.fn());
      const dashboard = windowManager.getMainWindow() as unknown as BrowserWindow;
      dashboard.hide();

      Menu.built
        .at(-1)
        ?.find((item) => item.label === 'Show Dashboard')
        ?.click?.();

      await vi.waitFor(() => expect(dashboard.isVisible()).toBe(true));
    });
  });

  it('lets the dashboard close for real once the app is quitting', async () => {
    await windowManager.createDashboardWindow();
    const dashboard = windowManager.getMainWindow() as unknown as BrowserWindow;

    windowManager.setQuitting(true);
    dashboard.close();

    expect(windowManager.getMainWindow()).toBeNull();
  });

  it('hides the dashboard on close while the app is not quitting', async () => {
    await windowManager.createDashboardWindow();
    const dashboard = windowManager.getMainWindow() as unknown as BrowserWindow;
    dashboard.show();

    dashboard.close();

    expect(windowManager.getMainWindow()).not.toBeNull();
    expect(dashboard.isVisible()).toBe(false);
  });
});
