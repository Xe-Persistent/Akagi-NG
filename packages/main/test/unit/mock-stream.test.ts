import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_TICK_MS, startMockStream, stopMockStream } from '../../src/services/mock/stream.js';
import { messagesOn, resetSentMessages } from '../electron-stub.js';

interface Recommendation {
  action: string;
  tile?: string;
  sim_candidates?: { tile: string; confidence: number }[];
}

interface Status {
  connection: string;
  model: string;
  modelName: string | null;
  notice: { kind: string } | null;
}

const recommendations = () =>
  messagesOn<{ recommendations: Recommendation[] }>('engine:recommendations');
const statuses = () => messagesOn<Status>('engine:status');

/** Lets every queued timer run, one tick at a time, up to `ticks`. */
function advance(ticks: number) {
  for (let i = 0; i < ticks; i++) vi.advanceTimersByTime(MOCK_TICK_MS);
}

describe('the mock stream', () => {
  beforeEach(() => {
    resetSentMessages();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopMockStream();
    vi.useRealTimers();
  });

  it('publishes a frame as soon as it starts', () => {
    startMockStream();

    expect(recommendations()).toHaveLength(1);
    expect(statuses().at(-1)).toMatchObject({ connection: 'connected', model: 'ready' });
  });

  it('rotates scenarios over the HUD vocabulary', () => {
    startMockStream();
    advance(8);

    const payloads = recommendations();
    expect(payloads.length).toBe(9);
    expect(new Set(payloads.map((p) => JSON.stringify(p.recommendations))).size).toBeGreaterThan(3);

    const actions = new Set(payloads.flatMap((p) => p.recommendations.map((r) => r.action)));
    for (const action of ['chi', 'pon', 'kan', 'ron', 'tsumo', 'reach', 'ryukyoku', 'nukidora']) {
      expect(actions).toContain(action);
    }

    const riichi = payloads.flatMap((p) => p.recommendations).find((r) => r.action === 'reach');
    expect(riichi?.sim_candidates?.length).toBeGreaterThan(1);
  });

  it('walks the engine through every state it can report', () => {
    startMockStream();
    advance(5);

    const seen = new Set(statuses().map((s) => `${s.connection}/${s.model}`));
    expect(seen).toEqual(
      new Set([
        'connected/ready',
        'connected/loading',
        'connected/failed',
        'idle/idle',
        'connected/idle',
      ]),
    );

    const notices = statuses()
      .map((s) => s.notice?.kind)
      .filter((kind) => kind !== undefined);
    expect(notices).toEqual(expect.arrayContaining(['game_dropped', 'replay']));
  });

  it('starts only once, even if asked twice', () => {
    startMockStream();
    startMockStream();
    advance(1);

    expect(recommendations()).toHaveLength(2);
  });

  it('goes quiet when stopped', () => {
    startMockStream();
    advance(2);
    const quiet = { recommendations: recommendations().length, statuses: statuses().length };

    stopMockStream();
    advance(3);

    expect(recommendations()).toHaveLength(quiet.recommendations);
    expect(statuses()).toHaveLength(quiet.statuses);
  });

  it('can be restarted after being stopped', () => {
    startMockStream();
    stopMockStream();
    resetSentMessages();

    startMockStream();
    advance(1);

    expect(recommendations()).toHaveLength(2);
  });
});
