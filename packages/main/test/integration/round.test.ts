/**
 * One complete blood-battle round, replayed packet by packet: the deal waits for
 * the three-tile swap, the two mid-game wins settle without closing the round,
 * and the exhaustive draw carries the payments the game made. This is the shape
 * a unit test cannot reach -- it only exists across 148 real packets.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { EngineService } from '../../src/services/engine/engine-service.js';
import type { MJAIEvent } from '../../src/shared/schema/mjai.js';
import { messagesOn, resetSentMessages } from '../electron-stub.js';
import { hasEngine } from '../engine-availability.js';
import { replay, round } from '../real-packets.js';

const UNKNOWN = '?';
const TILE = /^([1-9][mps]|[ESWNPCF]|5[mps]r)$/;

const { events, failures } = replay(round);
const ofType = (type: string) => events.filter((event) => event.type === type);
const count = (name: string) => round.filter((packet) => packet.name === name).length;

describe('a recorded round', () => {
  it('decodes every packet', () => {
    expect(failures).toEqual([]);
  });

  it('opens once and closes once', () => {
    expect(ofType('start_kyoku')).toHaveLength(1);
    expect(ofType('end_kyoku')).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('end_kyoku');
  });

  it('takes the draw the deal carried and the swap that followed', () => {
    // The deal is held until `ActionChangeTile` arrives, so the round opens from
    // the swapped hand and the dora the swap carries.
    expect(events.slice(0, 3).map((event) => event.type)).toEqual(['start_kyoku', 'tsumo', 'dora']);
    expect(round[0]!.name).toBe('ActionNewRound');
    expect(round[1]!.name).toBe('ActionChangeTile');
  });

  it('turns every discard into a tile the table can see', () => {
    const dahai = ofType('dahai');
    expect(dahai).toHaveLength(count('ActionDiscardTile'));

    for (const event of dahai) {
      const pai = (event as { pai: string }).pai;
      expect(pai).not.toBe(UNKNOWN);
      expect(pai).toMatch(TILE);
    }
  });

  it('draws once per deal, plus the dealer tile the round opened with', () => {
    expect(ofType('tsumo')).toHaveLength(count('ActionDealTile') + 1);
  });

  it('settles the mid-game wins without closing the round', () => {
    expect(ofType('hora')).toHaveLength(2);

    const types = events.map((event) => event.type);
    const first = types.indexOf('hora');
    const second = types.indexOf('hora', first + 1);
    expect(types.slice(first + 1, second)).not.toContain('end_kyoku');
  });

  it('reports the exhaustive draw before closing', () => {
    const types = events.map((event) => event.type);
    expect(types.indexOf('ryukyoku')).toBeGreaterThan(types.lastIndexOf('hora'));
    expect(types.indexOf('ryukyoku')).toBeLessThan(types.indexOf('end_kyoku'));
  });

  it('carries the riichi declaration through to its acceptance', () => {
    expect(ofType('reach').length).toBeGreaterThan(0);
    expect(ofType('reach_accepted')).toHaveLength(ofType('reach').length);
  });
});

describe.skipIf(!hasEngine)('the same round through the engine', () => {
  let seat: number;
  const publishedAt: number[] = [];

  beforeAll(async () => {
    resetSentMessages();

    // The engine only reacts for the seat it was told it plays as, which the
    // capture layer learns from the game handshake -- here it is the one seat
    // whose hand the deal reveals.
    const start = events.find((event) => event.type === 'start_kyoku') as
      { tehais: string[][] } | undefined;
    seat = start?.tehais.findIndex((hand) => hand.every((tile) => tile !== UNKNOWN)) ?? -1;

    const engine = new EngineService();
    try {
      await engine.ingest([{ type: 'start_game', id: seat, is_3p: false } as MJAIEvent]);
      for (const [index, event] of events.entries()) {
        await engine.ingest([event as MJAIEvent]);
        publishedAt[index] = messagesOn('engine:recommendations').length;
      }
    } finally {
      engine.stop();
    }
  }, 120_000);

  it('plays a seat the deal reveals', () => {
    expect(seat).toBeGreaterThanOrEqual(0);
  });

  it('answers without rejecting an event', () => {
    const notices = messagesOn<{ notice: { kind: string } | null }>('engine:status')
      .map((status) => status.notice?.kind)
      .filter(Boolean);

    expect(notices).not.toContain('runtime_error');
    expect(publishedAt.at(-1)).toBeGreaterThan(0);
  });

  it('goes quiet once the round is out of our hands', () => {
    // Our own win takes us out of the blood battle while it carries on for the
    // others, and a hand that no longer draws has nothing left to recommend.
    const won = events.findIndex(
      (event) => event.type === 'hora' && (event as { actor: number }).actor === seat,
    );
    expect(won).toBeGreaterThanOrEqual(0);
    expect(publishedAt[won]).toBeGreaterThan(0);

    const after = events.slice(won + 1);
    expect(after.length).toBeGreaterThan(0);
    expect(publishedAt.slice(won + 1)).toEqual(after.map(() => publishedAt[won]));
  });
});
