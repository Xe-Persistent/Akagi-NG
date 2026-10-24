import { createLogger } from '../../logging/index.js';
import { broadcastToWindows } from '../../shared/broadcast.js';
import { MAHJONG } from '../../shared/schema/mahjong.js';
import type { MJAIEvent, StartGameEvent } from '../../shared/schema/mjai.js';
import { engineStatus, type InferenceSource } from '../engine-status.js';
import { CloudDecisionService } from '../online/cloud-decision.js';
import { DEFAULT_BASE_URL } from '../online/inference-client.js';
import { KyokuStream } from '../online/kyoku-stream.js';
import { readApiKey } from '../online/secret-store.js';
import type { OnlineConfig } from '../online/types.js';
import { getSettingsManager } from '../settings-manager.js';
import { ModelRunner } from './model-runner.js';
import type { EngineDecision, RecommendationData } from './recommendation-mapper.js';
import {
  describeAction,
  describeRecommendation,
  mapDecisionToRecommendations,
} from './recommendation-mapper.js';
import { RoundState } from './round-state.js';

const logger = createLogger('EngineService');

/**
 * Turns the mjai event stream of a captured game into HUD recommendations: it
 * owns the model runner, knows when the local player has to act, and publishes
 * everything the renderer needs. Under `--mock` it stays out of the way, because
 * `services/mock/stream` owns the HUD for as long as it runs.
 *
 * The local engine is always in the loop. When online inference is configured it
 * acts as the gate (no call without a real choice) and as the fallback; the
 * online service only replaces the answer, never the pipeline.
 */
export class EngineService {
  private readonly runner = new ModelRunner();
  private readonly stream = new KyokuStream();
  private readonly round = new RoundState();
  private readonly cloud = new CloudDecisionService({ getConfig: () => this.onlineConfig() });

  /**
   * Batches are serialized: the capture layer does not await `ingest`, and an
   * online decision can occupy the full react timeout. Without this, a later
   * frame would feed the engine while the previous decision is still in flight.
   */
  private queue: Promise<void> = Promise.resolve();

  private isMockMode = false;
  private playerId = -1;
  private is3p = false;

  /** Lets the mock stream own the HUD, used by `npm run dev:mock`. */
  public setMockMode(enabled: boolean) {
    this.isMockMode = enabled;
  }

  /**
   * Feeds a batch of mjai events (already converted from the game protocol) into
   * the engine and answers at decision points.
   *
   * @param replayed - the batch is a restore's history: everything but its last
   * event describes a position the game has already left
   * @param seat - our seat, when the batch's frame established it (`authGame`);
   * mjai carries it beside the events rather than in them
   */
  public ingest(events: MJAIEvent[], replayed = false, seat?: number): Promise<void> {
    const run = this.queue.then(() => this.ingestBatch(events, replayed, seat));
    // Keep the chain alive after a failure; the caller still sees it.
    this.queue = run.catch(() => {});
    return run;
  }

  private async ingestBatch(events: MJAIEvent[], replayed: boolean, seat?: number): Promise<void> {
    // The mock stream publishes on its own; a captured game interleaving with it
    // would make the HUD flicker between two sources. No model is loaded either.
    if (this.isMockMode) return;

    if (seat !== undefined) this.playerId = seat;

    // Only the end of a replay is the state the table is in now; reacting to the
    // rest would broadcast one stale recommendation per historical decision.
    const liveFrom = replayed ? events.length - 1 : 0;

    for (const [index, ev] of events.entries()) {
      // One update keeps the hand, the claim window, the last drawn and
      // claimed tiles, and the round flags in step.
      this.round.update(ev, this.playerId);
      // The window accumulates even while online inference is off, so it can be
      // enabled mid-kyoku and upload the round so far.
      this.stream.accumulate(ev);

      if (ev.type === 'start_game') {
        await this.startGame(ev);
      } else {
        this.feed(ev);
      }

      if (index >= liveFrom && this.isDecisionPoint(ev)) {
        await this.react();
      }
    }
  }

  public stop() {
    this.cloud.cancel();
    this.stream.reset();
    this.round.reset();
    this.runner.reset();
    // Nothing is known about a table we are no longer watching, so the next
    // decision cannot be attributed to the seat or player count of the last one.
    this.playerId = -1;
    this.is3p = false;
    engineStatus.reset();
  }

  // ===== Connection lifecycle, reported by the capture layer =====

  public clientConnected() {
    engineStatus.set({ connection: 'connected', inference: this.inferenceSource() });
  }

  /**
   * Re-reads which model answers, for the edits that change it without a new
   * game: the online switch and the stored key.
   */
  public refreshInferenceSource() {
    engineStatus.set({ inference: this.inferenceSource() });
  }

  public gameDisconnected(gameEnded: boolean) {
    this.cloud.cancel();
    engineStatus.set({ connection: 'idle' });
    engineStatus.notice(gameEnded ? 'left_game' : 'game_disconnected');
  }

  // ===== Engine =====

  private async startGame(start: StartGameEvent) {
    const is3p = start.num_players === MAHJONG.SEATS_3P;
    this.is3p = is3p;
    // A new game invalidates any answer still in flight for the previous one.
    this.cloud.cancel();

    engineStatus.set({ model: 'loading' });
    const outcome = await this.runner.load(this.playerId, is3p);

    switch (outcome.status) {
      case 'missing':
        logger.error('Local model not found at path:', outcome.modelPath);
        engineStatus.set({ model: 'failed' });
        return;
      case 'failed':
        logger.error('Failed to initialize the local engine:', outcome.error);
        engineStatus.set({ model: 'failed' });
        return;
      case 'loaded':
        logger.info(`Loaded model ${outcome.modelName} (${is3p ? '3p' : '4p'})`);
        engineStatus.set({
          model: 'ready',
          modelName: outcome.modelName,
          inference: this.inferenceSource(),
        });
        break;
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
    if (this.round.won) return false;
    if (ev.type === 'tsumo' && ev.actor === this.playerId) return true;
    if (ev.type === 'dahai' && ev.actor !== this.playerId) return true;
    // A chi/pon leaves us on turn with no draw, so the discard has to be
    // recommended right away; no later event triggers it. Another seat's call is
    // not our turn — nothing of ours is legal while they hold the table.
    if ((ev.type === 'chi' || ev.type === 'pon') && ev.actor === this.playerId) return true;
    // Either seat: another's kakan opens the chankan window, our own is followed
    // by the replacement draw.
    if (ev.type === 'kakan') return true;
    // Either seat, for the same reason: another's nukidora is the 胡抜北 window,
    // our own draws the replacement tile.
    if (ev.type === 'kita') return true;
    return false;
  }

  private onlineConfig(): OnlineConfig {
    const settings = getSettingsManager().getSettings();
    return {
      enabled: settings.ot.online,
      // The endpoint is ours to decide, not the file's: the key must never be
      // sent to a host someone edited into `settings.json`.
      baseUrl: DEFAULT_BASE_URL,
      apiKey: readApiKey(),
      model4p: settings.ot.model_4p,
      model3p: settings.ot.model_3p,
      reactTimeoutMs: settings.ot.react_timeout_ms,
    };
  }

  /**
   * The source that will answer the next decision, under the same rule
   * `onlineConfig` applies: MJOT needs the switch on *and* a stored key,
   * otherwise the built-in model is what the HUD will show.
   */
  private inferenceSource(): InferenceSource {
    const config = this.onlineConfig();
    return config.enabled && config.apiKey ? 'mjot' : 'local';
  }

  private async react() {
    const payload = await this.buildPayload();
    // No decision at all means there is nothing to say, and a cancelled request
    // must not publish a stale row; the previous frame stays as it was.
    if (!payload) return;

    // What the HUD is about to show, so a capture says what was recommended
    // and not only what the table did.
    logger.debug(`HUD: ${payload.recommendations.map(describeRecommendation).join(' ')}`);
    broadcastToWindows('engine:recommendations', payload);
  }

  private async buildPayload(): Promise<RecommendationData | null> {
    if (!this.runner.loaded) return null;

    let decision: EngineDecision | null;
    try {
      decision = this.runner.decide();
    } catch (err) {
      logger.error('Engine inference failed:', err);
      engineStatus.notice('runtime_error');
      return null;
    }
    if (!decision) return null;

    // The engine's own answer, including the candidates it ranked below the
    // published row, so a capture shows what it thought at every decision.
    logger.debug(
      `Decision:${decision.forced ? ' (forced)' : ''} ${decision.candidates
        .map(([action, confidence]) => `${describeAction(action)}@${confidence.toFixed(2)}`)
        .join(' ')}${decision.riichi_lookahead?.length ? ' +lookahead' : ''}`,
    );

    // A single legal action is not a choice. riichienv narrows a hand in riichi
    // to the tile just drawn, so those turns are forced: nothing to recommend,
    // no online call to spend, and the HUD keeps what it showed rather than a
    // row nobody can act on.
    if (decision.forced) return null;

    const localPayload = this.toPayload(decision, 'local', false, false, null);

    const config = this.onlineConfig();
    if (!config.enabled || !config.apiKey) return localPayload;

    const events = this.stream.buildApiEvents(this.playerId, this.is3p);
    if (!events) {
      // Mid-round start, or a stream that never reset: uploading a partial
      // window looks like a desync to the service.
      logger.debug('Online inference skipped: the kyoku window is incomplete');
      return localPayload;
    }

    const outcome = await this.cloud.decide({
      events,
      seat: this.playerId,
      is3p: this.is3p,
      // A coarse `pon`/`chi_low`/`kan` only names the call; the tiles behind it
      // come from our hand, so the HUD can draw the combination it means.
      resolveCall: (label) => this.round.resolveCall(label),
      // A bare `hora` needs the seat it would win from to read as a ron.
      winTarget: this.round.winTarget() ?? undefined,
    });

    switch (outcome.kind) {
      case 'cancelled':
        // Stopped, disconnected or restarted: the answer is stale.
        return null;
      case 'cloud':
        return this.toPayload(outcome.decision, 'mjot', false, false, outcome.model);
      case 'local':
        return {
          ...localPayload,
          fallback_used: outcome.fallbackUsed,
          circuit_open: outcome.circuitOpen,
        };
    }
  }

  private toPayload(
    decision: EngineDecision,
    engine_type: 'mjot' | 'local',
    fallback_used: boolean,
    circuit_open: boolean,
    model: string | null,
  ): RecommendationData {
    return {
      recommendations: mapDecisionToRecommendations(decision, {
        playerId: this.playerId,
        lastDrawnTile: this.round.lastDrawn,
        lastDiscardTile: this.round.lastDiscard,
      }),
      engine_type,
      fallback_used,
      circuit_open,
      ...(model ? { model } : {}),
    };
  }
}
