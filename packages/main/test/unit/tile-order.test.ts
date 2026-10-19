/**
 * The renderer and the main process each carry their own tile order -- they do
 * not share a module -- so this is the test that keeps the two copies honest.
 * Any change to one of them that the other does not mirror fails here.
 */
import { describe, expect, it } from 'vitest';

import { sortTiles } from '../../../frontend/src/lib/mahjong.js';
import {
  comparePai,
  getPaiSortKey,
  MS_TILE_2_MJAI_TILE,
} from '../../src/protocol/majsoul/tile-mapping.js';

/** Every code either side can be handed, plus one neither of them knows. */
const TILES = [...new Set(Object.values(MS_TILE_2_MJAI_TILE)), '?', 'zz'];

/** The worst possible input order, and the same one on every run. */
const scrambled = [...TILES].sort((a, b) => getPaiSortKey(b) - getPaiSortKey(a));

describe('the tile order on both sides', () => {
  it('sorts a scrambled list identically', () => {
    expect(sortTiles(scrambled)).toEqual([...scrambled].sort(comparePai));
  });

  it('orders every pair the same way', () => {
    const disagreements: string[] = [];

    for (const a of TILES) {
      for (const b of TILES) {
        const ours = sortTiles([a, b]);
        const theirs = [a, b].sort(comparePai);
        if (ours[0] !== theirs[0] || ours[1] !== theirs[1]) {
          disagreements.push(`${a} vs ${b}: ${ours.join('')} / ${theirs.join('')}`);
        }
      }
    }

    expect(disagreements).toEqual([]);
  });

  it('puts the five tiles in the same place', () => {
    const five = ['5mr', '5m', '5p', '5pr', '5s', '5sr'];

    expect(sortTiles(five)).toEqual([...five].sort(comparePai));
    expect(sortTiles(five)).toEqual(['5mr', '5m', '5pr', '5p', '5sr', '5s']);
  });

  it('agrees on where the unknown tiles go', () => {
    for (const unknown of ['?', 'zz', '']) {
      expect(sortTiles(['C', unknown, '1m'])[2]).toBe(unknown);
      expect(getPaiSortKey(unknown)).toBe(999);
    }
  });
});
