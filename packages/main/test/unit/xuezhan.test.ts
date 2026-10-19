import { describe, expect, it } from 'vitest';

import { applySwap, isXuezhanRule } from '../../src/protocol/majsoul/xuezhan.js';

describe('recognising the blood battle', () => {
  it('reads the flag from the room rules', () => {
    expect(isXuezhanRule({ mode: { detailRule: { xuezhandaodi: 1 } } })).toBe(true);
  });

  it('is false for a plain room', () => {
    expect(isXuezhanRule({ mode: { detailRule: { xuezhandaodi: 0 } } })).toBe(false);
    expect(isXuezhanRule({ mode: { detailRule: {} } })).toBe(false);
  });

  it('survives a payload without the rules', () => {
    expect(isXuezhanRule({})).toBe(false);
    expect(isXuezhanRule({ mode: {} })).toBe(false);
    expect(isXuezhanRule(undefined)).toBe(false);
  });
});

describe('applying the opening swap', () => {
  const hand = ['1m', '2m', '3m', '5m', '5m', '7p', '8p', '9p', '1s', '2s', '3s', 'E', 'E'];

  it('removes what left and adds what arrived', () => {
    const { hand: after, missing } = applySwap(hand, ['1m', 'E'], ['9s', 'C']);

    expect(missing).toEqual([]);
    expect(after).toHaveLength(13);
    expect(after).not.toContain('1m');
    // Only one of the two east winds leaves.
    expect(after.filter((tile) => tile === 'E')).toHaveLength(1);
    expect(after).toContain('9s');
    expect(after).toContain('C');
  });

  it('takes one occurrence at a time when the hand holds a pair', () => {
    const { hand: after } = applySwap(hand, ['5m'], ['5pr']);

    expect(after.filter((tile) => tile === '5m')).toHaveLength(1);
    expect(after).toContain('5pr');
  });

  it('reports a tile that was not in the hand and leaves the rest alone', () => {
    const { hand: after, missing } = applySwap(hand, ['7z', '2m'], ['5s']);

    expect(missing).toEqual(['7z']);
    expect(after).not.toContain('2m');
    expect(after).toContain('5s');
    // One tile out, one tile in: the hand keeps its size.
    expect(after).toHaveLength(13);
  });

  it('does not mutate the dealt hand', () => {
    const before = [...hand];
    applySwap(hand, ['1m'], ['9s']);

    expect(hand).toEqual(before);
  });
});
