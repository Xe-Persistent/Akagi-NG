"""天凤协议常量定义"""


class TenhouConstants:
    """天凤协议常量"""

    TILES_PER_TYPE = 4  # 每种牌的数量

    # 逻辑常量
    TILES_PER_SUIT = 9
    CHI_OFFSET = 3
    MAGIC_LIMIT_6 = 6
    MAGIC_LIMIT_2 = 2
    PEI_INDEX = 30
    BIT_MASK_M = 0x3F
    BIT_NUKIDORA = 0x20

    # N 类型值
    TYPE_PON = 1
    TYPE_DAIMINKAN = 2
    TYPE_CHI = 3
    TYPE_ANKAN = 4
    TYPE_KAKAN = 5
    TYPE_RON = 6
    TYPE_TSUMO = 7
    TYPE_RYUKYOKU = 9
    TYPE_NUKIDORA = 10
