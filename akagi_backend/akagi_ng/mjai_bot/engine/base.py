from typing import Any, Literal, Self

import numpy as np

EngineType = Literal["mortal", "akagiot", "replay", "unknown", "null"]


class BaseEngine:
    def __init__(self, is_3p: bool, version: int, name: str, is_oracle: bool = False):
        self.is_3p = is_3p
        self.version = version
        self.name = name
        self.is_oracle = is_oracle

        # 核心状态信息
        self.engine_type: EngineType = "unknown"
        self.is_online = False
        self.is_sync = False

    def fork(self) -> Self:
        """
        创建当前引擎的副本（Fork）。
        共享底层的重资源（如模型、网络连接），但拥有独立的状态。
        用于确保 Lookahead 等子任务不会污染主任务的状态。
        """
        raise NotImplementedError("Subclasses must implement fork()")

    @property
    def enable_rule_based_agari_guard(self) -> bool:
        """
        是否启用基于规则的和牌保护（防止振听/无役和牌）。
        在线模型通常自带保护，本地模型可能需要。
        """
        return True

    @property
    def enable_quick_eval(self) -> bool:
        return True

    def reset_status(self):
        """重置引擎内部状态（如回退标志）。默认不执行任何操作。"""
        pass

    def _sync_fast_forward(
        self,
        masks: np.ndarray,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """
        同步模式下的快进逻辑。
        在同步/回放模式下，跳过实际推理，返回第一个合法动作。
        """
        batch_size = masks.shape[0]
        action_space = masks.shape[1]
        # np.argmax 返回第一个 True 的索引，符合最低合法动作原则
        actions = np.argmax(masks, axis=1).tolist()
        q_out = [[0.0] * action_space for _ in range(batch_size)]
        clean_masks = masks.tolist()
        is_greedy = [True] * batch_size

        return actions, q_out, clean_masks, is_greedy

    def react_batch(
        self,
        obs: np.ndarray,
        masks: np.ndarray,
        invisible_obs: np.ndarray | None = None,
        is_sync: bool | None = None,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """
        批量推理接口 (Stateless).

        Args:
            obs: 观测数据
            masks: 动作掩码
            invisible_obs: 不可见观测数据 (Oracle模式用)
            is_sync: 是否为同步/回放模式. 若为 None 则使用 self.is_sync.

        Returns:
            (actions, q_out, masks, is_greedy)

        Note:
            子类实现时应使用 is_sync 参数（或 self.is_sync），
            如果为 True，调用 self._sync_fast_forward(masks) 跳过实际推理。
        """
        raise NotImplementedError("Subclasses must implement react_batch()")

    def get_notification_flags(self) -> dict[str, Any]:
        """
        返回引擎的通知标志（如网络故障、熔断等）。
        """
        return {}

    def get_additional_meta(self) -> dict[str, Any]:
        """
        返回需要合并到推荐响应中的附加元数据。
        """
        return {}
