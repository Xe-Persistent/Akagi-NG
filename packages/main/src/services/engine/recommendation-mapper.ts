import { createLogger } from '../../logging/index.js';

const logger = createLogger('Recommendation');

/** An engine action as serialized by the Rust `BotAction` enum. */
export interface EngineAction {
  type: string;
  pai?: string;
  target?: number;
  consumed?: string[];
  tsumogiri?: boolean;
}

export interface EngineDecision {
  action: EngineAction;
  candidates: [EngineAction, number][];
  logits: number[];
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
  return decision.candidates.map(([action, confidence]) =>
    toRecommendation(action, confidence, context),
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
