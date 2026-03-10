from typing import Self

import numpy as np

from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.types import EngineType


class BaseEngine:
    def __init__(
        self,
        status: BotStatusContext,
        is_3p: bool,
        version: int,
        name: str,
        is_oracle: bool = False,
    ):
        self.status = status
        self.is_3p = is_3p
        self.version = version
        self.name = name
        self.is_oracle = is_oracle

        # 核心状态信息
        self.engine_type: EngineType = "unknown"
        self.is_online = False

        # quick_eval=True 会导致只有一个候选动作时跳过引擎推理，不返回 meta
        self.enable_quick_eval = False

        # torch.autocast 参数，CPU 推理无需 AMP
        self.enable_amp = False

        # 是否启用基于规则的和牌保护（防止振听/无役和牌）。
        # 在线模型通常自带保护，本地模型可能需要。
        self.enable_rule_based_agari_guard = True

    def fork(self, status: BotStatusContext | None = None) -> Self:
        """
        创建当前引擎的副本（Fork）。
        共享底层的重资源（如模型、网络连接），但拥有独立的状态。
        用于确保 Lookahead 等子任务不会污染主任务的状态。
        """
        raise NotImplementedError("Subclasses must implement fork()")

    def react_batch(
        self,
        obs: np.ndarray,
        masks: np.ndarray,
        invisible_obs: np.ndarray | None = None,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """
        批量推理接口 (Stateless).

        Args:
            obs: 观测数据
            masks: 动作掩码
            invisible_obs: 不可见观测数据 (Oracle模式用)

        Returns:
            (actions, q_out, masks, is_greedy)
        """
        raise NotImplementedError("Subclasses must implement react_batch()")
