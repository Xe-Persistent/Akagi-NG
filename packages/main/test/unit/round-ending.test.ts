/**
 * How a round ends, as the event stream records it. `end_kyoku` carries nothing,
 * so without a settlement a win and both kinds of draw would look identical --
 * which is exactly what v1.0.x produced, and why a replay could not tell them
 * apart.
 */
import { describe, expect, it } from 'vitest';

import { MajsoulBridge } from '../../src/protocol/majsoul/bridge.js';
import { actionFrame } from '../liqi-frames.js';

const HAND = ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', 'E', 'E', 'E', '2z'];

const win = (seat: number, zimo: boolean, pai = '2z') => ({ hand: HAND, hu_tile: pai, seat, zimo });

const scores = [25000, 25000, 25000, 25000];
const deltas = [0, 8000, -4000, -4000];

/** Parses frames through one bridge, in order. */
function replay(...frames: Buffer[]) {
  const bridge = new MajsoulBridge();

  return frames.flatMap((frame) => bridge.parse(frame, 'CDP').events);
}

const types = (events: { type: string }[]) => events.map((event) => event.type);

describe('a plain four-player win', () => {
  it('reports the win, then closes the round', () => {
    const events = replay(
      actionFrame('ActionHule', {
        hules: [win(1, true)],
        old_scores: scores,
        delta_scores: deltas,
        scores: [25000, 33000, 21000, 21000],
      }),
    );

    expect(types(events)).toEqual(['hora', 'end_kyoku']);
    // 2z is the descriptor's code for south; the event uses the mjai code.\n    expect(events[0]).toMatchObject({ actor: 1, target: 1, pai: 'S', deltas });
  });

  it('charges a ron to the seat that discarded last', () => {
    const events = replay(
      actionFrame('ActionDiscardTile', { seat: 2, tile: '2z', moqie: false }),
      actionFrame('ActionHule', { hules: [win(0, false)], delta_scores: deltas }),
    );

    expect(events.find((event) => event.type === 'hora')).toMatchObject({
      actor: 0,
      target: 2,
      pai: 'S',
    });
  });

  it('reports every win of a double ron', () => {
    const events = replay(
      actionFrame('ActionDiscardTile', { seat: 3, tile: '2z', moqie: false }),
      actionFrame('ActionHule', {
        hules: [win(0, false), win(1, false)],
        delta_scores: [4000, 4000, 0, -8000],
      }),
    );

    const hora = events.filter((event) => event.type === 'hora');
    expect(hora.map((event) => (event as { actor: number }).actor)).toEqual([0, 1]);
    expect(hora.every((event) => (event as { target: number }).target === 3)).toBe(true);
    expect(events.at(-1)?.type).toBe('end_kyoku');
  });

  it('carries the table after the win, not the one before it', () => {
    // Confirmed on a plain four-player capture (`logs/akagi_20261019_130714.log`,
    // a rinshan tsumo): `oldScores + deltaScores === scores`.
    const [hora] = replay(
      actionFrame('ActionHule', {
        hules: [win(1, true)],
        old_scores: scores,
        delta_scores: deltas,
        scores: [25000, 33000, 21000, 21000],
      }),
    );

    expect((hora as { scores: number[] }).scores).toEqual([25000, 33000, 21000, 21000]);
    expect((hora as { deltas: number[] }).deltas).toEqual(deltas);
  });

  it('reports nothing beyond the round closing when there was no win to report', () => {
    const events = replay(actionFrame('ActionHule', { hules: [], delta_scores: deltas }));

    expect(types(events)).toEqual(['end_kyoku']);
  });
});

describe('an abortive draw', () => {
  it.each([
    [1, 'kyushu_kyuhai'],
    [2, 'sufuurenta'],
    [3, 'suukansansen'],
    [4, 'suucha_riichi'],
    [5, 'sanchaho'],
  ])('names type %i as %s', (type, reason) => {
    const [ryukyoku] = replay(actionFrame('ActionLiuJu', { type, seat: 0 }));

    expect(ryukyoku).toMatchObject({ type: 'ryukyoku', reason });
  });

  it('leaves the reason out for a type it does not know', () => {
    const [ryukyoku] = replay(actionFrame('ActionLiuJu', { type: 99, seat: 0 }));

    expect(ryukyoku).not.toHaveProperty('reason');
  });

  it('reports the draw, then closes the round', () => {
    const events = replay(actionFrame('ActionLiuJu', { type: 1, seat: 0 }));

    expect(types(events)).toEqual(['ryukyoku', 'end_kyoku']);
    expect(events[0]).toMatchObject({ scores: [], deltas: [], tenpais: [] });
  });
});

describe('an exhaustive draw', () => {
  it('reports its payments before closing', () => {
    const events = replay(
      actionFrame('ActionNoTile', {
        players: [{ tingpai: true }, { tingpai: false }, { tingpai: true }, { tingpai: false }],
        scores: [{ old_scores: scores, delta_scores: [1500, -1500, 1500, -1500] }],
      }),
    );

    expect(types(events)).toEqual(['ryukyoku', 'end_kyoku']);
    expect(events[0]).toMatchObject({
      deltas: [1500, -1500, 1500, -1500],
      tenpais: [true, false, true, false],
    });
  });

  it('names the ordinary case', () => {
    const [ryukyoku] = replay(actionFrame('ActionNoTile', { players: [], scores: [] }));

    expect(ryukyoku).toMatchObject({ reason: 'exhaustive_draw' });
  });

  it('names a nagashi mangan, which pays like a win', () => {
    const [ryukyoku] = replay(
      actionFrame('ActionNoTile', { liujumanguan: true, players: [], scores: [] }),
    );

    expect(ryukyoku).toMatchObject({ reason: 'nagashimangan' });
  });

  it('reports the table after the draw, not the one before it', () => {
    // `NoTileScoreInfo` carries the table before the draw and the change; every
    // capture's next round opens on their sum.
    const [ryukyoku] = replay(
      actionFrame('ActionNoTile', {
        players: [],
        scores: [{ old_scores: scores, delta_scores: [0, -1000, 0, 1000] }],
      }),
    );

    expect((ryukyoku as { scores: number[] }).scores).toEqual([25000, 24000, 25000, 26000]);
  });
});

describe('a riichi the round ended on', () => {
  const riichi = actionFrame('ActionDiscardTile', { seat: 0, tile: '5p', is_liqi: true });

  it('stands when someone else draws the win', () => {
    const events = replay(
      riichi,
      actionFrame('ActionHule', { hules: [win(2, true)], delta_scores: deltas }),
    );

    expect(types(events)).toEqual(['reach', 'dahai', 'reach_accepted', 'hora', 'end_kyoku']);
  });

  it('is void when the discard is ronned', () => {
    const events = replay(
      riichi,
      actionFrame('ActionHule', { hules: [win(2, false)], delta_scores: deltas }),
    );

    expect(types(events)).toEqual(['reach', 'dahai', 'hora', 'end_kyoku']);
  });

  it('stands through an exhaustive draw', () => {
    const events = replay(riichi, actionFrame('ActionNoTile', { players: [], scores: [] }));

    expect(types(events)).toEqual(['reach', 'dahai', 'reach_accepted', 'ryukyoku', 'end_kyoku']);
  });

  it('stands through an ordinary abort', () => {
    const events = replay(riichi, actionFrame('ActionLiuJu', { type: 2, seat: 1 }));

    expect(types(events)).toEqual(['reach', 'dahai', 'reach_accepted', 'ryukyoku', 'end_kyoku']);
  });

  it('is void when three players ron it', () => {
    const events = replay(riichi, actionFrame('ActionLiuJu', { type: 5, seat: 0 }));

    expect(types(events)).toEqual(['reach', 'dahai', 'ryukyoku', 'end_kyoku']);
  });
});
