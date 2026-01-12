/**
 * 获取麻将牌的排序权重
 * 例如：'1m' -> 1, '5p' -> 5
 * 非数字牌返回 99 排到末尾
 */
export const getTileSortValue = (tile: string): number => {
  // 简单排序：依赖牌名格式（如 1m, 2p）
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
