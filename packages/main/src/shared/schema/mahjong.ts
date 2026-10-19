/**
 * The shape of a mahjong table, shared by everything that has to know one: the
 * protocol bridge, the round tracker and the reconnect replay.
 *
 * Only table-level vocabulary belongs here. What one wire message happens to
 * report -- how many tiles a pon names, say -- is that parser's business and
 * lives with it.
 */
export const MahjongConstants = {
  // Stand-in for a tile that has not been revealed yet.
  UNKNOWN_TILE: '?',

  SEATS_3P: 3,
  SEATS_4P: 4,

  TEHAI_SIZE: 13,
  TSUMO_TEHAI_SIZE: 14,
} as const;
