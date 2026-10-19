import { describe, expect, it } from 'vitest';

import type { LiqiMessage } from '../../src/protocol/majsoul/liqi.js';
import { LiqiProto, MsgType } from '../../src/protocol/majsoul/liqi.js';
import {
  is3pFromSyncSnapshot,
  parseSyncGameActions,
} from '../../src/protocol/majsoul/sync-replay.js';
import { encodeMessage } from '../liqi-frames.js';

/** A decoded `syncGame` response carrying the given restore payload. */
function syncMessage(gameRestore: Record<string, unknown>): LiqiMessage {
  return {
    id: 1,
    type: MsgType.Res,
    method: '.lq.FastTest.syncGame',
    data: { gameRestore },
  };
}

describe('reading the reconnect snapshot', () => {
  it('tells a three-player table from a four-player one', () => {
    const three = syncMessage({ snapshot: { players: [{}, {}, {}] } });
    const four = syncMessage({ snapshot: { players: [{}, {}, {}, {}] } });

    expect(is3pFromSyncSnapshot(three)).toBe(true);
    expect(is3pFromSyncSnapshot(four)).toBe(false);
  });

  it('returns null when the frame carries no snapshot', () => {
    expect(is3pFromSyncSnapshot(syncMessage({}))).toBeNull();
    expect(is3pFromSyncSnapshot(syncMessage({ snapshot: {} }))).toBeNull();
  });
});

describe('unpacking the replayed actions', () => {
  const proto = new LiqiProto();

  it('turns each recorded action back into an ActionPrototype message', () => {
    const data = encodeMessage('ActionDealTile', { seat: 1, tile: '4p' });
    const message = syncMessage({
      actions: [{ step: 0, name: 'ActionDealTile', data: data.toString('base64') }],
    });

    const [replayed] = parseSyncGameActions(message, proto);

    expect(replayed).toMatchObject({ id: -1, type: MsgType.Notify, method: '.lq.ActionPrototype' });
    expect(replayed.data).toMatchObject({ name: 'ActionDealTile', step: 0 });
    // The inner payload is decoded, not the base64 the frame carried.
    expect((replayed.data as { data: unknown }).data).toMatchObject({ seat: 1, tile: '4p' });
  });

  it('keeps the order the actions were recorded in', () => {
    const names = ['ActionMJStart', 'ActionNewRound', 'ActionDealTile'];
    const message = syncMessage({
      actions: names.map((name, step) => ({
        step,
        name,
        data: encodeMessage(name, {}).toString('base64'),
      })),
    });

    expect(parseSyncGameActions(message, proto).map((item) => item.data.name)).toEqual(names);
  });

  it('returns nothing when the frame has no history', () => {
    expect(parseSyncGameActions(syncMessage({}), proto)).toEqual([]);
    expect(parseSyncGameActions(syncMessage({ actions: [] }), proto)).toEqual([]);
  });

  it('drops an action the protocol cannot decode', () => {
    const good = encodeMessage('ActionDealTile', { seat: 0, tile: '1m' });
    const message = syncMessage({
      actions: [
        { step: 0, name: 'ActionUnknownToThisBuild', data: good.toString('base64') },
        { step: 1, name: 'ActionDealTile', data: good.toString('base64') },
      ],
    });

    const replayed = parseSyncGameActions(message, proto);

    expect(replayed).toHaveLength(1);
    expect(replayed[0].data).toMatchObject({ name: 'ActionDealTile' });
  });
});
