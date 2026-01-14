"""麻将游戏和协议相关的常量定义"""


class MahjongConstants:
    """麻将游戏常量"""

    # 座位数
    SEATS_3P = 3  # 三麻座位数
    SEATS_4P = 4  # 四麻座位数

    # 手牌数量
    TEHAI_SIZE = 13  # 配牌/手牌数量
    TSUMO_TEHAI_SIZE = 14  # 摸牌后手牌数量

    # 副露消耗牌数
    CHI_CONSUMED = 2  # 吃消耗的牌数
    PON_CONSUMED = 2  # 碰消耗的牌数
    DAIMINKAN_CONSUMED = 3  # 大明杠消耗的牌数
    ANKAN_TILES = 4  # 暗杠牌数
    KAKAN_CONSUMED = 3  # 加杠消耗的牌数

    # 特殊状态
    MIN_RIICHI_CANDIDATES = 5  # 立直前瞻候选数


class LiqiProtocolConstants:
    """Liqi 协议常量"""

    # 消息块类型
    MSG_BLOCK_SIZE = 2  # 标准消息块大小
    BLOCK_TYPE_VARINT = 0  # varint 类型
    BLOCK_TYPE_STRING = 2  # string 类型

    # 空数据长度
    EMPTY_DATA_LEN = 0  # 空数据长度


class ModelConstants:
    """模型相关常量"""

    MODEL_VERSION_4 = 4  # Mortal模型版本4
