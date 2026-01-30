"""通知处理器 - 负责从各种来源构造通知对象。"""

from typing import ClassVar

from akagi_ng.core.notification_codes import NotificationCode


class NotificationHandler:
    """
    通知处理器 - 无状态工具类。

    所有方法都是静态的,可以直接通过类名调用,无需实例化。
    """

    # ============================================================
    # 配置: 所有映射表集中在类开头
    # ============================================================

    # 1. 消息类型 → 通知
    MESSAGE_NOTIFICATIONS: ClassVar[dict[str, str]] = {
        "start_game": NotificationCode.GAME_CONNECTED,
    }

    # 2. 通知标志 → 通知
    FLAG_NOTIFICATIONS: ClassVar[dict[str, str]] = {
        "fallback_used": NotificationCode.FALLBACK_USED,
        "circuit_open": NotificationCode.RECONNECTING,
        "circuit_restored": NotificationCode.SERVICE_RESTORED,
        "riichi_lookahead": NotificationCode.RIICHI_SIM_FAILED,
        "model_loaded_local": NotificationCode.MODEL_LOADED_LOCAL,
        "model_loaded_online": NotificationCode.MODEL_LOADED_ONLINE,
    }

    # 3. 错误代码 → 通知代码的映射
    ERROR_CODE_MAP: ClassVar[dict[str, str]] = {
        "parse_error": NotificationCode.PARSE_ERROR,
    }

    # ============================================================
    # 公开方法: 对外提供的通知提取接口
    # ============================================================

    @staticmethod
    def from_message(msg: dict) -> dict | None:
        """
        从 MJAI 消息提取通知。

        Args:
            msg: MJAI 消息字典

        Returns:
            通知对象,如果消息不产生通知则返回 None
        """
        msg_type = msg.get("type")

        # 系统事件(携带动态 code)
        if msg_type == "system_event":
            code = msg.get("code")
            return _make_notification(code)

        # 已知消息类型
        if msg_type in NotificationHandler.MESSAGE_NOTIFICATIONS:
            code = NotificationHandler.MESSAGE_NOTIFICATIONS[msg_type]
            return _make_notification(code)

        return None

    @staticmethod
    def from_flags(flags: dict) -> list[dict]:
        """
        从通知标志字典提取通知列表。

        Args:
            flags: 通知标志字典

        Returns:
            通知对象列表
        """
        notifications = []
        for flag_key, code in NotificationHandler.FLAG_NOTIFICATIONS.items():
            if flags.get(flag_key):
                notifications.append(_make_notification(code))
        return notifications

    @staticmethod
    def from_error_response(response: dict) -> dict | None:
        """
        从错误响应提取通知。

        Args:
            response: MJAI 响应字典

        Returns:
            通知对象,如果没有错误则返回 None
        """
        error_code = response.get("error")
        if not error_code:
            return None

        # 映射错误代码
        code = NotificationHandler.ERROR_CODE_MAP.get(error_code, error_code)
        return _make_notification(code)


# ============================================================
# 私有工具函数
# ============================================================


def _make_notification(code: str) -> dict:
    """
    构造通知对象(模块私有)。

    Args:
        code: 通知代码

    Returns:
        通知对象
    """
    return {"code": code}
