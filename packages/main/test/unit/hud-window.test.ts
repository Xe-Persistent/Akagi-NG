/**
 * The HUD is the window the player actually watches during a game, and it is
 * the only one that floats over remote content. Two things are contracts: it
 * keeps its place on screen across a re-open, and it tells the dashboard every
 * time it appears or disappears — a toggle button that disagrees with the
 * overlay is worse than no button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HudWindow } from '../../src/app/windows/hud-window.js';
import {
  DEV_HUD_URL,
  HUD_MAX_HEIGHT,
  HUD_MAX_WIDTH,
  HUD_MIN_HEIGHT,
  HUD_MIN_WIDTH,
  HUD_WINDOW_HEIGHT,
  HUD_WINDOW_WIDTH,
} from '../../src/shared/constants.js';
import { app, BrowserWindow, type FakeBrowserWindow, screen } from '../electron-stub.js';

function created(hud: HudWindow): FakeBrowserWindow {
  const window = hud.get();
  if (!window) throw new Error('the HUD did not create a window');
  return window as unknown as FakeBrowserWindow;
}

function hud(hideOnClose = true) {
  const visibility: boolean[] = [];
  const window = new HudWindow(
    () => hideOnClose,
    (visible) => visibility.push(visible),
  );
  return { window, visibility };
}

describe('the HUD window', () => {
  beforeEach(() => {
    BrowserWindow.resetInstances();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    app.isPackaged = true;
  });

  it('has no window until it is ensured', () => {
    expect(hud().window.get()).toBeNull();
  });

  it('creates the overlay only once', async () => {
    const { window } = hud();

    await window.ensure();
    await window.ensure();

    expect(BrowserWindow.getAllWindows()).toHaveLength(1);
  });

  it('creates a transparent always-on-top frame at the top right', async () => {
    const { window } = hud();

    await window.ensure();
    const win = created(window);
    const { width } = screen.getPrimaryDisplay().workAreaSize;

    expect(win.options).toMatchObject({
      x: width - (HUD_WINDOW_WIDTH + 20),
      y: 100,
      width: HUD_WINDOW_WIDTH,
      height: HUD_WINDOW_HEIGHT,
      minWidth: HUD_MIN_WIDTH,
      minHeight: HUD_MIN_HEIGHT,
      maxWidth: HUD_MAX_WIDTH,
      maxHeight: HUD_MAX_HEIGHT,
      frame: false,
      transparent: true,
      show: false,
      hasShadow: false,
    });
    expect(win.callsTo('setAlwaysOnTop')).toEqual([[true, 'screen-saver']]);
    expect(win.callsTo('setVisibleOnAllWorkspaces')).toEqual([
      [true, { visibleOnFullScreen: true }],
    ]);
    expect(win.callsTo('setAspectRatio')).toEqual([[16 / 9]]);
  });

  it('loads the hud route of the built renderer', async () => {
    const { window } = hud();

    await window.ensure();

    const [load] = created(window).callsTo('loadFile');
    expect(String(load?.[0])).toMatch(/renderer[\\/]index\.html$/);
    expect(load?.[1]).toEqual({ hash: '/hud' });
  });

  it('loads the dev hud url outside a packaged build', async () => {
    app.isPackaged = false;
    const { window } = hud();

    await window.ensure();

    expect(created(window).callsTo('loadURL')).toEqual([[DEV_HUD_URL]]);
  });

  it('survives a hud that fails to load', async () => {
    const original = BrowserWindow.prototype.loadFile;
    BrowserWindow.prototype.loadFile = async () => {
      throw new Error('ERR_FILE_NOT_FOUND');
    };

    try {
      const { window } = hud();
      await expect(window.ensure()).resolves.toBeUndefined();
      expect(window.get()).not.toBeNull();
    } finally {
      BrowserWindow.prototype.loadFile = original;
    }
  });

  describe('showing and hiding', () => {
    it('fades the overlay in and says it is visible', async () => {
      const { window, visibility } = hud();
      await window.ensure();
      const win = created(window);

      await window.setVisible(true);

      expect(win.callsTo('setOpacity')).toEqual([[0]]);
      expect(win.isVisible()).toBe(true);
      expect(win.callsTo('focus')).toHaveLength(1);
      expect(visibility).toEqual([true]);

      await vi.advanceTimersByTimeAsync(50);
      expect(win.getOpacity()).toBe(1);
    });

    it('creates the overlay when asked to show it before it exists', async () => {
      const { window, visibility } = hud();

      await window.setVisible(true);

      expect(window.get()).not.toBeNull();
      expect(visibility).toEqual([true]);
    });

    it('hides a visible overlay and says so', async () => {
      const { window, visibility } = hud();
      await window.setVisible(true);
      const win = created(window);

      await window.setVisible(false);

      expect(win.isVisible()).toBe(false);
      expect(visibility).toEqual([true, false]);
    });

    it('stays quiet when hiding an overlay that is already hidden', async () => {
      const { window, visibility } = hud();
      await window.ensure();

      await window.setVisible(false);

      expect(visibility).toEqual([]);
    });
  });

  it('hides instead of closing while the app is not quitting', async () => {
    const { window, visibility } = hud(true);
    await window.setVisible(true);
    const win = created(window);

    win.close();

    expect(win.isDestroyed()).toBe(false);
    expect(win.isVisible()).toBe(false);
    expect(visibility).toEqual([true, false]);
  });

  it('really closes when the app is quitting', async () => {
    const { window } = hud(false);
    await window.ensure();
    const win = created(window);

    win.close();

    expect(win.isDestroyed()).toBe(true);
    expect(window.get()).toBeNull();
  });

  it('reopens where the user left it', async () => {
    const { window } = hud();
    await window.ensure();
    const first = created(window);

    first.setPosition(42, 64);
    first.emit('moved');
    first.destroy();

    await window.ensure();
    const second = created(window);

    expect(second.options).toMatchObject({ x: 42, y: 64 });
  });

  it('ignores a move event from a window that is gone', async () => {
    const { window } = hud();
    await window.ensure();
    const first = created(window);
    first.destroy();

    first.emit('moved');
    await window.ensure();

    const second = created(window);
    expect(second.options).toMatchObject({ x: 1280 - (HUD_WINDOW_WIDTH + 20), y: 100 });
  });
});
