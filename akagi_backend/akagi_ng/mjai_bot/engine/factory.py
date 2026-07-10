import threading
from pathlib import Path
from types import ModuleType
from typing import Self

import numpy as np

from akagi_ng.core.paths import get_models_dir
from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.engine.provider import EngineProvider
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.notifications import NotificationCode
from akagi_ng.schema.protocols import EngineProtocol, MJAIBotProtocol
from akagi_ng.schema.types import MortalModelResource
from akagi_ng.settings import local_settings

# 资源缓存
# Key: model path. V3 cloud inference is event-level and is managed by
# MortalBot, not by the tensor-level EngineProtocol.
_RESOURCE_CACHE: dict[str, MortalModelResource] = {}
_CACHE_LOCK = threading.Lock()


def clear_resource_cache(key_prefix: str | None = None):
    """清理全局资源缓存。

    Args:
        key_prefix: 如果指定，只清理匹配前缀的条目（如 "model:"）。
                    如果为 None，清空全部缓存。
    """
    with _CACHE_LOCK:
        if key_prefix is None:
            _RESOURCE_CACHE.clear()
        else:
            keys_to_remove = [k for k in _RESOURCE_CACHE if k.startswith(key_prefix)]
            for k in keys_to_remove:
                del _RESOURCE_CACHE[k]


class NullEngine(BaseEngine):
    """
    空引擎 - 在所有引擎都不可用时提供兜底。
    返回第一个合法动作，并通过 notification_flags 告知前端引擎不可用。
    """

    def __init__(self, status: BotStatusContext, is_3p: bool):
        super().__init__(status=status, is_3p=is_3p, version=4, name="Null", is_oracle=False)
        self.engine_type = "null"

    def fork(self, status: BotStatusContext | None = None) -> Self:
        return NullEngine(status or self.status, self.is_3p)

    def react_batch(
        self,
        obs: np.ndarray,
        masks: np.ndarray,
        invisible_obs: np.ndarray | None = None,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        return self._fast_forward(np.asanyarray(masks))

    @staticmethod
    def _fast_forward(masks: np.ndarray) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """返回第一个合法动作，作为兜底策略。"""
        batch_size = masks.shape[0]
        action_space = masks.shape[1]
        actions = np.argmax(masks, axis=1).tolist()
        q_out = [[0.0] * action_space for _ in range(batch_size)]
        clean_masks = masks.tolist()
        is_greedy = [True] * batch_size
        return actions, q_out, clean_masks, is_greedy


class LazyLocalEngine(BaseEngine):
    """
    轻量级延迟加载引擎。
    仅在第一次调用 react_batch 时从全局缓存加载资源并创建 MortalEngine。
    """

    def __init__(self, status: BotStatusContext, model_path: Path, consts: ModuleType, is_3p: bool):
        super().__init__(status=status, is_3p=is_3p, version=4, name="Local", is_oracle=False)
        self.model_path = model_path
        self.consts = consts
        self.engine_type = "mortal"
        self._real_engine: BaseEngine | None = None
        self._load_failed = False

    def fork(self, status: BotStatusContext | None = None) -> Self:
        return LazyLocalEngine(status or self.status, self.model_path, self.consts, self.is_3p)

    def _ensure_engine(self) -> BaseEngine:
        if self._real_engine is None and not self._load_failed:
            # 尝试从全局资源缓存获取或加载
            resource = _get_or_load_model_resource(self.model_path, self.consts, self.is_3p)

            from akagi_ng.mjai_bot.engine.mortal import MortalEngine

            if resource:
                self._real_engine = MortalEngine(self.status, resource, self.is_3p)
            else:
                logger.error(f"Failed to load local model at {self.model_path}. Using NullEngine as fallback.")
                self._load_failed = True
                self.status.set_flag(NotificationCode.MODEL_LOAD_FAILED)
                self.engine_type = "null"
                self._real_engine = NullEngine(self.status, self.is_3p)

        return self._real_engine

    def react_batch(
        self,
        obs: np.ndarray,
        masks: np.ndarray,
        invisible_obs: np.ndarray | None = None,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        real_engine = self._ensure_engine()
        return real_engine.react_batch(obs, masks, invisible_obs)


def _get_or_load_model_resource(model_path: Path, consts: ModuleType, is_3p: bool) -> MortalModelResource | None:
    """获取或加载模型资源缓存。"""
    cache_key = f"model:{model_path}"
    with _CACHE_LOCK:
        if cache_key not in _RESOURCE_CACHE:
            logger.info("Factory: Loading model resource from disk...")
            from akagi_ng.mjai_bot.engine.mortal import load_mortal_resource

            resource = load_mortal_resource(model_path, consts, is_3p)
            if resource:
                _RESOURCE_CACHE[cache_key] = resource
            else:
                return None
        return _RESOURCE_CACHE[cache_key]


def load_bot_and_engine(
    status: BotStatusContext, player_id: int, is_3p: bool = False
) -> tuple[MJAIBotProtocol, EngineProtocol]:
    """加载引擎的统一入口"""
    if is_3p:
        from akagi_ng.core.lib_loader import libriichi3p as libs

        model_filename = local_settings.model_config.model_3p
    else:
        from akagi_ng.core.lib_loader import libriichi as libs

        model_filename = local_settings.model_config.model_4p

    consts = libs.consts
    model_path = get_models_dir() / model_filename

    # 1. 准备 Lazy Local Engine (持有资源引用，按需加载)
    local_engine = LazyLocalEngine(status, model_path, consts, is_3p)

    # V3 cloud inference consumes the MJAI stream and returns an MJAI action,
    # so it sits one layer above libriichi's tensor engine. The provider remains
    # local and supplies both the legal-action gate and automatic fallback.
    provider = EngineProvider(status, None, local_engine, is_3p)

    bot = libs.mjai.Bot(provider, player_id)

    return bot, provider
