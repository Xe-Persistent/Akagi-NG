from typing import Any, TypedDict

import numpy as np

from akagi_ng.settings import local_settings


class InferenceResult(TypedDict):
    actions: list[int]
    q_out: list[list[float]]
    masks: list[list[bool]]
    is_greedy: list[bool]


class BaseEngine:
    def __init__(self, is_3p: bool, version: int, name: str, is_oracle: bool = False):
        self.is_3p = is_3p
        self.version = version
        self.name = name
        self.is_oracle = is_oracle

        # 核心状态信息
        self.engine_type = "base"
        self.is_online = False
        self.is_sync_mode = False  # 显式同步/回放模式标志
        self.last_inference_result: InferenceResult | None = None

    @property
    def enable_rule_based_agari_guard(self) -> bool:
        return local_settings.model_config.rule_based_agari_guard

    @property
    def enable_amp(self) -> bool:
        return False

    @property
    def enable_quick_eval(self) -> bool:
        return True

    def set_sync_mode(self, enabled: bool):
        """
        显式设置引擎是否处于同步/重连回放模式。
        在同步模式下，引擎通常应返回快速估算的动作以跳过神经网络计算。
        """
        self.is_sync_mode = enabled

    def react_batch(
        self, obs: np.ndarray, masks: np.ndarray, invisible_obs: np.ndarray
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """
        批量推理接口。子类必须实现。
        """
        raise NotImplementedError

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
