"""项目协议定义。

集中定义所有协议接口，供类型检查和依赖注入使用。
"""

from typing import Protocol


class Bot(Protocol):
    """MJAI Bot 协议接口。"""

    def react(self, events: str) -> str:
        """处理事件并返回响应。"""
        ...


class NotificationSource(Protocol):
    """通知源协议接口。

    实现此协议的类可以提供通知标志，用于前端 Toast/Alert 显示。
    """

    @property
    def notification_flags(self) -> dict[str, bool]:
        """返回当前的通知标志字典。"""
        ...


class GameBridge(Protocol):
    """游戏桥接器协议接口。

    负责解析特定平台的消息并转换为 MJAI 事件。
    """

    def reset(self) -> None:
        """重置桥接器状态。"""
        ...

    def parse(self, content: bytes) -> list[dict] | None:
        """解析平台消息。"""
        ...


class MessageSource(Protocol):
    """消息源协议接口。

    负责接收和转发游戏消息（如 ElectronClient 或 MitmClient）。
    """

    def start(self) -> None:
        """启动消息源。"""
        ...

    def stop(self) -> None:
        """停止消息源。"""
        ...


class ElectronClientProtocol(MessageSource, Protocol):
    """Electron 客户端协议接口。

    除了基本的消息源功能外，还支持向客户端推送消息。
    """

    def push_message(self, message: dict) -> None:
        """向客户端推送消息。"""
        ...


class ControllerProtocol(Protocol):
    """MJAI Controller 协议接口。

    负责管理 Bot 生命周期和事件分发。
    """

    def react(self, input_event: dict) -> dict | None:
        """响应 MJAI 事件。"""
        ...

    @property
    def notification_flags(self) -> dict:
        """获取通知标志。"""
        ...
