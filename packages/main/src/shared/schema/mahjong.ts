export const MahjongConstants = {
  // 系统内所有理牌与比较牌的大小时的排序权重基准（共38种，含未知牌'?'）
  PAI_ORDER: [
    '1m',
    '2m',
    '3m',
    '4m',
    '5mr',
    '5m',
    '6m',
    '7m',
    '8m',
    '9m',
    '1p',
    '2p',
    '3p',
    '4p',
    '5pr',
    '5p',
    '6p',
    '7p',
    '8p',
    '9p',
    '1s',
    '2s',
    '3s',
    '4s',
    '5sr',
    '5s',
    '6s',
    '7s',
    '8s',
    '9s',
    'E',
    'S',
    'W',
    'N',
    'P',
    'F',
    'C',
    '?',
  ],

  // 座位数
  SEATS_3P: 3, // 三麻座位数
  SEATS_4P: 4, // 四麻座位数

  // 手牌数量
  TEHAI_SIZE: 13, // 配牌/手牌数量
  TSUMO_TEHAI_SIZE: 14, // 摸牌后手牌数量

  // 副露消耗牌数
  CHI_CONSUMED: 2, // 吃消耗的牌数
  PON_CONSUMED: 2, // 碰消耗的牌数
  DAIMINKAN_CONSUMED: 3, // 大明杠消耗的牌数
  ANKAN_TILES: 4, // 暗杠牌数
  KAKAN_CONSUMED: 3, // 加杠消耗的牌数
} as const;
