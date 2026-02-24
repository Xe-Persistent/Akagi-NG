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

    # 麻将牌全局常量
    # fmt: off
    # 标准34种基本牌加上3种红5 (共37种)
    # 这是绝大部分需要遍历或初始化掩码时的基础集合
    BASE_TILES = (
        "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m",
        "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p",
        "1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s",
        "E", "S", "W", "N", "P", "F", "C",
        "5mr", "5pr", "5sr",
    )

    # 系统内所有理牌与比较牌的大小时的排序权重基准（共38种，含未知牌'?'）
    PAI_ORDER = (
        "1m", "2m", "3m", "4m", "5mr", "5m", "6m", "7m", "8m", "9m",
        "1p", "2p", "3p", "4p", "5pr", "5p", "6p", "7p", "8p", "9p",
        "1s", "2s", "3s", "4s", "5sr", "5s", "6s", "7s", "8s", "9s",
        "E", "S", "W", "N", "P", "F", "C", "?",
    )
    # fmt: on

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

    # 动作空间维度
    ACTION_DIMS_3P = 44  # 三麻动作空间维度
    ACTION_DIMS_4P = 46  # 四麻动作空间维度


class ServerConstants:
    """服务器和网络相关常量"""

    # SSE相关
    SSE_MAX_NOTIFICATION_HISTORY = 10  # 最大通知历史记录数
    SSE_KEEPALIVE_INTERVAL_SECONDS = 10  # SSE 保活间隔(秒)
    MESSAGE_QUEUE_MAXSIZE = 1000  # 核心/客户端消息队列最大大小
    SHUTDOWN_JOIN_TIMEOUT_SECONDS = 2.0  # 线程退出等待时间
    MAIN_LOOP_POLL_TIMEOUT_SECONDS = 0.1  # 主循环轮询超时时间
