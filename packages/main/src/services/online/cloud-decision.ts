import { createLogger } from '../../logging/index.js';
import type { EngineAction, EngineDecision } from '../engine/recommendation-mapper.js';
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
  /** The local engine's answer: used as the gate and as the fallback. */
  local: EngineDecision;
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
      logger.verbose(
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

    let reachDiscard: string | null = null;
    if (reaction.type === 'reach') {
      reachDiscard = await this.resolveReachDiscard(
        client,
        model,
        input.seat,
        input.events,
        signal,
      );
      if (generation !== this.generation) return { kind: 'cancelled' };
      if (!reachDiscard) {
        logger.warn('Cloud reach had no discard; dropping the cloud answer for the local decision');
        return local('reach-failed', true, false);
      }
    }

    const decision = mapCloudDecision(reaction, response.candidates, input.seat, reachDiscard);
    if (!decision) {
      logger.warn(
        `Cannot map the cloud reaction (type=${String(reaction.type)}); using the local model`,
      );
      return local('unmappable', true, false);
    }
    return { kind: 'cloud', decision, model: response.model ?? (model || null) };
  }

  /**
   * A bare `reach` asks for a second decision: append the declaration and ask
   * again for the discard. A burst 429 gets one short retry and never opens the
   * breaker — the server is reachable, just rate limiting.
   */
  private async resolveReachDiscard(
    client: InferenceClient,
    model: string,
    seat: number,
    events: unknown[],
    signal: AbortSignal,
  ): Promise<string | null> {
    const followUp = [...events, { type: 'reach', actor: seat }];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await client.react(model, seat, followUp, signal);
        this.recordSuccess();
        const reaction = response.reaction;
        if (reaction?.type === 'dahai' && typeof reaction.pai === 'string') return reaction.pai;
        return null;
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
    logger.info('Online inference disabled; using the local model');
  }

  private allowsCall(): boolean {
    return this.now() >= this.retryAt;
  }

  private recordSuccess(): void {
    if (this.failures > 0) logger.info('Online inference restored');
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

/**
 * Turn the server's mjai reaction plus its coarse top-k into the same decision
 * shape the local engine produces, so the HUD mapper is shared by both paths.
 * `null` when the reaction cannot be represented (an unknown action type).
 */
export function mapCloudDecision(
  reaction: Record<string, unknown>,
  candidates: ReactCandidate[],
  seat: number,
  reachDiscard: string | null,
): EngineDecision | null {
  const action = reactionToAction(reaction, seat, reachDiscard);
  if (!action) return null;

  const rows: [EngineAction, number][] = [[action, candidates[0]?.prob ?? 1]];
  const seen = new Set([signature(action)]);
  for (const candidate of candidates.slice(1)) {
    const mapped = coarseToAction(candidate.action);
    if (!mapped) continue;
    const key = signature(mapped);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([mapped, candidate.prob]);
  }

  return { action, candidates: rows, logits: [] };
}

function reactionToAction(
  reaction: Record<string, unknown>,
  seat: number,
  reachDiscard: string | null,
): EngineAction | null {
  const pai = typeof reaction.pai === 'string' ? reaction.pai : '';
  const consumed = stringList(reaction.consumed);

  switch (reaction.type) {
    case 'dahai':
      return pai ? { type: 'dahai', pai } : null;
    case 'reach':
      // The discard is the second decision; without it a reach stalls autoplay.
      return reachDiscard ? { type: 'reach', pai: reachDiscard } : null;
    case 'pon':
    case 'chi':
    case 'daiminkan':
      return pai ? { type: reaction.type, pai, consumed } : null;
    case 'ankan':
      return consumed.length > 0 ? { type: 'ankan', consumed } : null;
    case 'kakan':
      return pai ? { type: 'kakan', pai, consumed } : null;
    case 'hora':
      // `target` is the discarder for a ron; a self-draw names our own seat.
      return { type: 'hora', target: typeof reaction.target === 'number' ? reaction.target : seat };
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
 * Map a coarse top-k label. `hora` is deliberately absent: without a target the
 * row cannot say ron or tsumo, and guessing would mislabel the row.
 */
function coarseToAction(action: string): EngineAction | null {
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
 * One row per action the HUD can show. Only a discard is identified by its tile;
 * every other row is the action itself, so a coarse `pon` must not sit next to
 * the reaction's `pon 5s` as a second, tile-less row.
 */
function signature(action: EngineAction): string {
  return action.type === 'dahai' ? `dahai:${action.pai ?? ''}` : action.type;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}
