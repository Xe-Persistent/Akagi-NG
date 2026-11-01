/**
 * The window channels. Every one of them reaches a window the renderer does not
 * own, so the rule is that a missing or already-gone window makes the call a
 * no-op that still answers: a closed dashboard must not turn a title-bar click
 * into an unhandled rejection.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerWindowHandlers } from '../../src/app/ipc/windows.js';
import type { WindowManager } from '../../src/app/window-manager.js';
import {
  BrowserWindow,
  type FakeBrowserWindow,
  invokeIpc,
  resetIpcListeners,
} from '../electron-stub.js';

interface ManagerStub {
  toggleHudWindow: ReturnType<typeof vi.fn>;
  createGameWindow: ReturnType<typeof vi.fn>;
  getMainWindow: ReturnType<typeof vi.fn>;
  getGameWindow: ReturnType<typeof vi.fn>;
}

function manager(dashboard: FakeBrowserWindow | null, game: FakeBrowserWindow | null = null) {
  const stub: ManagerStub = {
    toggleHudWindow: vi.fn(async () => {}),
    createGameWindow: vi.fn(async () => ({ ok: true })),
    getMainWindow: vi.fn(() => dashboard),
    getGameWindow: vi.fn(() => game),
  };
  return stub as unknown as WindowManager & ManagerStub;
}

describe('the window IPC surface', () => {
  beforeEach(() => {
    resetIpcListeners();
    BrowserWindow.resetInstances();
  });

  it('forwards the HUD toggle', async () => {
    const windowManager = manager(null);
    registerWindowHandlers(windowManager);

    await expect(invokeIpc('toggle-hud', { id: 1 }, true)).resolves.toBe(true);

    expect(windowManager.toggleHudWindow).toHaveBeenCalledWith(true);
  });

  it('starts the game with the options the renderer sent', async () => {
    const windowManager = manager(null);
    registerWindowHandlers(windowManager);

    const options = { url: 'https://game.test', useMitm: true };
    await expect(invokeIpc('start-game', { id: 1 }, options)).resolves.toEqual({ ok: true });

    expect(windowManager.createGameWindow).toHaveBeenCalledWith(options);
  });

  it('passes a failed launch back instead of throwing', async () => {
    const windowManager = manager(null);
    windowManager.createGameWindow.mockResolvedValue({ ok: false, reason: 'url' });
    registerWindowHandlers(windowManager);

    await expect(invokeIpc('start-game', { id: 1 }, {})).resolves.toEqual({
      ok: false,
      reason: 'url',
    });
  });

  it('minimizes the dashboard', async () => {
    const dashboard = new BrowserWindow();
    registerWindowHandlers(manager(dashboard));

    await expect(invokeIpc('minimize-window')).resolves.toBe(true);

    expect(dashboard.isMinimized()).toBe(true);
  });

  it('answers the same way when there is no dashboard to minimize', async () => {
    registerWindowHandlers(manager(null));

    await expect(invokeIpc('minimize-window')).resolves.toBe(true);
  });

  it('closes the window that asked', async () => {
    const dashboard = new BrowserWindow();
    registerWindowHandlers(manager(dashboard));

    await expect(invokeIpc('close-window', dashboard.webContents)).resolves.toBe(true);

    expect(dashboard.isDestroyed()).toBe(true);
  });

  it('leaves a window that is already gone alone', async () => {
    const dashboard = new BrowserWindow();
    dashboard.destroyed = true;
    registerWindowHandlers(manager(dashboard));

    await expect(invokeIpc('close-window', dashboard.webContents)).resolves.toBe(true);

    expect(dashboard.callsTo('close')).toEqual([]);
  });

  it('ignores a sender that belongs to no window', async () => {
    registerWindowHandlers(manager(null));

    await expect(invokeIpc('close-window', { id: 99 })).resolves.toBe(true);
  });

  it('toggles the dashboard between maximized and not', async () => {
    const dashboard = new BrowserWindow();
    registerWindowHandlers(manager(dashboard));

    await invokeIpc('maximize-window');
    expect(dashboard.isMaximized()).toBe(true);

    await invokeIpc('maximize-window');
    expect(dashboard.isMaximized()).toBe(false);
  });

  it('targets the game window when the renderer names it', async () => {
    const dashboard = new BrowserWindow({ dashboard: true });
    const game = new BrowserWindow({ game: true });
    registerWindowHandlers(manager(dashboard, game));

    await invokeIpc('maximize-window', { id: 1 }, 'game');

    expect(game.isMaximized()).toBe(true);
    expect(dashboard.isMaximized()).toBe(false);
  });

  it('reports the dashboard state, and "not maximized" when there is none', async () => {
    const dashboard = new BrowserWindow();
    const windowManager = manager(dashboard);
    registerWindowHandlers(windowManager);

    await expect(invokeIpc('is-window-maximized')).resolves.toBe(false);
    dashboard.maximized = true;
    await expect(invokeIpc('is-window-maximized')).resolves.toBe(true);

    windowManager.getMainWindow.mockReturnValue(null);
    await expect(invokeIpc('is-window-maximized')).resolves.toBe(false);
  });
});
