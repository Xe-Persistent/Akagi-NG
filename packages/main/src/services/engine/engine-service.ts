import { createLogger } from '../../logging/index.js';
import { broadcastToWindows } from '../../shared/broadcast.js';
import type { MJAIEvent, StartGameEvent } from '../../shared/schema/mjai.js';
import { engineStatus } from '../engine-status.js';
import { ModelRunner } from './model-runner.js';
import type { Recommendation, RecommendationData } from './recommendation-mapper.js';
import { mapDecisionToRecommendations } from './recommendation-mapper.js';

const logger = createLogger('EngineService');

/**
 * Turns the mjai event stream of a captured game into HUD recommendations: it
 * owns the model runner, knows when the local player has to act, and publishes
 * everything the renderer needs. Under `--mock` it stays out of the way, because
 * `mock-stream` owns the HUD for as long as it runs.
 */
export class EngineService {
  private readonly runner = new ModelRunner();

  private isMockMode = false;
  private playerId = -1;
  private isReacting = false;
  /** True once our own declared riichi was accepted by the table. */
  private riichiAccepted = false;
  /** True once we have won the current round, which can happen before it ends. */
  private weWonThisRound = false;
  /** Last tile contexts, used to decorate win recommendations. */
  private lastDrawnTile: string | null = null;
  private lastDiscardTile: string | null = null;

  /** Lets the mock stream own the HUD, used by `npm run dev:mock`. */
  public setMockMode(enabled: boolean) {
    this.isMockMode = enabled;
  }

  /**
   * Feeds a batch of mjai events (already converted from the game protocol) into
   * the engine and answers at decision points.
   */
  public async ingest(events: MJAIEvent[]) {
    // The mock stream publishes on its own; a captured game interleaving with it
    // would make the HUD flicker between two sources. No model is loaded either.
    if (this.isMockMode) return;

    for (const ev of events) {
      this.trackTileContext(ev);
      this.trackRoundState(ev);

      if (ev.type === 'start_game') {
        await this.startGame(ev as StartGameEvent);
      } else {
        this.feed(ev);
      }

      // A reconnect replay feeds history back in: reacting to it would broadcast
      // one stale recommendation per historical decision point.
      if (ev.sync !== true && this.isDecisionPoint(ev)) {
        this.react();
      }
    }
  }

  public stop() {
    this.runner.reset();
    engineStatus.reset();
  }

  // ===== Connection lifecycle, reported by the capture layer =====

  public clientConnected() {
    engineStatus.set({ connection: 'connected' });
  }

  public gameDisconnected(gameEnded: boolean) {
    engineStatus.set({ connection: 'idle' });
    engineStatus.notice(gameEnded ? 'lobby_return' : 'game_dropped');
  }

  // ===== Engine =====

  private async startGame(start: StartGameEvent) {
    this.playerId = start.id;

    engineStatus.set({ model: 'loading' });
    const outcome = await this.runner.load(start.id, start.is_3p);

    switch (outcome.status) {
      case 'missing':
        logger.error('Local model not found at path:', outcome.modelPath);
        engineStatus.set({ model: 'failed' });
        return;
      case 'failed':
        logger.error('Failed to initialize the local engine:', outcome.error);
        engineStatus.set({ model: 'failed' });
        return;
      default:
        logger.info(`Loaded model ${outcome.modelName} (${start.is_3p ? '3p' : '4p'})`);
        engineStatus.set({ model: 'ready', modelName: outcome.modelName });
    }

    // A fresh engine needs the game context only; there is nothing to replay.
    this.feed(start);
  }

  private feed(ev: MJAIEvent) {
    try {
      this.runner.feed(ev);
    } catch (err) {
      logger.error('Engine rejected event:', err);
      engineStatus.notice('runtime_error');
    }
  }

  private isDecisionPoint(ev: MJAIEvent): boolean {
    // A won round is over for us: in xuezhan it carries on without us, and there
    // is nothing left to recommend with a hand that no longer gets drawn to.
    if (this.weWonThisRound) return false;
    if (ev.type === 'tsumo' && ev.actor === this.playerId) return true;
    if (ev.type === 'dahai' && ev.actor !== this.playerId) return true;
    // A chi/pon leaves us on turn with no draw, so the discard has to be
    // recommended right away; no later event triggers it.
    if (ev.type === 'chi' || ev.type === 'pon') return true;
    // Someone else's kakan can be robbed; after our own we draw and discard.
    if (ev.type === 'kakan' || ev.type === 'nukidora') return true;
    return false;
  }

  private trackTileContext(ev: MJAIEvent) {
    if (ev.type === 'tsumo' && ev.actor === this.playerId) {
      this.lastDrawnTile = (ev as { pai?: string }).pai ?? null;
    } else if (ev.type === 'dahai' && ev.actor !== this.playerId) {
      this.lastDiscardTile = (ev as { pai?: string }).pai ?? null;
    }
  }

  /** Flags that only describe the round in progress, so both reset on a new one. */
  private trackRoundState(ev: MJAIEvent) {
    if (ev.type === 'start_game' || ev.type === 'start_kyoku') {
      this.riichiAccepted = false;
      this.weWonThisRound = false;
    } else if (ev.type === 'reach_accepted' && ev.actor === this.playerId) {
      this.riichiAccepted = true;
    } else if (ev.type === 'hora' && ev.actor === this.playerId) {
      this.weWonThisRound = true;
    }
  }

  private react() {
    if (this.isReacting) return;
    this.isReacting = true;

    try {
      const recommendations = this.buildRecommendations();
      // No decision at all means there is nothing to say; an empty list is a
      // decision whose suggestions the HUD must not show, and it still has to be
      // published so the previous (now illegal) one disappears.
      if (!recommendations) return;

      const payload: RecommendationData = { recommendations };
      broadcastToWindows('engine:recommendations', payload);
    } finally {
      this.isReacting = false;
    }
  }

  private buildRecommendations(): Recommendation[] | null {
    if (!this.runner.loaded) return null;

    try {
      const decision = this.runner.decide();
      if (!decision) return null;

      return mapDecisionToRecommendations(decision, {
        playerId: this.playerId,
        lastDrawnTile: this.lastDrawnTile,
        lastDiscardTile: this.lastDiscardTile,
        riichiAccepted: this.riichiAccepted,
      });
    } catch (err) {
      logger.error('Engine inference failed:', err);
      engineStatus.notice('runtime_error');
      return null;
    }
  }
}
