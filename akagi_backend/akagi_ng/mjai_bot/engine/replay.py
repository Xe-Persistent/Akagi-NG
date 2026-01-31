import numpy as np

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.logger import logger


class ReplayEngine(BaseEngine):
    """
    回放引擎包装器。
    在回放阶段返回预录制的操作，回放结束后委托给真实引擎。
    用于在 libriichi 中快进状态，避免触发网络请求。
    """

    def __init__(self, delegate: BaseEngine, history_actions: list[int | None] | None = None):
        super().__init__(
            is_3p=delegate.is_3p,
            version=getattr(delegate, "version", 1),
            name=f"ReplayWrapper({delegate.name})",
            is_oracle=delegate.is_oracle,
        )
        self.delegate = delegate
        self.history_actions = history_actions or []
        self.cursor = 0
        self.replay_mode = False

        self.engine_type = "replay_wrapper"

    def start_replaying(self):
        """进入回放/同步模式"""
        self.replay_mode = True
        self.cursor = 0
        logger.debug("ReplayEngine: Replay mode started.")

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
        self, obs: np.ndarray, masks: np.ndarray, invisible_obs: np.ndarray
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        if self.replay_mode:
            batch_size = obs.shape[0]
            actions = []

            # 向量化处理逻辑：提取每个 mask 中第一个 True 的索引
            # masks 形状为 (batch_size, 54)，值为 bool 或 0/1
            # np.argmax 返回第一个最大值（即 True）的索引
            # 如果整行都是 False，argmax 会返回 0，这符合 fallback 逻辑
            fast_actions = np.argmax(masks, axis=1)

            for i in range(batch_size):
                if self.cursor < len(self.history_actions) and self.history_actions[self.cursor] is not None:
                    # 如果有预设的历史动作，优先使用
                    actions.append(int(self.history_actions[self.cursor]))
                else:
                    # 否则使用向量化计算出的首个合法动作
                    actions.append(int(fast_actions[i]))
                self.cursor += 1

            q_out = [[0.0] * masks.shape[1] for _ in range(batch_size)]
            clean_masks = masks.tolist()
            is_greedy = [True] * batch_size

            return actions, q_out, clean_masks, is_greedy

        # 回放结束，委托给真实引擎
        return self.delegate.react_batch(obs, masks, invisible_obs)
