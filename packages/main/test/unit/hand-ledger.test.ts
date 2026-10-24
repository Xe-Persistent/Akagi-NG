/**
 * The red-five rules a call and a discard share. `MajsoulStateTracker` and the
 * HUD's `RoundState` both read the hand through this ledger, so the "which copy
 * leaves the hand" decision is checked here once.
 */
import { describe, expect, it } from 'vitest';

import { HandLedger } from '../../src/shared/hand-ledger.js';

describe('the hand ledger', () => {
  it('takes an exact match, so a red five is not spent on a plain one', () => {
    const hand = new HandLedger();
    hand.setTiles(['5m', '5mr']);

    expect(hand.removeConcealed('5mr')).toBe(true);
    expect(hand.tiles).toEqual(['5m']);
  });

  it('falls back to the base name when only the other colour is held', () => {
    const hand = new HandLedger();
    hand.setTiles(['5m', '1p']);

    expect(hand.removeConcealed('5mr')).toBe(true);
    expect(hand.tiles).toEqual(['1p']);
  });

  it('falls back the other way too', () => {
    const hand = new HandLedger();
    hand.setTiles(['5mr', '1p']);

    expect(hand.removeConcealed('5m')).toBe(true);
    expect(hand.tiles).toEqual(['1p']);
  });

  it('leaves the hand alone when the tile is not there', () => {
    const hand = new HandLedger();
    hand.setTiles(['5m', '1p']);

    expect(hand.removeConcealed('7z')).toBe(false);
    expect(hand.tiles).toEqual(['5m', '1p']);
  });

  it('spends the red five first when a call asks for copies', () => {
    const hand = new HandLedger();
    hand.setTiles(['5m', '5mr', '5m']);

    expect(hand.take('5m', 2)).toEqual(['5mr', '5m']);
    // `take` is read-only, so the same choice can be made again before playing.
    expect(hand.take('5m', 2)).toEqual(['5mr', '5m']);
    expect(hand.tiles).toEqual(['5m', '5mr', '5m']);
  });

  it('counts the tile just drawn as held when a call asks for copies', () => {
    const hand = new HandLedger();
    hand.setTiles(['1m', '2m']);
    hand.draw('9p');

    // A kan is declared on the tile just drawn, so the pool cannot be the
    // concealed hand alone.
    expect(hand.take('9p', 1)).toEqual(['9p']);
    expect(hand.pending).toBe('9p');
    expect(hand.tiles).toEqual(['1m', '2m']);
  });

  it('still spends the red five first when the drawn tile is the plain one', () => {
    const hand = new HandLedger();
    hand.setTiles(['5m', '5m']);
    hand.draw('5mr');

    expect(hand.take('5m', 3)).toEqual(['5mr', '5m', '5m']);
  });

  it('reports a call the hand cannot pay for', () => {
    const hand = new HandLedger();
    hand.setTiles(['5m', '1p']);

    expect(hand.take('5m', 3)).toBeNull();
  });

  it('folds the draw into the hand before a discard plays from it', () => {
    const hand = new HandLedger();
    hand.reset(['1m', '2m', '3m']);
    hand.draw('9p');

    expect(hand.discard('2m', false)).toBe(true);
    expect(hand.pending).toBeNull();
    // The draw joined the hand, and only the discarded tile left it.
    expect(hand.tiles).toEqual(['1m', '3m', '9p']);
  });

  it('plays the drawn tile itself without folding it into the hand', () => {
    const hand = new HandLedger();
    hand.reset(['1m', '2m', '3m']);
    hand.draw('9p');

    expect(hand.discard('9p', false)).toBe(true);
    expect(hand.pending).toBeNull();
    expect(hand.tiles).toEqual(['1m', '2m', '3m']);
  });

  it('reports a discard that was not where the event said it was', () => {
    const hand = new HandLedger();
    hand.reset(['1m', '2m', '3m']);

    expect(hand.discard('7z', false)).toBe(false);
    expect(hand.tiles).toEqual(['1m', '2m', '3m']);
  });

  it('takes the drawn tile for a call when the hand does not hold it', () => {
    const hand = new HandLedger();
    hand.reset(['1m', '2m']);
    hand.draw('9p');

    // An added kan or a north draw can take the tile that was just drawn.
    expect(hand.removeHeld('9p')).toBe(true);
    expect(hand.pending).toBeNull();
    expect(hand.tiles).toEqual(['1m', '2m']);
  });
});
