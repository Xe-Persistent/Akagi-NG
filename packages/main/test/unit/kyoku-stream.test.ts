import { describe, expect, it } from 'vitest';

import {
  buildApiEvents,
  KyokuStream,
  MAX_API_EVENTS,
} from '../../src/services/online/kyoku-stream.js';
import type { MJAIEvent } from '../../src/shared/schema/mjai.js';

const HAND = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '4p'];

function startGame(is3p = false): MJAIEvent {
  return { type: 'start_game', id: 0, is_3p: is3p };
}

function startKyoku(seats = 4): MJAIEvent {
  return {
    type: 'start_kyoku',
    bakaze: 'E',
    dora_marker: '5s',
    kyoku: 1,
    honba: 0,
    kyotaku: 0,
    oya: 0,
    scores: Array.from({ length: seats }, () => 25000),
    tehais: Array.from({ length: seats }, () => [...HAND]),
  };
}

function collect(events: MJAIEvent[]): KyokuStream {
  const stream = new KyokuStream();
  for (const event of events) stream.accumulate(event);
  return stream;
}

describe('the per-kyoku window', () => {
  it('withholds a window until the game and the round have both started', () => {
    expect(collect([]).buildApiEvents(0, false)).toBeNull();

    const midRound = collect([startKyoku(), { type: 'tsumo', actor: 0, pai: '5s' }]);
    // No `start_game`: the stream would begin mid-round and read as a desync.
    expect(midRound.buildApiEvents(0, false)).toBeNull();

    const noKyoku = collect([startGame()]);
    expect(noKyoku.buildApiEvents(0, false)).toBeNull();
  });

  it('opens a new round with the game header and drops the previous round', () => {
    const stream = collect([
      startGame(),
      startKyoku(),
      { type: 'tsumo', actor: 0, pai: '5s' },
      startKyoku(),
    ]);

    const events = stream.buildApiEvents(0, false);
    expect(events?.map((event) => event.type)).toEqual(['start_game', 'start_kyoku']);
  });

  it('keeps only our hand and hides every other seat', () => {
    const stream = collect([startGame(), startKyoku()]);

    const [game, kyoku] = stream.buildApiEvents(2, false) ?? [];
    expect(game).toEqual({
      type: 'start_game',
      names: ['Player0', 'Player1', 'Player2', 'Player3'],
    });

    const tehais = kyoku.tehais as string[][];
    expect(tehais[2]).toEqual(HAND);
    for (const seat of [0, 1, 3]) {
      expect(tehais[seat]).toEqual(Array.from({ length: HAND.length }, () => '?'));
    }
  });

  it("never leaks another seat's draw", () => {
    const stream = collect([
      startGame(),
      startKyoku(),
      { type: 'tsumo', actor: 0, pai: '5s' },
      { type: 'tsumo', actor: 1, pai: '7p' },
    ]);

    const events = stream.buildApiEvents(2, false) ?? [];
    expect(events.at(-1)).toEqual({ type: 'tsumo', actor: 1, pai: '?' });
    expect(events.at(-2)).toEqual({ type: 'tsumo', actor: 0, pai: '?' });
  });

  it('shapes a reach without the discard that follows it', () => {
    const stream = collect([
      startGame(),
      startKyoku(),
      { type: 'reach', actor: 0 },
      { type: 'dahai', actor: 0, pai: '5s', tsumogiri: false },
    ]);

    const events = stream.buildApiEvents(0, false) ?? [];
    expect(events.at(-2)).toEqual({ type: 'reach', actor: 0 });
  });

  it('hands over a north extraction the way the service spells it', () => {
    const stream = collect([startGame(true), startKyoku(3), { type: 'kita', actor: 1, pai: 'N' }]);

    // No `pai`: the tile is implied, and upstream's own event carries the actor
    // alone, so sending more risks a stricter parser rejecting the window.
    expect(stream.buildApiEvents(0, true)?.at(-1)).toEqual({ type: 'kita', actor: 1 });
  });

  it('pads sanma to four seats with a phantom player', () => {
    const stream = collect([startGame(true), startKyoku(3)]);

    const [game, kyoku] = stream.buildApiEvents(0, true) ?? [];
    expect(game.names).toEqual(['Player0', 'Player1', 'Player2', '']);

    const scores = kyoku.scores as number[];
    expect(scores).toHaveLength(4);
    expect(scores.at(-1)).toBe(0);
    expect(kyoku.tehais).toHaveLength(4);
    expect((kyoku.tehais as string[][])[3]).toEqual(Array.from({ length: HAND.length }, () => '?'));
  });

  it('passes events it does not reshape through unchanged', () => {
    const stream = collect([
      startGame(),
      startKyoku(),
      { type: 'dahai', actor: 0, pai: '5s', tsumogiri: false },
    ]);

    const events = stream.buildApiEvents(0, false) ?? [];
    expect(events.at(-1)).toEqual({ type: 'dahai', actor: 0, pai: '5s', tsumogiri: false });
  });

  it('refuses a window that never reset', () => {
    const stream = new KyokuStream();
    stream.accumulate(startGame());
    stream.accumulate(startKyoku());
    for (let index = 0; index <= MAX_API_EVENTS; index++) {
      stream.accumulate({ type: 'dahai', actor: 0, pai: '5s', tsumogiri: true });
    }

    expect(stream.buildApiEvents(0, false)).toBeNull();
  });

  it('starts over when it is reset', () => {
    const stream = collect([startGame(), startKyoku()]);
    stream.reset();

    expect(stream.empty).toBe(true);
    expect(stream.buildApiEvents(0, false)).toBeNull();
  });
});

describe('buildApiEvents', () => {
  it('is the shaping the stream applies, without the window', () => {
    const events = buildApiEvents([startGame(), startKyoku()], 0, false);

    expect(events?.[0]).toEqual({
      type: 'start_game',
      names: ['Player0', 'Player1', 'Player2', 'Player3'],
    });
    expect(events?.[1].tehais && (events[1].tehais as string[][])[0]).toEqual(HAND);
  });
});
