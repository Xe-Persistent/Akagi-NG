import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AkagiEngine } from '@akagi-ng/rust-engine';
import { BrowserWindow } from 'electron';

import { createLogger } from '../logging/index.js';
import { BACKEND_READY_TIMEOUT_MS } from '../shared/constants.js';
import { getProjectRoot } from '../shared/paths.js';
import type { AkagiEvent, StartGameEvent, SystemEvent } from '../shared/schema/mjai.js';
import { NotificationCode } from '../shared/schema/mjai.js';
import type { EngineDecision, Recommendation } from './recommendation-mapper.js';
import { mapDecisionToRecommendations } from './recommendation-mapper.js';
import type { ResourceStatus } from './resource-validator.js';
import { ResourceValidator } from './resource-validator.js';
import { settingsManager } from './settings-manager.js';

const logger = createLogger('BackendManager');

type NotificationLevel = 'error' | 'warning' | 'info' | 'success';

interface NotificationItem {
  level: NotificationLevel;
  code: NotificationCode;
}

/** Notifications that describe a moment rather than an ongoing problem. */
const TRANSIENT_NOTIFICATIONS: Partial<Record<NotificationCode, number>> = {
  [NotificationCode.CLIENT_CONNECTED]: 5000,
  [NotificationCode.GAME_CONNECTED]: 5000,
  [NotificationCode.GAME_SYNCING]: 8000,
  [NotificationCode.MODEL_LOADED_LOCAL]: 5000,
  [NotificationCode.RETURN_LOBBY]: 5000,
  [NotificationCode.PARSE_ERROR]: 8000,
  [NotificationCode.BOT_RUNTIME_ERROR]: 10000,
};

const WARNING_NOTIFICATIONS = new Set<NotificationCode>([NotificationCode.PARSE_ERROR]);

export class BackendManager {
  private readonly validator: ResourceValidator;
  private isMockMode: boolean = false;

  private engine: AkagiEngine | null = null;
  private playerId: number = -1;
  private is3p: boolean = false;
  private isReacting: boolean = false;
  /** Last tile contexts, used to decorate win recommendations. */
  private lastDrawnTile: string | null = null;
  private lastDiscardTile: string | null = null;

  /** Active notifications, mirrored to the renderer as a complete list. */
  private readonly notifications = new Map<NotificationCode, NotificationItem>();
  private readonly notificationTimers = new Map<NotificationCode, NodeJS.Timeout>();

  constructor() {
    this.validator = new ResourceValidator(getProjectRoot());
  }

  public getMitmConfig(): { host: string; port: number } {
    const settings = settingsManager.getSettings();
    return {
      host: settings.mitm?.host ?? '127.0.0.1',
      port: settings.mitm?.port ?? 6789,
    };
  }

  public isRunning(): boolean {
    return true; // The engine is integrated directly, always "running"
  }

  public async getResourceStatus(): Promise<ResourceStatus> {
    return await this.validator.validate();
  }

  public start() {
    if (process.argv.includes('--mock')) {
      this.isMockMode = true;
    }
  }

  public async waitForReady(_timeoutMs: number = BACKEND_READY_TIMEOUT_MS): Promise<boolean> {
    return true; // The engine is integrated directly, nothing to wait for
  }

  public async stop() {
    this.engine = null;
    this.notificationTimers.forEach((timer) => clearTimeout(timer));
    this.notificationTimers.clear();
    this.notifications.clear();
  }

  /**
   * Feeds a batch of mjai events (already converted from the game protocol) into
   * the engine and answers at decision points.
   */
  public async ingest(events: AkagiEvent[]) {
    for (const ev of events) {
      if (ev.type === 'system_event') {
        this.forwardSystemEvent(ev as SystemEvent);
        continue;
      }

      this.trackTileContext(ev);

      if (ev.type === 'start_game') {
        await this.startGame(ev as StartGameEvent);
      } else {
        this.feedEngine(ev);
      }

      if (this.isDecisionPoint(ev)) {
        void this.react();
      }
    }
  }

  // ===== Connection lifecycle (called by the capture paths) =====

  public notifyClientConnected() {
    this.clearNotification(NotificationCode.GAME_DISCONNECTED);
    this.notify('success', NotificationCode.CLIENT_CONNECTED);
    this.broadcastStatus(true);
  }

  public notifyGameDisconnected(gameEnded: boolean) {
    this.clearNotification(NotificationCode.GAME_SYNCING);
    this.notify(
      gameEnded ? 'info' : 'error',
      gameEnded ? NotificationCode.RETURN_LOBBY : NotificationCode.GAME_DISCONNECTED,
    );
    if (!gameEnded) {
      this.broadcastStatus(false);
    }
  }

  // ===== Engine =====

  private async startGame(start: StartGameEvent) {
    this.playerId = start.id;
    this.is3p = start.is_3p;

    await this.loadEngine();

    // Replay is not needed: the engine is created from a fresh state, so only
    // the start_game context is handed over.
    this.feedEngine(start);
  }

  private async loadEngine() {
    this.engine = null;

    if (this.isMockMode) return;

    const settings = settingsManager.getSettings();
    const modelName = this.is3p ? settings.model_config.model_3p : settings.model_config.model_4p;
    const modelPath = join(getProjectRoot(), 'models', modelName);

    if (!existsSync(modelPath)) {
      logger.error('Local model not found at path:', modelPath);
      this.notify('error', NotificationCode.MODEL_LOAD_FAILED);
      return;
    }

    try {
      const modelBytes = readFileSync(modelPath);
      // The native binding is loaded lazily so a missing/unbuilt engine only
      // disables inference instead of crashing the whole application.
      const { AkagiEngine } = await import('@akagi-ng/rust-engine');
      this.engine = new AkagiEngine(modelBytes, this.is3p ? 3 : 4, this.playerId);
      logger.info(`Loaded model ${modelName} (${this.is3p ? '3p' : '4p'})`);

      this.clearNotification(NotificationCode.MODEL_LOAD_FAILED);
      this.notify('success', NotificationCode.MODEL_LOADED_LOCAL);
      this.notify('success', NotificationCode.GAME_CONNECTED);
    } catch (err) {
      logger.error('Failed to initialize the local engine:', err);
      this.notify('error', NotificationCode.MODEL_LOAD_FAILED);
    }
  }

  private feedEngine(ev: AkagiEvent) {
    if (!this.engine) return;

    try {
      const accepted = this.engine.feedLine(JSON.stringify(ev));
      if (!accepted) {
        logger.debug(`Engine ignored event: ${ev.type}`);
      }
    } catch (err) {
      logger.error('Engine rejected event:', err);
      this.notify('error', NotificationCode.BOT_RUNTIME_ERROR);
    }
  }

  private isDecisionPoint(ev: AkagiEvent): boolean {
    if (ev.type === 'tsumo' && ev.actor === this.playerId) return true;
    if (ev.type === 'dahai' && ev.actor !== this.playerId) return true;
    // A chi/pon leaves us on turn with no draw, so the discard has to be
    // recommended right away; no later event triggers it.
    if (ev.type === 'chi' || ev.type === 'pon') return true;
    // Someone else's kakan can be robbed; after our own we draw and discard.
    if (ev.type === 'kakan' || ev.type === 'nukidora') return true;
    return false;
  }

  private trackTileContext(ev: AkagiEvent) {
    if (ev.type === 'tsumo' && ev.actor === this.playerId) {
      this.lastDrawnTile = (ev as { pai?: string }).pai ?? null;
    } else if (ev.type === 'dahai' && ev.actor !== this.playerId) {
      this.lastDiscardTile = (ev as { pai?: string }).pai ?? null;
    }
  }

  private async react() {
    if (this.isReacting) return;
    this.isReacting = true;

    try {
      let recommendations: Recommendation[] = [];

      if (this.isMockMode) {
        recommendations = [{ action: '1m', tile: '1m', confidence: 0.99 }];
      } else if (this.engine) {
        const decision = this.decide();
        if (decision) {
          recommendations = mapDecisionToRecommendations(decision, {
            playerId: this.playerId,
            lastDrawnTile: this.lastDrawnTile,
            lastDiscardTile: this.lastDiscardTile,
          });
        }
      }

      if (recommendations.length > 0) {
        this.broadcast('backend:recommendations', {
          recommendations,
          engine_type: this.engine !== null || this.isMockMode ? 'local' : 'null',
        });
      }
    } finally {
      this.isReacting = false;
    }
  }

  private decide(): EngineDecision | null {
    if (!this.engine) return null;

    try {
      const decisionJson = this.engine.decide();
      return decisionJson ? (JSON.parse(decisionJson) as EngineDecision) : null;
    } catch (err) {
      logger.error('Engine inference failed:', err);
      this.notify('error', NotificationCode.BOT_RUNTIME_ERROR);
      return null;
    }
  }

  // ===== Notifications =====

  private forwardSystemEvent(ev: SystemEvent) {
    this.notify(WARNING_NOTIFICATIONS.has(ev.code) ? 'warning' : 'info', ev.code);
  }

  private notify(level: NotificationLevel, code: NotificationCode) {
    this.notifications.set(code, { level, code });

    const previousTimer = this.notificationTimers.get(code);
    if (previousTimer) clearTimeout(previousTimer);

    const transientMs = TRANSIENT_NOTIFICATIONS[code];
    if (transientMs !== undefined) {
      this.notificationTimers.set(
        code,
        setTimeout(() => this.clearNotification(code), transientMs),
      );
    }

    this.broadcastNotifications();
  }

  private clearNotification(code: NotificationCode) {
    const timer = this.notificationTimers.get(code);
    if (timer) {
      clearTimeout(timer);
      this.notificationTimers.delete(code);
    }

    if (!this.notifications.delete(code)) return;
    this.broadcastNotifications();
  }

  private broadcastNotifications() {
    this.broadcast('backend:notification', { list: [...this.notifications.values()] });
  }

  private broadcastStatus(connected: boolean) {
    this.broadcast('backend:status', { status: connected ? 'connected' : 'disconnected' });
  }

  private broadcast(channel: string, data: unknown) {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    });
  }
}
