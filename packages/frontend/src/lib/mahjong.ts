const SUITS = 'mps';
const HONOURS = 'ESWNPFC'; // east, south, west, north, white, green, red

/** A code the protocol does not define sorts last. */
const LAST = 999;

/**
 * Sort weight of a tile, in the same order the main process uses
 * (`getPaiSortKey`): each suit by rank with the red five just before the plain
 * one, then the honours.
 */
const getTileSortKey = (tile: string): number => {
  const isRed = tile.endsWith('r');
  const base = isRed ? tile.slice(0, -1) : tile;
  const suit = base.at(-1) ?? '';
  const suitIndex = SUITS.indexOf(suit);

  if (suitIndex >= 0) {
    const rank = Number.parseInt(base.charAt(0), 10);
    if (Number.isNaN(rank)) return LAST;
    return suitIndex * 100 + rank * 2 + (isRed ? 0 : 1);
  }

  const honour = HONOURS.indexOf(suit);
  return honour >= 0 ? 300 + honour : LAST;
};

export const sortTiles = (tiles: string[]): string[] => {
  return [...tiles].sort((a, b) => getTileSortKey(a) - getTileSortKey(b));
};
