import { createLogger } from '../../logging/index.js';

const logger = createLogger('Recommendation');

/**
 * How many riichi-lookahead tiles the HUD shows. The engine ranks more, but the
 * candidate row is sized for this many tiles.
 */
const RIICHI_LOOKAHEAD_CANDIDATES = 5;

/** An engine action as serialized by the Rust `BotAction` enum. */
export interface EngineAction {
  type: string;
  pai?: string;
  target?: number;
  consumed?: string[];
  tsumogiri?: boolean;
}

/** A tile the engine would discard right after declaring riichi. */
export interface RiichiLookaheadCandidate {
  pai: string;
  prob: number;
}

export interface EngineDecision {
  action: EngineAction;
  candidates: [EngineAction, number][];
  logits: number[];
  /** True when the legal set held a single action, i.e. the decision is forced. */
  forced?: boolean;
  /** Present only when riichi is one of the candidates. */
  riichi_lookahead?: RiichiLookaheadCandidate[];
}

/**
 * A recommendation in the vocabulary the HUD understands: a tile code for
 * discards, otherwise `reach` / `chi` / `pon` / `kan` / `ron` / `tsumo` /
 * `ryukyoku` / `nukidora` / `none`.
 */
export interface Recommendation {
  action: string;
  tile?: string;
  consumed?: string[];
  confidence: number;
  /** Riichi lookahead: the discards the model would pick after declaring. */
  sim_candidates?: SimCandidate[];
}

/** The payload of an `engine:recommendations` broadcast. */
export interface RecommendationData {
  recommendations: Recommendation[];
}

/** One entry of the riichi lookahead row the HUD renders under `reach`. */
export interface SimCandidate {
  tile: string;
  confidence: number;
}

export interface DecisionContext {
  /** Our seat, used to tell a tsumo from a ron. */
  playerId: number;
  /** Last tile we drew, shown next to a tsumo recommendation. */
  lastDrawnTile?: string | null;
  /** Last tile an opponent discarded, shown next to a ron recommendation. */
  lastDiscardTile?: string | null;
}

export function mapDecisionToRecommendations(
  decision: EngineDecision,
  context: DecisionContext,
): Recommendation[] {
  const recommendations = decision.candidates.map(([action, confidence]) =>
    toRecommendation(action, confidence, context),
  );

  attachRiichiLookahead(recommendations, decision.riichi_lookahead);
  return recommendations;
}

/**
 * Riichi lookahead: a `reach` recommendation carries the discards the model
 * would pick after declaring riichi, so the HUD can show what the hand becomes
 * instead of only naming the declaration.
 */
function attachRiichiLookahead(
  recommendations: Recommendation[],
  lookahead: RiichiLookaheadCandidate[] | undefined,
): void {
  if (!lookahead || lookahead.length === 0) return;

  const candidates = lookahead
    .filter((candidate) => candidate.pai)
    .slice(0, RIICHI_LOOKAHEAD_CANDIDATES)
    .map((candidate) => ({ tile: candidate.pai, confidence: candidate.prob }));
  if (candidates.length === 0) return;

  const reach = recommendations.find((recommendation) => recommendation.action === 'reach');
  if (!reach) return;

  reach.sim_candidates = candidates;
  logger.debug(
    `Riichi lookahead: ${candidates
      .map((candidate) => `${candidate.tile}(${candidate.confidence.toFixed(3)})`)
      .join(' ')}`,
  );
}

export function toRecommendation(
  action: EngineAction,
  confidence: number,
  context: DecisionContext,
): Recommendation {
  switch (action.type) {
    case 'dahai':
      // Discards are keyed by the tile itself, which is what the HUD renders.
      return { action: action.pai ?? '?', tile: action.pai, confidence };
    case 'reach':
      return { action: 'reach', tile: action.pai || undefined, confidence };
    case 'chi':
    case 'pon':
      return {
        action: action.type,
        tile: action.pai,
        consumed: action.consumed,
        confidence,
      };
    case 'daiminkan':
      return { action: 'kan', tile: action.pai, consumed: action.consumed, confidence };
    case 'ankan':
      return { action: 'kan', tile: action.consumed?.[0], consumed: action.consumed, confidence };
    case 'kakan': {
      // The HUD expects a kakan to carry the single added tile.
      const added = action.pai || action.consumed?.[0] || '';
      return { action: 'kan', tile: added, consumed: [added], confidence };
    }
    case 'hora': {
      const isTsumo = action.target === context.playerId;
      return {
        action: isTsumo ? 'tsumo' : 'ron',
        tile: isTsumo
          ? (context.lastDrawnTile ?? undefined)
          : (context.lastDiscardTile ?? undefined),
        confidence,
      };
    }
    case 'kyushu':
      return { action: 'ryukyoku', confidence };
    case 'kita':
      return { action: 'nukidora', tile: 'N', confidence };
    case 'pass':
      return { action: 'none', confidence };
    default:
      logger.warn(`Unknown engine action type: ${action.type}`);
      return { action: 'none', confidence };
  }
}
