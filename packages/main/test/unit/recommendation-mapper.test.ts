import { describe, expect, it } from 'vitest';

import {
  type EngineAction,
  type EngineDecision,
  mapDecisionToRecommendations,
} from '../../src/services/engine/recommendation-mapper.js';

const context = { playerId: 0, lastDrawnTile: '4p', lastDiscardTile: '3p' };

/** A decision whose only candidate is `action`, with the confidence given. */
function decide(action: EngineAction, confidence: number): EngineDecision {
  return { action, candidates: [[action, confidence]], logits: [] };
}

function map(action: EngineAction, confidence = 0.5) {
  return mapDecisionToRecommendations(decide(action, confidence), context);
}

describe('mapping an engine decision to the HUD vocabulary', () => {
  it('keys a discard by the tile itself', () => {
    expect(map({ type: 'dahai', pai: '9p' })[0]).toEqual({
      action: '9p',
      tile: '9p',
      confidence: 0.5,
    });
  });

  it('keeps riichi as a named action', () => {
    expect(map({ type: 'reach', pai: '3s' })[0]).toEqual({
      action: 'reach',
      tile: '3s',
      confidence: 0.5,
    });
  });

  it('passes the called tiles through', () => {
    expect(map({ type: 'pon', pai: '3p', consumed: ['3p', '3p'] })[0]).toMatchObject({
      action: 'pon',
      consumed: ['3p', '3p'],
    });
    expect(map({ type: 'daiminkan', pai: '5s', consumed: ['5s', '5s', '5s'] })[0]).toMatchObject({
      action: 'kan',
      consumed: ['5s', '5s', '5s'],
    });
    expect(map({ type: 'ankan', consumed: ['7m', '7m', '7m', '7m'] })[0]).toMatchObject({
      action: 'kan',
      consumed: ['7m', '7m', '7m', '7m'],
    });
    expect(map({ type: 'kakan', pai: '1z', consumed: ['1z'] })[0]).toMatchObject({
      action: 'kan',
      consumed: ['1z'],
    });
  });

  it('tells our own win from an opponent s', () => {
    expect(map({ type: 'hora', target: 0 })[0]).toMatchObject({ action: 'tsumo', tile: '4p' });
    expect(map({ type: 'hora', target: 2 })[0]).toMatchObject({ action: 'ron', tile: '3p' });
  });

  it('names the two special draws', () => {
    expect(map({ type: 'kyushu' })[0]!.action).toBe('ryukyoku');
    expect(map({ type: 'kita' })[0]).toMatchObject({ action: 'nukidora', tile: 'N' });
  });

  it('reports a pass as doing nothing', () => {
    expect(map({ type: 'pass' })[0]!.action).toBe('none');
  });

  it('keeps the order and confidence the engine gave', () => {
    const decision: EngineDecision = {
      action: { type: 'dahai', pai: '9p' },
      candidates: [
        [{ type: 'dahai', pai: '9p' }, 0.6],
        [{ type: 'reach', pai: '3s' }, 0.3],
        [{ type: 'pass' }, 0.1],
      ],
      logits: [],
    };

    const mapped = mapDecisionToRecommendations(decision, context);

    expect(mapped.map((r) => r.action)).toEqual(['9p', 'reach', 'none']);
    expect(mapped.map((r) => r.confidence)).toEqual([0.6, 0.3, 0.1]);
  });

  it('hangs the riichi lookahead on the reach row only', () => {
    const decision: EngineDecision = {
      ...decide({ type: 'reach', pai: '3s' }, 0.7),
      candidates: [
        [{ type: 'reach', pai: '3s' }, 0.7],
        [{ type: 'dahai', pai: '9p' }, 0.2],
      ],
      riichi_lookahead: [
        { pai: '9p', prob: 0.8 },
        { pai: '1m', prob: 0.2 },
      ],
    };

    const [reach, discard] = mapDecisionToRecommendations(decision, context);

    expect(reach!.sim_candidates).toEqual([
      { tile: '9p', confidence: 0.8 },
      { tile: '1m', confidence: 0.2 },
    ]);
    expect(discard!.sim_candidates).toBeUndefined();
  });

  it('drops lookahead rows without a tile', () => {
    const decision: EngineDecision = {
      ...decide({ type: 'reach', pai: '3s' }, 0.7),
      riichi_lookahead: [{ pai: '', prob: 0.9 }],
    };

    expect(mapDecisionToRecommendations(decision, context)[0]!.sim_candidates).toBeUndefined();
  });

  it('caps the lookahead at what the HUD renders', () => {
    const decision: EngineDecision = {
      ...decide({ type: 'reach', pai: '3s' }, 0.7),
      riichi_lookahead: ['1m', '2m', '3m', '4m', '5m', '6m', '7m'].map((pai, i) => ({
        pai,
        prob: 1 - i / 10,
      })),
    };

    expect(mapDecisionToRecommendations(decision, context)[0]!.sim_candidates).toHaveLength(5);
  });
});
