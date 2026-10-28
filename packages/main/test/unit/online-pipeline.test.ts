/**
 * The online layer as `EngineService` uses it: the local engine still gates every
 * call, a cloud answer replaces the recommendation, and a failure of the service
 * leaves the local answer on screen with the right flags.
 *
 * The runner is stubbed so the decision is scripted, and `fetch` is replaced at
 * the boundary: everything between them — the kyoku window, the request, the
 * mapping and the broadcast — is the production path.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineService } from '../../src/services/engine/engine-service.js';
import type { RecommendationData } from '../../src/services/engine/recommendation-mapper.js';
import {
  clearApiKey,
  resetSecretCache,
  writeApiKey,
} from '../../src/services/online/secret-store.js';
import { getSettingsManager } from '../../src/services/settings-manager.js';
import type { MJAIEvent } from '../../src/shared/schema/mjai.js';
import { messagesOn, resetSentMessages, testPaths } from '../electron-stub.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const schema = readFileSync(join(repoRoot, 'assets', 'settings.schema.json'), 'utf8');
const SEAT = 1;
const DEFAULT_HAND = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '4p'];

let workDir: string;

function startKyoku(hand: string[] = DEFAULT_HAND): MJAIEvent {
  return {
    type: 'start_kyoku',
    bakaze: 'E',
    dora_marker: '5s',
    kyoku: 1,
    honba: 0,
    kyotaku: 0,
    oya: 0,
    scores: [25000, 25000, 25000, 25000],
    tehais: [hand, hand, hand, hand],
  } as unknown as MJAIEvent;
}

/** Our own draw: the point at which the app asks for a recommendation. */
const OUR_DRAW: MJAIEvent = { type: 'tsumo', actor: SEAT, pai: '5s' };

interface StubOptions {
  forced?: boolean;
  decision?: Record<string, unknown>;
}

function stubbedEngine(options: StubOptions = {}): EngineService {
  const engine = new EngineService();
  const internal = engine as unknown as {
    runner: unknown;
    playerId: number;
  };
  internal.runner = {
    loaded: true,
    feed: () => {},
    decide: () =>
      options.decision ?? {
        action: { type: 'dahai', pai: '1m' },
        candidates: [
          [{ type: 'dahai', pai: '1m' }, 0.9],
          [{ type: 'dahai', pai: '9p' }, 0.1],
        ],
        logits: [],
        forced: options.forced ?? false,
      },
    reset: () => {},
    load: async () => ({ status: 'loaded', modelName: 'stub' }),
  };
  internal.playerId = SEAT;
  return engine;
}

/** A recorded request body, parsed back from the JSON text the client sent. */
function parsedBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== 'string') throw new Error('the client did not send a JSON text body');
  return JSON.parse(body);
}

/** A fetch that answers `/v3/react` with the given payload. */
function stubService(payload: unknown) {
  const calls: unknown[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, body: parsedBody(init) });
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  return calls;
}

/** A fetch that answers in order; the last payload repeats for later calls. */
function stubSequence(payloads: unknown[]) {
  const calls: unknown[] = [];
  const queue = [...payloads];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, body: parsedBody(init) });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return new Response(JSON.stringify(next), { status: 200 });
  });
  return calls;
}

function published(): RecommendationData | undefined {
  return messagesOn<RecommendationData>('engine:recommendations').at(-1);
}

describe('the online decision inside the engine', () => {
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'akagi-online-'));
    mkdirSync(join(workDir, 'assets'));
    mkdirSync(join(workDir, 'config'));
    writeFileSync(join(workDir, 'assets', 'settings.schema.json'), schema);
    testPaths.projectRoot = workDir;
  });

  afterAll(() => {
    testPaths.projectRoot = repoRoot;
    rmSync(workDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetSentMessages();
    resetSecretCache();
    getSettingsManager().updateSettings({ ot: { online: false } } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearApiKey();
  });

  async function play(engine: EngineService) {
    await engine.ingest(
      [
        { type: 'start_game', names: ['p0', 'p1', 'p2', 'p3'], num_players: 4 },
        startKyoku(),
        OUR_DRAW,
      ],
      false,
      SEAT,
    );
  }

  it('publishes the cloud answer and says online produced it', async () => {
    writeApiKey('ot_live_test');
    getSettingsManager().updateSettings({ ot: { online: true } } as never);

    const calls = stubService({
      reaction: { type: 'dahai', pai: '9p' },
      candidates: [
        { action: 'dahai:9p', prob: 0.7 },
        { action: 'dahai:1m', prob: 0.3 },
      ],
      model: 'mjot-4p',
    });

    await play(stubbedEngine());

    const payload = published();
    expect(payload?.engine_type).toBe('mjot');
    expect(payload?.fallback_used).toBe(false);
    expect(payload?.model).toBe('mjot-4p');
    expect(payload?.recommendations[0]).toMatchObject({ action: '9p', confidence: 0.7 });

    // The window is shaped from the round so far, censored to our seat.
    const request = calls[0] as { url: string; body: { events: { type: string }[] } };
    expect(request.url).toContain('/v3/react');
    expect(request.body.events.map((event) => event.type)).toEqual([
      'start_game',
      'start_kyoku',
      'tsumo',
    ]);
  });

  it('flags a single failed call as a fallback, not as a breaker', async () => {
    writeApiKey('ot_live_test');
    getSettingsManager().updateSettings({ ot: { online: true } } as never);

    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network down');
    });

    await play(stubbedEngine());

    const payload = published();
    expect(payload?.engine_type).toBe('local');
    expect(payload?.fallback_used).toBe(true);
    // One failed call is the hiccup: nothing is being skipped, so the breaker
    // stays closed and the HUD draws amber instead of the alarm.
    expect(payload?.circuit_open).toBe(false);
    expect(payload?.recommendations[0]).toMatchObject({ action: '1m' });
  });

  it('opens the breaker on the second consecutive failure', async () => {
    writeApiKey('ot_live_test');
    getSettingsManager().updateSettings({ ot: { online: true } } as never);

    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network down');
    });

    const engine = stubbedEngine();
    await play(engine);
    // Another turn, and the service is still unreachable.
    await engine.ingest([OUR_DRAW]);

    const payload = published();
    expect(payload?.engine_type).toBe('local');
    expect(payload?.fallback_used).toBe(true);
    // Now the calls genuinely are being held back: pulsing red.
    expect(payload?.circuit_open).toBe(true);
  });

  it('does not call the service at all when the decision is forced', async () => {
    writeApiKey('ot_live_test');
    getSettingsManager().updateSettings({ ot: { online: true } } as never);

    const calls = stubService({ reaction: { type: 'dahai', pai: '9p' }, candidates: [] });

    await play(stubbedEngine({ forced: true }));

    expect(calls).toEqual([]);
    // A forced move is not a recommendation: the HUD keeps the previous frame.
    expect(published()).toBeUndefined();
  });

  it('stays local without a key, even with the online mode on', async () => {
    getSettingsManager().updateSettings({ ot: { online: true } } as never);
    const calls = stubService({ reaction: { type: 'dahai', pai: '9p' }, candidates: [] });

    await play(stubbedEngine());

    expect(calls).toEqual([]);
    expect(published()?.engine_type).toBe('local');
    expect(published()?.fallback_used).toBe(false);
  });

  it('does not call the service while the mode is local', async () => {
    writeApiKey('ot_live_test');
    const calls = stubService({ reaction: { type: 'dahai', pai: '9p' }, candidates: [] });

    await play(stubbedEngine());

    expect(calls).toEqual([]);
    expect(published()?.engine_type).toBe('local');
  });

  it('draws the tiles behind a coarse online call row', async () => {
    writeApiKey('ot_live_test');
    getSettingsManager().updateSettings({ ot: { online: true } } as never);

    stubService({
      reaction: { type: 'dahai', pai: '9p' },
      candidates: [
        { action: 'dahai:9p', prob: 0.7 },
        { action: 'pon', prob: 0.3 },
      ],
      model: 'mjot-4p',
    });

    const engine = stubbedEngine();
    try {
      await engine.ingest(
        [
          { type: 'start_game', names: ['p0', 'p1', 'p2', 'p3'], num_players: 4 },
          startKyoku([
            '1m',
            '1m',
            '3m',
            '4m',
            '5m',
            '6m',
            '7m',
            '8m',
            '9m',
            '1p',
            '2p',
            '3p',
            '4p',
          ]),
          { type: 'dahai', actor: 0, pai: '1m', tsumogiri: false } as unknown as MJAIEvent,
        ],
        false,
        SEAT,
      );
    } finally {
      engine.stop();
    }

    const pon = published()?.recommendations.find((row) => row.action === 'pon');
    expect(pon).toMatchObject({ tile: '1m', consumed: ['1m', '1m'], confidence: 0.3 });
  });

  it('labels a coarse online hora row as a ron on the discard', async () => {
    writeApiKey('ot_live_test');
    getSettingsManager().updateSettings({ ot: { online: true } } as never);

    stubService({
      reaction: { type: 'none' },
      candidates: [
        { action: 'none', prob: 0.7 },
        { action: 'hora', prob: 0.3 },
      ],
      model: 'mjot-4p',
    });

    const engine = stubbedEngine();
    try {
      await engine.ingest(
        [
          { type: 'start_game', names: ['p0', 'p1', 'p2', 'p3'], num_players: 4 },
          startKyoku(),
          { type: 'dahai', actor: 0, pai: '3p', tsumogiri: false } as unknown as MJAIEvent,
        ],
        false,
        SEAT,
      );
    } finally {
      engine.stop();
    }

    const ron = published()?.recommendations.find((row) => row.action === 'ron');
    expect(ron).toMatchObject({ tile: '3p', confidence: 0.3 });
  });

  it('shows the online model own declaration tiles under an online reach', async () => {
    writeApiKey('ot_live_test');
    getSettingsManager().updateSettings({ ot: { online: true } } as never);

    stubSequence([
      {
        reaction: { type: 'reach' },
        candidates: [{ action: 'reach', prob: 0.9 }],
        model: 'mjot-4p',
      },
      {
        reaction: { type: 'dahai', pai: '9p' },
        candidates: [
          { action: 'dahai:9p', prob: 0.6 },
          { action: 'dahai:1m', prob: 0.4 },
        ],
        model: 'mjot-4p',
      },
    ]);

    const engine = stubbedEngine({
      decision: {
        action: { type: 'reach', pai: '1m' },
        candidates: [
          [{ type: 'reach', pai: '1m' }, 0.9],
          [{ type: 'dahai', pai: '9p' }, 0.1],
        ],
        logits: [],
        forced: false,
        // A local ranking that must not leak into the online card.
        riichi_lookahead: [
          { pai: '1m', prob: 0.99 },
          { pai: '9p', prob: 0.01 },
        ],
      },
    });
    try {
      await play(engine);
    } finally {
      engine.stop();
    }

    const reach = published()?.recommendations.find((row) => row.action === 'reach');
    expect(reach?.tile).toBe('9p');
    expect(reach?.sim_candidates).toEqual([
      { tile: '9p', confidence: 0.6 },
      { tile: '1m', confidence: 0.4 },
    ]);
  });
});
