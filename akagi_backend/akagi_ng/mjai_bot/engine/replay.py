from typing import Self

import numpy as np

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.protocols import EngineProtocol


class ReplayEngine(BaseEngine):
    """
    回放引擎包装器。
    在回放阶段返回预录制的操作（或默认操作），回放结束后委托给真实引擎。
    用于在 libriichi 中快进状态，避免触发网络请求。
    """

    def __init__(self, status: BotStatusContext, delegate: EngineProtocol):
        self.delegate = delegate
        super().__init__(
            status=status,
            is_3p=delegate.is_3p,
            version=getattr(delegate, "version", 1),
            name=f"ReplayWrapper({delegate.name})",
            is_oracle=delegate.is_oracle,
        )
        self.replay_mode = True
        self.engine_type = "replay"

    def stop_replaying(self):
        """停止回放模式，切换到真实引擎"""
        self.replay_mode = False
        logger.debug("ReplayEngine: Replay mode stopped, switching to real engine.")

    def fork(self, status: BotStatusContext | None = None) -> Self:
        """创建 ReplayEngine 副本，同时 Fork 内部委托引擎"""
        new_status = status or self.status
        forked = ReplayEngine(new_status, self.delegate.fork(status=new_status))
        forked.replay_mode = self.replay_mode
        return forked

    @property
    def enable_quick_eval(self) -> bool:
        return self.delegate.enable_quick_eval

    @property
    def enable_rule_based_agari_guard(self) -> bool:
        return self.delegate.enable_rule_based_agari_guard

    def react_batch(
        self,
        obs: np.ndarray,
        masks: np.ndarray,
        invisible_obs: np.ndarray | None = None,
        is_sync: bool | None = None,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """
        核心逻辑：
        - replay_mode=True: 执行同步快进（不调用底层引擎）
        - replay_mode=False: 透传给底层引擎
        """
        obs = np.asanyarray(obs)
        masks = np.asanyarray(masks)

        if is_sync is None:
            is_sync = self.is_sync or self.replay_mode

        if is_sync:
            logger.debug(
                f"ReplayEngine({self.name}): Synchronous fast-forward "
                f"(is_sync={self.is_sync}, replay_mode={self.replay_mode})"
            )
            # 复用基类的同步快进逻辑
            return self._sync_fast_forward(masks)

        res_actions, res_q_out, res_masks, res_greedy = self.delegate.react_batch(
            obs, masks, invisible_obs, is_sync=is_sync
        )

        # 鲁棒性增强: 强制转换为 Python 原生 list，满足部分 strict Rust Bridge (如 libriichi3p) 的要求
        final_actions = res_actions if isinstance(res_actions, list) else res_actions.tolist()
        final_q_out = res_q_out if isinstance(res_q_out, list) else res_q_out.tolist()
        final_masks = res_masks if isinstance(res_masks, list) else res_masks.tolist()
        final_greedy = res_greedy if isinstance(res_greedy, list) else res_greedy.tolist()

        return final_actions, final_q_out, final_masks, final_greedy
