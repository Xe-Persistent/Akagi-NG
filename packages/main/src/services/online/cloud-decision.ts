import { createLogger } from '../../logging/index.js';
import { MAHJONG } from '../../shared/schema/mahjong.js';
import type {
  EngineAction,
  EngineDecision,
  RiichiLookaheadCandidate,
} from '../engine/recommendation-mapper.js';
import { InferenceClient, InferenceError } from './inference-client.js';
import type { OnlineConfig, ReactCandidate, ReactResponse } from './types.js';

const logger = createLogger('Online');

/** First backoff after a failed call: roughly one turn. */
const BREAKER_BASE_MS = 5_000;
/** A server that has been down for two minutes is retried every two minutes. */
const BREAKER_MAX_MS = 120_000;
/** A reach's second call is milliseconds after the first; a 429 here is a burst. */
const REACH_RETRY_FALLBACK_MS = 400;
const REACH_RETRY_MAX_MS = 1_000;

export type CloudFallbackReason =
  'disabled' | 'breaker-open' | 'request-failed' | 'null-reaction' | 'reach-failed' | 'unmappable';

/** The discard a reach will declare with, plus the model's own tile ranking. */
interface ReachResolution {
  discard: string;
  lookahead: RiichiLookaheadCandidate[];
}

/** What the decision path did: a cloud answer, a local fallback, or nothing. */
export type CloudDecisionResult =
  | { kind: 'cloud'; decision: EngineDecision; model: string | null }
  | { kind: 'local'; reason: CloudFallbackReason; fallbackUsed: boolean; circuitOpen: boolean }
  | { kind: 'cancelled' };

export interface CloudDecisionInput {
  /** The shaped per-kyoku stream; `events[last]` is the decision point. */
  events: unknown[];
  seat: number;
  is3p: boolean;
  /**
   * Names the tiles behind a coarse top-k call label (`pon`, `chi_low`, `kan`).
   * Without it those rows reach the HUD as a bare label.
   */
  resolveCall?: (label: string) => EngineAction[];
  /**
   * The losing seat when a win is allowed at this decision point: our own seat
   * for a tsumo, the discarder for a ron. Absent means nobody can win here.
   * Without it a bare `hora` label cannot say which win it means.
   */
  winTarget?: number;
}

interface CloudDecisionDeps {
  /** Re-read at every decision, so mid-game edits apply to the next move. */
  getConfig: () => OnlineConfig;
  createClient?: (config: OnlineConfig) => InferenceClient;
  now?: () => number;
}

/**
 * Decisions come from the online service when it is configured and healthy, and
 * from the local engine otherwise. The local model is never replaced: it gates
 * every call (no call without a real choice to make) and supplies the fallback.
 *
 * Failure policy, taken from the upstream implementation's production behaviour:
 * - a transport/HTTP error opens an exponential breaker (5s → 120s);
 * - a null reaction means the server and our stream disagree: play locally and
 *   keep the breaker healthy, because the server *was* reachable;
 * - a reach needs a second call for the discard; if that call fails the whole
 *   cloud answer is dropped rather than mixing a cloud declaration with a local
 *   discard, and a burst 429 there does not open the breaker.
 */
export class CloudDecisionService {
  private readonly getConfig: () => OnlineConfig;
  private readonly createClient: (config: OnlineConfig) => InferenceClient;
  private readonly now: () => number;

  private client: InferenceClient | null = null;
  private appliedSignature = '';
  private failures = 0;
  private retryAt = 0;
  private generation = 0;
  private inFlight: AbortController | null = null;

  public constructor(deps: CloudDecisionDeps) {
    this.getConfig = deps.getConfig;
    this.createClient =
      deps.createClient ??
      ((config) =>
        new InferenceClient({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          reactTimeoutMs: config.reactTimeoutMs,
        }));
    this.now = deps.now ?? Date.now;
  }

  /** True while the breaker is holding calls back. */
  public get circuitOpen(): boolean {
    return !this.allowsCall();
  }

  /** A stop or a disconnect: the answer in flight is no longer worth waiting for. */
  public cancel(): void {
    this.generation += 1;
    this.inFlight?.abort();
    this.inFlight = null;
  }

  public async decide(input: CloudDecisionInput): Promise<CloudDecisionResult> {
    const config = this.getConfig();
    if (!isConfigured(config)) {
      this.dropClient();
      return local('disabled');
    }

    const client = this.reconcile(config);
    if (!this.allowsCall()) {
      return local('breaker-open', true, true);
    }

    const generation = this.generation;
    const controller = new AbortController();
    this.inFlight = controller;
    const model = (input.is3p ? config.model3p : config.model4p).trim();
    const startedAt = this.now();

    try {
      const response = await client.react(model, input.seat, input.events, controller.signal);
      if (generation !== this.generation) return { kind: 'cancelled' };

      this.recordSuccess();
      logger.debug(
        `Cloud decision: model=${response.model ?? (model || 'default')} ` +
          `candidates=${response.candidates.length} (${this.now() - startedAt}ms)`,
      );

      return await this.resolveResponse(
        response,
        input,
        client,
        model,
        controller.signal,
        generation,
      );
    } catch (error) {
      if (generation !== this.generation) return { kind: 'cancelled' };
      if (error instanceof InferenceError && error.kind === 'cancelled') {
        return { kind: 'cancelled' };
      }
      const inference =
        error instanceof InferenceError
          ? error
          : new InferenceError('network', 'cloud decision failed');
      const backoff = this.recordFailure();
      logger.warn(
        `Online inference unavailable (${inference.message}); using the local model ` +
          `and skipping the service for ${Math.round(backoff / 1000)}s`,
      );
      return local('request-failed', true, true);
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
    }
  }

  private async resolveResponse(
    response: ReactResponse,
    input: CloudDecisionInput,
    client: InferenceClient,
    model: string,
    signal: AbortSignal,
    generation: number,
  ): Promise<CloudDecisionResult> {
    const reaction = response.reaction;
    if (!reaction) {
      // The server was reachable but sees no legal action while the local gate
      // does: the streams disagree. Never silently pass a real turn.
      logger.warn(
        'Cloud returned a null reaction where the local model can act; using the local model',
      );
      return local('null-reaction', true, false);
    }

    let reachDiscard: string | undefined;
    let reachLookahead: RiichiLookaheadCandidate[] = [];
    if (reaction.type === 'reach') {
      const resolved = await this.resolveReachDiscard(
        client,
        model,
        input.seat,
        input.events,
        signal,
      );
      if (generation !== this.generation) return { kind: 'cancelled' };
      if (!resolved) {
        logger.warn('Cloud reach had no discard; dropping the cloud answer for the local decision');
        return local('reach-failed', true, false);
      }
      reachDiscard = resolved.discard;
      reachLookahead = resolved.lookahead;
    }

    const decision = mapCloudDecision(reaction, response.candidates, {
      reachDiscard,
      resolveCall: input.resolveCall,
      winTarget: input.winTarget,
    });
    if (!decision) {
      logger.warn(
        `Cannot map the cloud reaction (type=${String(reaction.type)}); using the local model`,
      );
      return local('unmappable', true, false);
    }
    // The declaration-tile candidates are the online model's own ranking, taken
    // from the follow-up call. A local lookahead would be a different model's
    // opinion and must never stand in for it.
    if (reachLookahead.length > 0) decision.riichi_lookahead = reachLookahead;
    return { kind: 'cloud', decision, model: response.model ?? (model || null) };
  }

  /**
   * A bare `reach` asks for a second decision: append the declaration and ask
   * again for the discard. The same answer's top-k ranks every declaration tile
   * the model considered, which is exactly the candidate row the HUD shows under
   * `reach` — the online model's own, not a local stand-in.
   *
   * A burst 429 here gets one short retry and never opens the breaker — the
   * server is reachable, just rate limiting.
   */
  private async resolveReachDiscard(
    client: InferenceClient,
    model: string,
    seat: number,
    events: unknown[],
    signal: AbortSignal,
  ): Promise<ReachResolution | null> {
    const followUp = [...events, { type: 'reach', actor: seat }];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await client.react(model, seat, followUp, signal);
        this.recordSuccess();
        const reaction = response.reaction;
        if (reaction?.type !== 'dahai' || typeof reaction.pai !== 'string') return null;
        return { discard: reaction.pai, lookahead: declarationTiles(response.candidates) };
      } catch (error) {
        const inference =
          error instanceof InferenceError
            ? error
            : new InferenceError('network', 'reach follow-up failed');
        if (signal.aborted) return null;
        if (inference.status === 429) {
          if (attempt > 0) return null;
          await pause(retryDelay(inference.retryAfterMs), signal);
          continue;
        }
        this.recordFailure();
        return null;
      }
    }
    return null;
  }

  /** Rebuild the client only when the transport-relevant settings changed. */
  private reconcile(config: OnlineConfig): InferenceClient {
    const signature = `${config.baseUrl}|${config.apiKey}|${config.reactTimeoutMs}`;
    if (this.client && this.appliedSignature === signature) return this.client;

    this.client = this.createClient(config);
    this.appliedSignature = signature;
    // Editing the settings is an explicit "try again now".
    this.recordSuccess();
    logger.info(
      `Online inference configured: ${this.client.host}, ` +
        `timeout ${this.client.reactTimeoutMs}ms, key ***${config.apiKey.slice(-4) || '----'}`,
    );
    return this.client;
  }

  private dropClient(): void {
    if (!this.client) return;
    this.client = null;
    this.appliedSignature = '';
    this.recordSuccess();
    logger.info('Online inference disabled, using the local model.');
  }

  private allowsCall(): boolean {
    return this.now() >= this.retryAt;
  }

  private recordSuccess(): void {
    if (this.failures > 0) logger.info('Online inference restored.');
    this.failures = 0;
    this.retryAt = 0;
  }

  private recordFailure(): number {
    this.failures += 1;
    const backoff = Math.min(BREAKER_BASE_MS * 2 ** (this.failures - 1), BREAKER_MAX_MS);
    this.retryAt = this.now() + backoff;
    return backoff;
  }
}

function isConfigured(config: OnlineConfig): boolean {
  return config.enabled && config.baseUrl.trim().length > 0 && config.apiKey.trim().length > 0;
}

function local(
  reason: CloudFallbackReason,
  fallbackUsed = false,
  circuitOpen = false,
): CloudDecisionResult {
  return { kind: 'local', reason, fallbackUsed, circuitOpen };
}

function retryDelay(retryAfterMs: number | null): number {
  // The null check is what narrows the type: `Number.isFinite` is not a guard.
  if (retryAfterMs === null || !Number.isFinite(retryAfterMs)) {
    return REACH_RETRY_FALLBACK_MS;
  }
  return Math.min(REACH_RETRY_MAX_MS, Math.max(0, retryAfterMs));
}

/** Sleep, but wake immediately when the request is cancelled. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

// ===== Reaction mapping =====

/** Everything a coarse reaction needs beyond the wire data to become a HUD row. */
export interface CloudMappingContext {
  /** The discard the follow-up call named, when the reaction is a reach. */
  reachDiscard?: string;
  /** Names the tiles behind a coarse top-k call label (`pon`, `chi_low`, `kan`). */
  resolveCall?: (label: string) => EngineAction[];
  /**
   * The losing seat when a win is allowed right now: our own seat for a tsumo,
   * the discarder for a ron. Absent means no win can be named here.
   */
  winTarget?: number;
}

/**
 * Map a cloud answer to the HUD's rows. `context` supplies what the top-k labels
 * leave out: the tiles a call takes and which win a `hora` means.
 */
export function mapCloudDecision(
  reaction: Record<string, unknown>,
  candidates: ReactCandidate[],
  context: CloudMappingContext = {},
): EngineDecision | null {
  const action = reactionToAction(reaction, context);
  if (!action) return null;

  const rows: [EngineAction, number][] = [[action, candidates[0]?.prob ?? 1]];
  const seen = new Set([signature(action)]);
  // A coarse label for the move the reaction already spelled out is the same
  // row, not a second, tile-less one.
  const covered = new Set(hasDetail(action) ? [action.type] : []);

  for (const candidate of candidates.slice(1)) {
    for (const mapped of actionsFor(candidate.action, context)) {
      if (!hasDetail(mapped) && covered.has(mapped.type)) continue;
      const key = signature(mapped);
      if (seen.has(key)) continue;
      seen.add(key);
      if (hasDetail(mapped)) covered.add(mapped.type);
      rows.push([mapped, candidate.prob]);
    }
  }

  return { action, candidates: rows, logits: [], forced: false };
}

/** A coarse label resolved into everything it can mean, or the bare mapping. */
function actionsFor(label: string, context: CloudMappingContext): EngineAction[] {
  const resolved = context.resolveCall?.(label) ?? [];
  if (resolved.length > 0) return resolved;

  const mapped = coarseToAction(label, context.winTarget);
  return mapped ? [mapped] : [];
}

/**
 * The declaration tiles ranked by the model that answered the reach. After the
 * declaration the only meaningful choice is which tile to discard, so the
 * follow-up's top-k is the candidate row for the reach: `dahai:<tile>` labels
 * only, best first.
 */
function declarationTiles(candidates: ReactCandidate[]): RiichiLookaheadCandidate[] {
  const seen = new Set<string>();
  const tiles: RiichiLookaheadCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate.action.startsWith('dahai:')) continue;
    const pai = candidate.action.slice('dahai:'.length);
    if (!pai || seen.has(pai)) continue;
    seen.add(pai);
    tiles.push({ pai, prob: candidate.prob });
  }
  return tiles;
}

function reactionToAction(
  reaction: Record<string, unknown>,
  context: CloudMappingContext,
): EngineAction | null {
  const pai = typeof reaction.pai === 'string' ? reaction.pai : '';
  const consumed = stringList(reaction.consumed);

  switch (reaction.type) {
    case 'dahai':
      return pai ? { type: 'dahai', pai } : null;
    case 'reach':
      // The discard is the second decision; without it a reach stalls autoplay.
      return context.reachDiscard ? { type: 'reach', pai: context.reachDiscard } : null;
    case 'pon':
    case 'chi':
    case 'daiminkan':
      return pai ? { type: reaction.type, pai, consumed } : null;
    case 'ankan':
      return consumed.length > 0 ? { type: 'ankan', consumed } : null;
    case 'kakan':
      return pai ? { type: 'kakan', pai, consumed } : null;
    case 'hora': {
      // A reaction normally names the loser. When it does not, only the decision
      // point can: without a win target the reaction cannot be labelled, so it
      // is dropped rather than guessed into a self-draw.
      const target = typeof reaction.target === 'number' ? reaction.target : context.winTarget;
      return typeof target === 'number' ? { type: 'hora', target } : null;
    }
    case 'ryukyoku':
      return { type: 'kyushu' };
    case 'kita':
    case 'nukidora':
      return { type: 'kita' };
    case 'none':
      return { type: 'pass' };
    default:
      return null;
  }
}

/**
 * Map a coarse top-k label. `hora` needs a target to say tsumo or ron; the
 * decision point supplies one (our draw, or the seat whose tile we would take),
 * so the row is only mapped when that context exists.
 */
function coarseToAction(action: string, winTarget?: number): EngineAction | null {
  if (action.startsWith('dahai:')) {
    const pai = action.slice('dahai:'.length);
    return pai ? { type: 'dahai', pai } : null;
  }

  switch (action) {
    case 'reach':
      return { type: 'reach' };
    case 'pon':
      return { type: 'pon' };
    case 'chi_low':
    case 'chi_mid':
    case 'chi_high':
      return { type: 'chi' };
    case 'kan':
      return { type: 'daiminkan' };
    case 'hora':
      return typeof winTarget === 'number' ? { type: 'hora', target: winTarget } : null;
    case 'ryukyoku':
      return { type: 'kyushu' };
    case 'nukidora':
    case 'kita':
      return { type: 'kita' };
    case 'none':
      return { type: 'pass' };
    default:
      return null;
  }
}

/**
 * One row per action the HUD can show. A discard is identified by its tile and
 * a call by the tiles it takes, so two kans — or a resolved `pon` and the
 * reaction's `pon 5s` — stay distinct rows instead of collapsing into one.
 * Red fives are compared by their base tile: the same call is the same row.
 */
function signature(action: EngineAction): string {
  if (action.type === 'dahai') return `dahai:${action.pai ?? ''}`;
  if (action.consumed?.length) {
    const tiles = [action.pai ?? '', ...action.consumed]
      .map((tile) => tile.replace(MAHJONG.RED_FIVE_SUFFIX, ''))
      .sort()
      .join('');
    return `${action.type}:${tiles}`;
  }
  return action.type;
}

/** Whether the row spells out the tiles it takes, not just the action kind. */
function hasDetail(action: EngineAction): boolean {
  return action.type === 'dahai' || (action.consumed?.length ?? 0) > 0;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}
