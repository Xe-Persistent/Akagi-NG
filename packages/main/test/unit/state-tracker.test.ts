import { beforeEach, describe, expect, it } from 'vitest';

import { MajsoulStateTracker } from '../../src/protocol/majsoul/state-tracker.js';
import { comparePai, toMjaiTile } from '../../src/protocol/majsoul/tile-mapping.js';

const UNKNOWN = '?';

/** A dealer's fourteen dealt tiles. */
const DEAL = ['9m', '1m', '3m', '5m', '6m', '7m', '1p', '1p', '5p', '9p', '1z', '1z', '2z', '4s'];

describe('the Majsoul state tracker', () => {
  let tracker: MajsoulStateTracker;

  beforeEach(() => {
    tracker = new MajsoulStateTracker();
  });

  it('starts with an unknown thirteen-tile hand', () => {
    expect(tracker.myTehais).toHaveLength(13);
    expect(tracker.myTehais.every((tile) => tile === UNKNOWN)).toBe(true);
    expect(tracker.myTsumohai).toBe(UNKNOWN);
    expect(tracker.seat).toBe(0);
    expect(tracker.is3p).toBe(false);
  });

  describe('opening a round', () => {
    it('splits the fourteen dealt tiles into a sorted hand and the draw', () => {
      const round = tracker.setupNewRound(DEAL);

      expect(round).not.toBeNull();
      expect(tracker.myTehais).toHaveLength(13);
      expect(tracker.myTehais).not.toContain(UNKNOWN);
      expect([...tracker.myTehais].sort(comparePai)).toEqual(tracker.myTehais);
      // The payload's last tile is the one that was drawn, not the highest sorted.
      expect(tracker.myTsumohai).toBe(toMjaiTile(DEAL[13]));
      expect([...(tracker.myTehais as string[]), tracker.myTsumohai].sort()).toEqual(
        DEAL.map(toMjaiTile).sort(),
      );
    });

    it('keeps the drawn tile out of the thirteen the round opens with', () => {
      const round = tracker.setupNewRound(DEAL);

      // Same multiset as the payload's first thirteen, so a duplicate of the
      // drawn tile stays in the hand only as many times as it was dealt.
      expect([...(round?.tehais[0] ?? [])].sort()).toEqual(
        DEAL.slice(0, 13).map(toMjaiTile).sort(),
      );
    });

    it('fills our seat and masks the others', () => {
      const round = tracker.setupNewRound(DEAL);

      expect(round?.tehais).toHaveLength(4);
      expect(round?.tehais[0]).toEqual(tracker.myTehais);
      for (const hand of round?.tehais.slice(1) ?? []) {
        expect(hand).toHaveLength(13);
        expect(hand.every((tile) => tile === UNKNOWN)).toBe(true);
      }
    });

    it('accepts a thirteen-tile deal with no draw', () => {
      const round = tracker.setupNewRound(DEAL.slice(0, 13));

      expect(round?.myTsumohai).toBeNull();
      expect(tracker.myTsumohai).toBeNull();
      expect(tracker.myTehais).toHaveLength(13);
    });

    it('refuses a deal of the wrong length', () => {
      expect(tracker.setupNewRound(['1m', '2m', '3m'])).toBeNull();
      expect(tracker.setupNewRound([...DEAL, '7z'])).toBeNull();
    });
  });

  describe('moving the draw into the hand', () => {
    it('sorts it in and forgets it', () => {
      tracker.setupNewRound(DEAL);
      const drawn = tracker.myTsumohai;

      tracker.saveTsumohaiToHand();

      expect(tracker.myTsumohai).toBeNull();
      expect(tracker.myTehais).toHaveLength(14);
      expect(tracker.myTehais).toContain(drawn);
    });

    it('does nothing when there is no draw', () => {
      tracker.setupNewRound(DEAL.slice(0, 13));

      tracker.saveTsumohaiToHand();

      expect(tracker.myTehais).toHaveLength(13);
    });
  });

  describe('removing a tile from the hand', () => {
    beforeEach(() => {
      tracker.setupNewRound(DEAL);
    });

    it('takes an exact match, so a red five is not spent on a plain one', () => {
      tracker.myTehais = ['5m', '5mr'];

      tracker.removeTileFromHand('5mr');

      expect(tracker.myTehais).toEqual(['5m']);
    });

    it('falls back to the base name when only the other colour is held', () => {
      tracker.myTehais = ['5m', '1p'];

      tracker.removeTileFromHand('5mr');

      expect(tracker.myTehais).toEqual(['1p']);
    });

    it('falls back the other way too', () => {
      tracker.myTehais = ['5mr', '1p'];

      tracker.removeTileFromHand('5m');

      expect(tracker.myTehais).toEqual(['1p']);
    });

    it('leaves the hand alone when the tile is not there', () => {
      const before = [...tracker.myTehais];

      tracker.removeTileFromHand('7z');

      expect(tracker.myTehais).toEqual(before);
    });
  });

  describe('discarding', () => {
    it('ignores another seat', () => {
      tracker.setupNewRound(DEAL);
      const before = [...tracker.myTehais];

      tracker.onDiscard(1, '1m', false);

      expect(tracker.myTehais).toEqual(before);
    });

    it('drops the draw when the discard is a tsumogiri', () => {
      tracker.setupNewRound(DEAL);
      const hand = [...tracker.myTehais];

      tracker.onDiscard(0, tracker.myTsumohai ?? '', true);

      expect(tracker.myTsumohai).toBeNull();
      expect(tracker.myTehais).toEqual(hand);
    });

    it('drops a held tile when the discard is from the hand, after the draw joins it', () => {
      tracker.setupNewRound(DEAL);
      const drawn = tracker.myTsumohai ?? '';
      const held = tracker.myTehais[0];

      tracker.onDiscard(0, held, false);

      // The draw moves into the hand first, so the hand is back to thirteen.
      expect(tracker.myTsumohai).toBeNull();
      expect(tracker.myTehais).toHaveLength(13);
      expect(tracker.myTehais).not.toContain(held);
      expect(tracker.myTehais).toContain(drawn);
    });

    it('drops the draw when the discarded tile is the one just drawn', () => {
      tracker.setupNewRound(DEAL);
      tracker.myTehais = tracker.myTehais.filter((tile) => tile !== tracker.myTsumohai);
      const drawn = tracker.myTsumohai ?? '';

      tracker.onDiscard(0, drawn, false);

      expect(tracker.myTsumohai).toBeNull();
    });
  });
});
