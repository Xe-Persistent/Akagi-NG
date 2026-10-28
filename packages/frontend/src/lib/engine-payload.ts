import type {
  EngineNotice,
  EngineStatus,
  Recommendation,
  RecommendationData,
  SimCandidate,
} from '@/types';

/**
 * The engine's broadcasts cross a process boundary, where a rename on one side
 * is not a compile error on the other. These guards are the boundary: a payload
 * that does not describe what the HUD renders is dropped by the caller instead
 * of reaching a component that would throw on it.
 *
 * Only the shape the renderer reads is checked, field by field: a new field the
 * main process adds stays allowed, and a field that disappears is caught.
 */

const CONNECTIONS = ['idle', 'connected'] as const;
const MODEL_STATES = ['idle', 'loading', 'ready', 'failed'] as const;
const INFERENCES = ['local', 'mjot'] as const;
const NOTICE_KINDS: readonly EngineNotice['kind'][] = [
  'parse_failed',
  'runtime_error',
  'syncing',
  'left_game',
  'game_disconnected',
];

/** A string the payload may carry, narrowed to the listed literals. */
function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSimCandidate(value: unknown): value is SimCandidate {
  return isRecord(value) && typeof value.tile === 'string' && typeof value.confidence === 'number';
}

function isNotice(value: unknown): value is EngineNotice {
  return isRecord(value) && isOneOf(value.kind, NOTICE_KINDS) && typeof value.seq === 'number';
}

function isRecommendation(value: unknown): value is Recommendation {
  if (!isRecord(value)) return false;
  if (typeof value.action !== 'string' || typeof value.confidence !== 'number') return false;
  if (value.consumed !== undefined && !isStringArray(value.consumed)) return false;
  if (value.tile !== undefined && typeof value.tile !== 'string') return false;
  if (
    value.sim_candidates !== undefined &&
    !(Array.isArray(value.sim_candidates) && value.sim_candidates.every(isSimCandidate))
  ) {
    return false;
  }
  return true;
}

export function parseEngineStatus(payload: unknown): EngineStatus | null {
  if (!isRecord(payload)) return null;

  const { connection, model, inference, notice } = payload;
  if (!isOneOf(connection, CONNECTIONS)) return null;
  if (!isOneOf(model, MODEL_STATES)) return null;
  if (!isOneOf(inference, INFERENCES)) return null;
  if (payload.modelName !== null && typeof payload.modelName !== 'string') return null;
  if (notice !== null && !isNotice(notice)) return null;

  return {
    connection,
    model,
    modelName: payload.modelName,
    inference,
    notice,
  };
}

export function parseRecommendations(payload: unknown): RecommendationData | null {
  if (!isRecord(payload)) return null;

  const { recommendations, engine_type, fallback_used, circuit_open, model } = payload;
  if (!Array.isArray(recommendations) || !recommendations.every(isRecommendation)) return null;
  if (!isOneOf(engine_type, ['mjot', 'local'])) return null;
  if (typeof fallback_used !== 'boolean' || typeof circuit_open !== 'boolean') return null;
  if (model !== undefined && typeof model !== 'string') return null;

  return {
    recommendations,
    engine_type,
    fallback_used,
    circuit_open,
    model,
  };
}
