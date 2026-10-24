import { describe, expect, it } from 'vitest';

import { meldSlots, sortTiles } from '@/lib/mahjong';

describe('the tiles of a call', () => {
  it('draws a closed kan as four tiles with its outer pair face-down', () => {
    expect(meldSlots('kan', ['5s', '5sr', '5s', '5s'])).toEqual([
      { tile: '5s', isBack: true },
      { tile: '5sr', isBack: false },
      { tile: '5s', isBack: false },
      { tile: '5s', isBack: true },
    ]);
  });

  it('puts the red five second from the left whichever order it arrives in', () => {
    expect(meldSlots('kan', ['5sr', '5s', '5s', '5s'])).toEqual(
      meldSlots('kan', ['5s', '5s', '5sr', '5s']),
    );
  });

  it('keeps a closed kan without a red five in sorted order', () => {
    expect(meldSlots('kan', ['3p', '1p', '3p', '2p'])).toEqual([
      { tile: '1p', isBack: true },
      { tile: '2p', isBack: false },
      { tile: '3p', isBack: false },
      { tile: '3p', isBack: true },
    ]);
  });

  it('leaves an open kan face-up, the red five first', () => {
    expect(meldSlots('kan', ['5s', '5s', '5sr'])).toEqual([
      { tile: '5sr', isBack: false },
      { tile: '5s', isBack: false },
      { tile: '5s', isBack: false },
    ]);
  });

  it('leaves a pon face-up, the red five first', () => {
    expect(meldSlots('pon', ['5s', '5sr'])).toEqual([
      { tile: '5sr', isBack: false },
      { tile: '5s', isBack: false },
    ]);
  });

  it('sorts a chi face-up', () => {
    expect(meldSlots('chi', ['5s', '4s']).map((slot) => slot.tile)).toEqual(['4s', '5s']);
  });
});

describe('sorting tiles', () => {
  it('orders suits by rank', () => {
    expect(sortTiles(['9m', '1m', '5m'])).toEqual(['1m', '5m', '9m']);
  });

  it('puts the suits in man, pin, sou order', () => {
    expect(sortTiles(['1s', '1p', '1m', '9p', '9m'])).toEqual(['1m', '9m', '1p', '9p', '1s']);
  });

  it('puts the red five before the plain one', () => {
    expect(sortTiles(['6m', '5m', '5mr', '4m'])).toEqual(['4m', '5mr', '5m', '6m']);
  });

  it('orders the honours east to red', () => {
    expect(sortTiles(['C', 'F', 'P', 'N', 'W', 'S', 'E'])).toEqual([
      'E',
      'S',
      'W',
      'N',
      'P',
      'F',
      'C',
    ]);
  });

  it('puts every honour after every suit', () => {
    expect(sortTiles(['E', '1p', 'S', '9s'])).toEqual(['1p', '9s', 'E', 'S']);
  });

  it('puts the unknown tile last', () => {
    expect(sortTiles(['?', 'C', '1m', 'E'])).toEqual(['1m', 'E', 'C', '?']);
  });

  it('leaves a code it does not know at the end, in input order', () => {
    expect(sortTiles(['zz', '9s', '??'])).toEqual(['9s', 'zz', '??']);
  });

  it('leaves the argument alone', () => {
    const tiles = ['3s', '1s'];
    sortTiles(tiles);

    expect(tiles).toEqual(['3s', '1s']);
  });

  it('matches the main process order for a whole hand', () => {
    const hand = ['?', 'C', 'F', '9s', '5sr', '5s', '1p', '4m', '5mr', '5m', '1m', 'E'];

    expect(sortTiles(hand)).toEqual([
      '1m',
      '4m',
      '5mr',
      '5m',
      '1p',
      '5sr',
      '5s',
      '9s',
      'E',
      'F',
      'C',
      '?',
    ]);
  });
});
