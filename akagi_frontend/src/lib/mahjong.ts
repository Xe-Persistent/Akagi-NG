/**
 * Gets the numeric value of a Mahjong tile for sorting.
 * e.g., '1m' -> 1, '5p' -> 5.
 * Non-numeric tiles or failures return 99 to sort to the end.
 * @param tile The tile string (e.g., '1m', '2p', 'east')
 */
export const getTileSortValue = (tile: string): number => {
  // Very simple heuristic for sorting, relies on tile naming convention (e.g. 1m, 2p)
  const val = parseInt(tile[0]);
  return isNaN(val) ? 99 : val;
};

/**
 * Sorts an array of tiles based on their numeric value.
 * @param tiles Array of tile strings
 */
export const sortTiles = (tiles: string[]): string[] => {
  return [...tiles].sort((a, b) => getTileSortValue(a) - getTileSortValue(b));
};
