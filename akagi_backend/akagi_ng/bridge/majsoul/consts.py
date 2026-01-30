"""雀魂协议常量定义"""


class OperationChiPengGang:
    """吃碰杠操作类型"""

    Chi = 0
    Peng = 1
    Gang = 2


class OperationAnGangAddGang:
    """暗杠/加杠操作类型"""

    AnGang = 3
    AddGang = 2


class LiqiProtocolConstants:
    """Liqi 协议常量"""

    # 消息块类型
    MSG_BLOCK_SIZE = 2  # 标准消息块大小
    BLOCK_TYPE_VARINT = 0  # varint 类型
    BLOCK_TYPE_STRING = 2  # string 类型

    # 空数据长度
    EMPTY_DATA_LEN = 0  # 空数据长度
