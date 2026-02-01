from typing import Any

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

    def set_sync_mode(self, enabled: bool):
        """显式设置同步模式，并应用到所有受管引擎"""
        super().set_sync_mode(enabled)
        if self.online_engine:
            self.online_engine.set_sync_mode(enabled)
        self.local_engine.set_sync_mode(enabled)

    def react_batch(
        self, obs: np.ndarray, masks: np.ndarray, invisible_obs: np.ndarray
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """
        核心调度逻辑：
        1. 尝试在线引擎。
        2. 如果在线引擎不可用或抛出异常，自动回退到本地引擎。
        """
        self.fallback_active = False

        # 1. 尝试在线引擎 (如果配置了且没有处于熔断状态 - 熔断逻辑由 OTEngine 内部维护)
        if self.online_engine:
            try:
                res = self.online_engine.react_batch(obs, masks, invisible_obs)
                self.active_engine = self.online_engine
                self.last_inference_result = self.online_engine.last_inference_result
                return res
            except Exception as e:
                logger.warning(f"EngineProvider: Online engine failed ({e}). Falling back to local.")
                self.fallback_active = True

        # 2. 本地引擎作为最终保底
        self.active_engine = self.local_engine
        res = self.local_engine.react_batch(obs, masks, invisible_obs)
        self.last_inference_result = self.local_engine.last_inference_result
        return res

    def get_notification_flags(self) -> dict[str, Any]:
        """聚合所有受管引擎的通知标志"""
        flags = {}
        if self.online_engine:
            flags.update(self.online_engine.get_notification_flags())
        flags.update(self.local_engine.get_notification_flags())

        if self.fallback_active:
            flags["fallback_used"] = True

        return flags

    def get_additional_meta(self) -> dict[str, Any]:
        """聚合引擎元数据"""
        meta = {}
        # 始终包含当前激活引擎的类型
        meta["engine_type"] = self.active_engine.engine_type

        if self.online_engine:
            meta.update(self.online_engine.get_additional_meta())
        meta.update(self.local_engine.get_additional_meta())

        return meta
