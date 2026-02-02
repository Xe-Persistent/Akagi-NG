/**
 * 获取麻将牌的排序权重
 * 数牌取数字大小，例如：'1m' -> 1, '5p' -> 5
 * 字牌返回 99 排到最后
 */
export const getTileSortValue = (tile: string): number => {
  const val = parseInt(tile[0]);
  return isNaN(val) ? 99 : val;
};

/**
 * 以数字为基准，对麻将牌进行排序
 * @param tiles 麻将牌数组
 */
export const sortTiles = (tiles: string[]): string[] => {
  return [...tiles].sort((a, b) => getTileSortValue(a) - getTileSortValue(b));
};
