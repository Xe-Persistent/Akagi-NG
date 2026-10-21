/**
 * The vocabulary of a mahjong table, shared by everything that has to know one:
 * the protocol bridge, the round tracker, the reconnect replay, the online
 * window shaper and the HUD's state reconstruction.
 */
export const MAHJONG = {
  // Stand-in for a tile that has not been revealed yet.
  UNKNOWN_TILE: '?',
  // The north tile: the one a sanma nukidora takes.
  NORTH_TILE: 'N',
  // Suffix that marks the red five of a suit (`5mr`, `5pr`, `5sr`).
  RED_FIVE_SUFFIX: 'r',
  // The numbered suits, in the order the renderer sorts them.
  SUITS: 'mps',
  // The honour tiles, in the order the renderer sorts them.
  HONOURS: 'ESWNPFC',
  // Round winds by index: east, south, west, north.
  ROUND_WIND_TILES: ['E', 'S', 'W', 'N'],

  SEATS_3P: 3,
  SEATS_4P: 4,

  TEHAI_SIZE: 13,
  TEHAI_SIZE_WITH_DRAW: 14,
} as const;

/**
 * How many tiles a call carries in `consumed`; the claimed tile is reported
 * separately as `pai`. The wire parser validates the counts and the HUD rebuilds
 * the same combination from our hand, so both read them from here.
 */
export const MELD_TILE_COUNTS = {
  chi: 2,
  pon: 2,
  daiminkan: 3,
  ankan: 4,
  kakan: 3,
} as const;
