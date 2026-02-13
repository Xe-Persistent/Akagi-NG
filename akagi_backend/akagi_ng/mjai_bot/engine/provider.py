from typing import Self

import numpy as np

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.schema.notifications import NotificationCode
from akagi_ng.schema.protocols import BotStatusContext


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
    ):
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
        is_sync: bool | None = None,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """
        核心调度逻辑：
        1. 尝试在线引擎。
        2. 如果在线引擎不可用或抛出异常，自动回退到本地引擎。
        """
        if is_sync is None:
            is_sync = self.is_sync

        # 1. 尝试在线引擎 (如果配置了且没有处于熔断状态 - 熔断逻辑由 OTEngine 内部维护)
        if self.online_engine:
            try:
                res = self.online_engine.react_batch(obs, masks, invisible_obs, is_sync=is_sync)
                self.active_engine = self.online_engine

                self.fallback_active = False

                return res
            except Exception as e:
                self.fallback_active = True
                self.status.set_flag(NotificationCode.FALLBACK_USED)
                logger.warning(f"EngineProvider: Online engine failed ({e}). Falling back to local.")

        # 2. 本地引擎作为最终保底
        self.active_engine = self.local_engine
        res = self.local_engine.react_batch(obs, masks, invisible_obs, is_sync=is_sync)

        # 同步注入元数据
        # 即使底层引擎（如 LocalEngine）在 react_batch 中设置了元数据，
        # Provider 也要确保最终上报的是主引擎类型（如 AkagiOT）及回退标志。
        primary_engine = self.online_engine if self.online_engine else self.local_engine
        self.status.set_metadata(NotificationCode.ENGINE_TYPE, primary_engine.engine_type)
        if self.fallback_active:
            self.status.set_metadata(NotificationCode.FALLBACK_USED, True)

        # 如果最终激活的是空引擎，说明全线崩溃
        if self.active_engine and self.active_engine.engine_type == "null":
            self.status.set_flag(NotificationCode.NO_BOT_LOADED)
            self.status.set_metadata(NotificationCode.NO_BOT_LOADED, True)

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
