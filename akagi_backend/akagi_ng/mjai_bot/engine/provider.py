from typing import Any, Self

import numpy as np

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.logger import logger


class EngineProvider(BaseEngine):
    """
    引擎调度器 (Engine Hub/Provider)。
    负责管理在线 (AkagiOT) 和本地 (Mortal) 引擎。
    通过显式的状态管理实现稳定的引擎回退。
    """

    def __init__(self, online_engine: BaseEngine | None, local_engine: BaseEngine, is_3p: bool):
        # 初始化基类信息
        name = f"Provider({online_engine.name if online_engine else 'None'} -> {local_engine.name})"
        super().__init__(is_3p=is_3p, version=4, name=name)

        self.online_engine = online_engine
        self.local_engine = local_engine

        # 内部状态
        self.active_engine = self.online_engine if self.online_engine else self.local_engine
        self.fallback_active = False

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
                logger.warning(f"EngineProvider: Online engine failed ({e}). Falling back to local.")

        # 2. 本地引擎作为最终保底
        self.active_engine = self.local_engine

        return self.local_engine.react_batch(obs, masks, invisible_obs, is_sync=is_sync)

    def fork(self) -> Self:
        """创建 Provider 无状态副本，同时 Fork 内部引擎"""
        online_fork = self.online_engine.fork() if self.online_engine else None
        local_fork = self.local_engine.fork()
        provider_fork = EngineProvider(online_fork, local_fork, self.is_3p)

        # 复制回退状态，确保 Fork 后的引擎行为一致
        provider_fork.fallback_active = self.fallback_active
        if self.fallback_active:
            provider_fork.active_engine = provider_fork.local_engine

        return provider_fork

    def get_notification_flags(self) -> dict[str, Any]:
        """聚合所有受管引擎的通知标志"""
        flags = {}
        if self.online_engine:
            flags.update(self.online_engine.get_notification_flags())
        flags.update(self.local_engine.get_notification_flags())

        if self.fallback_active:
            flags["fallback_used"] = True

        # 如果最终激活的是空引擎，说明全线崩溃
        if self.active_engine and self.active_engine.engine_type == "null":
            flags["no_engine_available"] = True

        return flags

    def get_additional_meta(self) -> dict[str, Any]:
        """聚合引擎元数据"""
        # 始终包含当前激活引擎的类型
        # 使用在线引擎时，即使回退到本地，也报告在线引擎类型
        primary_engine = self.online_engine if self.online_engine else self.local_engine
        meta = {"engine_type": primary_engine.engine_type}
        if self.online_engine:
            meta.update(self.online_engine.get_additional_meta())
        meta.update(self.local_engine.get_additional_meta())

        if self.fallback_active:
            meta["fallback_used"] = True

        # 同步注入空引擎状态
        if self.active_engine and self.active_engine.engine_type == "null":
            meta["no_engine_available"] = True

        return meta
