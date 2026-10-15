import { MahjongConstants } from '../../schema/constants.js';

// 雀魂 -> MJAI 牌面映射
export const MS_TILE_2_MJAI_TILE: Record<string, string> = {
  '0m': '5mr',
  '1m': '1m',
  '2m': '2m',
  '3m': '3m',
  '4m': '4m',
  '5m': '5m',
  '6m': '6m',
  '7m': '7m',
  '8m': '8m',
  '9m': '9m',
  '0p': '5pr',
  '1p': '1p',
  '2p': '2p',
  '3p': '3p',
  '4p': '4p',
  '5p': '5p',
  '6p': '6p',
  '7p': '7p',
  '8p': '8p',
  '9p': '9p',
  '0s': '5sr',
  '1s': '1s',
  '2s': '2s',
  '3s': '3s',
  '4s': '4s',
  '5s': '5s',
  '6s': '6s',
  '7s': '7s',
  '8s': '8s',
  '9s': '9s',
  '1z': 'E',
  '2z': 'S',
  '3z': 'W',
  '4z': 'N',
  '5z': 'P',
  '6z': 'F',
  '7z': 'C',
};

// 自动生成的反向映射: MJAI -> 雀魂
export const MJAI_TILE_2_MS_TILE: Record<string, string> = {};
for (const [k, v] of Object.entries(MS_TILE_2_MJAI_TILE)) {
  MJAI_TILE_2_MS_TILE[v] = k;
}

/**
 * 将雀魂牌码转换为 MJAI 牌码。
 *
 * 未知牌码会抛出异常 —— 雀魂协议里没有对应映射的牌是数据异常，
 * 静默丢弃会让引擎拿到缺字段的事件并从此错位。
 */
export function toMjaiTile(tile: string): string {
  const mapped = MS_TILE_2_MJAI_TILE[tile];
  if (mapped === undefined) {
    throw new Error(`Unknown Majsoul tile code: ${JSON.stringify(tile)}`);
  }
  return mapped;
}

// 优化排序查找字典
export const PAI_ORDER_INDEX: Record<string, number> = {};
MahjongConstants.PAI_ORDER.forEach((pai: string, i: number) => {
  PAI_ORDER_INDEX[pai] = i;
});

export function getPaiSortKey(pai: string): number {
  return PAI_ORDER_INDEX[pai] ?? 999;
}

/**
 * 比较两张牌的大小,用于排序。
 *
 * 返回值:
 *  < 0: pai1 < pai2
 *  === 0: pai1 == pai2
 *  > 0: pai1 > pai2
 */
export function comparePai(pai1: string, pai2: string): number {
  const idx1 = getPaiSortKey(pai1);
  const idx2 = getPaiSortKey(pai2);
  return idx1 - idx2;
}
