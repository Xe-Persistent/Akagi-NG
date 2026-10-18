/**
 * Sort weight of a tile: the rank for suits ('1m' -> 1, '5p' -> 5), 99 for
 * honours so they land last.
 *
 * Rank only, no suit: callers sort within one meld, where the suit is fixed.
 */
const getTileSortValue = (tile: string): number => {
  const value = Number.parseInt(tile[0], 10);
  return Number.isNaN(value) ? 99 : value;
};

export const sortTiles = (tiles: string[]): string[] => {
  return [...tiles].sort((a, b) => getTileSortValue(a) - getTileSortValue(b));
};
