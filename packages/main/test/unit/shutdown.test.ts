import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShutdownCoordinator } from '../../src/app/shutdown.js';
import type { WindowManager } from '../../src/app/window-manager.js';
import type { MitmProxyManager } from '../../src/services/capture/mitm-proxy.js';
import type { EngineService } from '../../src/services/engine/engine-service.js';
import {
  EXIT_ANIMATION_FADE_MS,
  EXIT_ANIMATION_HOLD_MS,
  EXIT_ANIMATION_SLACK_MS,
} from '../../src/shared/constants.js';
import { app, emitIpcMain, resetIpcListeners } from '../electron-stub.js';

interface WindowHarness {
  window: BrowserWindow;
  sent: { channel: string; payload: unknown }[];
  hidden: number;
  opacities: number[];
}

function createWindow(
  options: { id?: number; visible?: boolean; minimized?: boolean } = {},
): WindowHarness {
  const { id = 1, visible = true, minimized = false } = options;
  const harness: WindowHarness = {
    window: null as unknown as BrowserWindow,
    sent: [],
    hidden: 0,
    opacities: [],
  };

  harness.window = {
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => minimized,
    webContents: {
      id,
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => harness.sent.push({ channel, payload }),
    },
    getOpacity: () => 1,
    setOpacity: (value: number) => harness.opacities.push(value),
    hide: () => {
      harness.hidden += 1;
    },
  } as unknown as BrowserWindow;

  return harness;
}

function createWindowManager(
  dashboard: BrowserWindow | null,
  secondary: { game?: BrowserWindow; hud?: BrowserWindow } = {},
): WindowManager {
  return {
    setQuitting: vi.fn(),
    getMainWindow: () => dashboard,
    getGameWindow: () => secondary.game ?? null,
    getHudWindow: () => secondary.hud ?? null,
  } as unknown as WindowManager;
}

function createServices() {
  return {
    engine: { stop: vi.fn() } as unknown as EngineService,
    mitm: { stop: vi.fn().mockResolvedValue(undefined) } as unknown as MitmProxyManager,
  };
}

describe('ShutdownCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetIpcListeners();
    vi.spyOn(app, 'quit').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends the timing, waits for the acknowledgement and quits once', async () => {
    const dashboard = createWindow();
    const { engine, mitm } = createServices();
    const coordinator = new ShutdownCoordinator(
      createWindowManager(dashboard.window),
      engine,
      mitm,
    );

    const shutdown = coordinator.begin();

    expect(dashboard.sent).toEqual([
      {
        channel: 'exit-animation-start',
        payload: { fadeMs: EXIT_ANIMATION_FADE_MS, holdMs: EXIT_ANIMATION_HOLD_MS },
      },
    ]);

    emitIpcMain('exit-animation-complete', { sender: { id: 1 } });
    await shutdown;

    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(engine.stop).toHaveBeenCalledTimes(1);
  });

  it('joins a second quit instead of animating twice', async () => {
    const dashboard = createWindow();
    const { engine, mitm } = createServices();
    const coordinator = new ShutdownCoordinator(
      createWindowManager(dashboard.window),
      engine,
      mitm,
    );

    const first = coordinator.begin();
    const second = coordinator.begin();

    emitIpcMain('exit-animation-complete', { sender: { id: 1 } });
    await Promise.all([first, second]);

    expect(dashboard.sent).toHaveLength(1);
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it('quits when the renderer never acknowledges', async () => {
    const dashboard = createWindow();
    const { engine, mitm } = createServices();
    const coordinator = new ShutdownCoordinator(
      createWindowManager(dashboard.window),
      engine,
      mitm,
    );

    const shutdown = coordinator.begin();
    await vi.advanceTimersByTimeAsync(
      EXIT_ANIMATION_FADE_MS + EXIT_ANIMATION_HOLD_MS + EXIT_ANIMATION_SLACK_MS,
    );
    await shutdown;

    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it('skips the animation when the dashboard is hidden', async () => {
    const dashboard = createWindow({ visible: false });
    const { engine, mitm } = createServices();
    const coordinator = new ShutdownCoordinator(
      createWindowManager(dashboard.window),
      engine,
      mitm,
    );

    await coordinator.begin();

    expect(dashboard.sent).toHaveLength(0);
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it('fades and hides the HUD and the game window', async () => {
    const dashboard = createWindow();
    const game = createWindow({ id: 2 });
    const hud = createWindow({ id: 3 });
    const { engine, mitm } = createServices();
    const coordinator = new ShutdownCoordinator(
      createWindowManager(dashboard.window, { game: game.window, hud: hud.window }),
      engine,
      mitm,
    );

    const shutdown = coordinator.begin();
    emitIpcMain('exit-animation-complete', { sender: { id: 1 } });
    await vi.advanceTimersByTimeAsync(EXIT_ANIMATION_FADE_MS);
    await shutdown;

    expect(game.hidden).toBe(1);
    expect(hud.hidden).toBe(1);
    expect(game.opacities.at(-1)).toBe(1);
    expect(hud.opacities.at(-1)).toBe(1);
  });
});
