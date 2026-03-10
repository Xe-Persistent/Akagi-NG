from collections.abc import Sequence
from typing import Protocol, Self

import numpy as np

from akagi_ng.schema.types import (
    AkagiEvent,
    ElectronMessage,
    EngineAdditionalMeta,
    EngineAdditionalMetaKey,
    EngineType,
    FullRecommendationData,
    MJAIEvent,
    MJAIMetadata,
    MJAIResponse,
    NotificationFlagKey,
    NotificationFlags,
)


class MessageWithContent(Protocol):
    content: bytes


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

    def set_flag(self, key: NotificationFlagKey, value: bool = True):
        """设置通知标志位。"""
        ...

    def set_metadata(self, key: EngineAdditionalMetaKey, value: EngineType | bool):
        """设置附加元数据。"""
        ...

    def clear_flags(self):
        """清除所有通知标志位。"""
        ...

    def clear_metadata(self):
        """清除所有附加元数据。"""
        ...

    def clear(self):
        """重置所有状态。"""
        ...


class ActionCandidatesProtocol(Protocol):
    can_discard: bool
    can_riichi: bool
    can_chi: bool
    can_chi_low: bool
    can_chi_mid: bool
    can_chi_high: bool
    can_pon: bool
    can_kan: bool
    can_ankan: bool
    can_kakan: bool
    can_daiminkan: bool
    can_tsumo_agari: bool
    can_ron_agari: bool
    can_ryukyoku: bool


class PlayerStateProtocol(Protocol):
    self_riichi_accepted: bool
    last_cans: ActionCandidatesProtocol
    tehai: Sequence[int]
    akas_in_hand: list[bool]
    shanten: int
    waits: list[int]

    def last_self_tsumo(self) -> str | None: ...
    def last_kawa_tile(self) -> str | None: ...
    def update(self, events: str): ...
    def brief_info(self) -> str: ...
    def ankan_candidates(self) -> Sequence[str]: ...
    def kakan_candidates(self) -> Sequence[str]: ...
    def discardable_tiles_riichi_declaration(self) -> Sequence[str]: ...


class EngineProtocol(Protocol):
    """引擎协议接口。"""

    is_3p: bool
    version: int
    name: str
    is_oracle: bool
    status: BotStatusContext
    enable_quick_eval: bool
    enable_amp: bool
    enable_rule_based_agari_guard: bool


    def reset_status(self):
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
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """批量处理。"""
        ...


class MJAIBotProtocol(Protocol):
    """底层 C++ Bot 协议接口。

    直接处理原始 MJAI JSON 字符串，具有同步和推理能力。
    """

    def react(self, event_json: str, can_act: bool = True) -> str | None:
        """接收并返回原始 MJAI JSON 字符串。"""
        ...


class BotProtocol(Protocol):
    """MJAI Bot 协议接口。"""

    is_3p: bool
    status: BotStatusContext

    def react(self, event: MJAIEvent) -> MJAIResponse | None:
        """处理单个事件并返回响应。"""
        ...


class StateTrackerProtocol(BotProtocol, Protocol):
    """状态追踪器协议接口。"""

    meta: MJAIMetadata
    player_state: PlayerStateProtocol | None

    @property
    def last_self_tsumo(self) -> str | None: ...

    @property
    def last_kawa_tile(self) -> str | None: ...

    @property
    def self_riichi_accepted(self) -> bool: ...

    @property
    def can_tsumo_agari(self) -> bool: ...

    @property
    def tehai_mjai_with_aka(self) -> list[str]: ...

    @property
    def discardable_tiles_riichi_declaration(self) -> list[str]: ...

    def build_recommendations(self, response: MJAIResponse) -> FullRecommendationData | None: ...


class GameBridge(Protocol):
    """游戏桥接器协议接口。

    负责解析特定平台的消息并转换为 MJAI 事件。
    """

    def reset(self):
        """重置桥接器状态。"""
        ...

    def parse(self, content: bytes) -> list[AkagiEvent] | None:
        """解析平台消息。"""
        ...


class MessageSource(Protocol):
    """消息源协议接口。

    负责接收和转发游戏消息（如 ElectronClient 或 MitmClient）。
    """

    def start(self):
        """启动消息源。"""
        ...

    def stop(self):
        """停止消息源。"""
        ...


class ElectronClientProtocol(MessageSource, Protocol):
    """Electron 客户端协议接口。

    除了基本的消息源功能外，还支持向客户端推送消息。
    """

    def push_message(self, message: ElectronMessage):
        """向客户端推送消息。"""
        ...


class ControllerProtocol(Protocol):
    """MJAI Controller 协议接口。

    负责管理 Bot 生命周期和事件分发。
    """

    last_response: MJAIResponse | None

    def react(self, event: AkagiEvent):
        """响应 MJAI 或 系统事件。"""
        ...
