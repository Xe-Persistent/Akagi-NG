import { describe, expect, it } from 'vitest';

import type { BridgeOutput } from '../../src/protocol/base-bridge.js';
import { MajsoulBridge } from '../../src/protocol/majsoul/bridge.js';
import { toMjaiTile } from '../../src/protocol/majsoul/tile-mapping.js';
import type { MJAIEvent } from '../../src/shared/schema/mjai.js';
import { actionFrame, encodeMessage, requestFrame, responseFrame } from '../liqi-frames.js';

const ACCOUNT_ID = 11111;

/** A dealer's opening deal: thirteen tiles plus the drawn fourteenth. */
const ROUND_TILES = [
  '1m',
  '2m',
  '3m',
  '5m',
  '6m',
  '7m',
  '1p',
  '1p',
  '5p',
  '9p',
  '1z',
  '1z',
  '2z',
  '9m',
];

/** A bridge that has answered `authGame` for the seats and names given. */
function authenticated(seatList: number[], nicknames: string[]): BridgeOutput {
  const bridge = new MajsoulBridge();

  bridge.parse(
    requestFrame(
      '.lq.FastTest.authGame',
      1,
      encodeMessage('ReqAuthGame', { account_id: ACCOUNT_ID }),
    ),
  );
  return bridge.parse(
    responseFrame(
      1,
      encodeMessage('ResAuthGame', {
        seat_list: seatList,
        players: nicknames.map((nickname, index) => ({
          account_id: seatList[index],
          nickname,
        })),
      }),
    ),
  );
}

/** A bridge that has authenticated and opened one round. */
function openRound(): { bridge: MajsoulBridge; events: MJAIEvent[]; round: MJAIEvent[] } {
  const bridge = new MajsoulBridge();

  bridge.parse(
    requestFrame(
      '.lq.FastTest.authGame',
      1,
      encodeMessage('ReqAuthGame', { account_id: ACCOUNT_ID }),
    ),
  );
  bridge.parse(
    responseFrame(
      1,
      encodeMessage('ResAuthGame', { seat_list: [ACCOUNT_ID, 22222, 33333, 44444] }),
    ),
  );

  const { events } = bridge.parse(
    actionFrame('ActionNewRound', {
      chang: 0,
      ju: 0,
      ben: 0,
      liqibang: 0,
      tiles: ROUND_TILES,
      scores: [25000, 25000, 25000, 25000],
      doras: ['1s'],
      left_tile_count: 69,
    }),
  );

  return { bridge, events, round: events };
}

describe('MajsoulBridge', () => {
  describe('opening a game', () => {
    it('names one player per seat and says how many seats there are', () => {
      const output = authenticated([ACCOUNT_ID, 22222, 33333, 44444], ['me', 'b', 'c', 'd']);

      expect(output.events[0]).toEqual({
        type: 'start_game',
        names: ['me', 'b', 'c', 'd'],
        num_players: 4,
      });
    });

    it('reports sanma as three seats', () => {
      const output = authenticated([22222, ACCOUNT_ID, 44444], ['a', 'me', 'c']);

      expect(output.events[0]).toMatchObject({ num_players: 3, names: ['a', 'me', 'c'] });
    });

    it('falls back to a placeholder for a seat the answer did not name', () => {
      const bridge = new MajsoulBridge();
      bridge.parse(
        requestFrame(
          '.lq.FastTest.authGame',
          1,
          encodeMessage('ReqAuthGame', { account_id: ACCOUNT_ID }),
        ),
      );

      const output = bridge.parse(
        responseFrame(
          1,
          encodeMessage('ResAuthGame', { seat_list: [ACCOUNT_ID, 22222, 33333, 44444] }),
        ),
      );

      expect(output.events[0]).toMatchObject({
        names: ['Player0', 'Player1', 'Player2', 'Player3'],
        num_players: 4,
      });
    });

    it('carries our seat beside the events, and only on this frame', () => {
      const bridge = new MajsoulBridge();
      bridge.parse(
        requestFrame(
          '.lq.FastTest.authGame',
          1,
          encodeMessage('ReqAuthGame', { account_id: ACCOUNT_ID }),
        ),
      );

      const answer = bridge.parse(
        responseFrame(
          1,
          encodeMessage('ResAuthGame', { seat_list: [22222, ACCOUNT_ID, 33333, 44444] }),
        ),
      );
      // Nothing in a standard event names the reader, so it travels next to them.
      expect(answer.seat).toBe(1);
      expect(answer.events[0]).not.toHaveProperty('id');
      expect(bridge.parse(Buffer.from([42, 0, 0, 0])).seat).toBeUndefined();
    });
  });

  describe('a new round', () => {
    it('opens a kyoku for our seat', () => {
      const { round } = openRound();
      const start = round.find((e) => e.type === 'start_kyoku');

      expect(start).toBeDefined();
      expect(start?.oya).toBe(0);
      expect(start?.dora_marker).toBe('1s');
      expect(start?.scores).toEqual([25000, 25000, 25000, 25000]);
    });

    it('carries our thirteen tiles and masks the other seats', () => {
      const { round } = openRound();
      const start = round.find((e) => e.type === 'start_kyoku');

      expect(start?.tehais[0]).toHaveLength(13);
      expect(start?.tehais[0]).not.toContain('?');
      for (const hand of start?.tehais.slice(1) ?? []) {
        expect(hand.every((tile) => tile === '?')).toBe(true);
      }
    });

    it('emits the fourteenth tile as our draw', () => {
      const { round } = openRound();
      const start = round.find((e) => e.type === 'start_kyoku');
      const tsumo = round.find((e) => e.type === 'tsumo');

      expect(tsumo).toMatchObject({ type: 'tsumo', actor: 0, pai: toMjaiTile(ROUND_TILES[13]!) });
      // Hand plus draw has to be exactly the fourteen dealt tiles.
      const dealt = ROUND_TILES.map(toMjaiTile).sort();
      const seen = [...(start?.tehais[0] ?? []), tsumo?.pai ?? ''].sort();
      expect(seen).toEqual(dealt);
    });
  });

  describe('a frame it cannot read', () => {
    it('reports a parse failure instead of a partial event', () => {
      const { bridge } = openRound();

      const output = bridge.parse(
        actionFrame('ActionDiscardTile', { seat: 1, tile: 'zz', moqie: false }),
      );

      expect(output.parseFailed).toBe(true);
      expect(output.events.some((e) => e.type === 'dahai')).toBe(false);
    });

    it('stays quiet about frames that are not liqi at all', () => {
      const { bridge } = openRound();

      const output = bridge.parse(Buffer.from([42, 0, 0, 0]));

      expect(output.parseFailed).toBeFalsy();
      expect(output.replayed).toBe(false);
      expect(output.events).toEqual([]);
    });
  });

  describe('an action it has no mapping for', () => {
    it('skips it without failing the frame', () => {
      const { bridge } = openRound();

      const output = bridge.parse(actionFrame('ActionGangResult', {}));

      expect(output.parseFailed).toBeFalsy();
      expect(output.events).toEqual([]);
    });
  });
});
