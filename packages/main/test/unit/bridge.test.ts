import { describe, expect, it } from 'vitest';

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

      expect(tsumo).toMatchObject({ type: 'tsumo', actor: 0, pai: toMjaiTile(ROUND_TILES[13]) });
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
