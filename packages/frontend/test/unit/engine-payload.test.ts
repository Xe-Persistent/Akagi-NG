import { describe, expect, it } from 'vitest';

import { parseEngineStatus, parseRecommendations } from '@/lib/engine-payload';

function validStatus() {
  return {
    connection: 'connected',
    model: 'ready',
    modelName: 'majsoul-4p',
    inference: 'local',
    notice: null,
  };
}

function validRecommendations() {
  return {
    recommendations: [{ action: 'discard', confidence: 0.82, tile: '5mr' }],
    engine_type: 'local',
    fallback_used: false,
    circuit_open: false,
  };
}

describe('reading an engine status payload', () => {
  it('accepts the shape the main process sends', () => {
    expect(parseEngineStatus(validStatus())).toEqual(validStatus());
  });

  it('rejects a value that is not an object', () => {
    expect(parseEngineStatus(null)).toBeNull();
    expect(parseEngineStatus('connected')).toBeNull();
    expect(parseEngineStatus([])).toBeNull();
  });

  it('rejects a state the renderer cannot render', () => {
    expect(parseEngineStatus({ ...validStatus(), connection: 'online' })).toBeNull();
    expect(parseEngineStatus({ ...validStatus(), model: 'training' })).toBeNull();
    expect(parseEngineStatus({ ...validStatus(), inference: 'remote' })).toBeNull();
    expect(parseEngineStatus({ ...validStatus(), modelName: 4 })).toBeNull();
  });

  it('rejects a notice of an unknown kind', () => {
    expect(
      parseEngineStatus({ ...validStatus(), notice: { kind: 'exploded', seq: 1 } }),
    ).toBeNull();
    expect(parseEngineStatus({ ...validStatus(), notice: { kind: 'runtime_error' } })).toBeNull();
  });

  it('accepts a notice and the absence of one', () => {
    const withNotice = { ...validStatus(), notice: { kind: 'left_game', seq: 3 } };
    expect(parseEngineStatus(withNotice)).toEqual(withNotice);
    expect(parseEngineStatus({ ...validStatus(), notice: null })).not.toBeNull();
  });
});

describe('reading a recommendations payload', () => {
  it('accepts the shape the main process sends', () => {
    expect(parseRecommendations(validRecommendations())).toEqual(validRecommendations());
  });

  it('keeps the optional model and candidates', () => {
    const payload = {
      ...validRecommendations(),
      model: 'mjot-v3',
      recommendations: [
        {
          action: 'reach',
          confidence: 0.6,
          consumed: ['1m'],
          tile: '5pr',
          sim_candidates: [{ tile: '5pr', confidence: 0.6 }],
        },
      ],
    };

    expect(parseRecommendations(payload)).toEqual(payload);
  });

  it('rejects a row the board could not draw', () => {
    const row = { action: 'discard', confidence: 0.5 };
    expect(
      parseRecommendations({
        ...validRecommendations(),
        recommendations: [{ ...row, confidence: '9' }],
      }),
    ).toBeNull();
    expect(
      parseRecommendations({
        ...validRecommendations(),
        recommendations: [{ ...row, consumed: '1m' }],
      }),
    ).toBeNull();
    expect(
      parseRecommendations({
        ...validRecommendations(),
        recommendations: [{ ...row, sim_candidates: [{ tile: '1m' }] }],
      }),
    ).toBeNull();
  });

  it('rejects an unknown engine or a missing flag', () => {
    expect(parseRecommendations({ ...validRecommendations(), engine_type: 'cloud' })).toBeNull();
    expect(parseRecommendations({ ...validRecommendations(), fallback_used: 'no' })).toBeNull();
    expect(parseRecommendations({ ...validRecommendations(), circuit_open: undefined })).toBeNull();
    expect(parseRecommendations({ ...validRecommendations(), recommendations: {} })).toBeNull();
  });
});
