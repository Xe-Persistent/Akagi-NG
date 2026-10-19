// Majsoul -> MJAI tile codes.
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

// Reverse of the table above.
export const MJAI_TILE_2_MS_TILE: Record<string, string> = {};
for (const [k, v] of Object.entries(MS_TILE_2_MJAI_TILE)) {
  MJAI_TILE_2_MS_TILE[v] = k;
}

/**
 * Turns a Majsoul tile code into an MJAI one.
 *
 * An unmapped code throws rather than returning something: a tile the protocol
 * does not define is bad data, and dropping it silently would hand the engine an
 * event with a missing field and skew every event after it.
 */
export function toMjaiTile(tile: string): string {
  const mapped = MS_TILE_2_MJAI_TILE[tile];
  if (mapped === undefined) {
    throw new Error(`Unknown Majsoul tile code: ${JSON.stringify(tile)}`);
  }
  return mapped;
}

const SUITS = 'mps';
const HONOURS = 'ESWNPFC'; // east, south, west, north, white, green, red

/** A code the protocol does not define sorts last. */
const LAST = 999;

/**
 * Sort weight of a tile, in the same order the renderer uses (`lib/mahjong.ts`):
 * each suit by rank with the red five just before the plain one, then the
 * honours.
 */
export function getPaiSortKey(pai: string): number {
  const isRed = pai.endsWith('r');
  const base = isRed ? pai.slice(0, -1) : pai;
  const suit = base.at(-1) ?? '';
  const suitIndex = SUITS.indexOf(suit);

  if (suitIndex >= 0) {
    const rank = Number.parseInt(base[0], 10);
    if (Number.isNaN(rank)) return LAST;
    return suitIndex * 100 + rank * 2 + (isRed ? 0 : 1);
  }

  const honour = HONOURS.indexOf(suit);
  return honour >= 0 ? 300 + honour : LAST;
}

export function comparePai(pai1: string, pai2: string): number {
  return getPaiSortKey(pai1) - getPaiSortKey(pai2);
}
