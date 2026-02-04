"""通知代码常量定义。

集中管理所有通知代码,避免在代码中使用硬编码字符串。
"""

from enum import StrEnum


class NotificationCode(StrEnum):
    """通知代码常量类。"""

    # ============================================================
    # 服务状态通知
    # ============================================================
    RECONNECTING = "online_service_reconnecting"
    """在线服务连接中断,正在重连"""

    SERVICE_RESTORED = "online_service_restored"
    """在线服务连接已恢复"""

    FALLBACK_USED = "fallback_used"
    """在线服务不可用，已切换至本地模型"""

    MODEL_LOADED_LOCAL = "model_loaded_local"
    """已加载本地模型"""

    MODEL_LOADED_ONLINE = "model_loaded_online"
    """已加载在线模型"""

    # ============================================================
    # Bot 功能状态通知
    # ============================================================
    RIICHI_SIM_FAILED = "riichi_simulation_failed"
    """立直模拟推演失败"""

    # ============================================================
    # 游戏事件通知
    # ============================================================
    CLIENT_CONNECTED = "client_connected"
    """游戏已连接"""

    GAME_CONNECTED = "game_connected"
    """对局已连接,AI 已就绪"""

    GAME_SYNCING = "game_syncing"
    """正在同步对局数据"""

    GAME_DISCONNECTED = "game_disconnected"
    """对局断开连接"""

    RETURN_LOBBY = "return_lobby"
    """返回大厅"""

    MAJSOUL_PROTO_UPDATED = "majsoul_proto_updated"
    """雀魂协议文件更新成功"""

    MAJSOUL_PROTO_UPDATE_FAILED = "majsoul_proto_update_failed"
    """雀魂协议文件更新失败"""

    # ============================================================
    # 数据处理错误
    # ============================================================
    PARSE_ERROR = "game_data_parse_failed"
    """游戏数据解析异常"""

    JSON_DECODE_ERROR = "json_decode_error"
    """JSON 数据解析失败"""

    # ============================================================
    # Bot 错误
    # ============================================================
    NO_BOT_LOADED = "no_bot_loaded"
    """Bot 未加载"""

    BOT_SWITCH_FAILED = "bot_switch_failed"
    """Bot 切换失败"""

    BOT_RUNTIME_ERROR = "bot_runtime_error"
    """Bot 运行异常"""

    STATE_TRACKER_ERROR = "state_tracker_error"
    """对局状态异常"""
