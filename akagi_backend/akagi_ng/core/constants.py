"""麻将游戏和协议相关的常量定义"""

from enum import StrEnum


class Platform(StrEnum):
    AUTO = "auto"
    MAJSOUL = "majsoul"
    TENHOU = "tenhou"
    RIICHI_CITY = "riichi_city"
    AMATSUKI = "amatsuki"


DEFAULT_GAME_URLS = {
    Platform.MAJSOUL: "https://game.maj-soul.com/1/",
    Platform.TENHOU: "https://tenhou.net/3/",
    Platform.RIICHI_CITY: "https://riichi.city/",
    Platform.AMATSUKI: "https://amatsuki-mj.jp/",
}


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


class ModelConstants:
    """模型相关常量"""

    MODEL_VERSION_1 = 1
    MODEL_VERSION_2 = 2
    MODEL_VERSION_3 = 3
    MODEL_VERSION_4 = 4


class ServerConstants:
    """服务器和网络相关常量"""

    # SSE相关
    SSE_MAX_NOTIFICATION_HISTORY = 10  # 最大通知历史记录数
    SSE_KEEPALIVE_INTERVAL_SECONDS = 10  # SSE 保活间隔(秒)
    MESSAGE_QUEUE_MAXSIZE = 1000  # 核心/客户端消息队列最大大小
    SHUTDOWN_JOIN_TIMEOUT_SECONDS = 2.0  # 线程退出等待时间
    MAIN_LOOP_POLL_TIMEOUT_SECONDS = 0.1  # 主循环轮询超时时间
