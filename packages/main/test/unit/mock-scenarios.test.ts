import { describe, expect, it } from 'vitest';

import { generateMockData } from '../../src/services/mock/scenarios.js';

/** Walks one full rotation of the scenarios. */
const FRAMES = Array.from({ length: 9 }, (_, tick) => generateMockData(tick));

describe('the canned HUD data', () => {
  it('repeats after the scenarios, statuses and engines line up again', () => {
    // Nine scenarios, five statuses and four engine states: the rotation is
    // their least common multiple, 180 ticks.
    expect(generateMockData(180)).toEqual(generateMockData(0));
    expect(generateMockData(183)).toEqual(generateMockData(3));
    expect(generateMockData(9).recommendations).toEqual(generateMockData(0).recommendations);
  });

  it('rotates through every engine state the dot can show', () => {
    const sources = Array.from({ length: 4 }, (_, tick) => {
      const frame = generateMockData(tick);
      return `${frame.engine_type}/${frame.fallback_used}/${frame.circuit_open}`;
    });

    expect(new Set(sources)).toEqual(
      new Set(['mjot/false/false', 'local/true/true', 'local/true/false', 'local/false/false']),
    );
  });

  it('gives every scenario a recommendation list the HUD can render', () => {
    for (const frame of FRAMES) {
      expect(frame.recommendations.length).toBeGreaterThan(0);
      for (const recommendation of frame.recommendations) {
        expect(typeof recommendation.action).toBe('string');
        expect(recommendation.confidence).toBeGreaterThanOrEqual(0);
        expect(recommendation.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps each scenario ordered by confidence', () => {
    for (const frame of FRAMES) {
      const confidences = frame.recommendations.map((r) => r.confidence);
      expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
    }
  });

  it('covers the vocabulary the HUD shows', () => {
    const actions = new Set(FRAMES.flatMap((f) => f.recommendations.map((r) => r.action)));

    for (const action of ['chi', 'pon', 'kan', 'reach', 'ron', 'tsumo', 'ryukyoku', 'nukidora']) {
      expect(actions).toContain(action);
    }
  });

  it('carries the tiles a call would consume', () => {
    const calls = FRAMES.flatMap((f) => f.recommendations).filter((r) =>
      ['chi', 'pon', 'kan'].includes(r.action),
    );

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.tile).toBeDefined();
      expect(call.consumed?.length).toBeGreaterThan(0);
    }
  });

  it('rotates through every engine state the HUD reacts to', () => {
    const states = FRAMES.map((f) => `${f.status.connection}/${f.status.model}`);

    expect(new Set(states)).toEqual(
      new Set([
        'connected/ready',
        'connected/loading',
        'connected/failed',
        'idle/idle',
        'connected/idle',
      ]),
    );
  });

  it('raises its one-shot events with the state they belong to', () => {
    const notices = FRAMES.map((f) => f.status.notice).filter(Boolean);

    expect(notices).toEqual(expect.arrayContaining(['game_dropped', 'replay']));
  });
});
