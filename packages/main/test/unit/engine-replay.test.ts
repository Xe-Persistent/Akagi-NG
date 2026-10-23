/**
 * A reconnect replay end to end: the bridge turns the server's `game_restore`
 * into an event stream and the engine answers it. The history is the real
 * mid-kyoku capture in `fixtures/sync-game.json`, so what the HUD does after a
 * reconnect is asserted against a hand the game actually dealt.
 */
import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import { MajsoulBridge } from '../../src/protocol/majsoul/bridge.js';
import { EngineService } from '../../src/services/engine/engine-service.js';
import { engineStatus } from '../../src/services/engine-status.js';
import type { MJAIEvent } from '../../src/shared/schema/mjai.js';
import { messagesOn, resetSentMessages } from '../electron-stub.js';
import { hasEngine } from '../engine-availability.js';
import {
  encodeMessage,
  requestFrame,
  responseFrame,
  restoreFrames,
  type RestorePayload,
} from '../liqi-frames.js';

const ACCOUNT_ID = 13639010;
const SEAT = 3;

const restore = JSON.parse(
  readFileSync(new URL('../fixtures/sync-game.json', import.meta.url), 'utf8'),
) as RestorePayload;

/** The events a reconnecting client would recover from this game. */
function replay(): { events: MJAIEvent[]; replayed: boolean } {
  const bridge = new MajsoulBridge();
  bridge.parse(
    requestFrame(
      '.lq.FastTest.authGame',
      1,
      encodeMessage('ReqAuthGame', { account_id: ACCOUNT_ID }),
    ),
  );
  bridge.parse(
    responseFrame(1, encodeMessage('ResAuthGame', { seat_list: [2, 1, 3, ACCOUNT_ID] })),
  );

  const [request, response] = restoreFrames('syncGame', restore, 7);
  bridge.parse(request);
  const output = bridge.parse(response);

  return { events: output.events, replayed: output.replayed === true };
}

describe.skipIf(!hasEngine)('a reconnect replay', () => {
  let engine: EngineService;

  beforeAll(async () => {
    engine = new EngineService();
    await engine.ingest([{ type: 'start_game', id: SEAT, is_3p: false }]);
  }, 30_000);

  it('loads the model, otherwise the rest would be vacuous', () => {
    expect(engineStatus.get().model).toBe('ready');
  });

  it('publishes one recommendation, for the state the replay ends in', async () => {
    resetSentMessages();

    const { events, replayed } = replay();
    expect(replayed).toBe(true);
    // The history ends on the discard whose operation offers us a call.
    expect(events.at(-1)).toMatchObject({ type: 'dahai', actor: 2, pai: '4p' });

    if (replayed) engineStatus.notice('syncing');
    await engine.ingest(events, replayed);

    expect(messagesOn('engine:recommendations')).toHaveLength(1);

    const notices = messagesOn<{ notice: { kind: string } | null }>('engine:status')
      .map((status) => status.notice?.kind)
      .filter(Boolean);
    expect(notices).toContain('syncing');
  }, 30_000);
});
