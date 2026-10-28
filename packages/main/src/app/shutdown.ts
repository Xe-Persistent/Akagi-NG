import { app, type BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';

import { createLogger } from '../logging/index.js';
import type { MitmProxyManager } from '../services/capture/mitm-proxy.js';
import type { EngineService } from '../services/engine/engine-service.js';
import { stopMockStream } from '../services/mock/stream.js';
import {
  EXIT_ANIMATION_COMPLETE_CHANNEL,
  EXIT_ANIMATION_FADE_MS,
  EXIT_ANIMATION_HOLD_MS,
  EXIT_ANIMATION_SLACK_MS,
} from '../shared/constants.js';
import { isSafeWindow, safeSend } from '../shared/utils.js';
import type { WindowManager } from './window-manager.js';

const logger = createLogger('Shutdown');

/** What the dashboard needs to play the stopped screen. */
export interface ExitAnimationTiming {
  fadeMs: number;
  holdMs: number;
}

const EXIT_ANIMATION_TIMING: ExitAnimationTiming = {
  fadeMs: EXIT_ANIMATION_FADE_MS,
  holdMs: EXIT_ANIMATION_HOLD_MS,
};

/**
 * Runs the one shutdown sequence: play the stopped screen while the services
 * stop, then let Electron close the windows.
 *
 * Every quit path — the in-app button, the tray and the OS — reaches this class
 * through `before-quit`, so none of them can skip the animation or stop the
 * engine twice.
 */
export class ShutdownCoordinator {
  private shutdown: Promise<void> | null = null;
  private finished = false;

  constructor(
    private readonly windowManager: WindowManager,
    private readonly engine: EngineService,
    private readonly mitmProxy: MitmProxyManager,
  ) {}

  /** Whether the first quit attempt has already been allowed through. */
  public get isFinished(): boolean {
    return this.finished;
  }

  /**
   * Idempotent: a second quit request joins the first instead of starting a
   * second animation or a second service stop.
   */
  public begin(): Promise<void> {
    this.shutdown ??= this.run();
    return this.shutdown;
  }

  private async run(): Promise<void> {
    // Let the window close handlers through before the final `app.quit()`.
    this.windowManager.setQuitting(true);

    const dashboard = this.windowManager.getMainWindow();
    const animatedDashboard =
      isSafeWindow(dashboard) && dashboard.isVisible() && !dashboard.isMinimized()
        ? dashboard
        : null;

    try {
      await Promise.all([
        animatedDashboard ? this.playExitAnimation(animatedDashboard) : Promise.resolve(),
        this.fadeSecondaryWindows(),
        this.stopServices(),
      ]);
    } catch (error) {
      logger.error('Error during shutdown:', error);
    } finally {
      this.finished = true;
      logger.info('Shutdown complete.');
      // The second `before-quit` sees `isFinished` and lets Electron close.
      app.quit();
    }
  }

  private async playExitAnimation(dashboard: BrowserWindow): Promise<void> {
    const timing = EXIT_ANIMATION_TIMING;
    const totalMs = timing.fadeMs + timing.holdMs;

    // Subscribe before sending: the renderer's acknowledgement starts a full
    // fade + hold after it receives the event, but a zero-length timing would
    // otherwise race the listener registration.
    const acknowledged = waitForExitAck(dashboard, totalMs + EXIT_ANIMATION_SLACK_MS);

    safeSend(dashboard, 'exit-animation-start', timing);

    if (!(await acknowledged)) {
      logger.warn('Exit animation did not acknowledge in time; quitting anyway.');
    }
  }

  /** The HUD and the game window do not host the overlay; fade them natively. */
  private async fadeSecondaryWindows(): Promise<void> {
    const windows = [this.windowManager.getGameWindow(), this.windowManager.getHudWindow()];
    await Promise.all(windows.map((window) => fadeOutWindow(window, EXIT_ANIMATION_FADE_MS)));
  }

  private async stopServices(): Promise<void> {
    try {
      stopMockStream();
      await this.mitmProxy.stop();
      this.engine.stop();
    } catch (error) {
      logger.error('Error during shutdown:', error);
    }
  }
}

/** Resolves true when the dashboard reports the stopped screen is done. */
function waitForExitAck(dashboard: BrowserWindow, timeoutMs: number): Promise<boolean> {
  const senderId = dashboard.webContents.id;

  return new Promise((resolve) => {
    let settled = false;

    const finish = (acknowledged: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener(EXIT_ANIMATION_COMPLETE_CHANNEL, onAck);
      resolve(acknowledged);
    };

    const onAck = (event: IpcMainEvent) => {
      if (event.sender.id === senderId) finish(true);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    ipcMain.on(EXIT_ANIMATION_COMPLETE_CHANNEL, onAck);
  });
}

/**
 * Fades a window out over `durationMs`, then hides it. `setOpacity` is a no-op
 * on Linux, so the window still hides once the fade would have finished.
 */
async function fadeOutWindow(window: BrowserWindow | null, durationMs: number): Promise<void> {
  if (!isSafeWindow(window) || !window.isVisible()) return;

  if (durationMs <= 0) {
    window.hide();
    return;
  }

  const initialOpacity = window.getOpacity();
  const frames = Math.max(1, Math.ceil(durationMs / 16));
  const stepMs = durationMs / frames;
  let frame = 0;

  await new Promise<void>((resolve) => {
    const tick = () => {
      if (!isSafeWindow(window)) {
        resolve();
        return;
      }

      frame += 1;
      window.setOpacity(initialOpacity * (1 - Math.min(1, frame / frames)));

      if (frame < frames) {
        setTimeout(tick, stepMs);
        return;
      }

      window.hide();
      window.setOpacity(initialOpacity);
      resolve();
    };

    tick();
  });
}
