/**
 * A real mid-round reconnect: the `game_restore` our own client was sent with
 * `.lq.FastTest.syncGame` after the connection came back
 * (`logs/akagi_20261019_142612.log`).
 *
 * Plain four-player, East 1, our seat at 3. One kyoku of 125 recorded actions --
 * sixty draws, sixty-two discards, a pon, and the dealer's riichi -- ending on
 * the discard whose `operation` offers us a chi or a pon. A synthesised history
 * cannot say what the server deals to a client that reconnects mid-round.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { BridgeOutput } from '../../src/protocol/base-bridge.js';
import { MajsoulBridge } from '../../src/protocol/majsoul/bridge.js';
import type { MJAIEvent } from '../../src/shared/schema/mjai.js';
import {
  encodeMessage,
  requestFrame,
  responseFrame,
  restoreFrames,
  type RestorePayload,
} from '../liqi-frames.js';

const ACCOUNT_ID = 13639010;
const OUR_SEAT = 3;
/** Keeps the restore's request/answer apart from the auth handshake. */
const RESTORE_MSG_ID = 7;

const restore = JSON.parse(
  readFileSync(new URL('../fixtures/sync-game.json', import.meta.url), 'utf8'),
) as RestorePayload;

/** A bridge authenticated into the game the capture came from. */
function seated(): MajsoulBridge {
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

  return bridge;
}

/** Authenticates, then feeds the restore's request and answer. */
function replay(game: 'syncGame' | 'enterGame', payload: RestorePayload): BridgeOutput {
  const bridge = seated();
  const [request, response] = restoreFrames(game, payload, RESTORE_MSG_ID);

  bridge.parse(request);

  return bridge.parse(response);
}

function count(events: MJAIEvent[], type: string): number {
  return events.filter((event) => event.type === type).length;
}

/** The capture with one recorded action replaced, to see what the replay does with it. */
function withAction(step: number, action: Record<string, unknown>): RestorePayload {
  const copy = structuredClone(restore);
  const actions = copy.game_restore?.actions ?? [];
  actions[step] = action;

  return copy;
}

describe('a reconnect restore', () => {
  it('replays the recorded kyoku as one event stream', () => {
    const output = replay('syncGame', restore);

    expect(output.parseFailed).toBeUndefined();
    expect(output.replayed).toBe(true);
    expect(output.events).toHaveLength(126);
    expect(count(output.events, 'start_kyoku')).toBe(1);
    expect(count(output.events, 'tsumo')).toBe(60);
    expect(count(output.events, 'dahai')).toBe(62);
    expect(count(output.events, 'pon')).toBe(1);
  });

  it('opens the round before anything else and never reopens the game', () => {
    const output = replay('syncGame', restore);

    expect(output.events[0]!.type).toBe('start_kyoku');
    expect(count(output.events, 'start_game')).toBe(0);
  });

  it('gives our seat the hand the server dealt it', () => {
    const start = replay('syncGame', restore).events[0]!;

    expect(start.type).toBe('start_kyoku');
    if (start.type !== 'start_kyoku') return;
    expect(start).toMatchObject({ bakaze: 'E', kyoku: 1, dora_marker: '2s' });
    expect(start.tehais[OUR_SEAT]).toEqual([
      '8m',
      '1p',
      '2p',
      '3p',
      '4p',
      '5p',
      '7p',
      '8p',
      '1s',
      '3s',
      '5s',
      'E',
      'S',
    ]);
  });

  it('carries the riichi declared before the disconnect', () => {
    const output = replay('syncGame', restore);

    // The dealer's declaration and its acceptance both survive the replay.
    expect(output.events.filter((event) => event.type === 'reach')).toMatchObject([{ actor: 0 }]);
    expect(output.events.filter((event) => event.type === 'reach_accepted')).toMatchObject([
      { actor: 0 },
    ]);
  });

  it('ends the history on the discard waiting for our call', () => {
    const output = replay('syncGame', restore);

    expect(output.events.at(-1)).toEqual({
      type: 'dahai',
      actor: 2,
      pai: '4p',
      tsumogiri: false,
    });
  });

  it('replays an enterGame that carries a restore the same way', () => {
    const output = replay('enterGame', restore);

    expect(output.replayed).toBe(true);
    expect(output.events).toHaveLength(126);
  });

  it('has nothing to replay when entering a table mid-match without a restore', () => {
    // What a real capture carries on entering a game (`logs/akagi_20261019_130714.log`).
    const output = replay('enterGame', { is_end: false, step: 0 });

    expect(output.events).toEqual([]);
    expect(output.replayed).toBeFalsy();
  });

  it('skips an action it cannot decode instead of losing the rest', () => {
    const output = replay('syncGame', withAction(5, { name: 'ActionFromTheFuture', step: 5 }));

    // Step 5 is one draw, so only that event goes missing.
    expect(output.events).toHaveLength(125);
    expect(count(output.events, 'tsumo')).toBe(59);
    expect(output.events.at(-1)).toMatchObject({ type: 'dahai', actor: 2, pai: '4p' });
  });

  it('survives an action whose payload is not decodable', () => {
    // Three bytes of an impossible wire type: the decoder throws on this one.
    const output = replay('syncGame', withAction(7, { name: 'ActionDealTile', data: '////' }));

    expect(output.events).toHaveLength(125);
    expect(output.events.at(-1)).toMatchObject({ type: 'dahai', actor: 2, pai: '4p' });
  });
});
