import { describe, expect, it } from 'vitest';

import type { EngineDecision } from '../../src/services/engine/recommendation-mapper.js';
import {
  CloudDecisionService,
  mapCloudDecision,
} from '../../src/services/online/cloud-decision.js';
import type { FetchLike } from '../../src/services/online/inference-client.js';
import { InferenceClient } from '../../src/services/online/inference-client.js';
import type { OnlineConfig, ReactResponse } from '../../src/services/online/types.js';

const BASE_CONFIG: OnlineConfig = {
  enabled: true,
  baseUrl: 'https://api.example.test',
  apiKey: 'ot_live_key',
  model4p: 'mjot-4p',
  model3p: 'mjot-3p',
  reactTimeoutMs: 3000,
};

const LOCAL: EngineDecision = {
  action: { type: 'dahai', pai: '1m' },
  candidates: [[{ type: 'dahai', pai: '1m' }, 0.9]],
  logits: [],
};

const INPUT = {
  events: [{ type: 'start_game' }, { type: 'start_kyoku' }],
  seat: 0,
  is3p: false,
  local: LOCAL,
};

const REACH: ReactResponse = {
  reaction: { type: 'reach' },
  candidates: [{ action: 'reach', prob: 0.8 }],
  model: 'mjot-4p',
};

const DAHAI: ReactResponse = {
  reaction: { type: 'dahai', pai: '5s' },
  candidates: [
    { action: 'dahai:5s', prob: 0.7 },
    { action: 'dahai:1m', prob: 0.2 },
    { action: 'reach', prob: 0.1 },
  ],
  model: 'mjot-4p',
};

/** Answers the requests in order; a `Response` is returned as given, so
 *  failures are scripted the same way as successes. */
function scripted(responses: Array<ReactResponse | Response>) {
  const paths: string[] = [];
  const fetch: FetchLike = async (url) => {
    paths.push(new URL(url).pathname);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    if (next instanceof Response) return next;
    return new Response(JSON.stringify(next), { status: 200 });
  };
  return { fetch, paths };
}

function service(options: {
  responses: Array<ReactResponse | Response>;
  config?: Partial<OnlineConfig>;
  now?: () => number;
}) {
  const config = { ...BASE_CONFIG, ...options.config };
  const { fetch, paths } = scripted(options.responses);
  const cloud = new CloudDecisionService({
    getConfig: () => config,
    createClient: (current) =>
      new InferenceClient({
        apiKey: current.apiKey,
        baseUrl: current.baseUrl,
        reactTimeoutMs: current.reactTimeoutMs,
        fetch,
      }),
    now: options.now,
  });
  return { cloud, paths, config };
}

describe('the online decision', () => {
  it('returns the cloud answer when the service has one', async () => {
    const { cloud } = service({ responses: [DAHAI] });

    const outcome = await cloud.decide(INPUT);

    expect(outcome).toEqual({
      kind: 'cloud',
      model: 'mjot-4p',
      decision: {
        action: { type: 'dahai', pai: '5s' },
        candidates: [
          [{ type: 'dahai', pai: '5s' }, 0.7],
          [{ type: 'dahai', pai: '1m' }, 0.2],
          [{ type: 'reach' }, 0.1],
        ],
        logits: [],
      },
    });
  });

  it('asks for the discard after a bare reach and uses the cloud one', async () => {
    const { cloud, paths } = service({
      responses: [REACH, { ...DAHAI, reaction: { type: 'dahai', pai: '9p' } }],
    });

    const outcome = await cloud.decide(INPUT);

    expect(paths).toEqual(['/v3/react', '/v3/react']);
    expect(outcome.kind).toBe('cloud');
    if (outcome.kind === 'cloud') {
      expect(outcome.decision.action).toEqual({ type: 'reach', pai: '9p' });
    }
  });

  it('drops the whole cloud answer when the reach follow-up fails', async () => {
    const { cloud } = service({
      responses: [REACH, new Response('{}', { status: 500 })],
    });

    const outcome = await cloud.decide(INPUT);

    expect(outcome).toMatchObject({ kind: 'local', reason: 'reach-failed', fallbackUsed: true });
  });

  it('retries a burst 429 on the reach follow-up without opening the breaker', async () => {
    const { cloud } = service({
      responses: [
        REACH,
        new Response('{}', { status: 429, headers: { 'retry-after': '0' } }),
        { ...DAHAI, reaction: { type: 'dahai', pai: '9p' } },
      ],
    });

    const outcome = await cloud.decide(INPUT);

    expect(outcome.kind).toBe('cloud');
    expect(cloud.circuitOpen).toBe(false);
  });

  it('falls back to the local answer when the server sees no legal action', async () => {
    const { cloud } = service({
      responses: [{ reaction: null, candidates: [], model: null }],
    });

    const outcome = await cloud.decide(INPUT);

    // The server was reachable, so this is a stream mismatch, not an outage.
    expect(outcome).toEqual({
      kind: 'local',
      reason: 'null-reaction',
      fallbackUsed: true,
      circuitOpen: false,
    });
    expect(cloud.circuitOpen).toBe(false);
  });

  it('opens a breaker after a failed call and closes it again after the delay', async () => {
    let now = 0;
    const { cloud } = service({
      responses: [new Response('{}', { status: 503 }), DAHAI],
      now: () => now,
    });

    const failed = await cloud.decide(INPUT);
    expect(failed).toEqual({
      kind: 'local',
      reason: 'request-failed',
      fallbackUsed: true,
      circuitOpen: true,
    });
    expect(cloud.circuitOpen).toBe(true);

    // Still inside the first backoff: no request is made.
    const skipped = await cloud.decide(INPUT);
    expect(skipped).toEqual({
      kind: 'local',
      reason: 'breaker-open',
      fallbackUsed: true,
      circuitOpen: true,
    });

    now += 5_000;
    expect((await cloud.decide(INPUT)).kind).toBe('cloud');
    expect(cloud.circuitOpen).toBe(false);
  });

  it('cancels an answer that arrived after a stop', async () => {
    const { cloud } = service({ responses: [DAHAI] });

    const pending = cloud.decide(INPUT);
    cloud.cancel();

    expect(await pending).toEqual({ kind: 'cancelled' });
  });

  it('does nothing when the service is not configured', async () => {
    const { cloud, paths } = service({
      responses: [],
      config: { enabled: false },
    });

    const outcome = await cloud.decide(INPUT);

    expect(outcome).toEqual({
      kind: 'local',
      reason: 'disabled',
      fallbackUsed: false,
      circuitOpen: false,
    });
    expect(paths).toEqual([]);
  });

  it('treats a missing key as "not configured" instead of calling', async () => {
    const { cloud, paths } = service({ responses: [], config: { apiKey: '  ' } });

    expect((await cloud.decide(INPUT)).kind).toBe('local');
    expect(paths).toEqual([]);
  });

  it('rebuilds the client when the timeout changes mid-game', async () => {
    const { cloud, config } = service({ responses: [DAHAI, DAHAI] });

    await cloud.decide(INPUT);
    config.reactTimeoutMs = 1000;

    expect((await cloud.decide(INPUT)).kind).toBe('cloud');
  });

  it('uses the model that matches the table', async () => {
    const threePlayer = service({ responses: [DAHAI] });
    await threePlayer.cloud.decide({ ...INPUT, is3p: true });
    expect(threePlayer.config.model3p).toBe('mjot-3p');
  });
});

describe('mapping a cloud reaction', () => {
  const CANDIDATES = [
    { action: 'dahai:5s', prob: 0.6 },
    { action: 'chi_low', prob: 0.2 },
    { action: 'dahai:5s', prob: 0.1 },
    { action: 'hora', prob: 0.1 },
  ];

  it('keeps the reaction first and drops duplicate and unmappable rows', () => {
    const decision = mapCloudDecision({ type: 'dahai', pai: '5s' }, CANDIDATES, 0, null);

    expect(decision?.action).toEqual({ type: 'dahai', pai: '5s' });
    // `hora` has no target, so it cannot be labelled with a target.
    expect(decision?.candidates).toEqual([
      [{ type: 'dahai', pai: '5s' }, 0.6],
      [{ type: 'chi' }, 0.2],
    ]);
  });

  it('does not repeat a call as a tile-less second row', () => {
    // The live service answers a pon with `reaction: pon 5s` and a top-k that
    // also lists `pon`; that is the same row, not a second one.
    const decision = mapCloudDecision(
      { type: 'pon', pai: '5s', consumed: ['5s', '5s'] },
      [
        { action: 'pon', prob: 0.53 },
        { action: 'none', prob: 0.47 },
      ],
      0,
      null,
    );

    expect(decision?.candidates).toEqual([
      [{ type: 'pon', pai: '5s', consumed: ['5s', '5s'] }, 0.53],
      [{ type: 'pass' }, 0.47],
    ]);
  });

  it('does not repeat a reach as a tile-less second row', () => {
    const decision = mapCloudDecision(
      { type: 'reach' },
      [
        { action: 'reach', prob: 0.21 },
        { action: 'dahai:E', prob: 0.1 },
      ],
      0,
      'E',
    );

    expect(decision?.candidates).toEqual([
      [{ type: 'reach', pai: 'E' }, 0.21],
      [{ type: 'dahai', pai: 'E' }, 0.1],
    ]);
  });

  it('keeps discards distinct, because their tile is the point', () => {
    const decision = mapCloudDecision(
      { type: 'dahai', pai: '1s' },
      [
        { action: 'dahai:1s', prob: 0.3 },
        { action: 'dahai:S', prob: 0.2 },
        { action: 'dahai:4p', prob: 0.1 },
      ],
      0,
      null,
    );

    expect(decision?.candidates.map(([action]) => action)).toEqual([
      { type: 'dahai', pai: '1s' },
      { type: 'dahai', pai: 'S' },
      { type: 'dahai', pai: '4p' },
    ]);
  });

  it('needs the second call before a reach can carry a discard', () => {
    expect(mapCloudDecision({ type: 'reach' }, [], 0, null)).toBeNull();

    expect(mapCloudDecision({ type: 'reach' }, [], 0, '9p')?.action).toEqual({
      type: 'reach',
      pai: '9p',
    });
  });

  it('maps the north extraction in both spellings the service may use', () => {
    for (const type of ['kita', 'nukidora']) {
      expect(mapCloudDecision({ type }, [], 0, null)?.action).toEqual({ type: 'kita' });
    }
  });

  it('passes a self-draw and a ron through as hora', () => {
    expect(mapCloudDecision({ type: 'hora', target: 2 }, [], 0, null)?.action).toEqual({
      type: 'hora',
      target: 2,
    });
    expect(mapCloudDecision({ type: 'hora' }, [], 3, null)?.action).toEqual({
      type: 'hora',
      target: 3,
    });
  });

  it('refuses a reaction it cannot represent', () => {
    expect(mapCloudDecision({ type: 'weather' }, [], 0, null)).toBeNull();
    expect(mapCloudDecision({ type: 'dahai' }, [], 0, null)).toBeNull();
  });

  it('does not call the client while the breaker is open', async () => {
    const { cloud, paths } = service({ responses: [new Response('{}', { status: 500 })] });

    await cloud.decide(INPUT);
    await cloud.decide(INPUT);
    await cloud.decide(INPUT);

    expect(paths).toEqual(['/v3/react']);
  });
});
