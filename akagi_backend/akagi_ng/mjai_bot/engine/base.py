import abc
import contextlib
from contextvars import ContextVar
from typing import Any, Literal, TypedDict

import numpy as np

EngineType = Literal["mortal", "akagiot", "unknown", "null"]


class InferenceResult(TypedDict):
    actions: list[int]
    q_out: list[list[float]]
    masks: list[list[bool]]
    is_greedy: list[bool]


# 定义 ContextVar 用于跨 C++ 边界传递配置
_ENGINE_OPTIONS_VAR: ContextVar[dict] = ContextVar("engine_options", default=None)


@contextlib.contextmanager
def engine_options(options: dict):
    """
    上下文管理器，用于设置当前线程/任务的引擎选项。
    用于解决 C++ 调用 Python 回调时无法传递额外参数的问题。
    """
    token = _ENGINE_OPTIONS_VAR.set(options)
    try:
        yield
    finally:
        _ENGINE_OPTIONS_VAR.reset(token)


def get_current_options() -> dict:
    return _ENGINE_OPTIONS_VAR.get() or {}


class BaseEngine(abc.ABC):
    def __init__(self, is_3p: bool, version: int, name: str, is_oracle: bool = False):
        self.is_3p = is_3p
        self.version = version
        self.name = name
        self.is_oracle = is_oracle

        # 核心状态信息
        self.engine_type: EngineType = "unknown"
        self.is_online = False
        self.last_inference_result: InferenceResult | None = None

    @property
    def enable_rule_based_agari_guard(self) -> bool:
        """
        是否启用基于规则的和牌保护（防止振听/无役和牌）。
        在线模型通常自带保护，本地模型可能需要。
        """
        return True

    @property
    def enable_amp(self) -> bool:
        return False

    @property
    def enable_quick_eval(self) -> bool:
        return True

    def _sync_fast_forward(
        self, masks: np.ndarray
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """
        同步模式下的快进逻辑。
        在同步/回放模式下，跳过实际推理，返回第一个合法动作。

        子类应在 react_batch 中检测 is_sync 选项，并调用此方法处理同步模式。
        """
        batch_size = masks.shape[0]
        action_space = masks.shape[1]
        # np.argmax 返回第一个 True 的索引，符合最低合法动作原则
        actions = np.argmax(masks, axis=1).tolist()
        q_out = [[0.0] * action_space for _ in range(batch_size)]
        clean_masks = masks.tolist()
        is_greedy = [True] * batch_size

        self.last_inference_result = {
            "actions": actions,
            "q_out": q_out,
            "masks": clean_masks,
            "is_greedy": is_greedy,
        }
        return actions, q_out, clean_masks, is_greedy

    @abc.abstractmethod
    def react_batch(
        self,
        obs: np.ndarray,
        masks: np.ndarray,
        invisible_obs: np.ndarray,
        options: dict | None = None,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """
        批量推理接口 (Stateless).

        Args:
            obs: 观测数据
            masks: 动作掩码
            invisible_obs: 不可见观测数据 (Oracle模式用)
            options: 请求级配置选项. 如果为 None, 尝试从 contextvar 获取.

        Returns:
            (actions, q_out, masks, is_greedy)

        Note:
            子类实现时应检测 options.get("is_sync", False)，
            如果为 True，调用 self._sync_fast_forward(masks) 跳过实际推理。
        """
        ...

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
