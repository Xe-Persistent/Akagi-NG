/**
 * 获取麻将牌的排序权重
 * 数牌取数字大小，例如：'1m' -> 1, '5p' -> 5
 * 字牌返回 99 排到最后
 *
 * 只比较点数、不区分花色；调用方只对同一副露内的牌排序，花色必然一致。
 */
const getTileSortValue = (tile: string): number => {
  const value = Number.parseInt(tile[0], 10);
  return Number.isNaN(value) ? 99 : value;
};

/**
 * 以数字为基准，对麻将牌进行排序
 * @param tiles 麻将牌数组
 */
export const sortTiles = (tiles: string[]): string[] => {
  return [...tiles].sort((a, b) => getTileSortValue(a) - getTileSortValue(b));
};
