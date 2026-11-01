/**
 * The game window hosts remote content, so how it is opened decides what that
 * content can reach. The session hardening and the routing helpers have their
 * own concerns and are stubbed here; what this file holds down is the pairing
 * between the two capture modes and the routing, and the fact that a launch
 * cancelled by the user is not reported as a broken URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/capture/game-session.js', () => ({
  GAME_PARTITION: 'persist:game',
  hardenGameSession: vi.fn(),
  routeDirect: vi.fn(async () => {}),
  routeThroughMitmProxy: vi.fn(async () => {}),
}));

import { GameWindow } from '../../src/app/windows/game-window.js';
import {
  GAME_PARTITION,
  hardenGameSession,
  routeDirect,
  routeThroughMitmProxy,
} from '../../src/services/capture/game-session.js';
import type { EngineService } from '../../src/services/engine/engine-service.js';
import { BrowserWindow, type FakeBrowserWindow, nativeTheme } from '../electron-stub.js';

function engine(): EngineService {
  return {} as EngineService;
}

function created(window: GameWindow): FakeBrowserWindow {
  const opened = window.get();
  if (!opened) throw new Error('the game window was not created');
  return opened as unknown as FakeBrowserWindow;
}

describe('the game window', () => {
  let window: GameWindow;

  beforeEach(() => {
    BrowserWindow.resetInstances();
    vi.clearAllMocks();
    window = new GameWindow(engine());
  });

  afterEach(() => {
    nativeTheme.shouldUseDarkColors = false;
  });

  it('refuses to open without a url', async () => {
    await expect(window.open({})).resolves.toEqual({ ok: false, reason: 'url' });

    expect(BrowserWindow.getAllWindows()).toHaveLength(1);
    expect(window.get()).toBeNull();
  });

  it('focuses the window it already has instead of opening a second one', async () => {
    await window.open({ url: 'https://game.test/1/' });
    const first = created(window);

    await expect(window.open({ url: 'https://game.test/1/' })).resolves.toEqual({ ok: true });

    expect(BrowserWindow.getAllWindows()).toHaveLength(1);
    expect(first.callsTo('focus')).toHaveLength(1);
  });

  it('opens the game in its own persistent partition', async () => {
    await window.open({ url: 'https://game.test/1/' });
    const opened = created(window);

    expect(opened.options).toMatchObject({
      useContentSize: true,
      maximizable: true,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
    });
    expect(opened.options.webPreferences).toMatchObject({
      partition: GAME_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
    });
  });

  it('follows the system theme for the background', async () => {
    nativeTheme.shouldUseDarkColors = true;

    await window.open({ url: 'https://game.test/1/' });

    expect(created(window).options.backgroundColor).toBe('#18181b');
  });

  it('hardens the session before the page ever loads', async () => {
    await window.open({ url: 'https://game.test/1/' });

    expect(hardenGameSession).toHaveBeenCalledWith(created(window));
    const [loadUrl] = created(window).callsTo('loadURL');
    expect(loadUrl).toEqual(['https://game.test/1/']);
  });

  it('routes direct and attaches the debugger capture by default', async () => {
    await window.open({ url: 'https://game.test/1/' });
    const opened = created(window);

    expect(routeDirect).toHaveBeenCalledWith(opened);
    expect(routeThroughMitmProxy).not.toHaveBeenCalled();
    expect(opened.webContents.debugger.attachCalls).toEqual(['1.3']);
    expect(opened.webContents.debugger.commands).toContain('Network.enable');
  });

  it('routes through the proxy and leaves the debugger alone when mitm is on', async () => {
    await window.open({ url: 'https://game.test/1/', useMitm: true });
    const opened = created(window);

    expect(routeThroughMitmProxy).toHaveBeenCalledWith(opened);
    expect(routeDirect).not.toHaveBeenCalled();
    expect(opened.webContents.debugger.attachCalls).toEqual([]);
  });

  it('switches capture mode when the proxy settings change', async () => {
    await window.open({ url: 'https://game.test/1/' });
    const opened = created(window);

    await window.syncProxy(true);
    expect(routeThroughMitmProxy).toHaveBeenCalledWith(opened);
    // A detached handler never re-attaches: the two must not observe one socket.
    expect(opened.webContents.debugger.detachCalls).toBe(1);

    await window.syncProxy(false);
    expect(routeDirect).toHaveBeenCalledTimes(2);
    expect(opened.webContents.debugger.attachCalls).toEqual(['1.3', '1.3']);
  });

  it('does nothing to a proxy when there is no window', async () => {
    await window.syncProxy(true);
    await window.syncProxy(false);

    expect(routeThroughMitmProxy).not.toHaveBeenCalled();
    expect(routeDirect).not.toHaveBeenCalled();
  });

  describe('a launch that fails', () => {
    /**
     * Replaces the load with one that throws the given error, so the failure
     * path runs against a real window rather than a hand-built one.
     */
    async function loadFailingWith(
      error: Error & { code?: string },
      during?: (window: FakeBrowserWindow) => void,
    ) {
      const original = BrowserWindow.prototype.loadURL;
      BrowserWindow.prototype.loadURL = async function (this: FakeBrowserWindow) {
        during?.(this);
        throw error;
      };

      try {
        return await window.open({ url: 'https://game.test/1/' });
      } finally {
        BrowserWindow.prototype.loadURL = original;
      }
    }

    it('blames the proxy when the window could not reach it', async () => {
      const result = await loadFailingWith(
        Object.assign(new Error('tunnel failed'), { code: 'ERR_TUNNEL_CONNECTION_FAILED' }),
      );

      expect(result).toEqual({ ok: false, reason: 'proxy' });
      // A window that never reached the game is closed again, not left blank.
      expect(window.get()).toBeNull();
    });

    it('blames the url for anything else', async () => {
      const result = await loadFailingWith(
        Object.assign(new Error('no such host'), { code: 'ERR_NAME_NOT_RESOLVED' }),
      );

      expect(result).toEqual({ ok: false, reason: 'url' });
      expect(window.get()).toBeNull();
    });

    it('treats a window the user closed mid-load as no failure at all', async () => {
      const result = await loadFailingWith(
        Object.assign(new Error('aborted'), { code: 'ERR_FAILED' }),
        (opened) => opened.emit('close'),
      );

      expect(result).toEqual({ ok: true });
    });
  });

  it('denies popups to anything but http and https', async () => {
    await window.open({ url: 'https://game.test/1/' });
    const handler = created(window).webContents.windowOpenHandler;
    if (!handler) throw new Error('no window open handler was installed');

    expect(handler({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
    expect(handler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
    expect(handler({ url: 'https://login.test/oauth' })).toMatchObject({ action: 'allow' });
  });

  it('toggles fullscreen on F11 and swallows the key', async () => {
    await window.open({ url: 'https://game.test/1/' });
    const opened = created(window);
    const preventDefault = vi.fn();

    opened.webContents.emit(
      'before-input-event',
      { preventDefault },
      { type: 'keyDown', key: 'F11' },
    );
    expect(opened.isFullScreen()).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);

    opened.webContents.emit(
      'before-input-event',
      { preventDefault },
      { type: 'keyDown', key: 'F11' },
    );
    expect(opened.isFullScreen()).toBe(false);
  });

  it('leaves other keys alone', async () => {
    await window.open({ url: 'https://game.test/1/' });
    const opened = created(window);
    const preventDefault = vi.fn();

    opened.webContents.emit(
      'before-input-event',
      { preventDefault },
      { type: 'keyDown', key: 'F5' },
    );

    expect(preventDefault).not.toHaveBeenCalled();
    expect(opened.fullScreen).toBe(false);
  });
});
