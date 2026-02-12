from typing import Any, Protocol, Self, TypedDict

import numpy as np


class MjaiMetadata(TypedDict, total=False):
    """MJAI 协议响应中的元数据字段 (meta)。"""

    # 核心推理预测
    q_values: list[float]
    mask_bits: int
    is_greedy: bool
    batch_size: int
    eval_time_ns: int

    # C++ 注入数据 (来自 libriichi)
    shanten: int
    at_furiten: bool

    # 业务层注入数据
    engine_type: str
    fallback_used: bool
    circuit_open: bool
    game_start: bool

    # 嵌套前瞻结果
    riichi_lookahead: Self


class EngineProtocol(Protocol):
    """引擎协议接口。"""

    is_3p: bool
    version: int
    name: str
    is_oracle: bool

    @property
    def enable_quick_eval(self) -> bool: ...

    @property
    def enable_rule_based_agari_guard(self) -> bool: ...

    @property
    def enable_amp(self) -> bool: ...

    def reset_status(self) -> None:
        """重置引擎状态（如回退标志）。"""
        ...

    def fork(self) -> Self:
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

    def get_notification_flags(self) -> dict[str, Any]:
        """获取通知标志。"""
        ...

    def get_additional_meta(self) -> dict[str, Any]:
        """获取附加元数据。"""
        ...


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
