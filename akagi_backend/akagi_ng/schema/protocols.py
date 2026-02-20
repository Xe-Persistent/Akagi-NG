from typing import Protocol, Self

import numpy as np

from akagi_ng.schema.types import (
    AkagiEvent,
    ElectronMessage,
    EngineAdditionalMeta,
    EngineAdditionalMetaKey,
    EngineType,
    MJAIEvent,
    MJAIResponse,
    NotificationFlagKey,
    NotificationFlags,
)


class BotStatusContext(Protocol):
    """Bot 状态上下文协议。"""

    @property
    def flags(self) -> NotificationFlags:
        """获取所有标志位。"""
        ...

    @property
    def metadata(self) -> EngineAdditionalMeta:
        """获取所有元数据。"""
        ...

    def set_flag(self, key: NotificationFlagKey, value: bool = True) -> None:
        """设置通知标志位。"""
        ...

    def set_metadata(self, key: EngineAdditionalMetaKey, value: EngineType | bool) -> None:
        """设置附加元数据。"""
        ...

    def clear_flags(self) -> None:
        """清除所有通知标志位。"""
        ...

    def clear_metadata(self) -> None:
        """清除所有附加元数据。"""
        ...

    def clear(self) -> None:
        """重置所有状态。"""
        ...


class EngineProtocol(Protocol):
    """引擎协议接口。"""

    is_3p: bool
    version: int
    name: str
    is_oracle: bool
    status: BotStatusContext

    @property
    def enable_quick_eval(self) -> bool: ...

    @property
    def enable_rule_based_agari_guard(self) -> bool: ...

    @property
    def enable_amp(self) -> bool: ...

    def reset_status(self) -> None:
        """重置引擎状态（如回退标志）。"""
        ...

    def fork(self, status: BotStatusContext | None = None) -> Self:
        """创建引擎副本。"""
        ...

    def react_batch(
        self,
        obs: np.ndarray,
        masks: np.ndarray,
        invisible_obs: np.ndarray | None = None,
        is_sync: bool | None = None,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """批量处理。"""
        ...


class BotProtocol(Protocol):
    """MJAI Bot 协议接口。"""

    status: BotStatusContext

    def react(self, event: MJAIEvent) -> MJAIResponse:
        """处理单个事件并返回响应。"""
        ...


class GameBridge(Protocol):
    """游戏桥接器协议接口。

    负责解析特定平台的消息并转换为 MJAI 事件。
    """

    def reset(self) -> None:
        """重置桥接器状态。"""
        ...

    def parse(self, content: bytes) -> list[AkagiEvent] | None:
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

    def push_message(self, message: ElectronMessage) -> None:
        """向客户端推送消息。"""
        ...


class ControllerProtocol(Protocol):
    """MJAI Controller 协议接口。

    负责管理 Bot 生命周期和事件分发。
    """

    def react(self, event: AkagiEvent) -> MJAIResponse:
        """响应 MJAI 或 系统事件。"""
        ...
