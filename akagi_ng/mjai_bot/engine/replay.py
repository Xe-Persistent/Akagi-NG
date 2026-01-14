from typing import Any

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.logger import logger


class ReplayEngine(BaseEngine):
    """
    回放引擎包装器。
    在回放阶段返回预录制的操作，回放结束后委托给真实引擎。
    用于在 libriichi 中快进状态，避免触发网络请求。
    """

    def __init__(self, delegate: BaseEngine, history_actions: list[Any]):
        super().__init__(
            is_3p=delegate.is_3p,
            version=getattr(delegate, "version", 1),
            name=f"ReplayWrapper({delegate.name})",
            is_oracle=delegate.is_oracle,
        )
        self.delegate = delegate
        self.history_actions = history_actions
        self.cursor = 0
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

    def react_batch(self, obs, masks, invisible_obs):
        if self.replay_mode:
            batch_size = len(masks)
            actions = []
            q_out = []
            clean_masks = []
            is_greedy = []

            for i in range(batch_size):
                self.cursor += 1
                m = masks[i]
                legal_indices = [idx for idx, val in enumerate(m) if val]
                chosen_action = legal_indices[0] if legal_indices else 0

                actions.append(int(chosen_action))
                q_out.append([0.0] * len(m))
                clean_masks.append([bool(x) for x in m])
                is_greedy.append(True)

            return actions, q_out, clean_masks, is_greedy

        # 回放结束，委托给真实引擎
        logger.debug("ReplayEngine: Delegating batch request to real engine.")
        return self.delegate.react_batch(obs, masks, invisible_obs)
