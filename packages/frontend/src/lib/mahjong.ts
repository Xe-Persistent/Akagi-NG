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

/** One tile of a call, as the HUD draws it. */
export interface MeldSlot {
  tile: string;
  /** Turned face-down: a closed kan exposes only its middle pair. */
  isBack: boolean;
}

/** A closed kan's four tiles, the outer two turned over. */
function closedKanSlots(tiles: string[]): MeldSlot[] {
  return tiles.map((tile, index) => ({ tile, isBack: index === 0 || index === 3 }));
}

/**
 * The tiles of a call in the order the HUD draws them.
 *
 * Everything is sorted the way a hand is, which already puts the red five before
 * its plain twins. A closed kan is the exception: it claims nothing from the
 * table, its outer two tiles are turned over, and the red five -- always among
 * the four, since a suit five only has four copies -- is shown second from the
 * left, first of the two that stay visible.
 */
export function meldSlots(action: string, consumed: string[]): MeldSlot[] {
  const sorted = sortTiles(consumed);
  if (action !== 'kan' || sorted.length !== 4) {
    return sorted.map((tile) => ({ tile, isBack: false }));
  }

  const aka = sorted.find((tile) => tile.endsWith('r'));
  if (aka === undefined) return closedKanSlots(sorted);

  const [first, second, third] = sorted.filter((tile) => tile !== aka);
  // Fewer than four copies left around the red one is not a hand this game can
  // deal, so the sorted order is the best that can be said about it.
  if (first === undefined || second === undefined || third === undefined) {
    return closedKanSlots(sorted);
  }
  return closedKanSlots([first, aka, second, third]);
}
