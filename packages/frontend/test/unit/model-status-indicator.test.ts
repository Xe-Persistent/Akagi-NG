import { describe, expect, it } from 'vitest';

import { resolveIndicatorStatus } from '@/components/ui/model-status-indicator';
import type { EngineStatus, RecommendationData } from '@/types';

const CONNECTED: EngineStatus = {
  connection: 'connected',
  model: 'ready',
  modelName: 'akagi4p.safetensors',
  notice: null,
};

function data(overrides: Partial<RecommendationData> = {}): RecommendationData {
  return {
    recommendations: [{ action: '5s', confidence: 0.5 }],
    engine_type: 'local',
    fallback_used: false,
    circuit_open: false,
    ...overrides,
  };
}

describe('the model status dot', () => {
  it('is hidden until a game is connected', () => {
    expect(resolveIndicatorStatus(undefined, data())).toBe('hidden');
    expect(
      resolveIndicatorStatus({ ...CONNECTED, connection: 'idle' }, data({ engine_type: 'mjot' })),
    ).toBe('hidden');
  });

  it('is hidden while no recommendation has arrived', () => {
    expect(resolveIndicatorStatus(CONNECTED, null)).toBe('hidden');
  });

  it('stays hidden while the weights are still loading', () => {
    // Loading is progress, not an answer: nothing has been recommended yet, and
    // the "model loaded" toast already announces when it finishes.
    expect(resolveIndicatorStatus({ ...CONNECTED, model: 'loading' }, null)).toBe('hidden');
  });

  it('describes the answer as usual once loading finishes mid-round', () => {
    // A status can lag a recommendation; the dot follows the rows on screen.
    expect(
      resolveIndicatorStatus({ ...CONNECTED, model: 'loading' }, data({ engine_type: 'mjot' })),
    ).toBe('online');
  });

  it('shows a failed model even before any recommendation', () => {
    expect(resolveIndicatorStatus({ ...CONNECTED, model: 'failed' }, null)).toBe('failed');
  });

  it('turns green for an online answer', () => {
    expect(resolveIndicatorStatus(CONNECTED, data({ engine_type: 'mjot' }))).toBe('online');
  });

  it('turns blue for a local answer', () => {
    expect(resolveIndicatorStatus(CONNECTED, data())).toBe('local');
  });

  it('turns yellow when the local model covered for a failure', () => {
    expect(resolveIndicatorStatus(CONNECTED, data({ fallback_used: true }))).toBe('fallback');
  });

  it('flashes red while the breaker is open, before any other colour', () => {
    expect(
      resolveIndicatorStatus(CONNECTED, data({ fallback_used: true, circuit_open: true })),
    ).toBe('circuitOpen');
  });
});
