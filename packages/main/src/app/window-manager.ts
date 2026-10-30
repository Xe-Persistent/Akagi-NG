import type { BrowserWindow, Tray } from 'electron';

import type { EngineService } from '../services/engine/engine-service.js';
import { safeSend } from '../shared/utils.js';
import { setupTray } from './tray.js';
import { DashboardWindow } from './windows/dashboard-window.js';
import type { GameLaunchResult, GameWindowOptions } from './windows/game-launch.js';
import { GameWindow } from './windows/game-window.js';
import { HudWindow } from './windows/hud-window.js';

/**
 * Owns the application windows and the tray. Each window keeps its own creation
 * and event wiring; this class only coordinates them and exposes the handles the
 * IPC layer needs.
 */
export class WindowManager {
  private readonly dashboard: DashboardWindow;
  private readonly hud: HudWindow;
  private readonly game: GameWindow;
  private tray: Tray | null = null;
  private isQuitting = false;

  constructor(engine: EngineService) {
    const shouldHideOnClose = () => !this.isQuitting;

    this.dashboard = new DashboardWindow(shouldHideOnClose);
    this.hud = new HudWindow(shouldHideOnClose, (visible) =>
      safeSend(this.getMainWindow(), 'hud-visibility-changed', visible),
    );
    this.game = new GameWindow(engine);
  }

  public setQuitting(quitting: boolean) {
    this.isQuitting = quitting;
  }

  public getMainWindow(): BrowserWindow | null {
    return this.dashboard.get();
  }

  public getGameWindow(): BrowserWindow | null {
    return this.game.get();
  }

  public getHudWindow(): BrowserWindow | null {
    return this.hud.get();
  }

  public setupTray(onCheckForUpdates: () => void): void {
    if (this.tray) return;

    this.tray = setupTray({
      onToggleDashboard: () => this.dashboard.toggle(),
      onShowDashboard: () => void this.dashboard.show(),
      onCheckForUpdates,
      onRequestQuit: () => {
        // The dashboard owns the shutdown confirmation dialog.
        void this.dashboard.show().then(() => safeSend(this.getMainWindow(), 'request-app-quit'));
      },
    });
  }

  public async createDashboardWindow(): Promise<void> {
    await this.dashboard.show();
    // Preload the overlay so showing it later is instant.
    await this.hud.ensure();
  }

  public async toggleHudWindow(show: boolean): Promise<void> {
    await this.hud.setVisible(show);
  }

  public async createGameWindow(options: GameWindowOptions): Promise<GameLaunchResult> {
    return this.game.open(options);
  }

  /** Re-points an open game window after the proxy settings changed. */
  public async syncGameWindowProxy(useMitm: boolean): Promise<void> {
    await this.game.syncProxy(useMitm);
  }
}
