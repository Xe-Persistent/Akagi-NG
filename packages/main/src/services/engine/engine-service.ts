import { createLogger } from '../../logging/index.js';
import { broadcastToWindows } from '../../shared/broadcast.js';
import type { AkagiEvent, StartGameEvent, SystemEvent } from '../../shared/schema/mjai.js';
import { NotificationCode } from '../../shared/schema/mjai.js';
import { ModelRunner } from './model-runner.js';
import { NotificationCenter } from './notifications.js';
import type { Recommendation } from './recommendation-mapper.js';
import { mapDecisionToRecommendations } from './recommendation-mapper.js';

const logger = createLogger('EngineService');

const MOCK_RECOMMENDATION: Recommendation = { action: '1m', tile: '1m', confidence: 0.99 };

/**
 * Turns the mjai event stream of a captured game into HUD recommendations and
 * notifications: it owns the model runner, knows when the local player has to
 * act, and publishes everything the renderer needs.
 */
export class EngineService {
  private readonly runner = new ModelRunner();
  private readonly notifications = new NotificationCenter();

  private isMockMode = false;
  private playerId = -1;
  private isReacting = false;
  /** Last tile contexts, used to decorate win recommendations. */
  private lastDrawnTile: string | null = null;
  private lastDiscardTile: string | null = null;

  /** Replaces inference with a canned recommendation, used by `npm run dev:mock`. */
  public setMockMode(enabled: boolean) {
    this.isMockMode = enabled;
  }

  /**
   * Feeds a batch of mjai events (already converted from the game protocol) into
   * the engine and answers at decision points.
   */
  public async ingest(events: AkagiEvent[]) {
    for (const ev of events) {
      if (ev.type === 'system_event') {
        this.notifications.forwardSystemEvent(ev as SystemEvent);
        continue;
      }

      this.trackTileContext(ev);

      if (ev.type === 'start_game') {
        await this.startGame(ev as StartGameEvent);
      } else {
        this.feed(ev);
      }

      if (this.isDecisionPoint(ev)) {
        this.react();
      }
    }
  }

  public stop() {
    this.runner.reset();
    this.notifications.clearAll();
  }

  // ===== Connection lifecycle, reported by the capture layer =====

  public clientConnected() {
    this.notifications.clear(NotificationCode.GAME_DISCONNECTED);
    this.notifications.show('success', NotificationCode.CLIENT_CONNECTED);
    this.publishStatus(true);
  }

  public gameDisconnected(gameEnded: boolean) {
    this.notifications.clear(NotificationCode.GAME_SYNCING);
    this.notifications.show(
      gameEnded ? 'info' : 'error',
      gameEnded ? NotificationCode.RETURN_LOBBY : NotificationCode.GAME_DISCONNECTED,
    );
    if (!gameEnded) {
      this.publishStatus(false);
    }
  }

  // ===== Engine =====

  private async startGame(start: StartGameEvent) {
    this.playerId = start.id;

    if (this.isMockMode) return;

    const outcome = await this.runner.load(start.id, start.is_3p);

    switch (outcome.status) {
      case 'missing':
        logger.error('Local model not found at path:', outcome.modelPath);
        this.notifications.show('error', NotificationCode.MODEL_LOAD_FAILED);
        return;
      case 'failed':
        logger.error('Failed to initialize the local engine:', outcome.error);
        this.notifications.show('error', NotificationCode.MODEL_LOAD_FAILED);
        return;
      default:
        logger.info(`Loaded model ${outcome.modelName} (${start.is_3p ? '3p' : '4p'})`);
        this.notifications.clear(NotificationCode.MODEL_LOAD_FAILED);
        this.notifications.show('success', NotificationCode.MODEL_LOADED_LOCAL);
        this.notifications.show('success', NotificationCode.GAME_CONNECTED);
    }

    // A fresh engine needs the game context only; there is nothing to replay.
    this.feed(start);
  }

  private feed(ev: AkagiEvent) {
    try {
      this.runner.feed(ev);
    } catch (err) {
      logger.error('Engine rejected event:', err);
      this.notifications.show('error', NotificationCode.BOT_RUNTIME_ERROR);
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

  private react() {
    if (this.isReacting) return;
    this.isReacting = true;

    try {
      const recommendations = this.buildRecommendations();
      if (recommendations.length === 0) return;

      broadcastToWindows('engine:recommendations', {
        recommendations,
        engine_type: this.runner.loaded || this.isMockMode ? 'local' : 'null',
      });
    } finally {
      this.isReacting = false;
    }
  }

  private buildRecommendations(): Recommendation[] {
    if (this.isMockMode) return [MOCK_RECOMMENDATION];
    if (!this.runner.loaded) return [];

    try {
      const decision = this.runner.decide();
      if (!decision) return [];

      return mapDecisionToRecommendations(decision, {
        playerId: this.playerId,
        lastDrawnTile: this.lastDrawnTile,
        lastDiscardTile: this.lastDiscardTile,
      });
    } catch (err) {
      logger.error('Engine inference failed:', err);
      this.notifications.show('error', NotificationCode.BOT_RUNTIME_ERROR);
      return [];
    }
  }

  private publishStatus(connected: boolean) {
    broadcastToWindows('engine:status', { status: connected ? 'connected' : 'disconnected' });
  }
}
