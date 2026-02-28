from typing import Self

import numpy as np

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.schema.notifications import NotificationCode
from akagi_ng.schema.protocols import BotStatusContext
from akagi_ng.schema.types import EngineType


class EngineProvider(BaseEngine):
    """
    引擎调度器 (Engine Hub/Provider)。
    负责管理在线 (AkagiOT) 和本地 (Mortal) 引擎。
    通过显式的状态管理实现稳定的引擎回退。
    """

    def __init__(
        self,
        status: BotStatusContext,
        online_engine: BaseEngine | None,
        local_engine: BaseEngine,
        is_3p: bool,
    ) -> None:
        # 初始化基类信息
        name = f"Provider({online_engine.name if online_engine else 'None'} -> {local_engine.name})"
        super().__init__(status=status, is_3p=is_3p, version=4, name=name)

        self.online_engine = online_engine
        self.local_engine = local_engine

        # 内部状态
        self.active_engine = self.online_engine if self.online_engine else self.local_engine
        self.fallback_active = False

        # 初始注入元数据，以便 Bot 初始化时能识别引擎类型
        self.status.set_metadata(NotificationCode.ENGINE_TYPE, self.active_engine.engine_type)

    def react_batch(
        self,
        obs: np.ndarray,
        masks: np.ndarray,
        invisible_obs: np.ndarray | None = None,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """
        核心调度逻辑：
        1. 尝试在线引擎。
        2. 如果在线引擎不可用或抛出异常，自动回退到本地引擎。
        """
        res: tuple[list[int], list[list[float]], list[list[bool]], list[bool]] | None = None

        # 1. 尝试在线引擎
        if self.online_engine:
            try:
                res = self.online_engine.react_batch(obs, masks, invisible_obs)
                self.active_engine = self.online_engine
                self.fallback_active = False
            except Exception as e:
                self.fallback_active = True
                self.status.set_flag(NotificationCode.FALLBACK_USED)
                logger.warning(f"EngineProvider: Online engine failed ({e}). Falling back to local.")

        # 2. 如果在线失败或未启用，走本地引擎
        if res is None:
            self.active_engine = self.local_engine
            res = self.local_engine.react_batch(obs, masks, invisible_obs)

        # 3. 统计上报与元数据精炼 ( Reactor 模式的统一元数据点 )
        # 确保不向前端返回 None，且状态语义清晰。
        # 默认值：全线崩溃时的状态 (NullEngine)
        engine_type: EngineType = "null"
        fallback_used = False
        reconnecting = False

        if self.active_engine.engine_type != "null":
            # 正常执行或回退执行
            primary = self.online_engine if self.online_engine else self.local_engine
            engine_type = primary.engine_type
            fallback_used = self.fallback_active

            # 处理在线重连标志：
            # 仅在“启用在线引擎”且“执行失败/熔断”时，继承由 AkagiOTClient 设置的 RECONNECTING 标志位。
            # 否则（如在线成功、原生本地、全线崩溃）均显式设为 False。
            if self.online_engine and self.fallback_active:
                reconnecting = self.status.metadata.get(NotificationCode.RECONNECTING, False)
        else:
            # 终极崩溃状态
            self.status.set_flag(NotificationCode.NO_BOT_LOADED)

        # 批量设置经过计算的最终元数据，确保 key 始终存在且不为 None
        self.status.set_metadata(NotificationCode.ENGINE_TYPE, engine_type)
        self.status.set_metadata(NotificationCode.FALLBACK_USED, fallback_used)
        self.status.set_metadata(NotificationCode.RECONNECTING, reconnecting)

        return res

    def fork(self, status: BotStatusContext | None = None) -> Self:
        """创建 Provider 无状态副本，同时 Fork 内部引擎"""
        new_status = status or self.status
        online_fork = self.online_engine.fork(status=new_status) if self.online_engine else None
        local_fork = self.local_engine.fork(status=new_status)
        provider_fork = EngineProvider(new_status, online_fork, local_fork, self.is_3p)

        # 复制回退状态，确保 Fork 后的引擎行为一致
        provider_fork.fallback_active = self.fallback_active
        if self.fallback_active:
            provider_fork.active_engine = provider_fork.local_engine

        return provider_fork
