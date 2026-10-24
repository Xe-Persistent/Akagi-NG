/**
 * The round as the HUD needs it: the tiles behind a coarse call label, the last
 * drawn and claimed tiles, and which seat a win would pay.
 *
 * Online top-k rows say `pon` / `chi_mid` / `kan` and nothing else, so the HUD's
 * combination has to come from our own hand — the bookkeeping Akagi v1.0.8's
 * `StateTracker` did against `PlayerState`.
 */
import { describe, expect, it } from 'vitest';

import { RoundState } from '../../src/services/engine/round-state.js';
import type { MJAIEvent } from '../../src/shared/schema/mjai.js';

const SEAT = 1;
const OTHER = 0;

function startGame(): MJAIEvent {
  return { type: 'start_game', names: ['a', 'b', 'c', 'd'], num_players: 4 };
}

function startKyoku(hand: string[]): MJAIEvent {
  const tehais = Array.from({ length: 4 }, () => Array.from({ length: 13 }, () => '?'));
  tehais[SEAT] = hand;
  return {
    type: 'start_kyoku',
    bakaze: 'E',
    dora_marker: '1p',
    kyoku: 1,
    honba: 0,
    kyotaku: 0,
    oya: 0,
    scores: [25000, 25000, 25000, 25000],
    tehais,
  };
}

function discard(actor: number, pai: string, tsumogiri = false): MJAIEvent {
  return { type: 'dahai', actor, pai, tsumogiri };
}

/** The stream never names our seat, so every update is told it. */
function update(state: RoundState, event: MJAIEvent): void {
  state.update(event, SEAT);
}

function withHand(hand: string[]): RoundState {
  const state = new RoundState();
  update(state, startGame());
  update(state, startKyoku(hand));
  return state;
}

describe('our hand behind a coarse call label', () => {
  it('names the two copies a pon takes, red five first', () => {
    const state = withHand([
      '1m',
      '2m',
      '3m',
      '4m',
      '5mr',
      '5m',
      '6m',
      '7m',
      '8m',
      '9m',
      '1p',
      '2p',
      '3p',
    ]);
    update(state, discard(OTHER, '5m'));

    expect(state.resolveCall('pon')).toEqual([{ type: 'pon', pai: '5m', consumed: ['5mr', '5m'] }]);
  });

  it('turns each chi label into the pair it claims next to the discard', () => {
    const hand = ['2m', '3m', '5m', '6m', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p'];
    const state = withHand(hand);
    update(state, discard(OTHER, '4m'));

    expect(state.resolveCall('chi_low')).toEqual([
      { type: 'chi', pai: '4m', consumed: ['5m', '6m'] },
    ]);
    expect(state.resolveCall('chi_mid')).toEqual([
      { type: 'chi', pai: '4m', consumed: ['3m', '5m'] },
    ]);
    expect(state.resolveCall('chi_high')).toEqual([
      { type: 'chi', pai: '4m', consumed: ['2m', '3m'] },
    ]);
  });

  it('leaves a chi the hand cannot pay for unresolved', () => {
    const state = withHand([
      '1m',
      '2m',
      '3m',
      '5m',
      '7m',
      '8m',
      '9m',
      '1p',
      '2p',
      '3p',
      '4p',
      '5p',
      '6p',
    ]);
    update(state, discard(OTHER, '4m'));

    expect(state.resolveCall('chi_low')).toEqual([]);
    expect(state.resolveCall('chi_mid')).toEqual([
      { type: 'chi', pai: '4m', consumed: ['3m', '5m'] },
    ]);
  });

  it('does not claim a discard once anything else happened', () => {
    const state = withHand([
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
    ]);
    update(state, discard(OTHER, '1m'));
    expect(state.resolveCall('pon')).toHaveLength(1);

    update(state, { type: 'tsumo', actor: SEAT, pai: '9s' });

    expect(state.resolveCall('pon')).toEqual([]);
  });

  it('offers only the kan the claim window allows', () => {
    // The table offers a 9p. The four 8p are a closed kan that only our own
    // draw could declare, so it must not become a second row.
    const state = withHand([
      '8p',
      '8p',
      '8p',
      '8p',
      '9p',
      '9p',
      '9p',
      'E',
      'E',
      'S',
      'S',
      'P',
      'P',
    ]);
    update(state, discard(OTHER, '9p'));

    expect(state.resolveCall('kan')).toEqual([
      { type: 'daiminkan', pai: '9p', consumed: ['9p', '9p', '9p'] },
    ]);
  });

  it('keeps a pon on the table for the next added kan', () => {
    const state = withHand([
      'E',
      'E',
      'E',
      '1m',
      '2m',
      '3m',
      '4m',
      '5m',
      '6m',
      '7m',
      '8m',
      '9m',
      '1p',
    ]);
    update(state, discard(OTHER, 'E'));
    update(state, {
      type: 'pon',
      actor: SEAT,
      target: OTHER,
      pai: 'E',
      consumed: ['E', 'E'],
    });

    // Another player's discard cannot be answered with an added kan.
    update(state, discard(OTHER, '9s'));
    expect(state.resolveCall('kan')).toEqual([]);

    update(state, { type: 'tsumo', actor: SEAT, pai: '9s' });
    expect(state.resolveCall('kan')).toEqual([{ type: 'kakan', pai: 'E', consumed: ['E'] }]);
  });

  it('adds the tile just drawn to a pon on the table', () => {
    const state = withHand([
      'E',
      'E',
      '1m',
      '2m',
      '3m',
      '4m',
      '5m',
      '6m',
      '7m',
      '8m',
      '9m',
      '1p',
      '2p',
    ]);
    update(state, discard(OTHER, 'E'));
    update(state, {
      type: 'pon',
      actor: SEAT,
      target: OTHER,
      pai: 'E',
      consumed: ['E', 'E'],
    });
    // The fourth copy arrives on the draw, which is the only moment a kan is on
    // offer: the hand has nothing left to pay with.
    update(state, { type: 'tsumo', actor: SEAT, pai: 'E' });

    expect(state.resolveCall('kan')).toEqual([{ type: 'kakan', pai: 'E', consumed: ['E'] }]);
  });

  it('closes a kan on the tile just drawn', () => {
    const state = withHand([
      '3p',
      '3p',
      '3p',
      '1m',
      '2m',
      '4m',
      '5m',
      '6m',
      '7m',
      '8m',
      '9m',
      '1s',
      '2s',
    ]);
    update(state, { type: 'tsumo', actor: SEAT, pai: '3p' });

    expect(state.resolveCall('kan')).toEqual([
      { type: 'ankan', consumed: ['3p', '3p', '3p', '3p'] },
    ]);
  });

  it('folds the draw into the hand before reading it', () => {
    const state = withHand([
      '3p',
      '3p',
      '3p',
      '1m',
      '2m',
      '4m',
      '5m',
      '6m',
      '7m',
      '8m',
      '9m',
      '1s',
      '2s',
    ]);
    update(state, { type: 'tsumo', actor: SEAT, pai: '3p' });
    update(state, discard(SEAT, '1m'));
    // The next draw would overwrite the pending tile if it had not been folded
    // into the hand by the discard.
    update(state, { type: 'tsumo', actor: SEAT, pai: '9s' });

    expect(state.resolveCall('kan')).toEqual([
      { type: 'ankan', consumed: ['3p', '3p', '3p', '3p'] },
    ]);
  });

  it('forgets the melds of the previous round', () => {
    const state = withHand([
      'E',
      'E',
      'E',
      '1m',
      '2m',
      '3m',
      '4m',
      '5m',
      '6m',
      '7m',
      '8m',
      '9m',
      '1p',
    ]);
    update(state, discard(OTHER, 'E'));
    update(state, {
      type: 'pon',
      actor: SEAT,
      target: OTHER,
      pai: 'E',
      consumed: ['E', 'E'],
    });

    update(
      state,
      startKyoku(['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '4p']),
    );
    update(state, discard(OTHER, '9s'));

    expect(state.resolveCall('kan')).toEqual([]);
  });
});

describe('the decision context', () => {
  const HAND = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '4p'];

  it('names our own seat as the win target on a self-draw', () => {
    const state = withHand(HAND);

    update(state, { type: 'tsumo', actor: SEAT, pai: '5s' });

    expect(state.lastDrawn).toBe('5s');
    expect(state.winTarget()).toBe(SEAT);
  });

  it('names the discarder as the win target on a ron', () => {
    const state = withHand(HAND);

    update(state, discard(OTHER, '3p'));

    expect(state.lastDiscard).toBe('3p');
    expect(state.winTarget()).toBe(OTHER);
  });

  it('treats a robbed kan as a ron on the added tile', () => {
    const state = withHand(HAND);

    update(state, { type: 'kakan', actor: OTHER, pai: '7s', consumed: ['7s', '7s', '7s'] });

    expect(state.lastDiscard).toBe('7s');
    expect(state.winTarget()).toBe(OTHER);
  });

  it('has no win target on a call of our own', () => {
    const state = withHand(['3m', '5m', ...HAND.slice(2)]);

    update(state, { type: 'chi', actor: SEAT, target: OTHER, pai: '4m', consumed: ['3m', '5m'] });

    expect(state.winTarget()).toBeNull();
  });

  it('closes the round for us when we win, and reopens it next round', () => {
    const state = withHand(HAND);

    update(state, {
      type: 'hora',
      actor: SEAT,
      target: SEAT,
      pai: '3p',
      scores: [25000, 25000, 25000, 25000],
      deltas: [8000, -4000, -4000, 0],
    });
    expect(state.won).toBe(true);

    update(state, startKyoku(HAND));
    expect(state.won).toBe(false);
  });
});
