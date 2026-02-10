from typing import Any

import numpy as np

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.logger import logger


class ReplayEngine(BaseEngine):
    """
    回放引擎包装器。
    在回放阶段返回预录制的操作（或默认操作），回放结束后委托给真实引擎。
    用于在 libriichi 中快进状态，避免触发网络请求。
    """

    def __init__(self, delegate: BaseEngine):
        super().__init__(
            is_3p=delegate.is_3p,
            version=getattr(delegate, "version", 1),
            name=f"ReplayWrapper({delegate.name})",
            is_oracle=delegate.is_oracle,
        )
        self.delegate = delegate
        self.replay_mode = True
        self.engine_type = "replay_wrapper"

    def stop_replaying(self):
        """停止回放模式，切换到真实引擎"""
        self.replay_mode = False
        logger.debug("ReplayEngine: Replay mode stopped, switching to real engine.")

    @property
    def enable_quick_eval(self) -> bool:
        return self.delegate.enable_quick_eval

    @property
    def enable_rule_based_agari_guard(self) -> bool:
        return self.delegate.enable_rule_based_agari_guard

    @property
    def enable_amp(self) -> bool:
        return self.delegate.enable_amp

    def react_batch(
        self,
        obs: np.ndarray,
        masks: np.ndarray,
        invisible_obs: np.ndarray,
        options: dict | None = None,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """
        核心逻辑：
        - replay_mode=True: 执行同步快进（不调用底层引擎）
        - replay_mode=False: 透传给底层引擎
        """
        if self.replay_mode:
            # 复用基类的同步快进逻辑
            return self._sync_fast_forward(masks)

        # 回放结束，委托给真实引擎
        # 注意：这里不需要再传递 options，因为 contextvar 已经由上层管理（如果用到的话）
        # 但为了兼容 BaseEngine 签名，如果有 options 还是传一下
        return self.delegate.react_batch(obs, masks, invisible_obs, options=options)

    def get_notification_flags(self) -> dict[str, Any]:
        return self.delegate.get_notification_flags()

    def get_additional_meta(self) -> dict[str, Any]:
        return self.delegate.get_additional_meta()
