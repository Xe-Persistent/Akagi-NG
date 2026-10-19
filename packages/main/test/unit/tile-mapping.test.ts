import { describe, expect, it } from 'vitest';

import {
  comparePai,
  getPaiSortKey,
  MJAI_TILE_2_MS_TILE,
  MS_TILE_2_MJAI_TILE,
  toMjaiTile,
} from '../../src/protocol/majsoul/tile-mapping.js';

describe('Majsoul tile codes', () => {
  it('keeps the suits as they are', () => {
    expect(toMjaiTile('1m')).toBe('1m');
    expect(toMjaiTile('9p')).toBe('9p');
    expect(toMjaiTile('5s')).toBe('5s');
  });

  it('turns the zero code into the red five', () => {
    expect(toMjaiTile('0m')).toBe('5mr');
    expect(toMjaiTile('0p')).toBe('5pr');
    expect(toMjaiTile('0s')).toBe('5sr');
  });

  it('turns honours into mjai letters', () => {
    expect(['1z', '2z', '3z', '4z', '5z', '6z', '7z'].map(toMjaiTile)).toEqual([
      'E',
      'S',
      'W',
      'N',
      'P',
      'F',
      'C',
    ]);
  });

  it('refuses a code the protocol does not define', () => {
    expect(() => toMjaiTile('zz')).toThrow(/Unknown Majsoul tile code/);
    expect(() => toMjaiTile('8z')).toThrow();
  });

  it('has a reverse entry for every forward one', () => {
    for (const [majsoul, mjai] of Object.entries(MS_TILE_2_MJAI_TILE)) {
      expect(MJAI_TILE_2_MS_TILE[mjai]).toBe(majsoul);
    }
    expect(Object.keys(MJAI_TILE_2_MS_TILE)).toHaveLength(Object.keys(MS_TILE_2_MJAI_TILE).length);
  });
});

describe('ordering tiles', () => {
  it('orders suits by rank', () => {
    expect(getPaiSortKey('1m')).toBeLessThan(getPaiSortKey('9m'));
    expect(getPaiSortKey('9m')).toBeLessThan(getPaiSortKey('1p'));
  });

  it('puts honours last and the unknown tile after them', () => {
    expect(getPaiSortKey('9s')).toBeLessThan(getPaiSortKey('E'));
    expect(getPaiSortKey('C')).toBeLessThan(getPaiSortKey('?'));
  });

  it('sorts an unknown code to the very end', () => {
    expect(getPaiSortKey('zz')).toBe(999);
  });

  it('compares with the sign sort expects', () => {
    expect(comparePai('1m', '9m')).toBeLessThan(0);
    expect(comparePai('9m', '1m')).toBeGreaterThan(0);
    expect(comparePai('5p', '5p')).toBe(0);
    expect(comparePai('E', '9s')).toBeGreaterThan(0);
  });

  it('puts the red five before the plain one', () => {
    const hand = ['?', 'E', '9s', '5mr', '1p', '1m', '5m'];

    expect([...hand].sort(comparePai)).toEqual(['1m', '5mr', '5m', '1p', '9s', 'E', '?']);
  });
});
